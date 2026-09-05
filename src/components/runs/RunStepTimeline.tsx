// The step timeline of one agent run — shared by the runs console (inline
// under a row) and the ticket's folded run entry. A vertical rail with one
// node per AgentStep: the node's icon says what kind of step it is, its
// colour says how risky it was (LOW neutral, MEDIUM warn, HIGH critical),
// the right edge says how long the agent took to get there. Tool inputs and
// results are mono blocks with a six-line preview. A totals strip on top
// gives the run's shape before the reader scrolls.
//
// Directive-less on purpose: rendered on the server inside RunGroup and on
// the client inside RunsManager. The only state (Show all) lives in MonoBlock.

import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  ClipboardCheck,
  CornerDownLeft,
  MessageSquare,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import Markdown from "@/components/tickets/Markdown";
import MonoBlock from "@/components/runs/MonoBlock";
import RunChip, {
  APPROVAL_CHIP,
  CHIP_CLASS,
  RISK_CHIP,
  RISK_TEXT,
  type ChipTone,
} from "@/components/runs/RunChip";
import {
  elapsedMs,
  formatDuration,
  formatGap,
  isFailedResult,
  runTotals,
  stepGapMs,
  toMs,
  type TraceApproval,
  type TraceRun,
  type TraceStep,
} from "@/components/runs/run-format";
import { cn } from "@/lib/utils";

const STEP_ICON: Record<string, LucideIcon> = {
  TEXT: MessageSquare,
  TOOL_CALL: Wrench,
  TOOL_RESULT: CornerDownLeft,
  APPROVAL_REQUEST: ShieldCheck,
  QA_REVIEW: ClipboardCheck,
  ERROR: AlertTriangle,
};

const STEP_LABEL: Record<string, string> = {
  TEXT: "message",
  TOOL_CALL: "tool call",
  TOOL_RESULT: "result",
  APPROVAL_REQUEST: "approval request",
  QA_REVIEW: "QA review",
  ERROR: "error",
};

function nodeTone(step: TraceStep): ChipTone {
  if (step.type === "ERROR") return "critical";
  if (step.riskLevel) return RISK_CHIP[step.riskLevel] ?? "neutral";
  return "neutral";
}

const LABEL = "font-mono text-[10.5px] font-semibold uppercase tracking-[0.14em] text-(--text-faint)";

