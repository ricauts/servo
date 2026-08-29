"use client";

// Desk skills: the procedures this desk has agreed to follow, edited as the
// same Markdown documents the repository ships in skills/<slug>/SKILL.md.
// Deliberately the AgentsManager shape — an admin who has edited an agent
// already knows how to edit a skill.

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { BookOpen, Pencil, Plus, Trash2 } from "lucide-react";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import Badge from "@/components/legacy/Badge";
import EmptyState from "@/components/legacy/EmptyState";
import { CATEGORY_LABEL } from "@/lib/labels";
import type { Category } from "@/lib/types";

export interface SkillView {
  id: string;
  slug: string;
  name: string;
  description: string;
  categories: string[];
  markdown: string;
  enabled: boolean;
  /** Provenance (reb-05): the ticket this skill was distilled from. */
  sourceTicketId?: string | null;
  sourceTicketNumber?: number | null;
}

const NEW_SKILL_TEMPLATE = `---
name: My Desk Procedure
description: One line on when an agent should read this — it is all the agent sees before deciding to open it.
categories: [OTHER]
---

## When this applies

…

## Steps

1. …
2. …

## Never

- …
`;

const EDITOR_HELP =
  "Markdown with YAML frontmatter: name, description (the catalogue line agents choose from) and categories ([] = every ticket). The body is the procedure read_skill returns.";

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

function EditorDialog({
  title,
  initial,
  open,
  onOpenChange,
  onSave,
}: {
  title: string;
  initial: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (markdown: string) => Promise<string | null>;
}) {
  const [markdown, setMarkdown] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset the buffer each time the dialog opens with fresh content.
  const [lastInitial, setLastInitial] = useState(initial);
  if (initial !== lastInitial) {
    setLastInitial(initial);
    setMarkdown(initial);
  }

  async function save() {
    setBusy(true);
    setError(null);
    const err = await onSave(markdown);
    setBusy(false);
    if (err) setError(err);
    else onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{EDITOR_HELP}</DialogDescription>
        </DialogHeader>
        <Textarea
          value={markdown}
          onChange={(e) => setMarkdown(e.target.value)}
          rows={18}
          spellCheck={false}
          className="font-mono text-[12.5px] leading-relaxed"
        />
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
          <Button type="button" onClick={save} disabled={busy || !markdown.trim()}>
            Save skill
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SkillCard({ skill, canManage }: { skill: SkillView; canManage: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function toggleEnabled(enabled: boolean) {
    setBusy(true);
    setError(null);
    const res = await api(`/api/skills/${skill.id}`, "PATCH", { enabled });
    if (!res.ok) setError(res.error ?? null);
    else router.refresh();
    setBusy(false);
  }

  async function remove() {
    setBusy(true);
    setError(null);
    const res = await api(`/api/skills/${skill.id}`, "DELETE");
    if (!res.ok) {
      setError(res.error ?? null);
      setBusy(false);
    } else {
      router.refresh();
    }
  }

  return (
    <Card size="sm" className={skill.enabled ? "" : "opacity-70"}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BookOpen size={16} className="text-primary-strong" />
          {skill.name}
        </CardTitle>
        <CardDescription>
          {skill.description}
          {skill.sourceTicketId && (
            <Link
              href={`/tickets/${skill.sourceTicketId}`}
              className="ml-1.5 font-mono text-[10.5px] uppercase tracking-wide text-primary-strong hover:underline"
              title="The ticket this skill was distilled from"
            >
              from #{skill.sourceTicketNumber ?? "?"}
            </Link>
          )}
        </CardDescription>
        {canManage && (
          <CardAction>
            <Switch
              checked={skill.enabled}
              disabled={busy}
              onCheckedChange={(v) => void toggleEnabled(v)}
              aria-label={`${skill.name} enabled`}
            />
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-3 font-sans">
        <div className="flex flex-wrap items-center gap-1.5">
          {skill.categories.length === 0 ? (
            <Badge tone="brand">Every ticket</Badge>
          ) : (
            skill.categories.map((c) => (
              <Badge key={c} tone="brand">
                {CATEGORY_LABEL[c as Category] ?? c}
              </Badge>
            ))
          )}
          <span
            className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10.5px] text-muted-foreground"
            title="The handle read_skill takes. It never changes when you rename the skill."
          >
            {skill.slug}
          </span>
        </div>

        {canManage && (
          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setEditing(true)}
            >
              <Pencil size={13} />
              Edit SKILL.md
            </Button>
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
          </div>
        )}

        {confirmDelete && (
          <p className="text-[12.5px] text-muted-foreground">
            A bundled skill comes back on the next upgrade. To retire one for
            good, switch it off instead — agents are told a disabled skill must
            not be followed.
          </p>
        )}

        {error && <p className="text-[13px] text-critical">{error}</p>}
      </CardContent>

      <EditorDialog
        title={`Edit ${skill.name}`}
        initial={skill.markdown}
        open={editing}
        onOpenChange={setEditing}
        onSave={async (markdown) => {
          const res = await api(`/api/skills/${skill.id}`, "PATCH", { markdown });
          if (res.ok) router.refresh();
          return res.ok ? null : (res.error ?? "Save failed.");
        }}
      />
    </Card>
  );
}

export default function SkillsManager({
  skills,
  canManage,
  prefillMarkdown = null,
  prefillSourceTicketId = null,
}: {
  skills: SkillView[];
  canManage: boolean;
  /** From /skills?distill=<id>: the deterministic prefill (reb-05). */
  prefillMarkdown?: string | null;
  prefillSourceTicketId?: string | null;
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(prefillMarkdown !== null);

  return (
    <div className="space-y-4">
      {canManage && (
        <div className="flex justify-end">
          <Button onClick={() => setCreating(true)}>
            <Plus size={15} />
            New skill
          </Button>
        </div>
      )}

      {skills.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title="No desk skills yet"
          hint={
            canManage
              ? "Write one from the template, or drop a skills/<slug>/SKILL.md into the repo and re-run npm run setup."
              : "An admin can write the procedures agents follow."
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {skills.map((s) => (
            <SkillCard key={s.id} skill={s} canManage={canManage} />
          ))}
        </div>
      )}

      <EditorDialog
        title={prefillMarkdown ? "Distill into skill" : "New desk skill"}
        initial={prefillMarkdown ?? NEW_SKILL_TEMPLATE}
        open={creating}
        onOpenChange={setCreating}
        onSave={async (markdown) => {
          const res = await api("/api/skills", "POST", {
            markdown,
            // Provenance rides the create when the editor was prefilled
            // from a ticket (reb-05); the server creates it DISABLED.
            ...(prefillSourceTicketId ? { sourceTicketId: prefillSourceTicketId } : {}),
          });
          if (res.ok) router.refresh();
          return res.ok ? null : (res.error ?? "Save failed.");
        }}
      />
    </div>
  );
}
