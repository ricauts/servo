// What a fact chip's tooltip says (ext-08): the normalized value, and — for
// an ASSUMED fact — which ruleset field resolved it.
//
// A fact is ASSUMED when the text did not say enough and a RULESET FIELD
// decided the rest: a bare "$" has no currency code, "04/11/2025" has two
// legal readings, and "next month" has no meaning without a date to be next
// to. Those three fields are the whole of it — `defaultCurrency`, `dateOrder`
// and `refDate` — so the tooltip can always name exactly one of them.
//
// Plain .ts rather than part of the component: this is the sentence the chip
// promises to show, and it is asserted directly by tests/kb-facts-ui.test.ts
// (the same split nav-items.ts uses against the shell components).

import { DEFAULT_RULESET, exponentFor } from "@/lib/kb/facts";

/** The half of a fact chip's tooltip that states the value. Everything it
 *  needs, and nothing about how it is drawn. */
export interface FactValue {
  kind: string;
  norm: string;
  unit: string;
  /** Decimal as a string; MONEY is in MINOR UNITS. */
  num: string | null;
  /** DATE only: the stored half-open interval, epoch ms as strings. */
  ts: string | null;
  tsEnd: string | null;
}

/** The interval a DATE fact covers, from the stored half-open [ts, tsEnd). */
function dateRange(fact: FactValue): string {
  if (fact.ts === null || fact.tsEnd === null) return fact.norm;
  const start = new Date(Number(fact.ts)).toISOString().slice(0, 10);
  const end = new Date(Number(fact.tsEnd) - 1).toISOString().slice(0, 10);
  return start === end ? start : `${start} → ${end}`;
}

/**
 * The normalized value a chip's tooltip states, beside its surface form.
 *
 * MONEY IS STORED IN MINOR UNITS, so it is rendered through its currency's
 * own exponent — the same conversion the search route's filter chips make.
 * Printing `num` raw would put "240000 USD" beside the text "$2,400.00" and
 * tell an operator checking the parser's work that it read the amount 100×
 * high, which is the opposite of what this panel is for. The bug is
 * currency-dependent: JPY (exponent 0) would look right while every USD
 * amount was wrong, so a spot check would not find it.
 */
export function factValue(fact: FactValue): string {
  if (fact.kind === "DATE") return dateRange(fact);
  if (fact.num === null) return fact.norm;
  if (fact.kind === "MONEY") {
    const exponent = exponentFor(fact.unit);
    if (exponent !== null) {
      return `${fact.unit} ${(Number(fact.num) / 10 ** exponent).toFixed(exponent)}`;
    }
  }
  return fact.unit === "" ? fact.num : `${fact.num} ${fact.unit}`;
}

/**
 * A day-first/month-first numeric date: `31/01/2026`, `1.2.26`, `01-02-2026`.
 * This is the ONE surface shape whose reading `dateOrder` decides (see the
 * ambiguous branch in src/lib/kb/facts/dates.ts); every other ASSUMED date
 * came from a relative phrase resolved against the document's own date.
 */
export const NUMERIC_DATE = /^\d{1,2}\s*[./-]\s*\d{1,2}\s*[./-]\s*\d{2,4}$/;

/**
 * Which ruleset field resolved an ASSUMED fact, named in full.
 *
 * These are the extractor's ruleset fields, not rows in the Setting table:
 * `dateOrder` and `defaultCurrency` are constants of DEFAULT_RULESET, and
 * `refDate` is the document's own date. Naming the live constant rather than
 * a copied string means the tooltip cannot drift from what actually ran.
 */
export function assumptionNote(fact: { kind: string; text: string }, documentDate: string): string {
  if (fact.kind === "MONEY") {
    return `Currency assumed. This amount carries an ambiguous symbol, so the ruleset default defaultCurrency = ${DEFAULT_RULESET.defaultCurrency} resolved it.`;
  }
  if (fact.kind === "DATE") {
    if (NUMERIC_DATE.test(fact.text.trim())) {
      return `Day/month order assumed. Both readings of this numeric date are legal, so the ruleset default dateOrder = ${DEFAULT_RULESET.dateOrder} resolved it.`;
    }
    return `Resolved relative to refDate — the document's own date, ${documentDate}.`;
  }
  return "Resolved by a ruleset default rather than stated in the text.";
}
