"use client";

// The BYOK key pool: named credentials assignable to specialized agents from
// the /agents page. Keys are write-only — never displayed after creation.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { KeyRound, Plus, Trash2 } from "lucide-react";
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
import Badge from "@/components/common/Badge";
import Spinner from "@/components/common/Spinner";

export interface CredentialView {
  id: string;
  name: string;
  provider: string;
  model: string;
  baseUrl: string;
  inUse: number;
}

const PROVIDERS = [
  { value: "anthropic", label: "Anthropic" },
  { value: "zai", label: "Z.AI (GLM)" },
  { value: "openai", label: "OpenAI-compatible" },
];

export default function CredentialsManager({
  credentials,
}: {
  credentials: CredentialView[];
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [provider, setProvider] = useState("zai");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          provider,
          apiKey: apiKey.trim(),
          baseUrl: baseUrl.trim(),
          model: model.trim(),
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? `Save failed (${res.status}).`);
        return;
      }
      setCreating(false);
      setName("");
      setApiKey("");
      setBaseUrl("");
      setModel("");
      toast("Credential added to the pool");
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
      const res = await fetch(`/api/credentials/${id}`, { method: "DELETE" });
      if (res.ok) {
        toast("Credential removed — agents using it fall back to the default");
        router.refresh();
      }
    } finally {
      setBusy(false);
      setConfirmDelete(null);
    }
  }

  return (
    <div className="flex flex-col gap-3 font-sans">
      <p className="text-xs text-muted-foreground">
        Named keys assignable to specialized agents from the Agents page —
        separate billing, models, or providers per agent. Every model call is
        metered per key (see the throughput panel on Agents). Keys are never
        shown again after creation.
      </p>

      {credentials.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No pool credentials yet — agents run on the default provider above.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {credentials.map((c) => (
            <li key={c.id} className="flex items-center gap-3 py-2.5">
              <KeyRound size={15} className="shrink-0 text-primary-strong" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-medium">
                  {c.name}
                </span>
                <span className="block truncate font-mono text-[11px] text-muted-foreground">
                  {c.provider}
                  {c.model ? ` · ${c.model}` : ""}
                  {c.baseUrl ? ` · ${c.baseUrl}` : ""}
                </span>
              </span>
              <Badge tone={c.inUse > 0 ? "brand" : "neutral"}>
                {c.inUse} agent{c.inUse === 1 ? "" : "s"}
              </Badge>
              {confirmDelete === c.id ? (
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  disabled={busy}
                  onClick={() => void remove(c.id)}
                >
                  Confirm
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Delete ${c.name}`}
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => setConfirmDelete(c.id)}
                >
                  <Trash2 size={14} />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      <Button type="button" className="self-start" onClick={() => setCreating(true)}>
        <Plus size={15} />
        Add credential
      </Button>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add a pool credential</DialogTitle>
            <DialogDescription>
              A named API key agents can be assigned to.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cr-name">Name</Label>
              <Input
                id="cr-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="GLM Primary"
                disabled={busy}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cr-provider">Provider</Label>
              <Select value={provider} onValueChange={setProvider} disabled={busy}>
                <SelectTrigger id="cr-provider" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROVIDERS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor="cr-key">API key</Label>
              <Input
                id="cr-key"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                disabled={busy}
                autoComplete="off"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cr-model">
                Model <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="cr-model"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder={provider === "zai" ? "glm-5.2" : "claude-opus-5"}
                disabled={busy}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cr-url">
                Base URL <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="cr-url"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                disabled={busy}
                className="font-mono text-[13px]"
              />
            </div>
          </div>
          {error && <p className="text-[13px] text-critical">{error}</p>}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setCreating(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void create()}
              disabled={busy || !name.trim() || !apiKey.trim()}
            >
              {busy && <Spinner size={14} className="text-primary-foreground" />}
              Add credential
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
