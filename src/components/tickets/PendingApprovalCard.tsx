"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import JsonBlock from "@/components/tickets/JsonBlock";
import RelativeTime from "@/components/tickets/RelativeTime";
import RunChip, { RISK_CHIP, RISK_TEXT } from "@/components/runs/RunChip";
import type { RiskLevel } from "@/lib/types";

export default function PendingApprovalCard({
  approvalId,
  toolName,
  toolInput,
  riskLevel,
  requestedAt,
}: {
  approvalId: string;
  toolName: string;
  toolInput: string;
  riskLevel: RiskLevel;
  requestedAt: Date;
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState<"APPROVED" | "REJECTED" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: "APPROVED" | "REJECTED") {
    setPending(decision);
    setError(null);
    try {
      const res = await fetch(`/api/approvals/${approvalId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decision,
          ...(reason.trim() ? { reason: reason.trim() } : {}),
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? `Decision failed (${res.status}).`);
      } else {
        router.refresh();
      }
    } catch {
      setError("Network error — the decision was not recorded.");
    } finally {
      setPending(null);
    }
  }

  return (
    // The chip triple, not an alpha tint: opaque warn surface + warn hairline.
    <Card className="bg-(--warn-chip) ring-(--warn-chip-line)">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldAlert size={18} className="text-(--warn-chip-ink)" aria-hidden />
          Human approval required
        </CardTitle>
        <CardDescription>
          Requested <RelativeTime value={requestedAt} />
        </CardDescription>
        <CardAction>
          <RunChip tone={RISK_CHIP[riskLevel] ?? "warn"}>
            {RISK_TEXT[riskLevel] ?? riskLevel.toLowerCase()}
          </RunChip>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 font-sans">
        <p className="text-sm text-muted-foreground">
          The agent is paused and wants to execute{" "}
          <code className="rounded border border-(--neutral-chip-line) bg-(--surface) px-1.5 py-0.5 font-mono text-xs text-(--text-strong)">
            {toolName}
          </code>{" "}
          with this input:
        </p>

        <JsonBlock raw={toolInput} className="max-h-48 border border-(--warn-chip-line) bg-(--surface)" />

        <div className="flex flex-col gap-2">
          <Label htmlFor="approval-reason" className="font-heading">
            Reason (optional)
          </Label>
          <Input
            id="approval-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why are you approving or rejecting?"
            disabled={pending !== null}
            className="bg-(--surface)"
          />
        </div>

        <div className="flex items-center gap-2">
          <Button
            onClick={() => decide("APPROVED")}
            disabled={pending !== null}
            className="font-heading"
          >
            {pending === "APPROVED" && <Loader2 className="animate-spin" />}
            {pending === "APPROVED" ? "Approving…" : "Approve & resume"}
          </Button>
          <Button
            variant="destructive"
            onClick={() => decide("REJECTED")}
            disabled={pending !== null}
            className="font-heading"
          >
            {pending === "REJECTED" && <Loader2 className="animate-spin" />}
            {pending === "REJECTED" ? "Rejecting…" : "Reject"}
          </Button>
        </div>

        {error && <p className="text-[13px] text-(--critical)">{error}</p>}
      </CardContent>
    </Card>
  );
}
