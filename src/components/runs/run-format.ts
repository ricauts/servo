// Pure helpers shared by every surface that renders an agent run — the runs
// console, the ticket timeline's folded entry and the ticket rail. No React,
// no database: shapes in, strings and numbers out, so the console (which
// receives JSON with ISO strings) and the ticket page (which receives Prisma
// rows with Date objects) format a run identically.

/** The minimal step shape every run surface agrees on (AgentStep, minus runId). */
export type TraceStep = {
  id: string;
  index: number;
  type: string;
  toolName: string | null;
  content: string;
  riskLevel: string | null;
  createdAt: string | Date;
};

/** The approvals a run raised, with the decider's name resolved. */
export type TraceApproval = {
  id: string;
  toolName: string;
  riskLevel: string | null;
  status: string;
  reason: string | null;
  decider: { name: string } | null;
};

/** The run fields the timeline header and the folded summary read. */
export type TraceRun = {
  createdAt: string | Date;
  completedAt: string | Date | null;
  status: string;
  qaVerdict?: string | null;
  qaNotes?: string | null;
  error?: string | null;
};

export function toMs(value: string | Date): number {
  return typeof value === "string" ? new Date(value).getTime() : value.getTime();
}

/**
 * How long a run took (finished) or has been going (running, when `now` is
 * known). Null when it cannot be told yet — a running run before the client
 * has a clock, so server and client render the same first paint.
 */
export function elapsedMs(
  run: { createdAt: string | Date; completedAt: string | Date | null },
  now: number | null = null,
): number | null {
  const start = toMs(run.createdAt);
  if (run.completedAt) return Math.max(0, toMs(run.completedAt) - start);
  if (now === null) return null;
  return Math.max(0, now - start);
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** Whole-run durations: "<1s", "42s", "3m 05s", "1h 12m". */
export function formatDuration(ms: number): string {
  if (ms < 1000) return "<1s";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${pad2(seconds % 60)}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${pad2(minutes % 60)}m`;
}

/** Step-to-step gaps keep sub-second precision: "+0.4s", "+12s", "+1m 05s". */
export function formatGap(ms: number): string {
  if (ms < 0) ms = 0;
  if (ms < 10_000) return `+${(ms / 1000).toFixed(1)}s`;
  return `+${formatDuration(ms)}`;
}

/** Elapsed time since the previous step (or since the run started, for the first). */
export function stepGapMs(steps: TraceStep[], index: number, runStart: string | Date): number {
  const current = toMs(steps[index].createdAt);
  const previous = index === 0 ? toMs(runStart) : toMs(steps[index - 1].createdAt);
  return Math.max(0, current - previous);
}

/** "github_read_file ×2 · github_edit_file": tool calls deduped, in first-call order. */
export function toolTrail(steps: TraceStep[]): { name: string; count: number }[] {
  const order: string[] = [];
  const counts = new Map<string, number>();
  for (const step of steps) {
    if (step.type !== "TOOL_CALL" || !step.toolName) continue;
    if (!counts.has(step.toolName)) order.push(step.toolName);
    counts.set(step.toolName, (counts.get(step.toolName) ?? 0) + 1);
  }
  return order.map((name) => ({ name, count: counts.get(name) ?? 1 }));
}

export function formatToolTrail(steps: TraceStep[]): string[] {
  return toolTrail(steps).map(({ name, count }) => (count > 1 ? `${name} ×${count}` : name));
}

/** The header strip's numbers. */
export function runTotals(steps: TraceStep[], approvals: TraceApproval[]) {
  let toolCalls = 0;
  let errors = 0;
  for (const step of steps) {
    if (step.type === "TOOL_CALL") toolCalls++;
    if (step.type === "ERROR") errors++;
  }
  let approved = 0;
  let rejected = 0;
  let pending = 0;
  for (const a of approvals) {
    if (a.status === "APPROVED") approved++;
    else if (a.status === "REJECTED") rejected++;
    else pending++;
  }
  return { steps: steps.length, toolCalls, errors, approvals: approvals.length, approved, rejected, pending };
}

/** A tool result the tool itself reported as a failure. */
export function isFailedResult(step: TraceStep): boolean {
  return (
    step.type === "TOOL_RESULT" &&
    (step.content.startsWith("Error:") || step.content.includes("GitHub error"))
  );
}

/** First name only — "approved by Ana" reads better than the full name in a chip line. */
export function firstName(name: string): string {
  return name.split(/\s+/)[0] ?? name;
}
