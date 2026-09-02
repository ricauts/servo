"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight } from "lucide-react";
import {
  Card,
  CardContent,
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
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import Badge from "@/components/common/Badge";
import Spinner from "@/components/common/Spinner";
import { SENIORITY_LABEL, SENIORITY_TONE } from "@/lib/labels";
import type { Seniority } from "@/lib/types";
import { nextLevel } from "@/lib/escalation-rules";

interface GroupOption {
  id: string;
  name: string;
}

export default function EscalatePanel({
  ticketId,
  groupId,
  groupName,
  escalationLevel,
  closed,
}: {
  ticketId: string;
  groupId: string | null;
  groupName: string | null;
  escalationLevel: string;
  /** RESOLVED/CLOSED tickets cannot be escalated. */
  closed: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [groups, setGroups] = useState<GroupOption[]>([]);
  const [mode, setMode] = useState<"tier" | "group">("tier");
  const [targetGroup, setTargetGroup] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upper = nextLevel(escalationLevel);
  const canRaiseTier = Boolean(groupId && upper);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch("/api/groups")
      .then((res) => res.json())
      .then((data: { groups?: GroupOption[] }) => {
        if (cancelled || !Array.isArray(data.groups)) return;
        setGroups(data.groups.filter((g) => g.id !== groupId));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open, groupId]);

  // Tickets without a group (or already at SENIOR) can only move groups.
  useEffect(() => {
    if (open && !canRaiseTier) setMode("group");
  }, [open, canRaiseTier]);

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/tickets/${ticketId}/escalate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(mode === "group" ? { toGroupId: targetGroup } : {}),
          ...(reason.trim() ? { reason: reason.trim() } : {}),
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? `Escalation failed (${res.status}).`);
        return;
      }
      setOpen(false);
      setReason("");
      setTargetGroup("");
      router.refresh();
    } catch {
      setError("Network error — nothing was changed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Group & escalation</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 font-sans">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[13px] text-muted-foreground">
            {groupName ?? "No group"}
          </span>
          <Badge tone={SENIORITY_TONE[escalationLevel as Seniority] ?? "neutral"}>
            {SENIORITY_LABEL[escalationLevel as Seniority] ?? escalationLevel} tier
          </Badge>
        </div>

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" disabled={closed}>
              <ArrowUpRight size={14} />
              Escalate
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Escalate ticket</DialogTitle>
              <DialogDescription>
                Raise the tier within {groupName ?? "the group"} or hand the
                ticket to another group.
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-4">
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={mode === "tier" ? "default" : "outline"}
                  size="sm"
                  disabled={!canRaiseTier}
                  onClick={() => setMode("tier")}
                >
                  Raise tier
                  {upper ? ` → ${SENIORITY_LABEL[upper]}` : ""}
                </Button>
                <Button
                  type="button"
                  variant={mode === "group" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setMode("group")}
                >
                  Move to group
                </Button>
              </div>

              {mode === "group" && (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="escalate-group" className="text-xs">
                    Target group
                  </Label>
                  <Select value={targetGroup} onValueChange={setTargetGroup}>
                    <SelectTrigger id="escalate-group" className="w-full">
                      <SelectValue placeholder="Pick a group" />
                    </SelectTrigger>
                    <SelectContent>
                      {groups.map((g) => (
                        <SelectItem key={g.id} value={g.id}>
                          {g.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="escalate-reason" className="text-xs">
                  Reason (posted to the timeline)
                </Label>
                <Textarea
                  id="escalate-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Why does this need a higher tier or another team?"
                  rows={3}
                />
              </div>

              {error && <p className="text-[13px] text-critical">{error}</p>}
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setOpen(false)}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={submit}
                disabled={submitting || (mode === "group" && !targetGroup)}
              >
                {submitting && <Spinner size={14} className="text-primary-foreground" />}
                Escalate
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