export default function RunStepTimeline({
  run,
  steps,
  approvals,
  agentName,
  totals = true,
}: {
  run: TraceRun;
  steps: TraceStep[];
  approvals: TraceApproval[];
  agentName?: string;
  /** The header strip with the run's totals; off when the parent already shows them. */
  totals?: boolean;
}) {
  const ordered = [...steps].sort((a, b) => a.index - b.index);

  return (
    <div className="space-y-4">
      {totals && <TotalsStrip run={run} steps={ordered} approvals={approvals} />}
      {ordered.length === 0 ? (
        <p className="rounded-md border border-dashed border-(--line-strong) px-4 py-6 text-center font-sans text-[12.5px] text-(--text-muted)">
          No steps recorded yet.
        </p>
      ) : (
        <ol className="relative">
          <span aria-hidden className="absolute bottom-3 left-[11px] top-3 w-px bg-(--line)" />
          {ordered.map((step, i) => (
            <StepNode
              key={step.id}
              step={step}
              gapMs={stepGapMs(ordered, i, run.createdAt)}
              run={run}
              approvals={approvals}
              agentName={agentName}
              last={i === ordered.length - 1}
            />
          ))}
        </ol>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Totals strip
// ---------------------------------------------------------------------------

function TotalsStrip({
  run,
  steps,
  approvals,
}: {
  run: TraceRun;
  steps: TraceStep[];
  approvals: TraceApproval[];
}) {
  const t = runTotals(steps, approvals);
  const took = elapsedMs(run);
  const decisions = [
    t.approved > 0 ? `${t.approved} approved` : null,
    t.rejected > 0 ? `${t.rejected} rejected` : null,
    t.pending > 0 ? `${t.pending} pending` : null,
  ].filter(Boolean);
  const durationValue =
    took !== null
      ? formatDuration(took)
      : run.status === "WAITING_APPROVAL"
        ? "paused"
        : "running";

  return (
    <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-(--line) bg-(--line) sm:grid-cols-4">
      <Total label="Steps" value={String(t.steps)} note={t.errors > 0 ? `${t.errors} error${t.errors > 1 ? "s" : ""}` : undefined} noteTone="critical" />
      <Total label="Tool calls" value={String(t.toolCalls)} />
      <Total label="Approvals" value={String(t.approvals)} note={decisions.join(" · ") || undefined} />
      <Total label="Duration" value={durationValue} />
    </dl>
  );
}

function Total({
  label,
  value,
  note,
  noteTone = "muted",
}: {
  label: string;
  value: string;
  note?: string;
  noteTone?: "muted" | "critical";
}) {
  return (
    <div className="min-w-0 bg-(--surface-2) px-3 py-2">
      <dt className={LABEL}>{label}</dt>
      <dd className="mt-0.5 flex flex-wrap items-baseline gap-x-2">
        <span className="font-heading text-[16px] font-semibold tabular-nums text-(--text-strong)">{value}</span>
        {note && (
          <span
            className={cn(
              "truncate font-mono text-[10.5px]",
              noteTone === "critical" ? "text-(--critical)" : "text-(--text-muted)",
            )}
          >
            {note}
          </span>
        )}
      </dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// One node on the rail
// ---------------------------------------------------------------------------

function StepNode({
  step,
  gapMs,
  run,
  approvals,
  agentName,
  last,
}: {
  step: TraceStep;
  gapMs: number;
  run: TraceRun;
  approvals: TraceApproval[];
  agentName?: string;
  last: boolean;
}) {
  const Icon = STEP_ICON[step.type] ?? MessageSquare;
  const tone = nodeTone(step);
  const failed = isFailedResult(step);
  const iso = new Date(toMs(step.createdAt)).toISOString();
  // Best-effort match for an approval request: the latest approval this run
  // raised for the same tool.
  const approval =
    step.type === "APPROVAL_REQUEST"
      ? [...approvals].reverse().find((a) => a.toolName === step.toolName)
      : undefined;
  const verdict = step.type === "QA_REVIEW" ? run.qaVerdict : undefined;

  return (
    <li className={cn("relative pl-9", !last && "pb-5")}>
      <span
        aria-hidden
        className={cn(
          "absolute left-0 top-0 flex h-6 w-6 items-center justify-center rounded-full border",
          CHIP_CLASS[tone],
        )}
      >
        <Icon size={12} strokeWidth={2} />
      </span>

      <div className="flex min-h-6 flex-wrap items-center gap-x-2 gap-y-1">
        <span className={LABEL}>{STEP_LABEL[step.type] ?? step.type.toLowerCase().replace(/_/g, " ")}</span>
        {step.type === "TEXT" && agentName && (
          <span className="font-sans text-[12.5px] font-medium text-(--text-strong)">{agentName}</span>
        )}
        {step.toolName && (
          <span className="font-mono text-[12.5px] text-(--text-strong)">{step.toolName}</span>
        )}
        {step.riskLevel && (
          <RunChip tone={RISK_CHIP[step.riskLevel] ?? "neutral"}>
            {RISK_TEXT[step.riskLevel] ?? step.riskLevel.toLowerCase()}
          </RunChip>
        )}
        {failed && <RunChip tone="critical">failed</RunChip>}
        {approval && (
          <RunChip tone={APPROVAL_CHIP[approval.status] ?? "neutral"}>{approval.status.toLowerCase()}</RunChip>
        )}
        {verdict && (
          <RunChip tone={verdict === "PASS" ? "good" : "critical"}>QA {verdict}</RunChip>
        )}
        <time
          dateTime={iso}
          title={iso}
          className="ml-auto font-mono text-[11px] tabular-nums text-(--text-faint)"
        >
          {formatGap(gapMs)}
        </time>
      </div>

      <div className="mt-1.5 min-w-0">
        <StepContent step={step} run={run} approval={approval} />
      </div>
    </li>
  );
}

function StepContent({
  step,
  run,
  approval,
}: {
  step: TraceStep;
  run: TraceRun;
  approval?: TraceApproval;
}) {
  switch (step.type) {
    case "TEXT":
      return <Markdown className="text-(--text-muted)">{step.content}</Markdown>;

    case "TOOL_CALL":
    case "TOOL_RESULT":
      return <MonoBlock raw={step.content} />;

    case "APPROVAL_REQUEST":
      return (
        <>
          <MonoBlock raw={step.content} />
          {approval && approval.status !== "PENDING" && (
            <p className="mt-1.5 font-sans text-[12.5px] text-(--text-muted)">
              <span className={approval.status === "APPROVED" ? "text-(--good)" : "text-(--critical)"}>
                {approval.status === "APPROVED" ? "Approved" : "Rejected"}
              </span>
              {approval.decider ? ` by ${approval.decider.name}` : ""}
              {approval.reason ? ` — “${approval.reason}”` : ""}
            </p>
          )}
          {approval && approval.status === "PENDING" && (
            <p className="mt-1.5 font-sans text-[12.5px] text-(--text-muted)">
              Waiting for a human to decide.
            </p>
          )}
        </>
      );

    case "QA_REVIEW":
      return <Markdown className="text-(--text-muted)">{run.qaNotes ?? step.content}</Markdown>;

    case "ERROR":
      return <MonoBlock raw={step.content} tone="critical" />;

    default:
      return (
        <p className="whitespace-pre-wrap font-sans text-[12.5px] text-(--text-muted)">{step.content}</p>
      );
  }
}
