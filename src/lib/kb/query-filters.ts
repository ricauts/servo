// Query-side filter parsing (spec ext-06). One entry point:
//
//   parseQueryFilters(query, ruleset) -> { filters, residue }
//
// The filters are structured and compile to SQL inside kb-10's single
// statement (src/lib/kb/search.ts). The residue is the free text that still
// reaches `websearch_to_tsquery` — what the parser could not type stays a
// keyword rather than disappearing.
//
// THE SAME EXTRACTOR, NOT A SECOND ONE. Every typed value here comes from
// `extractFacts` (src/lib/kb/facts/index.ts) — the identical pass that
// produced the stored `DocumentFact` rows. A query-side parser that read
// "$2,400" differently from the ingest-side parser would filter against a
// normalization the table does not contain, and every such query would
// return nothing for a reason no operator could see.
//
// WHAT THIS MODULE ADDS ON TOP, and why none of it is a second parser:
//
//   1. COMPARATORS. "over", "at least", "menos de" carry no value of their
//      own and are meaningless in a document — they exist only in a
//      question. They are a CLOSED table in data (COMPARATOR_PHRASES),
//      emitting exactly >=, <=, between and =, EN and ES.
//   2. REWRITES. "$2k" and "last quarter" are question-shaped surface forms
//      the ingest-side extractor deliberately does not parse. This module
//      REWRITES them to surface forms it already parses — "$2000" and
//      "Q4 2025" — and then runs the shared extractor over the result. All
//      of the money and interval arithmetic therefore still happens in
//      src/lib/kb/facts/, once. Teaching those forms to the extractor
//      itself would change what a stored fact IS, which bumps
//      EXTRACTOR_VERSION and re-extracts every document in the corpus —
//      a different item's decision, not this one's.
//
// PURITY, inherited: no clock, no locale, no Intl, no Setting read. The
// caller resolves `refDate` exactly as ingestion does; "last quarter" is a
// function of the ruleset, never of the wall clock. A test asserts this file
// contains no clock read at all, comments included.
//
// COVERAGE, stated rather than discovered: EN and ES, like the extractor's
// own relative-date and comparator coverage. A query in another language
// still filters on absolute dates, money with a code, identifiers, emails
// and URLs, because those matchers work on symbols rather than words.

import { extractFacts, type Fact, type FactRuleset } from "@/lib/kb/facts";
import type { FactConfidence, FactKind } from "@/lib/kb/facts/types";

/** The four comparators the phrase table may emit. The set is CLOSED. */
export type Comparator = ">=" | "<=" | "between" | "=";

/**
 * One structured filter. Exactly one shape is populated per `kind`:
 * numeric kinds carry `num` (+ `num2` for `between`) and `unit`, DATE
 * carries the half-open interval `[ts, tsEnd)` in epoch ms, and the string
 * kinds carry `norm`.
 */
export interface QueryFilter {
  kind: FactKind;
  comparator: Comparator;
  /** MONEY: minor units. DURATION: seconds. QUANTITY: the value. */
  num?: number;
  /** The upper bound of a `between` filter; `num` is then the lower. */
  num2?: number;
  /** "USD" | "s" | "gb" — compared exactly; no unit conversion (ext §11). */
  unit?: string;
  /** DATE only: inclusive interval start, epoch ms. */
  ts?: number;
  /** DATE only: exclusive interval end, epoch ms. */
  tsEnd?: number;
  /** IDENTIFIER | EMAIL | URL: the normalized, joinable form. */
  norm?: string;
  /** EXACT, or ASSUMED when a ruleset default resolved it (a bare "$"). */
  confidence: FactConfidence;
  /** The surface text this filter was read from — the readback's material. */
  text: string;
}

export interface ParsedQuery {
  filters: QueryFilter[];
  /** What reaches websearch_to_tsquery: whitespace-collapsed, order kept. */
  residue: string;
}

/**
 * Query input is capped before parsing (design §"Determinism", rule 5).
 * Extraction runs bounded regexes over caller-supplied text; the cap is the
 * outer bound that makes the step budget's job small.
 */
export const QUERY_INPUT_CAP = 512;

/**
 * The comparator table. DATA, not branching code: adding a language is a
 * row, and every row names one of the four comparators. Longest phrase
 * wins, which is why "more than" can never be shadowed by "than".
 *
 * "over" emits >= rather than > deliberately: the closed set has four
 * members and a strict variant would double it for a distinction no
 * operator asking for "invoices over $2k" intends.
 */
