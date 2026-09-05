"use client";

// Assignment groups on the shared MasterDetail shell: the rail lists every
// group with its open-ticket count and member count, the pane carries what
// the old card did — routed categories, members with their tier, add and
// remove, delete. Create stays a dialog in the actions slot.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, UserPlus, Users2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { Textarea } from "@/components/ui/textarea";
import Avatar from "@/components/common/Avatar";
import Badge from "@/components/common/Badge";
import EmptyState from "@/components/common/EmptyState";
import MasterDetail, {
  type MasterDetailItem,
} from "@/components/common/MasterDetail";
import { cn } from "@/lib/utils";
import { CATEGORIES, MEMBER_TIERS } from "@/lib/types";
import type { Category, MemberTier } from "@/lib/types";
import { CATEGORY_LABEL, SENIORITY_LABEL, SENIORITY_TONE } from "@/lib/labels";

export interface GroupView {
  id: string;
  name: string;
  description: string;
  categories: string[];
  openTickets: number;
  members: {
    userId: string;
    name: string;
    color: string;
    seniority: string;
  }[];
}

export interface MemberOption {
  id: string;
  name: string;
  color: string;
  role: string;
}

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

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

/** Category toggles as ds chips: the selected ones are opaque brand chips
 *  (surface + hairline + ink), the rest hairline-only. */
function CategoryToggles({
  selected,
  onToggle,
  disabled,
}: {
  selected: string[];
  onToggle: (c: Category) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {CATEGORIES.map((c) => {
        const active = selected.includes(c);
        return (
          <button
            key={c}
            type="button"
            disabled={disabled}
            onClick={() => onToggle(c)}
            aria-pressed={active}
            className={cn(
              "rounded-full border px-2.5 py-0.5 font-mono text-[10.5px] tracking-wide uppercase transition-colors",
              active
                ? "border-brand-chip-line bg-brand-chip text-brand-chip-ink"
                : "border-border text-muted-foreground",
              !active && !disabled && "hover:border-line-brand hover:text-text-strong",
              disabled && "cursor-default opacity-70",
            )}
          >
            {CATEGORY_LABEL[c]}
          </button>
        );
      })}
    </div>
  );
}

/** The detail pane: workload strip, routed categories, members and the
 *  add / delete footer. The shell's header carries name and description. */
