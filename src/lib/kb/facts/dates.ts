// Date fact extraction (ext-02). Pure: no clock, no locale, no Intl —
// dates normalize to UTC and every fact is an interval {ts, tsEnd}. A
// per-desk timezone is ROADMAP and is named here so nobody "fixes" the UTC
// normalization into a locale read.
//
// Regex safety: every pattern uses bounded quantifiers with no nesting.
// Month names are alternations, matched case-insensitively for English and
// exactly for Spanish accents.

import type { DateFact, DateOrder, FactConfidence } from "./types";

const DAY_MS = 86_400_000;

/** Gregorian month lengths — no Date object anywhere in this module. */
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeap(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month1: number): number {
  if (month1 === 2 && isLeap(year)) return 29;
  return MONTH_DAYS[month1 - 1];
}

/** days since epoch → epoch ms, pure integer math (UTC by construction). */
function ymdToMs(year: number, month1: number, day: number): number {
  // Howard Hinnant's civil-from-days, inverted: days since 1970-01-01.
  const y = month1 <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (month1 + (month1 > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return (era * 146097 + doe - 719468) * DAY_MS;
}

const EN_MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const ES_MONTHS = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

function monthIndex(token: string): number {
  const lower = token.toLowerCase();
  const en = EN_MONTHS.findIndex((m) => m.toLowerCase() === lower);
  if (en !== -1) return en + 1;
  return ES_MONTHS.findIndex((m) => m === lower) + 1;
}

function civilFromDays(days: number): string {
  let z = days + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  const year = m <= 2 ? y + 1 : y;
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(year, 4)}-${pad(m)}-${pad(d)}`;
}

function fact(text: string, ts: number, tsEnd: number, confidence: FactConfidence): DateFact {
  return { kind: "DATE", text, ts, tsEnd, norm: `${civilFromDays(ts / DAY_MS)}/${civilFromDays(tsEnd / DAY_MS)}`, confidence };
}

export interface DatePassResult {
  facts: DateFact[];
  steps: number;
}

/**
 * One bounded pass over the text. Steps: each match consumed pays 1 plus a
 * small constant for the interpretation; scanning cost of matchAll is
 * charged per match, which is the honest unit (the patterns are linear —
 * bounded quantifiers, no nesting, so no catastrophic backtracking exists
 * to charge for).
 */
export function extractDates(
  text: string,
  opts: { refTs: number; dateOrder: DateOrder; pay: (n?: number) => boolean },
): DatePassResult {
  const facts: DateFact[] = [];
  const seen = new Set<string>(); // one fact per (ts, tsEnd) — no dup spans
  const push = (f: DateFact) => {
    const key = `${f.ts}:${f.tsEnd}`;
    if (!seen.has(key)) {
      seen.add(key);
      facts.push(f);
    }
  };

  // ISO: 2026-01-31, 2026-1-9 (bounded, no nesting)
  for (const m of text.matchAll(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g)) {
    if (!opts.pay()) break;
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo)) {
      const ts = ymdToMs(y, mo, d);
      push(fact(m[0], ts, ts + DAY_MS, "EXACT"));
    }
  }

  // Numeric d/m/y or m/d/y: 31/01/2026, 01/02/2026 (also .-separated)
  for (const m of text.matchAll(/\b(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})\b/g)) {
    if (!opts.pay()) break;
    const a = Number(m[1]);
    const b = Number(m[2]);
    const y = Number(m[3]);
    // Day > 12: unambiguous — the setting does not change it.
    if (a > 12 && b <= 12) {
      const ts = ymdToMs(y, b, a);
      push(fact(m[0], ts, ts + DAY_MS, "EXACT"));
    } else if (b > 12 && a <= 12) {
      const ts = ymdToMs(y, a, b);
      push(fact(m[0], ts, ts + DAY_MS, "EXACT"));
    } else if (a >= 1 && a <= 12 && b >= 1 && b <= 12) {
      // Both readings legal: the ruleset decides, and the fact says ASSUMED.
      const [d, mo] = opts.dateOrder === "DMY" ? [a, b] : [b, a];
      const ts = ymdToMs(y, mo, d);
      push(fact(m[0], ts, ts + DAY_MS, "ASSUMED"));
    }
  }

  // "January 31, 2026" / "31 January 2026" / "31 de enero de 2026"
  const monthAlt = [...EN_MONTHS, ...ES_MONTHS].join("|");
  for (const m of text.matchAll(new RegExp(`(?:(${monthAlt})\\s{0,3}(\\d{1,2})(?:st|nd|rd|th)?,?\\s{0,3}(\\d{4}))|(?:(\\d{1,2})(?:st|nd|rd|th)?\\s{0,3}(?:de\\s{0,3})?(${monthAlt})(?:,?\\s{0,3}|\\s{0,3}de\\s{0,3})(\\d{4}))`, "gi"))) {
    if (!opts.pay(2)) break;
    if (m[1]) {
      const mo = monthIndex(m[1]);
      const d = Number(m[2]);
      const y = Number(m[3]);
      if (d >= 1 && d <= daysInMonth(y, mo)) {
        const ts = ymdToMs(y, mo, d);
        push(fact(m[0], ts, ts + DAY_MS, "EXACT"));
      }
    } else if (m[4]) {
      const d = Number(m[4]);
      const mo = monthIndex(m[5]);
      const y = Number(m[6]);
      if (d >= 1 && d <= daysInMonth(y, mo)) {
        const ts = ymdToMs(y, mo, d);
        push(fact(m[0], ts, ts + DAY_MS, "EXACT"));
      }
    }
  }

  // "January 2026" / "enero de 2026" — a whole month interval.
  for (const m of text.matchAll(new RegExp(`\\b(${monthAlt})\\s{0,3}(?:de\\s{0,3})?(\\d{4})\\b`, "gi"))) {
    if (!opts.pay(2)) break;
    // Skip when this span is inside an already-extracted full date (the
    // day-carrying pattern above wins because it is scanned first and the
    // month-only ts differs — dedupe by interval makes them distinct, so
    // guard by checking the preceding character for a day we already saw).
    const before = text.slice(Math.max(0, (m.index ?? 0) - 8), m.index ?? 0);
    if (/\d{1,2}\s{0,3}(de\s{0,3})?$/.test(before)) continue;
    const mo = monthIndex(m[1]);
    const y = Number(m[2]);
    const ts = ymdToMs(y, mo, 1);
    push(fact(m[0], ts, ts + daysInMonth(y, mo) * DAY_MS, "EXACT"));
  }

  // Quarters: "Q3 2026" — a three-month interval.
  for (const m of text.matchAll(/\bQ([1-4])[ -]?(\d{4})\b/gi)) {
    if (!opts.pay()) break;
    const q = Number(m[1]);
    const y = Number(m[2]);
    const ts = ymdToMs(y, q * 3 - 2, 1);
    const endMonth = q === 4 ? 1 : q * 3 + 1;
    const endYear = q === 4 ? y + 1 : y;
    push(fact(m[0], ts, ymdToMs(endYear, endMonth, 1), "EXACT"));
  }

  // Relative spans, resolved against the ruleset's refTs — never a clock.
  const refDays = Math.floor(opts.refTs / DAY_MS);
  const rel: Array<[RegExp, (d: number) => number]> = [
    [/\byesterday\b/gi, (d) => d - 1],
    [/\btomorrow\b/gi, (d) => d + 1],
    [/\btoday\b/gi, (d) => d],
    [/\blast month\b/gi, (d) => d - 30],
    [/\bnext month\b/gi, (d) => d + 30],
    [/\blast week\b/gi, (d) => d - 7],
    [/\bnext week\b/gi, (d) => d + 7],
  ];
  for (const [re, shift] of rel) {
    for (const m of text.matchAll(re)) {
      if (!opts.pay()) break;
      const ts = (refDays + shift(0)) * DAY_MS;
      push(fact(m[0], ts, ts + DAY_MS, "ASSUMED"));
    }
  }

  return { facts, steps: 0 }; // steps were paid into the shared budget
}
