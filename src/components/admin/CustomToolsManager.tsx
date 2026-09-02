"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Globe, Pencil, Plus, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import Badge from "@/components/common/Badge";
import { RISK_LABEL, RISK_TONE } from "@/lib/labels";
import type { RiskLevel } from "@/lib/types";

export interface CustomToolView {
  id: string;
  name: string;
  description: string;
  inputSchema: string;
  method: string;
  url: string;
  headers: string;
  bodyTemplate: string;
  secretSet: boolean;
  riskLevel: RiskLevel;
  requiresApproval: boolean;
}

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const RISKS: RiskLevel[] = ["LOW", "MEDIUM", "HIGH"];

const DEFAULT_SCHEMA = JSON.stringify(
  {
    type: "object",
    properties: {
      message: { type: "string", description: "Message to send" },
    },
    required: ["message"],
  },
  null,
  2,
);

interface FormState {
  name: string;
  description: string;
  inputSchema: string;
  method: string;
  url: string;
  headers: string;
  bodyTemplate: string;
  secret: string;
  riskLevel: RiskLevel;
  requiresApproval: boolean;
}

function emptyForm(): FormState {
  return {
    name: "",
    description: "",
    inputSchema: DEFAULT_SCHEMA,
    method: "POST",
    url: "",
    headers: JSON.stringify({ Authorization: "Bearer {secret}" }, null, 2),
    bodyTemplate: "",
    secret: "",
    riskLevel: "MEDIUM",
    requiresApproval: true,
  };
}

function formFrom(tool: CustomToolView): FormState {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    method: tool.method,
    url: tool.url,
    headers: tool.headers,
    bodyTemplate: tool.bodyTemplate,
    secret: "",
    riskLevel: tool.riskLevel,
    requiresApproval: tool.requiresApproval,
  };
}

