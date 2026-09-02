import type { AgentRun } from "@prisma/client";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import Badge from "@/components/common/Badge";
import { toPlainText } from "@/components/tickets/Markdown";
import RelativeTime from "@/components/tickets/RelativeTime";
import { RUN_STATUS_LABEL, RUN_STATUS_TONE } from "@/lib/labels";
import type { RunStatus } from "@/lib/types";

export default function RunSummaryCard({
  run,
  agentName,
}: {
  run: AgentRun;
  agentName: string;
}) {
  const status = run.status as RunStatus;
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>
          {run.kind === "TRIAGE" ? "Triage run" : "Resolver run"}
        </CardTitle>
        <CardAction>
          <Badge tone={RUN_STATUS_TONE[status] ?? "neutral"}>
            {RUN_STATUS_LABEL[status] ?? run.status}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 font-sans">
        <p className="text-xs text-muted-foreground/80">
          {agentName} · started <RelativeTime value={run.createdAt} />
          {run.completedAt && (
            <>
              {" "}
              · finished <RelativeTime value={run.completedAt} />
            </>
          )}
        </p>

        {run.summary && (
          // Plain text on purpose: this rail is a three-line preview, and
          // markdown syntax would read as noise at this size.
          <p className="line-clamp-3 text-xs text-muted-foreground">
            {toPlainText(run.summary)}
          </p>
        )}

        {run.qaVerdict && (
          <div>
            <Badge tone={run.qaVerdict === "PASS" ? "good" : "critical"}>
              QA {run.qaVerdict}
            </Badge>
          </div>
        )}

        {run.error && (
          <p className="font-mono text-[11px] leading-relaxed text-critical">
            {run.error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
