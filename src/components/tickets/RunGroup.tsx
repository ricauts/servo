// One agent run as a single timeline entry: a headline a human can read in
// two seconds, with the full step-by-step trace one click away.
//
// The trace is the product's audit trail, so nothing is removed — a completed
// run is folded, not truncated. Runs still working or waiting on a human stay
// open, because that is what the reader needs to act on.

import type { AgentRun, AgentStep, Approval, User } from "@prisma/client";
import { ChevronRight, ClipboardCheck } from "lucide-react";
import Badge from "@/components/common/Badge";
import Markdown, { toPlainText } from "@/components/tickets/Markdown";
import RelativeTime from "@/components/tickets/RelativeTime";

export type RunWithSteps = AgentRun & {
  steps: AgentStep[];
  approvals: (Approval & { decider: User | null })[];
  profile?: { name: string } | null;
};

/** "github_read_file ×2 · github_create_branch · github_edit_file" */
function toolTrail(steps: AgentStep[]): string[] {
  const order: string[] = [];
  const counts = new Map<string, number>();
  for (const step of steps) {
    if (step.type !== "TOOL_CALL" || !step.toolName) continue;
    if (!counts.has(step.toolName)) order.push(step.toolName);
    counts.set(step.toolName, (counts.get(step.toolName) ?? 0) + 1);
  }
  return order.map((name) => {
    const n = counts.get(name) ?? 1;
    return n > 1 ? `${name} ×${n}` : name;
  });
}

function duration(run: AgentRun): string | null {
  if (!run.completedAt) return null;
  const ms = run.completedAt.getTime() - run.createdAt.getTime();
  if (ms < 1000) return null;
  const seconds = Math.round(ms / 1000);
  return seconds < 90 ? `${seconds}s` : `${Math.round(seconds / 60)}m`;
}

const STATUS_TONE = {
  COMPLETED: "good",
  RUNNING: "brand",
  WAITING_APPROVAL: "warn",
  FAILED: "critical",
} as const;

const STATUS_LABEL = {
  COMPLETED: "completed",
  RUNNING: "running",
  WAITING_APPROVAL: "waiting for approval",
  FAILED: "failed",
} as const;

export default function RunGroup({
  run,
  agentName,
  children,
}: {
  run: RunWithSteps;
  agentName: string;
  agentColor: string;
  children: React.ReactNode; // the rendered steps
}) {
  const status = run.status as keyof typeof STATUS_LABEL;
  // A run the reader may need to act on stays open; finished history folds.
  const openByDefault = run.status === "RUNNING" || run.status === "WAITING_APPROVAL";
  const trail = toolTrail(run.steps);
  const took = duration(run);
  const decided = run.approvals.filter((a) => a.status !== "PENDING");

  return (
    <details open={openByDefault} className="group rounded-lg border border-border bg-card">
      <summary className="flex cursor-pointer list-none flex-col gap-2 p-4 [&::-webkit-details-marker]:hidden">
        <div className="flex flex-wrap items-center gap-2 font-sans">
          <span className="text-sm font-medium">{agentName}</span>
          <Badge tone="brand">AI</Badge>
          <Badge tone={STATUS_TONE[status] ?? "neutral"}>{STATUS_LABEL[status] ?? run.status}</Badge>
          {run.qaVerdict && (
            <Badge tone={run.qaVerdict === "PASS" ? "good" : "critical"}>
              QA {run.qaVerdict}
            </Badge>
          )}
          <span className="text-xs text-muted-foreground/80">
            {took ? `${took} · ` : ""}
            <RelativeTime value={run.createdAt} />
          </span>
          <span className="ml-auto flex items-center gap-1 text-xs font-medium text-muted-foreground">
            {run.steps.length} steps
            <ChevronRight
              size={14}
              className="transition-transform group-open:rotate-90"
              aria-hidden
            />
          </span>
        </div>

        {/* What the agent says it did. Clamped plain text while folded so the
            header stays scannable; full markdown once opened. */}
        {run.summary && (
          <div className="font-sans text-sm leading-relaxed text-muted-foreground">
            <p className="line-clamp-2 group-open:hidden">{toPlainText(run.summary)}</p>
            <div className="hidden group-open:block">
              <Markdown>{run.summary}</Markdown>
            </div>
          </div>
        )}

        {/* The QA verdict belongs with the outcome, not buried in the trace. */}
        {run.qaVerdict && run.qaNotes && (
          <div className="flex gap-2 rounded-md bg-muted/50 px-3 py-2 font-sans text-xs leading-relaxed text-muted-foreground">
            <ClipboardCheck size={14} className="mt-0.5 shrink-0 text-violet" aria-hidden />
            <div className="min-w-0">
              <span className="font-heading font-semibold uppercase tracking-wide text-muted-foreground/80">
                QA review
              </span>{" "}
              <span className="line-clamp-2 group-open:line-clamp-none">{run.qaNotes}</span>
            </div>
          </div>
        )}

        {(trail.length > 0 || decided.length > 0) && (
          <div className="font-mono text-[11px] text-muted-foreground/90">
            {trail.join("  ·  ")}
            {decided.map((a) => (
              <span key={a.id}>
                {"  ·  "}
                <span className={a.status === "APPROVED" ? "text-good" : "text-critical"}>
                  {a.status === "APPROVED" ? "approved" : "rejected"}
                  {a.decider ? ` by ${a.decider.name.split(" ")[0]}` : ""}
                </span>
              </span>
            ))}
          </div>
        )}
      </summary>

      <div className="space-y-5 border-t border-border px-4 pb-4 pt-4">{children}</div>
    </details>
  );
}
