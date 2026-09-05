// One agent run as a single timeline entry: a line a human can read in two
// seconds — who ran, how it ended, which tools it touched, who signed off —
// with the full step-by-step trace one click away.
//
// The trace is the product's audit trail, so nothing is removed — a completed
// run is folded, not truncated. Runs still working or waiting on a human stay
// open, because that is what the reader needs to act on. The trace itself is
// RunStepTimeline, the same component the runs console renders.

import type { AgentRun, AgentStep, Approval, User } from "@prisma/client";
import { ChevronRight } from "lucide-react";
import Markdown, { toPlainText } from "@/components/tickets/Markdown";
import RelativeTime from "@/components/tickets/RelativeTime";
import MonoBlock from "@/components/runs/MonoBlock";
import QaNote from "@/components/runs/QaNote";
import RunChip, { RUN_STATUS_CHIP, RUN_STATUS_TEXT } from "@/components/runs/RunChip";
import RunStepTimeline from "@/components/runs/RunStepTimeline";
import { elapsedMs, firstName, formatDuration, toolTrail } from "@/components/runs/run-format";

export type RunWithSteps = AgentRun & {
  steps: AgentStep[];
  approvals: (Approval & { decider: User | null })[];
  profile?: { name: string } | null;
};

export default function RunGroup({
  run,
  agentName,
  children,
}: {
  run: RunWithSteps;
  agentName: string;
  agentColor: string;
  /** Anything to render under the trace; the steps themselves come from `run`. */
  children?: React.ReactNode;
}) {
  // A run the reader may need to act on stays open; finished history folds.
  const openByDefault = run.status === "RUNNING" || run.status === "WAITING_APPROVAL";
  const trail = toolTrail(run.steps);
  const took = elapsedMs(run);
  const decided = run.approvals.filter((a) => a.status !== "PENDING");

  return (
    <details open={openByDefault} className="group rounded-lg border border-(--line) bg-(--surface)">
      <summary className="flex cursor-pointer list-none flex-col gap-2 p-4 [&::-webkit-details-marker]:hidden">
        {/* The one line: agent · outcome · tools · sign-off · when. */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <span className="font-sans text-[13.5px] font-semibold text-(--text-strong)">{agentName}</span>
          <RunChip tone="brand">AI</RunChip>
          <RunChip tone={RUN_STATUS_CHIP[run.status] ?? "neutral"}>
            {RUN_STATUS_TEXT[run.status] ?? run.status.toLowerCase()}
          </RunChip>
          {run.qaVerdict && (
            <RunChip tone={run.qaVerdict === "PASS" ? "good" : "critical"}>QA {run.qaVerdict}</RunChip>
          )}
          {trail.map(({ name, count }) => (
            <RunChip key={name} tone="neutral" upper={false} title={`${name} called ${count}×`}>
              {name}
              {count > 1 && <span className="text-(--text-faint)">×{count}</span>}
            </RunChip>
          ))}
          {decided.map((a) => (
            <span
              key={a.id}
              className={`font-mono text-[11px] ${a.status === "APPROVED" ? "text-(--good)" : "text-(--critical)"}`}
            >
              {a.status === "APPROVED" ? "approved" : "rejected"}
              {a.decider ? ` by ${firstName(a.decider.name)}` : ""}
            </span>
          ))}
          <span className="ml-auto flex items-center gap-1.5 font-mono text-[11px] tabular-nums text-(--text-faint)">
            {run.steps.length} {run.steps.length === 1 ? "step" : "steps"}
            {took !== null && ` · ${formatDuration(took)}`}
            {" · "}
            <RelativeTime value={run.createdAt} />
            <ChevronRight
              size={14}
              className="text-(--text-muted) transition-transform group-open:rotate-90"
              aria-hidden
            />
          </span>
        </div>

        {/* What the agent says it did: one clamped plain-text line while
            folded, full markdown once opened. */}
        {run.summary && (
          <div className="font-sans text-[13px] leading-relaxed text-(--text-muted)">
            <p className="line-clamp-1 group-open:hidden">{toPlainText(run.summary)}</p>
            <div className="hidden group-open:block">
              <Markdown>{run.summary}</Markdown>
            </div>
          </div>
        )}
      </summary>

      <div className="space-y-4 border-t border-(--line) p-4">
        {run.error && <MonoBlock raw={run.error} tone="critical" />}

        {/* The QA verdict belongs with the outcome, not buried in the trace. */}
        {run.qaVerdict && run.qaNotes && <QaNote notes={run.qaNotes} />}

        <RunStepTimeline run={run} steps={run.steps} approvals={run.approvals} agentName={agentName} />

        {children}
      </div>
    </details>
  );
}
