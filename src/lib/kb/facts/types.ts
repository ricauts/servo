// Fact types and the ruleset (ext-02). The extractor is PURE: no database,
// no network, no provider, NO CLOCK READ and no Setting read — refDate,
// dateOrder and defaultCurrency are FIELDS OF THE RULESET, resolved by the
// caller. The extractor never consults kb.facts.* itself.
//
// No Intl, no toLocaleDateString, no host locale anywhere under
// src/lib/kb/facts/: dates normalize to UTC. A per-desk timezone is
// ROADMAP and is deliberately absent here.

export type FactKind =
  | "DATE"
  | "MONEY"
  | "DURATION"
  | "IDENTIFIER"
  | "QUANTITY"
  | "EMAIL"
  | "URL";

/**
 * The extractor version every fact is stamped with (ext-03). When a rule
 * changes what a fact WOULD be, this string changes and every stored fact
 * from an older version is re-extracted rather than mixed with the new
 * output. It is a CONSTANT, not a Setting: a setting that changes
 * extraction output silently invalidates every stored fact.
 */
export const EXTRACTOR_VERSION = "facts@1";

/**
 * Every fact names its exact span: text.slice(0) at [offset, offset+length)
 * round-trips byte-identically. Facts from one extraction never overlap —
 * overlaps are resolved by LONGEST MATCH, ties by the fixed precedence
 * URL > EMAIL > IDENTIFIER > MONEY > DATE > DURATION > QUANTITY.
 */
export interface FactBase {
  /** The matched text span. */
  text: string;
  /** Inclusive start offset within the input. */
  offset: number;
  /** Length in UTF-16 code units; slice(offset, offset + length) === text. */
  length: number;
  /** The ruleset that produced this fact — see EXTRACTOR_VERSION. */
  extractor: typeof EXTRACTOR_VERSION;
}

export interface DateFact extends FactBase {
  kind: "DATE";
  /** Inclusive UTC midnight, epoch ms. */
  ts: number;
  /** Exclusive end, epoch ms. */
  tsEnd: number;
  norm: string; // "2026-01-31/2026-02-01"
  confidence: FactConfidence;
}

export type FactConfidence = "EXACT" | "ASSUMED";

export interface MoneyFact extends FactBase {
  kind: "MONEY";
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
export interface DurationFact extends FactBase {
  kind: "DURATION";
  num: number; // seconds
  unit: "s";
  norm: string; // ISO-8601 duration
  confidence: FactConfidence;
}

/**
 * IDENTIFIER: a document-style reference token — letters AND digits with an
 * internal -_/. separator, a letters-then-digits form like SR00123, or a
 * #-prefixed numeral. Normalization case-folds and collapses every
 * separator run AWAY, so INV-2024-113 and inv_2024_113 are one
 * identifier: "inv2024113". Space is NOT a separator — "paid 300" must
 * never become a reference.
 */
export interface IdentifierFact extends FactBase {
  kind: "IDENTIFIER";
  norm: string; // case-folded, separators collapsed away
  confidence: FactConfidence;
}

/**
 * QUANTITY: a number with a NON-time unit (time belongs to DURATION).
 * BARE NUMERALS ARE NOT EXTRACTED — no unit and no currency means no fact.
 * norm is "<value>:<unit>" with the unit lowercased.
 */
export interface QuantityFact extends FactBase {
  kind: "QUANTITY";
  num: number;
  unit: string; // "kg", "%", "gb", ...
  norm: string; // "3.5:gb"
}

/** EMAIL: the whole address, case-folded. */
export interface EmailFact extends FactBase {
  kind: "EMAIL";
  norm: string;
}

/** URL: origin plus path; query and fragment are DROPPED. */
export interface UrlFact extends FactBase {
  kind: "URL";
  norm: string; // "https://host/path"
}

export type Fact =
  | DateFact
  | MoneyFact
  | DurationFact
  | IdentifierFact
  | QuantityFact
  | EmailFact
  | UrlFact;

/**
 * Tie-break order for overlapping spans of EQUAL LENGTH (ext-03). A longer
 * span always wins first; this order settles same-span collisions.
 */
export const FACT_PRECEDENCE: Record<Fact["kind"], number> = {
  URL: 0,
  EMAIL: 1,
  IDENTIFIER: 2,
  MONEY: 3,
  DATE: 4,
  DURATION: 5,
  QUANTITY: 6,
};

/**
 * At most this many facts leave one extractFacts call, kept in offset
 * order, the remainder dropped deterministically (ext-03). A CONSTANT,
 * not a Setting — a setting that changes extraction output silently
 * invalidates every stored fact.
 */
export const MAX_FACTS_PER_CALL = 64;

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
