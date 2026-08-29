// Fact types and the ruleset (ext-02). The extractor is PURE: no database,
// no network, no provider, NO CLOCK READ and no Setting read — refDate,
// dateOrder and defaultCurrency are FIELDS OF THE RULESET, resolved by the
// caller. The extractor never consults kb.facts.* itself.
//
// No Intl, no toLocaleDateString, no host locale anywhere under
// src/lib/kb/facts/: dates normalize to UTC. A per-desk timezone is
// ROADMAP and is deliberately absent here.

export type FactKind = "DATE" | "MONEY" | "DURATION";

export type FactConfidence = "EXACT" | "ASSUMED";

/**
 * Every DATE fact is an INTERVAL: ts inclusive UTC midnight, tsEnd
 * exclusive. A single day has tsEnd = ts + 1 day; a month, a quarter and a
 * relative span use the same shape. One representation, one predicate —
 * there is no separate "instant" date fact anywhere.
 */
export interface DateFact {
  kind: "DATE";
  /** The matched text span. */
  text: string;
  /** Inclusive UTC midnight, epoch ms. */
  ts: number;
  /** Exclusive end, epoch ms. */
  tsEnd: number;
  norm: string; // "2026-01-31/2026-02-01"
  confidence: FactConfidence;
}

/**
 * MONEY is stored in INTEGER MINOR UNITS: num is never a float. The ISO
 * code rides `unit`, and `norm` is "<CODE>:<minor>". Exponents come from
 * currencies.json; a symbol or code absent from that table produces NO
 * money fact — it stays a keyword.
 */
export interface MoneyFact {
  kind: "MONEY";
  text: string;
  /** Minor units as an integer (cents for USD/EUR, whole yen for JPY). */
  num: number;
  /** ISO 4217 code, resolved (possibly via the ruleset default). */
  unit: string;
  norm: string; // "USD:123456"
  confidence: FactConfidence;
}

/**
 * DURATION normalizes to seconds in num with unit "s" and an ISO-8601
 * duration in norm: "30 days" → 2592000 / "P30D".
 */
export interface DurationFact {
  kind: "DURATION";
  text: string;
  num: number; // seconds
  unit: "s";
  norm: string; // ISO-8601 duration
  confidence: FactConfidence;
}

export type Fact = DateFact | MoneyFact | DurationFact;

/** Day-month-year or month-day-year for ambiguous numeric dates. */
export type DateOrder = "DMY" | "MDY";

/** Everything the extractor may know about the world, passed in. */
export interface FactRuleset {
  /** The "today" facts are relative to, as a UTC ISO date (YYYY-MM-DD).
   *  Resolved by the CALLER; the extractor reads no clock. */
  refDate: string;
  /** Order for numeric dates whose day is <= 12 (both readings legal). */
  dateOrder: DateOrder;
  /** The code a bare, ambiguous currency symbol resolves to. */
  defaultCurrency: string;
  /** Max regex/candidate steps one call may take. */
  stepBudget: number;
}

export const DEFAULT_RULESET: FactRuleset = {
  refDate: "2026-01-15",
  dateOrder: "DMY",
  defaultCurrency: "USD",
  stepBudget: 250_000,
};

export interface ExtractResult {
  facts: Fact[];
  /** How many steps the pass consumed — the budget is enforced on THIS
   *  counter, never on elapsed milliseconds. */
  steps: number;
}

/** A bounded, monotonic step counter — every regex pass and every
 *  candidate evaluation pays into it. */
export class StepBudget {
  private steps = 0;
  constructor(public readonly budget: number) {}
  /** Returns false when the budget is exhausted — callers stop, and the
   *  facts gathered so far stand (a partial pass beats an OOM regex). */
  pay(n = 1): boolean {
    this.steps += n;
    return this.steps <= this.budget;
  }
  get consumed(): number {
    return this.steps;
  }
}