const COMPARATOR_PHRASES: ReadonlyArray<{ phrase: string; comparator: Comparator }> = [
  // English — at or above
  { phrase: "greater than or equal to", comparator: ">=" },
  { phrase: "more than", comparator: ">=" },
  { phrase: "greater than", comparator: ">=" },
  { phrase: "at least", comparator: ">=" },
  { phrase: "over", comparator: ">=" },
  { phrase: "above", comparator: ">=" },
  // English — at or below
  { phrase: "less than or equal to", comparator: "<=" },
  { phrase: "less than", comparator: "<=" },
  { phrase: "fewer than", comparator: "<=" },
  { phrase: "no more than", comparator: "<=" },
  { phrase: "at most", comparator: "<=" },
  { phrase: "under", comparator: "<=" },
  { phrase: "below", comparator: "<=" },
  // Spanish — at or above
  { phrase: "mayor o igual a", comparator: ">=" },
  { phrase: "más de", comparator: ">=" },
  { phrase: "mas de", comparator: ">=" },
  { phrase: "más que", comparator: ">=" },
  { phrase: "mas que", comparator: ">=" },
  { phrase: "al menos", comparator: ">=" },
  { phrase: "por encima de", comparator: ">=" },
  // Spanish — at or below
  { phrase: "menor o igual a", comparator: "<=" },
  { phrase: "menos de", comparator: "<=" },
  { phrase: "menos que", comparator: "<=" },
  { phrase: "como máximo", comparator: "<=" },
  { phrase: "como maximo", comparator: "<=" },
  { phrase: "por debajo de", comparator: "<=" },
];

/** The two-sided form, EN and ES. Both halves must be present or neither
 *  phrase is consumed — a lone "between" is a keyword, not a filter. */
const BETWEEN_PHRASES: ReadonlyArray<{ open: string; join: string }> = [
  { open: "between", join: "and" },
  { open: "entre", join: "y" },
];

/**
 * Connectives dropped from the residue ONLY when they sit against a span
 * the parser consumed — "invoices over $2k from last quarter" must leave
 * "invoices", not "invoices from". A word in this table that is NOT
 * adjacent to a consumed span survives, because "notes from Ana" is a
 * legitimate keyword query.
 */
const CONNECTIVES: ReadonlySet<string> = new Set([
  // English
  "from", "in", "on", "at", "of", "for", "during", "within", "since", "to", "by",
  // Spanish
  "de", "del", "en", "durante", "desde", "para", "por", "a", "al",
]);

/**
 * Relative period phrases, rewritten to the absolute quarter label the
 * shared extractor already parses ("Q4 2025"). Values are an offset in
 * QUARTERS from the quarter containing `ruleset.refDate`.
 */
const RELATIVE_PERIODS: ReadonlyArray<{ phrase: string; quarters: number }> = [
  { phrase: "last quarter", quarters: -1 },
  { phrase: "previous quarter", quarters: -1 },
  { phrase: "this quarter", quarters: 0 },
  { phrase: "current quarter", quarters: 0 },
  { phrase: "next quarter", quarters: 1 },
  { phrase: "trimestre pasado", quarters: -1 },
  { phrase: "último trimestre", quarters: -1 },
  { phrase: "ultimo trimestre", quarters: -1 },
  { phrase: "trimestre anterior", quarters: -1 },
  { phrase: "este trimestre", quarters: 0 },
  { phrase: "trimestre actual", quarters: 0 },
  { phrase: "próximo trimestre", quarters: 1 },
  { phrase: "proximo trimestre", quarters: 1 },
];

/** Magnitude suffixes, expanded only in a currency context (see below). */
const MAGNITUDES: ReadonlyArray<{ suffix: string; zeros: number }> = [
  { suffix: "k", zeros: 3 },
  { suffix: "m", zeros: 6 },
];

/** The currency codes money.ts resolves — repeated here only to bound the
 *  magnitude rewrite to a currency context. */
const CURRENCY_CODES = "USD|EUR|GBP|JPY|CHF|CLP|COP|MXN|BRL|CAD|INR|SEK";
const CURRENCY_SYMBOLS = "\\$|€|£|¥";

interface Span {
  start: number;
  end: number;
}

