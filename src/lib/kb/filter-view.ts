// The search route's view-model helpers (ext-06/08): how a structured
// filter renders as a chip, and how the UI's dropped-chip set round-trips.
// They live HERE — a module the tests and the route both import — because
// a Next.js route file may export ONLY handlers and config: the build's
// route-type check rejects any other runtime export (the failure main's
// CI caught).

import type { QueryFilter } from "@/lib/kb/query-filters";
import { exponentFor as exponent } from "@/lib/kb/facts";

export const MAX_UI_FILTERS = 8;

/** Result rows one search returns. */
export const SEARCH_LIMIT = 8;

export interface SearchFilterView {
  /** Index into the FULL parse — the id `drop` names. Stable for one query. */
  index: number;
  kind: string;
  comparator: string;
  /** The surface text the filter was read from, as the operator typed it. */
  text: string;
  confidence: string;
  /** The normalized value, rendered for a human: "≥ USD 2,000.00". */
  display: string;
  /** True when this filter was dropped by `drop` and did NOT narrow. */
  dropped: boolean;
}

export interface SearchHitView {
  documentId: string;
  docName: string;
  chunkId: string;
  locator: string;
  text: string;
}

export interface KbSearchResponse {
  /** The free text that reached the keyword pass. */
  residue: string;
  /** What the search actually ran on — residue, or the query verbatim. */
  queryUsed: string;
  filters: SearchFilterView[];
  /** Filters beyond MAX_UI_FILTERS that were parsed but not applied. */
  overflow: number;
  /** The cap `overflow` was measured against — sent so the readback can name
   *  it without the client importing this server module. */
  maxFilters: number;
  hits: SearchHitView[];
}

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

const COMPARATOR_GLYPH: Record<string, string> = {
  ">=": "≥",
  "<=": "≤",
  "=": "=",
  between: "between",
};

/**
 * The normalized value in words. MONEY is stored in MINOR UNITS, so it is
 * rendered through the currency's own exponent rather than divided by a
 * hardcoded 100 — JPY has no minor unit and would otherwise read 100× high.
 */
export function describeFilter(f: QueryFilter): string {
  if (f.kind === "DATE") {
    const start = isoDay(f.ts ?? 0);
    // tsEnd is EXCLUSIVE; a single day renders as the day, not as a range
    // whose second half nobody asked about.
    const end = isoDay((f.tsEnd ?? 0) - 1);
    return start === end ? start : `${start} → ${end}`;
  }
  if (f.num !== undefined) {
    const one = (n: number) => renderAmount(f.kind, n, f.unit ?? "");
    if (f.comparator === "between") return `between ${one(f.num)} and ${one(f.num2 ?? f.num)}`;
    return `${COMPARATOR_GLYPH[f.comparator] ?? f.comparator} ${one(f.num)}`;
  }
  return f.norm ?? "";
}

function renderAmount(kind: string, num: number, unit: string): string {
  if (kind === "MONEY") {
    const exp = exponent(unit);
    if (exp === null) return `${num} ${unit}`.trim();
    const major = num / 10 ** exp;
    return `${unit} ${major.toFixed(exp)}`;
  }
  if (kind === "DURATION") return `${num} s`;
  return unit === "" ? String(num) : `${num} ${unit}`;
}

/**
 * The OPERAND text of one filter, for the value fallback below.
 *
 * A one-sided filter's `text` IS its operand. A two-sided one's is the whole
 * span from the first operand to the second — "$1,000 and $2,000", "2025-01-05
 * y 2025-03-01" — so it carries the join word the parser consumed and the
 * readback has already told the operator was consumed. Feeding that to the
 * keyword pass demands the literal lexeme "and" or "y", which turns a range
 * question into a search for documents that happen to phrase the range the
 * same way the question did.
 *
 * TWO-SIDEDNESS IS READ FROM `operands`, NOT FROM THE COMPARATOR. A numeric
 * range carries comparator "between", but a DATE range carries "=" like every
 * other date — every date is an interval, so a range is just a wider one.
 * Keying on the comparator would fix "entre $1,000 y $2,000" and leave "entre
 * 2025-01-05 y 2025-03-01" broken, which is the same bug with a different
 * operand type.
 */
export function operandText(f: QueryFilter): string {
  return f.operands ? f.operands.join(" ") : f.text;
}

/**
 * `drop=0,2` -> {0, 2}. Anything that is not a run of digits is ignored
 * rather than refused: a stale chip index is a no-op, not a 400.
 *
 * The shape test is `/^\d+$/` on the raw part, NOT `Number(part)`, because
 * `Number("")` and `Number(" ")` are both 0 — a trailing comma or a stray
 * space would otherwise drop filter index 0, a chip nobody clicked.
 */
export function parseDropped(raw: string | null): Set<number> {
  const out = new Set<number>();
  if (!raw) return out;
  // Bounded on the way in. The value is only ever read as `has(i)` for
  // i < MAX_UI_FILTERS, so nothing beyond that many distinct indices can
  // change an answer — and a `drop` of a million parts would otherwise
  // build a million-entry Set on an endpoint whose other inputs are capped.
  for (const part of raw.split(",", MAX_UI_FILTERS * 4)) {
    const trimmed = part.trim();
    if (/^\d{1,6}$/.test(trimmed)) out.add(Number(trimmed));
  }
  return out;
}

