// The composing entry (ext-02): extractFacts(text, ruleset) — PURE. The
// ruleset carries refDate, dateOrder and defaultCurrency; the extractor
// reads no clock, no Setting, no database and no locale (see types.ts).

import { extractDates } from "./dates";
import { extractMoney } from "./money";
import { extractDurations } from "./duration";
import { StepBudget, type ExtractResult, type Fact, type FactRuleset } from "./types";

export { DEFAULT_RULESET } from "./types";
export type { Fact, FactRuleset, ExtractResult, DateFact, MoneyFact, DurationFact } from "./types";
export { exponentFor } from "./money";

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

  // Stable order: kind, then position in the text — the byte-identity the
  // golden corpora assert depends on it.
  const facts: Fact[] = [...dates.facts, ...money.facts, ...durations.facts].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
    return text.indexOf(a.text) - text.indexOf(b.text);
  });
  return { facts, steps: budget.consumed };
}