/** A piece of the rewritten string and the original span it stands for. */
interface Piece {
  workStart: number;
  workEnd: number;
  origStart: number;
  origEnd: number;
  /** True when the piece is the original text verbatim (1:1 offsets). */
  identity: boolean;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A lowercase view of the text with the SAME length, so phrase offsets
 * found in it are offsets in the original. A locale-independent
 * `toLowerCase` can in principle change length; when it does, matching
 * falls back to the original text rather than reporting wrong spans.
 */
function sameLengthLower(text: string): string {
  const lower = text.toLowerCase();
  return lower.length === text.length ? lower : text;
}

/** `1.5` + 3 zeros -> "1500"; null when the mantissa is not expandable. */
export function expandMagnitude(mantissa: string, zeros: number): string | null {
  const m = /^(\d{1,12})(?:[.,](\d{1,3}))?$/.exec(mantissa);
  if (!m) return null;
  const frac = m[2] ?? "";
  if (frac.length > zeros) return null;
  return m[1] + frac + "0".repeat(zeros - frac.length);
}

/** Zero-based quarter index of a YYYY-MM-DD day, and its year. */
function quarterOf(refDate: string): { year: number; quarter: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(refDate);
  if (!m) return { year: 1970, quarter: 1 };
  const month = Number(m[2]);
  return { year: Number(m[1]), quarter: Math.floor((month - 1) / 3) + 1 };
}

/** "last quarter" against refDate 2026-01-15 -> "Q4 2025". */
export function quarterLabel(refDate: string, offset: number): string {
  const { year, quarter } = quarterOf(refDate);
  const zero = (year * 4 + (quarter - 1)) + offset;
  const y = Math.floor(zero / 4);
  const q = zero - y * 4 + 1;
  return `Q${q} ${y}`;
}

/** Non-overlapping matches of a phrase table, longest phrase first. */
function findPhrases<T extends { phrase: string }>(
  lower: string,
  table: ReadonlyArray<T>,
): Array<Span & { entry: T }> {
  const ordered = [...table].sort((a, b) => b.phrase.length - a.phrase.length);
  const out: Array<Span & { entry: T }> = [];
  const taken: Span[] = [];
  for (const entry of ordered) {
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(entry.phrase)}(?![\\p{L}\\p{N}])`, "gu");
    for (const m of lower.matchAll(re)) {
      const span = { start: m.index ?? 0, end: (m.index ?? 0) + m[0].length };
      if (taken.some((t) => span.start < t.end && t.start < span.end)) continue;
      taken.push(span);
      out.push({ ...span, entry });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/**
 * Build the rewritten string: relative periods become quarter labels and
 * currency magnitudes become full numerals, everything else is copied
 * verbatim. The returned pieces map any offset in the rewrite back to a
 * span of the original.
 */
function rewrite(text: string, ruleset: FactRuleset): { work: string; pieces: Piece[] } {
  const lower = sameLengthLower(text);
  const replacements: Array<Span & { out: string }> = [];

  for (const hit of findPhrases(lower, RELATIVE_PERIODS)) {
    replacements.push({ start: hit.start, end: hit.end, out: quarterLabel(ruleset.refDate, hit.entry.quarters) });
  }

  // Magnitudes, only where a currency symbol or code makes the reading
  // unambiguous: a bare "50k" in a document is as likely to be a part
  // number as an amount, and QUANTITY deliberately refuses bare numerals.
  const suffixAlt = MAGNITUDES.map((m) => m.suffix).join("|");
  const zerosFor = (suffix: string) =>
    MAGNITUDES.find((m) => m.suffix === suffix.toLowerCase())?.zeros ?? 0;
  const push = (start: number, end: number, out: string) => {
    if (replacements.some((r) => start < r.end && r.start < end)) return;
    replacements.push({ start, end, out });
  };
  for (const m of text.matchAll(
    new RegExp(`(${CURRENCY_SYMBOLS})(\\s{0,2})(\\d{1,12}(?:[.,]\\d{1,3})?)(${suffixAlt})(?![\\p{L}\\p{N}])`, "giu"),
  )) {
    const expanded = expandMagnitude(m[3], zerosFor(m[4]));
    if (expanded === null) continue;
    push(m.index ?? 0, (m.index ?? 0) + m[0].length, `${m[1]}${m[2]}${expanded}`);
  }
  for (const m of text.matchAll(
    new RegExp(`(\\d{1,12}(?:[.,]\\d{1,3})?)(${suffixAlt})(\\s{0,2})(${CURRENCY_CODES})(?![\\p{L}\\p{N}])`, "giu"),
  )) {
    const expanded = expandMagnitude(m[1], zerosFor(m[2]));
    if (expanded === null) continue;
    push(m.index ?? 0, (m.index ?? 0) + m[0].length, `${expanded}${m[3]}${m[4]}`);
  }

  replacements.sort((a, b) => a.start - b.start);

  const pieces: Piece[] = [];
  let work = "";
  let cursor = 0;
  const copy = (from: number, to: number) => {
    if (to <= from) return;
    pieces.push({ workStart: work.length, workEnd: work.length + (to - from), origStart: from, origEnd: to, identity: true });
    work += text.slice(from, to);
  };
  for (const r of replacements) {
    copy(cursor, r.start);
    pieces.push({ workStart: work.length, workEnd: work.length + r.out.length, origStart: r.start, origEnd: r.end, identity: false });
    work += r.out;
    cursor = r.end;
  }
  copy(cursor, text.length);
  return { work, pieces };
}

/** Map a span of the rewritten string back to a span of the original. */
function toOriginal(pieces: Piece[], workStart: number, workEnd: number): Span {
  let start: number | null = null;
  let end: number | null = null;
  for (const p of pieces) {
    if (workStart >= p.workEnd || workEnd <= p.workStart) continue;
    const s = p.identity ? p.origStart + (Math.max(workStart, p.workStart) - p.workStart) : p.origStart;
    const e = p.identity ? p.origStart + (Math.min(workEnd, p.workEnd) - p.workStart) : p.origEnd;
    start = start === null ? s : Math.min(start, s);
    end = end === null ? e : Math.max(end, e);
  }
  return { start: start ?? 0, end: end ?? 0 };
}

/** The numeric kinds a comparator may attach to. */
function numericKind(kind: FactKind): boolean {
  return kind === "MONEY" || kind === "DURATION" || kind === "QUANTITY";
}

/** QUANTITY, EMAIL and URL carry no confidence: they are EXACT by shape. */
function confidenceOf(fact: Fact): FactConfidence {
  return "confidence" in fact ? fact.confidence : "EXACT";
}

/**
 * `surface` is the span AS THE CALLER TYPED IT, not the rewritten form: an
 * operator who wrote "last quarter" must be told the filter came from "last
 * quarter", never from the "Q4 2025" this module handed the extractor.
 */
function filterFromFact(fact: Fact, comparator: Comparator, surface: string): QueryFilter {
  const base = { kind: fact.kind, comparator, confidence: confidenceOf(fact), text: surface } as QueryFilter;
  if (fact.kind === "DATE") return { ...base, ts: fact.ts, tsEnd: fact.tsEnd, comparator: "=" };
  if (numericKind(fact.kind)) {
    const withNum = fact as Extract<Fact, { num: number }>;
    return { ...base, num: withNum.num, unit: "unit" in withNum ? withNum.unit : "" };
  }
  return { ...base, comparator: "=", norm: fact.norm };
}

/** The original text a mapped span covers. */
function surfaceOf(text: string, span: Span): string {
  return text.slice(span.start, span.end);
}

/** True when the gap between two offsets is whitespace only. */
function onlyGap(text: string, from: number, to: number): boolean {
  return to >= from && /^\s*$/.test(text.slice(from, to));
}

/**
 * Parse a query into structured filters plus the free-text residue.
 * PURE: the ruleset carries refDate, dateOrder and defaultCurrency, so the
 * same query plus the same ruleset always produces the same result.
 */
export function parseQueryFilters(query: string, ruleset: FactRuleset): ParsedQuery {
  const text = query.slice(0, QUERY_INPUT_CAP);
  const lower = sameLengthLower(text);
  const { work, pieces } = rewrite(text, ruleset);

  // The shared extractor — the same call ingestion makes.
  const facts = extractFacts(work, ruleset).facts
    .map((fact) => ({ fact, span: toOriginal(pieces, fact.offset, fact.offset + fact.length) }))
    .sort((a, b) => a.span.start - b.span.start);

  const consumedFacts = new Set<number>();
  const masked: Span[] = [];
  const filters: QueryFilter[] = [];

  // Two-sided form first: "between $1,000 and $2,000" must not be read as
  // two independent equality filters.
  for (const hit of findPhrases(lower, BETWEEN_PHRASES.map((b) => ({ ...b, phrase: b.open })))) {
    const first = facts.findIndex((f, i) => !consumedFacts.has(i) && f.span.start >= hit.end);
    if (first === -1) continue;
    const joinRe = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(hit.entry.join)}(?![\\p{L}\\p{N}])`, "gu");
    joinRe.lastIndex = facts[first].span.end;
    const join = joinRe.exec(lower);
    if (!join) continue;
    const second = facts.findIndex(
      (f, i) => i > first && !consumedFacts.has(i) && f.span.start >= join.index + join[0].length && f.fact.kind === facts[first].fact.kind,
    );
    if (second === -1) continue;
    const a = facts[first].fact;
    const b = facts[second].fact;
    if (a.kind === "DATE" && b.kind === "DATE") {
      filters.push({
        kind: "DATE", comparator: "=", ts: Math.min(a.ts, b.ts), tsEnd: Math.max(a.tsEnd, b.tsEnd),
        confidence: a.confidence === "ASSUMED" || b.confidence === "ASSUMED" ? "ASSUMED" : "EXACT",
        text: text.slice(facts[first].span.start, facts[second].span.end),
      });
    } else if (numericKind(a.kind) && numericKind(b.kind)) {
      const an = a as Extract<Fact, { num: number }>;
      const bn = b as Extract<Fact, { num: number }>;
      if (an.unit !== bn.unit) continue; // no unit conversion, by design
      filters.push({
        kind: a.kind, comparator: "between", num: Math.min(an.num, bn.num), num2: Math.max(an.num, bn.num), unit: an.unit,
        confidence: confidenceOf(a) === "ASSUMED" || confidenceOf(b) === "ASSUMED" ? "ASSUMED" : "EXACT",
        text: text.slice(facts[first].span.start, facts[second].span.end),
      });
    } else {
      continue;
    }
    consumedFacts.add(first);
    consumedFacts.add(second);
    masked.push({ start: hit.start, end: hit.end });
    masked.push({ start: join.index, end: join.index + join[0].length });
    masked.push(facts[first].span, facts[second].span);
  }

  // One-sided comparators: the phrase binds to the next unconsumed numeric
  // fact when only whitespace separates them. A comparator with nothing to
  // bind to is NOT consumed — it stays a keyword, because a silently
  // dropped word is a silently different query.
  for (const hit of findPhrases(lower, COMPARATOR_PHRASES)) {
    const idx = facts.findIndex(
      (f, i) => !consumedFacts.has(i) && f.span.start >= hit.end && onlyGap(text, hit.end, f.span.start) && numericKind(f.fact.kind),
    );
    if (idx === -1) continue;
    consumedFacts.add(idx);
    filters.push(filterFromFact(facts[idx].fact, hit.entry.comparator, surfaceOf(text, facts[idx].span)));
    masked.push({ start: hit.start, end: hit.end }, facts[idx].span);
  }

  // Everything else the extractor typed becomes an equality (DATE: an
  // interval overlap) filter.
  facts.forEach((f, i) => {
    if (consumedFacts.has(i)) return;
    consumedFacts.add(i);
    filters.push(filterFromFact(f.fact, "=", surfaceOf(text, f.span)));
    masked.push(f.span);
  });

  return { filters, residue: residueOf(text, masked) };
}

