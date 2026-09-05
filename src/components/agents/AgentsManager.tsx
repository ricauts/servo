"use client";

// Specialist agents: the resolver personas the repository ships in
// agents/<slug>.md, on the shared MasterDetail shell — one rail listing every
// specialist with its On/Off chip, one pane with the key, the tool allowlist
// and the .md itself (rendered read-only, edited inline). Create stays a
// dialog in the actions slot; the tool picker stays a dialog too.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Bot, Pencil, Plus, SlidersHorizontal, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import Badge from "@/components/common/Badge";
import Spinner from "@/components/common/Spinner";
import EmptyState from "@/components/common/EmptyState";
import MasterDetail, {
  type MasterDetailItem,
} from "@/components/common/MasterDetail";
import Markdown from "@/components/tickets/Markdown";
import MarkdownEditor, {
  stripFrontmatter,
} from "@/components/agents/MarkdownEditor";
import { CATEGORY_LABEL, RISK_LABEL, RISK_TONE } from "@/lib/labels";
import type { Category, RiskLevel } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface AgentProfileView {
  id: string;
  slug: string;
  name: string;
  description: string;
  categories: string[];
  tools: string[];
  markdown: string;
  enabled: boolean;
  credentialId: string | null;
  runCount: number;
}

export interface ToolCatalogItem {
  name: string;
  description: string;
  riskLevel: RiskLevel;
  requiresApproval: boolean;
  /** Core tools are always granted and cannot be toggled off. */
  core: boolean;
}

export interface CredentialOption {
  id: string;
  name: string;
}

/** Radix Select items cannot carry an empty value — sentinel for "default". */
const DEFAULT_CREDENTIAL = "DEFAULT";

const NEW_AGENT_TEMPLATE = `---
name: My Specialist Agent
description: One line on what this specialist owns.
categories: [OTHER]
tools: []
---

You are Servo's **specialist** for … Describe how this agent should work:
what to check first, what to be careful with, and when to hand off to a
human instead of acting.
`;

const EDITOR_HELP =
  "Markdown with YAML frontmatter: name, description, categories, tools. The body is the agent's system prompt.";

async function api(
  path: string,
  method: string,
  body?: unknown,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(path, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.ok) return { ok: true };
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: data.error ?? `Request failed (${res.status}).` };
  } catch {
    return { ok: false, error: "Network error — nothing was changed." };
  }
}

/** Checkbox picker for a profile's tool allowlist. Empty selection = every
 * enabled tool (the profile default); core tools are always on and locked. */
