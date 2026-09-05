"use client";

// Desk skills: the procedures this desk has agreed to follow, edited as the
// same Markdown documents the repository ships in skills/<slug>/SKILL.md.
// One rail, one pane (the shared MasterDetail): the rail lists every skill
// with its On/Off chip, the pane renders the procedure read-only and swaps
// the same text into an inline editor on demand. Deliberately the
// AgentsManager shape — an admin who has edited an agent already knows how
// to edit a skill.

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { BookOpen, Pencil, Plus, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import Badge from "@/components/common/Badge";
import EmptyState from "@/components/common/EmptyState";
import MasterDetail, {
  type MasterDetailItem,
} from "@/components/common/MasterDetail";
import Markdown from "@/components/tickets/Markdown";
import MarkdownEditor, {
  stripFrontmatter,
} from "@/components/agents/MarkdownEditor";
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

function categoryBadges(categories: string[]) {
  if (categories.length === 0) return <Badge tone="brand">Every ticket</Badge>;
  return categories.map((c) => (
    <Badge key={c} tone="brand">
      {CATEGORY_LABEL[c as Category] ?? c}
    </Badge>
  ));
}

/** The detail pane: identity strip, the SKILL.md (read-only or inline
 *  editor) and the delete footer. The shell already carries name and
 *  description in its header. */
function SkillDetail({ skill, canManage }: { skill: SkillView; canManage: boolean }) {
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
    <div className="flex flex-col gap-4 font-sans">
      {/* Identity strip: the handle, its scope, the on/off control. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <BookOpen size={16} aria-hidden className="text-text-brand" />
          <code
            className="rounded border border-border bg-surface-inset px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground"
            title="The handle read_skill takes. It never changes when you rename the skill."
          >
            {skill.slug}
          </code>
          {categoryBadges(skill.categories)}
        </div>
        {canManage ? (
          <label className="flex items-center gap-2 font-mono text-[10.5px] tracking-[0.14em] text-text-faint uppercase">
            {skill.enabled ? "Enabled" : "Disabled"}
            <Switch
              checked={skill.enabled}
              disabled={busy}
              onCheckedChange={(v) => void toggleEnabled(v)}
              aria-label={`${skill.name} enabled`}
            />
          </label>
        ) : (
          <Badge tone={skill.enabled ? "good" : "neutral"}>
            {skill.enabled ? "On" : "Off"}
          </Badge>
        )}
      </div>

      {/* The document: rendered read-only, or the same text in the editor. */}
      <section className="overflow-hidden rounded-lg border border-border">
        <header className="flex min-h-9 items-center justify-between gap-2 border-b border-border bg-surface-inset px-3 py-1">
          <span className="truncate font-mono text-[12px] text-muted-foreground">
            skills/{skill.slug}/SKILL.md
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
                Edit SKILL.md
              </Button>
            )
          )}
        </header>
        <div className="p-4">
          {editing ? (
            <MarkdownEditor
              initial={skill.markdown}
              help={EDITOR_HELP}
              saveLabel="Save skill"
              autoFocus
              onCancel={() => setEditing(false)}
              onSave={async (markdown) => {
                const res = await api(`/api/skills/${skill.id}`, "PATCH", { markdown });
                if (!res.ok) return res.error ?? "Save failed.";
                router.refresh();
                setEditing(false);
                return null;
              }}
            />
          ) : (
            <Markdown>{stripFrontmatter(skill.markdown)}</Markdown>
          )}
        </div>
      </section>

      {canManage && (
        <footer className="flex flex-col gap-2 border-t border-border pt-3">
          <div className="flex flex-wrap items-center gap-2">
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
          {confirmDelete && (
            <p className="text-[12.5px] text-muted-foreground">
              A bundled skill comes back on the next upgrade. To retire one for
              good, switch it off instead — agents are told a disabled skill must
              not be followed.
            </p>
          )}
        </footer>
      )}

      {error && <p className="text-[13px] text-critical">{error}</p>}
    </div>
  );
}

export default function SkillsManager({
  skills,
  canManage,
  prefillMarkdown = null,
  prefillSourceTicketId = null,
  initialSlug,
}: {
  skills: SkillView[];
  canManage: boolean;
  /** From /skills?distill=<id>: the deterministic prefill (reb-05). */
  prefillMarkdown?: string | null;
  prefillSourceTicketId?: string | null;
  /** From /skills?skill=<slug>: the rail row to open first. */
  initialSlug?: string;
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(prefillMarkdown !== null);

  // Enabled first, then by name — the rail reads as "what applies today".
  const ordered = [...skills].sort(
    (a, b) => Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name),
  );

  const items: MasterDetailItem[] = ordered.map((skill) => ({
    id: skill.slug,
    title: skill.name,
    subtitle: skill.description,
    description: (
      <>
        {skill.description}
        {skill.sourceTicketId && (
          <Link
            href={`/tickets/${skill.sourceTicketId}`}
            className="ml-1.5 font-mono text-[10.5px] tracking-wide text-text-brand uppercase hover:underline"
            title="The ticket this skill was distilled from"
          >
            from #{skill.sourceTicketNumber ?? "?"}
          </Link>
        )}
      </>
    ),
    icon: <BookOpen size={16} />,
    status: skill.enabled
      ? { label: "On", tone: "good" }
      : { label: "Off", tone: "neutral" },
    keywords: [
      skill.slug,
      ...skill.categories,
      ...skill.categories.map((c) => CATEGORY_LABEL[c as Category] ?? c),
    ],
    body: <SkillDetail skill={skill} canManage={canManage} />,
  }));

  const newSkill = canManage ? (
    <Button onClick={() => setCreating(true)}>
      <Plus size={15} />
      New skill
    </Button>
  ) : undefined;

  return (
    <>
      <MasterDetail
        title="Skills"
        param="skill"
        initialId={initialSlug}
        keepMounted
        items={items}
        actions={newSkill}
        emptyState={
          <EmptyState
            icon={BookOpen}
            title="No desk skills yet"
            hint={
              canManage
                ? "Write one from the template, or drop a skills/<slug>/SKILL.md into the repo and re-run npm run setup."
                : "An admin can write the procedures agents follow."
            }
            action={newSkill}
          />
        }
      />

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {prefillMarkdown ? "Distill into skill" : "New desk skill"}
            </DialogTitle>
            <DialogDescription>{EDITOR_HELP}</DialogDescription>
          </DialogHeader>
          <MarkdownEditor
            initial={prefillMarkdown ?? NEW_SKILL_TEMPLATE}
            saveLabel="Save skill"
            onCancel={() => setCreating(false)}
            onSave={async (markdown) => {
              const res = await api("/api/skills", "POST", {
                markdown,
                // Provenance rides the create when the editor was prefilled
                // from a ticket (reb-05); the server creates it DISABLED.
                ...(prefillSourceTicketId ? { sourceTicketId: prefillSourceTicketId } : {}),
              });
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
