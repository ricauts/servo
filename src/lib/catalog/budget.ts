// Tier-2 budgets (cat-04): declared, enforced, and the FIRST cap to bind
// ends the tier with PARTIAL — never FAILED, never losing profiled rows —
// and a resume cursor naming where the next run restarts. Admission order
// (smallest relpages first, never-sampled before re-sampled) is what makes
// the resume meaningful: one wide table cannot consume a run.

export interface Tier2Budget {
  wallClockMs: number;
  /** Per DATASET: one wide table may not eat a run's sampling budget. */
  rowsSampledPerDataset: number;
  bytesReadPerRun: number; // bytes, per RUN — the resume-driving cap
}

export const DEFAULT_TIER2_BUDGET: Tier2Budget = {
  wallClockMs: 120_000,
  rowsSampledPerDataset: 50_000,
  bytesReadPerRun: 100 * 1024 * 1024,
};

export type BudgetCap = "WALL_CLOCK" | "ROWS" | "BYTES";

export interface BudgetState {
  startedAt: number;
  rowsSampled: number;
  bytesRead: number;
}

export function freshBudget(now = 0): BudgetState {
  return { startedAt: now, rowsSampled: 0, bytesRead: 0 };
}

/** Which cap (if any) binds RIGHT NOW. The first to bind is the one named
 *  in CatalogRun.budgetHit; checking in this order is deterministic. */
export function bindingCap(
  state: BudgetState,
  budget: Tier2Budget = DEFAULT_TIER2_BUDGET,
  now: number,
): BudgetCap | null {
  if (now - state.startedAt > budget.wallClockMs) return "WALL_CLOCK";
  if (state.rowsSampled > budget.rowsSampledPerDataset) return "ROWS";
  if (state.bytesRead > budget.bytesReadPerRun) return "BYTES";
  return null;
}

/** Charge a dataset's sampling against the budget. */
export function chargeDataset(state: BudgetState, rowsSampled: number, bytesRead: number): void {
  state.rowsSampled += rowsSampled;
  state.bytesRead += bytesRead;
}

export interface AdmissionCandidate {
  fqn: string;
  relpages: number;
  /** null = never sampled (admitted first among its size class). */
  valuesStatus: "ABSENT" | "PARTIAL" | "COMPLETE" | null;
}

/** Admission order: smallest relpages first; never-sampled before
 *  re-sampled within the same size. Deterministic (stable on fqn). */
export function admissionOrder<T extends AdmissionCandidate>(entries: T[]): T[] {
  return [...entries].sort((a, b) => {
    if (a.relpages !== b.relpages) return a.relpages - b.relpages;
    const aSampled = a.valuesStatus !== null && a.valuesStatus !== "ABSENT";
    const bSampled = b.valuesStatus !== null && b.valuesStatus !== "ABSENT";
    if (aSampled !== bSampled) return aSampled ? 1 : -1; // never-sampled first
    return a.fqn < b.fqn ? -1 : a.fqn > b.fqn ? 1 : 0;
  });
}

/** The resume cursor: where a PARTIAL run restarts. */
export interface ResumeCursor {
  lastFqn: string | null;
  pass: number;
}

export function cursorAfter(lastFqn: string | null, pass: number): ResumeCursor {
  return { lastFqn, pass };
}

/** catalog.sample.enabled: ON for SQL sources by default, OFF for object
 *  storage (cat-05 owns that path and its own budget shapes). */
export function samplingEnabledDefault(sourceKind: "sql" | "object-storage"): boolean {
  return sourceKind === "sql";
}
