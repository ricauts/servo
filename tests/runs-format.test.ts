// The run-format helpers behind the runs console, the ticket's folded run
// entry and the rail card. Pure: no database, no React — the same shapes
// the console receives as JSON (ISO strings) and the ticket page receives
// as Prisma rows (Date objects) must format identically.

import { describe, expect, it } from "vitest";
import {
  elapsedMs,
  formatDuration,
  formatGap,
  formatToolTrail,
  isFailedResult,
  runTotals,
  stepGapMs,
  toolTrail,
  type TraceApproval,
  type TraceStep,
} from "@/components/runs/run-format";

const t0 = new Date("2026-01-01T10:00:00.000Z");
const at = (ms: number) => new Date(t0.getTime() + ms);

function step(partial: Partial<TraceStep> & { index: number; type: string }): TraceStep {
  return {
    id: `s${partial.index}`,
    toolName: null,
    content: "",
    riskLevel: null,
    createdAt: at(partial.index * 1000),
    ...partial,
  };
}

const steps: TraceStep[] = [
  step({ index: 0, type: "TEXT", content: "Starting." }),
  step({ index: 1, type: "TOOL_CALL", toolName: "github_read_file", riskLevel: "LOW" }),
  step({ index: 2, type: "TOOL_RESULT", toolName: "github_read_file", content: "{}" }),
  step({ index: 3, type: "TOOL_CALL", toolName: "github_read_file", riskLevel: "LOW" }),
  step({ index: 4, type: "TOOL_RESULT", toolName: "github_read_file", content: "Error: not found" }),
  step({ index: 5, type: "TOOL_CALL", toolName: "github_edit_file", riskLevel: "HIGH" }),
  step({ index: 6, type: "ERROR", content: "boom" }),
];

const approvals: TraceApproval[] = [
  { id: "a1", toolName: "github_edit_file", riskLevel: "HIGH", status: "APPROVED", reason: null, decider: { name: "Ana Ruiz" } },
  { id: "a2", toolName: "password_reset", riskLevel: "HIGH", status: "REJECTED", reason: "no", decider: { name: "Bo" } },
  { id: "a3", toolName: "password_reset", riskLevel: "HIGH", status: "PENDING", reason: null, decider: null },
];

describe("durations", () => {
  it("elapsedMs reads completed runs from the columns and running runs from the clock", () => {
    expect(elapsedMs({ createdAt: t0, completedAt: at(42_000) })).toBe(42_000);
    // ISO strings — the console's JSON — give the same number.
    expect(elapsedMs({ createdAt: t0.toISOString(), completedAt: at(42_000).toISOString() })).toBe(42_000);
    expect(elapsedMs({ createdAt: t0, completedAt: null })).toBeNull();
    expect(elapsedMs({ createdAt: t0, completedAt: null }, t0.getTime() + 5_000)).toBe(5_000);
  });

  it("formatDuration is exact and unitised", () => {
    expect(formatDuration(400)).toBe("<1s");
    expect(formatDuration(42_000)).toBe("42s");
    expect(formatDuration(185_000)).toBe("3m 05s");
    expect(formatDuration(4_320_000)).toBe("1h 12m");
  });

  it("formatGap keeps sub-second precision for step-to-step time", () => {
    expect(formatGap(0)).toBe("+0.0s");
    expect(formatGap(420)).toBe("+0.4s");
    expect(formatGap(12_000)).toBe("+12s");
    expect(formatGap(65_000)).toBe("+1m 05s");
  });

  it("stepGapMs measures from the previous step, or from the run start for the first", () => {
    expect(stepGapMs(steps, 0, at(-2_500))).toBe(2_500);
    expect(stepGapMs(steps, 3, t0)).toBe(1_000);
  });
});

describe("the tool trail", () => {
  it("dedupes tool calls in first-call order with counts", () => {
    expect(toolTrail(steps)).toEqual([
      { name: "github_read_file", count: 2 },
      { name: "github_edit_file", count: 1 },
    ]);
    expect(formatToolTrail(steps)).toEqual(["github_read_file ×2", "github_edit_file"]);
  });

  it("ignores results and steps without a tool name", () => {
    expect(toolTrail([step({ index: 0, type: "TOOL_RESULT", toolName: "x" })])).toEqual([]);
    expect(toolTrail([step({ index: 0, type: "TOOL_CALL" })])).toEqual([]);
  });
});

describe("totals and failures", () => {
  it("runTotals counts steps, tool calls, errors and approval decisions", () => {
    expect(runTotals(steps, approvals)).toEqual({
      steps: 7,
      toolCalls: 3,
      errors: 1,
      approvals: 3,
      approved: 1,
      rejected: 1,
      pending: 1,
    });
  });

  it("isFailedResult recognises a result the tool reported as an error", () => {
    expect(isFailedResult(steps[4])).toBe(true);
    expect(isFailedResult(steps[2])).toBe(false);
    // A call whose input happens to start with "Error:" is not a failed result.
    expect(isFailedResult(step({ index: 9, type: "TOOL_CALL", content: "Error: x" }))).toBe(false);
  });
});
