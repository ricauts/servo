"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import Spinner from "@/components/common/Spinner";
import { CATEGORIES, PRIORITIES, TICKET_STATUSES } from "@/lib/types";
import { CATEGORY_LABEL, PRIORITY_LABEL, STATUS_LABEL } from "@/lib/labels";

interface UserOption {
  id: string;
  name: string;
  role: string;
  aiKind: string | null;
}

// Radix Select items cannot carry an empty-string value, so "unassigned"
// uses a sentinel that maps back to null in the PATCH payload.
const UNASSIGNED = "UNASSIGNED";

export default function PropertiesPanel({
  ticketId,
  status,
  priority,
  category,
  assigneeId,
  assigneeName,
}: {
  ticketId: string;
  status: string;
  priority: string;
  category: string;
  assigneeId: string | null;
  assigneeName: string | null;
}) {
  const router = useRouter();
  const [users, setUsers] = useState<UserOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Local mirrors so a failed PATCH can snap the select back to server state.
  const [localStatus, setLocalStatus] = useState(status);
  const [localPriority, setLocalPriority] = useState(priority);
  const [localCategory, setLocalCategory] = useState(category);
  const [localAssignee, setLocalAssignee] = useState(assigneeId ?? "");
  useEffect(() => setLocalStatus(status), [status]);
  useEffect(() => setLocalPriority(priority), [priority]);
  useEffect(() => setLocalCategory(category), [category]);
  useEffect(() => setLocalAssignee(assigneeId ?? ""), [assigneeId]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/users")
      .then((res) => res.json())
      .then((data: { users?: UserOption[] }) => {
        if (cancelled || !Array.isArray(data.users)) return;
        // Assignable: every human plus the RESOLVER AI agent.
        setUsers(
          data.users.filter(
            (u) => u.role !== "AI_AGENT" || u.aiKind === "RESOLVER",
          ),
        );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  async function patch(body: Record<string, unknown>, revert: () => void) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/tickets/${ticketId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? `Update failed (${res.status}).`);
        revert();
      } else {
        router.refresh();
      }
    } catch {
      setError("Network error — the change was not saved.");
      revert();
    } finally {
      setSaving(false);
    }
  }

  const showFallbackAssignee =
    localAssignee !== "" && !users.some((u) => u.id === localAssignee);

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Properties</CardTitle>
        {saving && (
          <CardAction>
            <Spinner size={14} />
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-3 font-sans">
        <div className="flex flex-col gap-1.5">
          <Label
            htmlFor="prop-status"
            className="font-heading text-xs text-muted-foreground"
          >
            Status
          </Label>
          <Select
            value={localStatus}
            disabled={saving}
            onValueChange={(value) => {
              setLocalStatus(value);
              void patch({ status: value }, () => setLocalStatus(status));
            }}
          >
            <SelectTrigger id="prop-status" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TICKET_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {STATUS_LABEL[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label
            htmlFor="prop-priority"
            className="font-heading text-xs text-muted-foreground"
          >
            Priority
          </Label>
          <Select
            value={localPriority}
            disabled={saving}
            onValueChange={(value) => {
              setLocalPriority(value);
              void patch({ priority: value }, () => setLocalPriority(priority));
            }}
          >
            <SelectTrigger id="prop-priority" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PRIORITIES.map((p) => (
                <SelectItem key={p} value={p}>
                  {PRIORITY_LABEL[p]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label
            htmlFor="prop-category"
            className="font-heading text-xs text-muted-foreground"
          >
            Category
          </Label>
          <Select
            value={localCategory}
            disabled={saving}
            onValueChange={(value) => {
              setLocalCategory(value);
              void patch({ category: value }, () => setLocalCategory(category));
            }}
          >
            <SelectTrigger id="prop-category" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>
                  {CATEGORY_LABEL[c]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label
            htmlFor="prop-assignee"
            className="font-heading text-xs text-muted-foreground"
          >
            Assignee
          </Label>
          <Select
            value={localAssignee || UNASSIGNED}
            disabled={saving}
            onValueChange={(value) => {
              const next = value === UNASSIGNED ? "" : value;
              setLocalAssignee(next);
              void patch({ assigneeId: next || null }, () =>
                setLocalAssignee(assigneeId ?? ""),
              );
            }}
          >
            <SelectTrigger id="prop-assignee" className="w-full">
              <SelectValue placeholder="Unassigned" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
              <SelectSeparator />
              {showFallbackAssignee && (
                <SelectItem value={localAssignee}>
                  {assigneeName ?? "Current assignee"}
                </SelectItem>
              )}
              {users.map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  {u.role === "AI_AGENT" ? `${u.name} (AI)` : u.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {error && <p className="text-[13px] text-critical">{error}</p>}
      </CardContent>
    </Card>
  );
}
