// SLA state as a badge. Works in server and client components: the label is
// time-relative, so hydration warnings are suppressed the same way
// RelativeTime does it.

import Badge from "@/components/common/Badge";
import { evaluateSla, slaLabel, type SlaState } from "@/lib/sla-rules";
import type { BadgeTone } from "@/lib/labels";

const TONE: Record<SlaState, BadgeTone> = {
  met: "good",
  ok: "neutral",
  at_risk: "warn",
  breached: "critical",
  none: "neutral",
};

const PREFIX: Record<SlaState, string> = {
  met: "SLA",
  ok: "SLA",
  at_risk: "SLA",
  breached: "SLA",
  none: "SLA",
};

export interface SlaTicketFields {
  status: string;
  createdAt: string | Date;
  firstResponseAt: string | Date | null;
  resolvedAt: string | Date | null;
  responseDueAt: string | Date | null;
  resolutionDueAt: string | Date | null;
}

export default function SlaBadge({
  ticket,
  showKind = false,
}: {
  ticket: SlaTicketFields;
  /** Append what the deadline is for ("response" / "resolution"). */
  showKind?: boolean;
}) {
  const view = evaluateSla(ticket);
  if (view.state === "none") {
    return <span className="text-sm text-muted-foreground/60">—</span>;
  }
  const label = slaLabel(view);
  return (
    <span suppressHydrationWarning>
      <Badge tone={TONE[view.state]}>
        {PREFIX[view.state]} {label}
        {showKind && view.kind ? ` · ${view.kind}` : ""}
      </Badge>
    </span>
  );
}
