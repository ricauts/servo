"use client";

// One pending AI reply draft in the approvals queue: preview, approve-and-send
// or discard in place, or jump to the ticket to edit before sending.

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, MailCheck, PenLine } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import Badge from "@/components/common/Badge";
import RelativeTime from "@/components/tickets/RelativeTime";
import { STATUS_LABEL, STATUS_TONE } from "@/lib/labels";
import type { TicketStatus } from "@/lib/types";

export interface DraftQueueView {
  id: string;
  body: string;
  agentName: string;
  createdAt: string;
  requesterName: string;
  ticket: { id: string; number: number; title: string; status: string };
}

export default function DraftQueueCard({ draft }: { draft: DraftQueueView }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(action: "approve" | "reject") {
    setBusy(action);
    setError(null);
    try {
      // Approving sends exactly the body this card displayed — a concurrent
      // regenerate must never swap in text no human reviewed.
      const res = await fetch(`/api/drafts/${draft.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          action === "approve" ? { action, body: draft.body } : { action },
        ),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        draft?: { emailed: boolean };
      };
      if (!res.ok) {
        setError(data.error ?? `Decision failed (${res.status}).`);
      } else {
        if (action === "approve") {
          toast(
            data.draft?.emailed
              ? `Reply sent to ${draft.requesterName} by email`
              : "Reply posted (email notifications are off)",
          );
        }
        router.refresh();
      }
    } catch {
      setError("Network error — the decision was not recorded.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-[15px]">
          <PenLine size={16} className="text-primary-strong" />
          Reply to {draft.requesterName}
          {(draft.ticket.status === "RESOLVED" || draft.ticket.status === "CLOSED") && (
            <Badge tone={STATUS_TONE[draft.ticket.status as TicketStatus]}>
              Ticket {STATUS_LABEL[draft.ticket.status as TicketStatus]}
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          <Link
            href={`/tickets/${draft.ticket.id}`}
            className="font-mono text-xs hover:underline"
          >
            #{draft.ticket.number}
          </Link>{" "}
          {draft.ticket.title} · drafted by {draft.agentName}{" "}
          <RelativeTime value={new Date(draft.createdAt)} />
        </CardDescription>
        <CardAction>
          <Link
            href={`/tickets/${draft.ticket.id}`}
            className="text-xs font-medium text-primary-strong hover:underline"
          >
            Edit on ticket
          </Link>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 font-sans">
        <p className="whitespace-pre-wrap rounded-md bg-muted/50 px-3 py-2.5 text-sm leading-relaxed">
          {draft.body}
        </p>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={() => void decide("approve")}
            disabled={busy !== null}
            className="font-heading"
          >
            {busy === "approve" ? <Loader2 className="animate-spin" /> : <MailCheck size={14} />}
            {busy === "approve" ? "Sending…" : "Approve & send"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void decide("reject")}
            disabled={busy !== null}
            className="font-heading text-muted-foreground"
          >
            {busy === "reject" && <Loader2 className="animate-spin" />}
            Discard
          </Button>
        </div>
        {error && <p className="text-[13px] text-critical">{error}</p>}
      </CardContent>
    </Card>
  );
}
