// The composing entry: extractFacts(text, ruleset) — PURE. The ruleset
// carries refDate, dateOrder and defaultCurrency; the extractor reads no
// clock, no Setting, no database and no locale (see types.ts).
//
// COMPOSITION (ext-03): seven matchers run in one bounded pass each, then
// overlapping spans resolve by LONGEST MATCH, ties by the fixed precedence
// URL > EMAIL > IDENTIFIER > MONEY > DATE > DURATION > QUANTITY; the
// survivors are kept in OFFSET ORDER and capped at MAX_FACTS_PER_CALL
// (64), the remainder dropped deterministically. Every fact carries its
// exact offset and length and the extractor version "facts@1".
//
// COVERAGE LIMIT, in plain words: relative-date and comparator phrases
// ("last week", "más de") are English and Spanish only. Other languages
// still get identifiers, money, emails, URLs and absolute dates, because
// those matchers work on symbols and ISO shapes rather than words.
//
// DELIBERATELY NOT EXTRACTED, and why: person names, organisations and
// places (capitalisation is not evidence of type in ticket prose, and a
// wrong-type fact is worse than a keyword — capitalized multi-word names
// REMAIN in kb-08's lexical keyword half and are not moved here); phone
// numbers (no canonical format survives copy-paste, and no v1 reader
// calls a phone fact); times of day (a clock time without a date is not
// an interval the date predicates can answer).

import { extractDates } from "./dates";
import { extractMoney } from "./money";
import { extractDurations } from "./duration";
import { extractIdentifiers, extractEmails, extractUrls } from "./identifiers";
import { extractQuantities } from "./quantity";
import {
  FACT_PRECEDENCE,
  MAX_FACTS_PER_CALL,
  StepBudget,
  type ExtractResult,
  type Fact,
  type FactRuleset,
} from "./types";

export { DEFAULT_RULESET, EXTRACTOR_VERSION, FACT_PRECEDENCE, MAX_FACTS_PER_CALL } from "./types";
export type {
  Fact,
  FactRuleset,
  ExtractResult,
  DateFact,
  MoneyFact,
  DurationFact,
  IdentifierFact,
  QuantityFact,
  EmailFact,
  UrlFact,
} from "./types";
export { exponentFor } from "./money";
export { normalizeIdentifier } from "./identifiers";

/** True when the two spans share at least one character. */
function overlaps(a: Fact, b: Fact): boolean {
  return a.offset < b.offset + b.length && b.offset < a.offset + a.length;
}

/**
 * Longest match wins; equal length settles by the fixed precedence; equal
 * both keeps the earlier offset. The sort runs once and the greedy sweep
 * below is then deterministic.
 */
function resolveOverlaps(candidates: Fact[]): Fact[] {
  const ordered = [...candidates].sort((a, b) => {
    if (b.length !== a.length) return b.length - a.length;
    const pa = FACT_PRECEDENCE[a.kind];
    const pb = FACT_PRECEDENCE[b.kind];
    if (pa !== pb) return pa - pb;
    return a.offset - b.offset;
  });
  const kept: Fact[] = [];
  for (const f of ordered) {
    if (kept.some((k) => overlaps(k, f))) continue;
    kept.push(f);
  }
  return kept.sort((a, b) => a.offset - b.offset);
}

/** Pure: same text plus same ruleset produces byte-identical output. */
export function extractFacts(text: string, ruleset: FactRuleset): ExtractResult {
  const budget = new StepBudget(ruleset.stepBudget);
  // refDate is a UTC ISO date string from the CALLER — Date.parse of a
  // fixed date-form string is deterministic UTC, not a clock read.
  const refTs = Date.parse(`${ruleset.refDate}T00:00:00Z`);

  const dates = extractDates(text, {
    refTs,
    dateOrder: ruleset.dateOrder,
    pay: (n) => budget.pay(n),
  });
  const money = extractMoney(text, {
    defaultCurrency: ruleset.defaultCurrency,
    pay: (n) => budget.pay(n),
  });
  const durations = extractDurations(text, { pay: (n) => budget.pay(n) });
  const identifiers = extractIdentifiers(text, { pay: (n) => budget.pay(n) });
  const emails = extractEmails(text, { pay: (n) => budget.pay(n) });
  const urls = extractUrls(text, { pay: (n) => budget.pay(n) });
  const quantities = extractQuantities(text, { pay: (n) => budget.pay(n) });

  const resolved = resolveOverlaps([
    ...dates.facts,
    ...money.facts,
    ...durations.facts,
    ...identifiers.facts,
    ...emails.facts,
    ...urls.facts,
    ...quantities.facts,
  ]);

  return { facts: resolved.slice(0, MAX_FACTS_PER_CALL), steps: budget.consumed };
}