function GroupDetail({
  group,
  users,
  canManage,
}: {
  group: GroupView;
  users: MemberOption[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addUserId, setAddUserId] = useState("");
  const [addSeniority, setAddSeniority] = useState<string>("JUNIOR");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const memberIds = new Set(group.members.map((m) => m.userId));
  const addable = users.filter((u) => !memberIds.has(u.id));

  async function patchMembers(
    members: { userId: string; seniority: string }[],
  ) {
    setBusy(true);
    setError(null);
    const res = await api(`/api/groups/${group.id}`, "PATCH", { members });
    if (!res.ok) setError(res.error ?? null);
    else router.refresh();
    setBusy(false);
  }

  async function toggleCategory(c: Category) {
    setBusy(true);
    setError(null);
    const next = group.categories.includes(c)
      ? group.categories.filter((x) => x !== c)
      : [...group.categories, c];
    const res = await api(`/api/groups/${group.id}`, "PATCH", {
      categories: next,
    });
    if (!res.ok) setError(res.error ?? null);
    else router.refresh();
    setBusy(false);
  }

  async function removeGroup() {
    setBusy(true);
    setError(null);
    const res = await api(`/api/groups/${group.id}`, "DELETE");
    if (!res.ok) {
      setError(res.error ?? null);
      setBusy(false);
    } else {
      router.refresh();
    }
  }

  return (
    <div className="flex flex-col gap-4 font-sans">
      {/* Workload strip: what this group carries right now. */}
      <div className="flex flex-wrap items-center gap-2">
        <Users2 size={16} aria-hidden className="text-text-brand" />
        <Badge tone="neutral">{group.openTickets} open</Badge>
        <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
          {plural(group.members.length, "member")}
        </span>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="font-mono text-[10.5px] tracking-[0.14em] text-text-faint uppercase">
          Routed categories
        </span>
        <CategoryToggles
          selected={group.categories}
          onToggle={toggleCategory}
          disabled={!canManage || busy}
        />
      </div>

      <div className="flex flex-col gap-2">
        <span className="font-mono text-[10.5px] tracking-[0.14em] text-text-faint uppercase">
          Members
        </span>
        {group.members.length === 0 && (
          <p className="text-[13px] text-muted-foreground">
            No members yet — tickets routed here stay unassigned.
          </p>
        )}
        {group.members.map((m) => (
          <div key={m.userId} className="flex items-center gap-2.5">
            <Avatar name={m.name} color={m.color} size={24} />
            <span className="min-w-0 flex-1 truncate text-[13px]">
              {m.name}
            </span>
            {canManage ? (
              <Select
                value={m.seniority}
                disabled={busy}
                onValueChange={(value) =>
                  void patchMembers(
                    group.members.map((x) =>
                      x.userId === m.userId
                        ? { userId: x.userId, seniority: value }
                        : { userId: x.userId, seniority: x.seniority },
                    ),
                  )
                }
              >
                <SelectTrigger size="sm" className="w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MEMBER_TIERS.map((s) => (
                    <SelectItem key={s} value={s}>
                      {SENIORITY_LABEL[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Badge tone={SENIORITY_TONE[m.seniority as MemberTier] ?? "neutral"}>
                {SENIORITY_LABEL[m.seniority as MemberTier] ?? m.seniority}
              </Badge>
            )}
            {canManage && (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove ${m.name}`}
                disabled={busy}
                onClick={() =>
                  void patchMembers(
                    group.members
                      .filter((x) => x.userId !== m.userId)
                      .map((x) => ({ userId: x.userId, seniority: x.seniority })),
                  )
                }
              >
                <Trash2 size={14} />
              </Button>
            )}
          </div>
        ))}
      </div>

      {canManage && (
        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <div className="flex items-center gap-2">
            <Select value={addUserId} onValueChange={setAddUserId}>
              <SelectTrigger size="sm" className="min-w-0 flex-1 sm:max-w-xs">
                <SelectValue placeholder="Add a member" />
              </SelectTrigger>
              <SelectContent>
                {addable.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={addSeniority} onValueChange={setAddSeniority}>
              <SelectTrigger size="sm" className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MEMBER_TIERS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {SENIORITY_LABEL[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              aria-label="Add member"
              disabled={busy || !addUserId}
              onClick={() => {
                void patchMembers([
                  ...group.members.map((x) => ({
                    userId: x.userId,
                    seniority: x.seniority,
                  })),
                  { userId: addUserId, seniority: addSeniority },
                ]);
                setAddUserId("");
              }}
            >
              <UserPlus size={14} />
            </Button>
          </div>

          {confirmDelete ? (
            <div className="flex items-center gap-2">
              <span className="flex-1 text-[13px] text-muted-foreground">
                Delete this group? Its tickets keep working, ungrouped.
              </span>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={busy}
                onClick={() => void removeGroup()}
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
            </div>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="self-start text-muted-foreground hover:text-destructive"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 size={14} />
              Delete group
            </Button>
          )}
        </div>
      )}

      {error && <p className="text-[13px] text-critical">{error}</p>}
    </div>
  );
}

function CreateGroupDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [categories, setCategories] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    const res = await api("/api/groups", "POST", {
      name,
      description,
      categories,
    });
    if (!res.ok) {
      setError(res.error ?? null);
      setBusy(false);
      return;
    }
    setOpen(false);
    setName("");
    setDescription("");
    setCategories([]);
    setBusy(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus size={15} />
          New group
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create group</DialogTitle>
          <DialogDescription>
            Groups own ticket categories; triage routes matching tickets to the
            group automatically.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="group-name" className="text-xs">
              Name
            </Label>
            <Input
              id="group-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Development"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="group-description" className="text-xs">
              Description
            </Label>
            <Textarea
              id="group-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does this team own?"
              rows={2}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Routed categories</Label>
            <CategoryToggles
              selected={categories}
              onToggle={(c) =>
                setCategories((prev) =>
                  prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c],
                )
              }
            />
          </div>
          {error && <p className="text-[13px] text-critical">{error}</p>}
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => setOpen(false)}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button type="button" onClick={submit} disabled={busy || !name.trim()}>
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function GroupsManager({
  groups,
  users,
  canManage,
  initialId,
}: {
  groups: GroupView[];
  users: MemberOption[];
  canManage: boolean;
  /** From /groups?group=<id>: the rail row to open first. */
  initialId?: string;
}) {
  const items: MasterDetailItem[] = groups.map((group) => ({
    id: group.id,
    title: group.name,
    subtitle: `${plural(group.members.length, "member")}${
      group.description ? ` · ${group.description}` : ""
    }`,
    description: group.description || undefined,
    icon: <Users2 size={16} />,
    status: { label: `${group.openTickets} open`, tone: "neutral" },
    keywords: [
      ...group.categories,
      ...group.categories.map((c) => CATEGORY_LABEL[c as Category] ?? c),
      ...group.members.map((m) => m.name),
    ],
    body: <GroupDetail group={group} users={users} canManage={canManage} />,
  }));

  const create = canManage ? <CreateGroupDialog /> : undefined;

  return (
    <MasterDetail
      title="Groups"
      param="group"
      initialId={initialId}
      keepMounted
      items={items}
      actions={create}
      emptyState={
        <EmptyState
          icon={Users2}
          title="No groups yet"
          hint={
            canManage
              ? "Create a group and pick which ticket categories it owns."
              : "An admin needs to create the first group."
          }
          action={create}
        />
      }
    />
  );
}