function ToolPickerDialog({
  open,
  onOpenChange,
  catalog,
  selected,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  catalog: ToolCatalogItem[];
  selected: string[];
  onSave: (tools: string[]) => Promise<string | null>;
}) {
  // Start from the profile's current allowlist; if it's empty the profile
  // grants everything, so pre-check every non-core tool to make that explicit.
  const optional = catalog.filter((t) => !t.core);
  const allOptional = optional.map((t) => t.name);
  const [picked, setPicked] = useState<Set<string>>(
    () => new Set(selected.length > 0 ? selected : allOptional),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seed when the dialog reopens with a different profile.
  const [lastSelected, setLastSelected] = useState(selected.join(","));
  const key = selected.join(",");
  if (key !== lastSelected) {
    setLastSelected(key);
    setPicked(new Set(selected.length > 0 ? selected : allOptional));
  }

  function toggle(name: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  async function save() {
    setBusy(true);
    setError(null);
    // All optional tools checked → store [] (means "all enabled tools").
    const chosen = allOptional.filter((n) => picked.has(n));
    const tools = chosen.length === allOptional.length ? [] : chosen;
    const err = await onSave(tools);
    setBusy(false);
    if (err) setError(err);
    else onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Tools & permissions</DialogTitle>
          <DialogDescription>
            Choose which tools this agent may call. Risk level and approval
            gates come from the global tool policy and apply on top.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[55vh] space-y-1.5 overflow-y-auto">
          {catalog.map((tool) => {
            const checked = tool.core || picked.has(tool.name);
            return (
              <label
                key={tool.name}
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2 transition-colors",
                  checked
                    ? "border-line-brand bg-brand-soft"
                    : "border-border hover:bg-surface-hover",
                  tool.core && "cursor-default opacity-90",
                )}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={tool.core || busy}
                  onChange={() => toggle(tool.name)}
                  className="mt-1 h-4 w-4 accent-primary"
                />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className="font-mono text-[12.5px] font-medium">
                      {tool.name}
                    </span>
                    <Badge tone={RISK_TONE[tool.riskLevel]}>
                      {RISK_LABEL[tool.riskLevel]}
                    </Badge>
                    {tool.requiresApproval && <Badge tone="warn">Approval</Badge>}
                    {tool.core && <Badge tone="neutral">Always on</Badge>}
                  </span>
                  <span className="mt-0.5 block text-[12px] text-muted-foreground">
                    {tool.description}
                  </span>
                </span>
              </label>
            );
          })}
        </div>

        {error && <p className="text-[13px] text-critical">{error}</p>}

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button type="button" onClick={() => void save()} disabled={busy}>
            {busy && <Spinner size={14} className="text-primary-foreground" />}
            Save tools
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const ROW_LABEL =
  "w-16 shrink-0 font-mono text-[10.5px] tracking-[0.14em] text-text-faint uppercase";

/** The detail pane: identity strip, key, tools, the .md (read-only or the
 *  inline editor) and the delete footer. The shell's header already carries
 *  the name and description. */
function AgentDetail({
  profile,
  catalog,
  credentials,
  canManage,
}: {
  profile: AgentProfileView;
  catalog: ToolCatalogItem[];
  credentials: CredentialOption[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [pickingTools, setPickingTools] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function toggleEnabled(enabled: boolean) {
    setBusy(true);
    setError(null);
    const res = await api(`/api/agents/${profile.id}`, "PATCH", { enabled });
    if (!res.ok) setError(res.error ?? null);
    else router.refresh();
    setBusy(false);
  }

  async function remove() {
    setBusy(true);
    setError(null);
    const res = await api(`/api/agents/${profile.id}`, "DELETE");
    if (!res.ok) {
      setError(res.error ?? null);
      setBusy(false);
    } else {
      router.refresh();
    }
  }

  return (
    <div className="flex flex-col gap-4 font-sans">
      {/* Identity strip: the handle, the run count, scope, the on/off control. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <Bot size={16} aria-hidden className="text-text-brand" />
          <code
            className="rounded border border-border bg-surface-inset px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground"
            title="The profile's handle. It never changes when you rename the agent."
          >
            {profile.slug}
          </code>
          <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
            {profile.runCount} run{profile.runCount === 1 ? "" : "s"}
          </span>
          {profile.categories.map((c) => (
            <Badge key={c} tone="brand">
              {CATEGORY_LABEL[c as Category] ?? c}
            </Badge>
          ))}
        </div>
        {canManage ? (
          <label className="flex items-center gap-2 font-mono text-[10.5px] tracking-[0.14em] text-text-faint uppercase">
            {profile.enabled ? "Enabled" : "Disabled"}
            <Switch
              checked={profile.enabled}
              disabled={busy}
              onCheckedChange={(v) => void toggleEnabled(v)}
              aria-label={`${profile.name} enabled`}
            />
          </label>
        ) : (
          <Badge tone={profile.enabled ? "good" : "neutral"}>
            {profile.enabled ? "On" : "Off"}
          </Badge>
        )}
      </div>

      {canManage && credentials.length > 0 && (
        <div className="flex items-center gap-3">
          <span className={ROW_LABEL}>API key</span>
          <Select
            value={profile.credentialId ?? DEFAULT_CREDENTIAL}
            disabled={busy}
            onValueChange={(value) => {
              void (async () => {
                setBusy(true);
                const res = await api(`/api/agents/${profile.id}`, "PATCH", {
                  credentialId: value === DEFAULT_CREDENTIAL ? null : value,
                });
                if (!res.ok) setError(res.error ?? null);
                else router.refresh();
                setBusy(false);
              })();
            }}
          >
            <SelectTrigger size="sm" className="w-full max-w-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={DEFAULT_CREDENTIAL}>Default provider</SelectItem>
              <SelectSeparator />
              {credentials.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="flex items-start gap-3">
        <span className={cn(ROW_LABEL, "pt-1.5")}>Tools</span>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
          {profile.tools.length > 0 ? (
            profile.tools.map((t) => (
              <code
                key={t}
                className="rounded border border-border bg-surface-inset px-1.5 py-0.5 font-mono text-[10.5px] text-muted-foreground"
              >
                {t}
              </code>
            ))
          ) : (
            <span className="text-[12.5px] text-muted-foreground">
              all enabled tools
            </span>
          )}
          {canManage && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setPickingTools(true)}
            >
              <SlidersHorizontal size={13} />
              Tools
            </Button>
          )}
        </div>
      </div>

      {/* The document: rendered read-only, or the same text in the editor. */}
      <section className="overflow-hidden rounded-lg border border-border">
        <header className="flex min-h-9 items-center justify-between gap-2 border-b border-border bg-surface-inset px-3 py-1">
          <span className="truncate font-mono text-[12px] text-muted-foreground">
            agents/{profile.slug}.md
          </span>
          {editing ? (
            <span className="font-mono text-[10.5px] tracking-[0.14em] text-text-brand uppercase">
              Editing
            </span>
          ) : (
            canManage && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setEditing(true)}
              >
                <Pencil size={13} />
                Edit .md
              </Button>
            )
          )}
        </header>
        <div className="p-4">
          {editing ? (
            <MarkdownEditor
              initial={profile.markdown}
              help={EDITOR_HELP}
              saveLabel="Save agent"
              autoFocus
              onCancel={() => setEditing(false)}
              onSave={async (markdown) => {
                const res = await api(`/api/agents/${profile.id}`, "PATCH", { markdown });
                if (!res.ok) return res.error ?? "Save failed.";
                router.refresh();
                setEditing(false);
                return null;
              }}
            />
          ) : (
            <Markdown>{stripFrontmatter(profile.markdown)}</Markdown>
          )}
        </div>
      </section>

      {canManage && (
        <footer className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
          {confirmDelete ? (
            <>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={busy}
                onClick={() => void remove()}
              >
                Delete
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setConfirmDelete(false)}
              >
                Keep
              </Button>
            </>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-destructive"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 size={13} />
              Delete
            </Button>
          )}
        </footer>
      )}

      {error && <p className="text-[13px] text-critical">{error}</p>}

      <ToolPickerDialog
        open={pickingTools}
        onOpenChange={setPickingTools}
        catalog={catalog}
        selected={profile.tools}
        onSave={async (tools) => {
          const res = await api(`/api/agents/${profile.id}`, "PATCH", { tools });
          if (res.ok) router.refresh();
          return res.ok ? null : (res.error ?? "Save failed.");
        }}
      />
    </div>
  );
}

export default function AgentsManager({
  profiles,
  toolCatalog,
  credentials,
  canManage,
  initialSlug,
}: {
  profiles: AgentProfileView[];
  toolCatalog: ToolCatalogItem[];
  credentials: CredentialOption[];
  canManage: boolean;
  /** From /agents?agent=<slug>: the rail row to open first. */
  initialSlug?: string;
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);

  // Enabled first, then by name — the rail reads as "who resolves today".
  const ordered = [...profiles].sort(
    (a, b) => Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name),
  );

  const items: MasterDetailItem[] = ordered.map((profile) => ({
    id: profile.slug,
    title: profile.name,
    subtitle: profile.description,
    icon: <Bot size={16} />,
    status: profile.enabled
      ? { label: "On", tone: "good" }
      : { label: "Off", tone: "neutral" },
    keywords: [
      profile.slug,
      ...profile.categories,
      ...profile.categories.map((c) => CATEGORY_LABEL[c as Category] ?? c),
      ...profile.tools,
    ],
    body: (
      <AgentDetail
        profile={profile}
        catalog={toolCatalog}
        credentials={credentials}
        canManage={canManage}
      />
    ),
  }));

  const newAgent = canManage ? (
    <Button onClick={() => setCreating(true)}>
      <Plus size={15} />
      New agent
    </Button>
  ) : undefined;

  return (
    <>
      <MasterDetail
        title="Agents"
        param="agent"
        initialId={initialSlug}
        keepMounted
        items={items}
        actions={newAgent}
        emptyState={
          <EmptyState
            icon={Bot}
            title="No specialized agents yet"
            hint={
              canManage
                ? "Create one from a .md template, or drop files into the repo's agents/ directory and reseed."
                : "An admin can create specialized agents from .md definitions."
            }
            action={newAgent}
          />
        }
      />

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>New specialized agent</DialogTitle>
            <DialogDescription>{EDITOR_HELP}</DialogDescription>
          </DialogHeader>
          <MarkdownEditor
            initial={NEW_AGENT_TEMPLATE}
            saveLabel="Save agent"
            onCancel={() => setCreating(false)}
            onSave={async (markdown) => {
              const res = await api("/api/agents", "POST", { markdown });
              if (!res.ok) return res.error ?? "Save failed.";
              router.refresh();
              setCreating(false);
              return null;
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
