"use client";

import NextLink from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import Badge from "@/components/common/Badge";
import Spinner from "@/components/common/Spinner";
import { formatRelativeTime } from "@/components/admin/time";
import { RISK_LABEL, RISK_TONE } from "@/lib/labels";
import type { RiskLevel } from "@/lib/types";

export interface PendingApprovalView {
  id: string;
  toolName: string;
  /** Pretty-printed JSON of the tool input (formatted server-side). */
  toolInput: string;
  riskLevel: RiskLevel;
  requestedAt: string; // ISO date
  agentName: string | null;
  ticket: { id: string; number: number; title: string };
}

type Decision = "APPROVED" | "REJECTED";

export default function ApprovalCard({
  approval,
  canDecide = true,
}: {
  approval: PendingApprovalView;
  /** Whether the viewer's role may decide this approval (HIGH risk = admins). */
  canDecide?: boolean;
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Decision | null>(null);

  async function decide(decision: Decision) {
    setBusy(decision);
    setError(null);
    try {
      const res = await fetch(`/api/approvals/${approval.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decision,
          ...(reason.trim() ? { reason: reason.trim() } : {}),
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? `Request failed (${res.status}).`);
        setBusy(null);
        return;
      }
      // Card disappears (or moves to history) after the server refetch.
      router.refresh();
    } catch {
      setError("Network error — please retry.");
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <NextLink
              href={`/tickets/${approval.ticket.id}`}
              className="font-heading text-sm font-semibold text-foreground hover:text-primary-strong"
            >
              <span className="font-mono">#{approval.ticket.number}</span> ·{" "}
              {approval.ticket.title}
            </NextLink>
            <p className="font-sans text-xs text-muted-foreground">
              Requested{" "}
              <time dateTime={approval.requestedAt} suppressHydrationWarning>
                {formatRelativeTime(approval.requestedAt)}
              </time>
              {approval.agentName ? ` by ${approval.agentName}` : ""}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge tone={RISK_TONE[approval.riskLevel]}>
              {RISK_LABEL[approval.riskLevel]}
            </Badge>
            <Badge tone="warn">Pending</Badge>
          </div>
        </div>

        <div className="rounded-lg border border-warn/30 bg-warn-soft/50 p-3 dark:bg-warn/10">
          <div className="font-heading text-[13px] font-medium text-foreground">
            Tool call: <span className="font-mono">{approval.toolName}</span>
          </div>
          <p className="mt-0.5 font-sans text-xs text-muted-foreground">
            This action is paused until a human approves or rejects it.
          </p>
          <pre className="mt-2 overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs leading-relaxed text-foreground">
            {approval.toolInput}
          </pre>
        </div>

        {canDecide && (
          <Input
            aria-label="Reason (optional)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why are you approving or rejecting this action?"
            disabled={busy !== null}
            className="font-sans"
          />
        )}

        {error && (
          <Alert variant="destructive">
            <AlertTriangle />
            <AlertTitle>{error}</AlertTitle>
          </Alert>
        )}

        <div className="flex items-center gap-2">
          <Button
            onClick={() => void decide("APPROVED")}
            disabled={busy !== null || !canDecide}
            className="font-heading"
          >
            {busy === "APPROVED" && (
              <Spinner size={14} className="text-primary-foreground" />
            )}
            Approve
          </Button>
          <Button
            variant="destructive"
            onClick={() => void decide("REJECTED")}
            disabled={busy !== null || !canDecide}
            className="font-heading"
          >
            {busy === "REJECTED" && (
              <Spinner size={14} className="text-destructive" />
            )}
            Reject
          </Button>
          {!canDecide && (
            <span className="font-sans text-xs text-muted-foreground">
              HIGH-risk approvals require an admin.
            </span>
          )}
          {busy !== null && (
            <span className="font-sans text-xs text-muted-foreground">
              Resuming the agent run…
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