/**
 * The residue: the original text minus every consumed span, minus the
 * connectives left stranded against one, whitespace-collapsed.
 */
function residueOf(text: string, masked: Span[]): string {
  const mask = new Array<boolean>(text.length).fill(false);
  for (const s of masked) {
    for (let i = Math.max(0, s.start); i < Math.min(text.length, s.end); i++) mask[i] = true;
  }

  const tokens: Array<{ start: number; end: number; text: string }> = [];
  let i = 0;
  while (i < text.length) {
    if (mask[i] || /\s/.test(text[i])) {
      i++;
      continue;
    }
    const start = i;
    while (i < text.length && !mask[i] && !/\s/.test(text[i])) i++;
    tokens.push({ start, end: i, text: text.slice(start, i) });
  }

  /** The nearest non-whitespace neighbour was consumed. */
  const touchesMask = (from: number, step: -1 | 1): boolean => {
    let j = from;
    while (j >= 0 && j < text.length && /\s/.test(text[j]) && !mask[j]) j += step;
    return j >= 0 && j < text.length && mask[j];
  };

  const kept = tokens.filter((t) => {
    const word = t.text.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
    if (!CONNECTIVES.has(word)) return true;
    return !(touchesMask(t.start - 1, -1) || touchesMask(t.end, 1));
  });

  return kept.map((t) => t.text).join(" ").trim();
}
