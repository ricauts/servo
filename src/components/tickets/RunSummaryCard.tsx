// The right-rail card for one run: kind, outcome, who ran it and when, the
// summary as a three-line preview. The full trace lives in the timeline's
// RunGroup entry; this card is the index, not the record.

import type { AgentRun } from "@prisma/client";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { toPlainText } from "@/components/tickets/Markdown";
import RelativeTime from "@/components/tickets/RelativeTime";
import RunChip, { RUN_STATUS_CHIP, RUN_STATUS_TEXT } from "@/components/runs/RunChip";
import { elapsedMs, formatDuration } from "@/components/runs/run-format";

export default function RunSummaryCard({
  run,
  agentName,
}: {
  run: AgentRun;
  agentName: string;
}) {
  const took = elapsedMs(run);
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <RunChip tone="neutral">{run.kind}</RunChip>
          <span>{run.kind === "TRIAGE" ? "Triage run" : "Resolver run"}</span>
        </CardTitle>
        <CardAction>
          <RunChip tone={RUN_STATUS_CHIP[run.status] ?? "neutral"}>
            {RUN_STATUS_TEXT[run.status] ?? run.status.toLowerCase()}
          </RunChip>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 font-sans">
        <p className="font-mono text-[11px] tabular-nums text-(--text-muted)">
          {agentName} · <RelativeTime value={run.createdAt} />
          {took !== null && ` · ${formatDuration(took)}`}
        </p>

        {run.summary && (
          // Plain text on purpose: this rail is a three-line preview, and
          // markdown syntax would read as noise at this size.
          <p className="line-clamp-3 text-[12.5px] leading-relaxed text-(--text-muted)">
            {toPlainText(run.summary)}
          </p>
        )}

        {run.qaVerdict && (
          <div>
            <RunChip tone={run.qaVerdict === "PASS" ? "good" : "critical"}>QA {run.qaVerdict}</RunChip>
          </div>
        )}

        {run.error && (
          <p className="line-clamp-3 font-mono text-[11px] leading-relaxed text-(--critical)">{run.error}</p>
        )}
      </CardContent>
    </Card>
  );
}