export default function CustomToolsManager({
  tools,
}: {
  tools: CustomToolView[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  function openCreate() {
    setEditingId(null);
    setForm(emptyForm());
    setError(null);
    setOpen(true);
  }

  function openEdit(tool: CustomToolView) {
    setEditingId(tool.id);
    setForm(formFrom(tool));
    setError(null);
    setOpen(true);
  }

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function submit() {
    setBusy(true);
    setError(null);
    const body: Record<string, unknown> = {
      description: form.description,
      inputSchema: form.inputSchema,
      method: form.method,
      url: form.url,
      headers: form.headers,
      bodyTemplate: form.bodyTemplate,
      riskLevel: form.riskLevel,
      requiresApproval: form.requiresApproval,
    };
    if (!editingId) body.name = form.name;
    // On edit, an empty secret field means "keep the stored secret".
    if (!editingId || form.secret !== "") body.secret = form.secret;
    try {
      const res = await fetch(editingId ? `/api/tools/${editingId}` : "/api/tools", {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? `Save failed (${res.status}).`);
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      setError("Network error — nothing was changed.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/tools/${id}`, { method: "DELETE" });
      if (res.ok) router.refresh();
    } finally {
      setBusy(false);
      setConfirmDelete(null);
    }
  }

  return (
    <div className="flex flex-col gap-3 font-sans">
      {tools.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No custom tools yet. Define an HTTP integration (a webhook, an
          internal API, a SaaS endpoint) and the resolver can call it like any
          built-in tool — with the same risk levels and approval gates.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {tools.map((tool) => (
            <li key={tool.id} className="flex items-center gap-3 py-2.5">
              <Globe size={15} className="shrink-0 text-primary-strong" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-mono text-[13px] font-medium">
                  {tool.name}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {tool.method} {tool.url}
                </span>
              </span>
              <Badge tone={RISK_TONE[tool.riskLevel]}>
                {RISK_LABEL[tool.riskLevel]}
              </Badge>
              {tool.requiresApproval && <Badge tone="warn">Approval</Badge>}
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Edit ${tool.name}`}
                onClick={() => openEdit(tool)}
              >
                <Pencil size={14} />
              </Button>
              {confirmDelete === tool.id ? (
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  disabled={busy}
                  onClick={() => void remove(tool.id)}
                >
                  Confirm
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Delete ${tool.name}`}
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => setConfirmDelete(tool.id)}
                >
                  <Trash2 size={14} />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      <Button type="button" className="self-start" onClick={openCreate}>
        <Plus size={15} />
        New tool
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editingId ? `Edit ${form.name}` : "New custom tool"}
            </DialogTitle>
            <DialogDescription>
              An HTTP integration the resolver can call.{" "}
              <code className="font-mono text-xs">{"{input.field}"}</code>{" "}
              placeholders pull from the tool input;{" "}
              <code className="font-mono text-xs">{"{secret}"}</code> injects
              the stored secret.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ct-name">Tool name (snake_case)</Label>
              <Input
                id="ct-name"
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder="notify_oncall_webhook"
                disabled={busy || Boolean(editingId)}
                className="font-mono text-[13px]"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ct-description">Description (shown to the model)</Label>
              <Input
                id="ct-description"
                value={form.description}
                onChange={(e) => set("description", e.target.value)}
                placeholder="Send a message to the on-call channel"
                disabled={busy}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ct-method">Method</Label>
              <Select
                value={form.method}
                onValueChange={(v) => set("method", v)}
                disabled={busy}
              >
                <SelectTrigger id="ct-method" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {METHODS.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ct-url">URL</Label>
              <Input
                id="ct-url"
                value={form.url}
                onChange={(e) => set("url", e.target.value)}
                placeholder="https://hooks.example.com/oncall?msg={input.message}"
                disabled={busy}
                className="font-mono text-[13px]"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ct-schema">Input schema (JSON Schema)</Label>
            <Textarea
              id="ct-schema"
              value={form.inputSchema}
              onChange={(e) => set("inputSchema", e.target.value)}
              rows={6}
              spellCheck={false}
              disabled={busy}
              className="font-mono text-[12.5px]"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ct-headers">Headers (JSON)</Label>
              <Textarea
                id="ct-headers"
                value={form.headers}
                onChange={(e) => set("headers", e.target.value)}
                rows={4}
                spellCheck={false}
                disabled={busy}
                className="font-mono text-[12.5px]"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ct-body">
                Body template{" "}
                <span className="font-normal text-muted-foreground">
                  (empty = raw input JSON)
                </span>
              </Label>
              <Textarea
                id="ct-body"
                value={form.bodyTemplate}
                onChange={(e) => set("bodyTemplate", e.target.value)}
                rows={4}
                spellCheck={false}
                disabled={busy}
                placeholder='{"text": "{input.message}"}'
                className="font-mono text-[12.5px]"
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ct-secret">Secret</Label>
              <Input
                id="ct-secret"
                type="password"
                value={form.secret}
                onChange={(e) => set("secret", e.target.value)}
                placeholder={
                  editingId && form.secret === "" ? "•••• (kept)" : "token…"
                }
                disabled={busy}
                autoComplete="off"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ct-risk">Risk level</Label>
              <Select
                value={form.riskLevel}
                onValueChange={(v) => set("riskLevel", v as RiskLevel)}
                disabled={busy}
              >
                <SelectTrigger id="ct-risk" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RISKS.map((r) => (
                    <SelectItem key={r} value={r}>
                      {RISK_LABEL[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end gap-2 pb-2">
              <Switch
                id="ct-approval"
                checked={form.requiresApproval}
                onCheckedChange={(v) => set("requiresApproval", v)}
                disabled={busy}
              />
              <Label htmlFor="ct-approval">Requires approval</Label>
            </div>
          </div>

          {error && <p className="text-[13px] text-critical">{error}</p>}

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void submit()}
              disabled={
                busy || !form.url.trim() || (!editingId && !form.name.trim())
              }
            >
              {editingId ? "Save tool" : "Create tool"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
