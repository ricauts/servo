// Duration fact extraction (ext-02). DURATION normalizes to seconds in
// num with unit "s" and an ISO-8601 duration in norm: "30 days" →
// 2592000 / "P30D". Fixed-length units only — months and years vary in
// length, so a "2 months" span is a DATE-interval question (the caller
// resolves it against the ruleset), not a DURATION. English and Spanish
// unit words. Bounded quantifiers, no nesting.

import type { DurationFact } from "./types";

/** unit word → seconds. Weeks/days/hours/minutes/seconds are exact. */
const UNITS: Record<string, { seconds: number; iso: string; es?: string[] }> = {
  weeks: { seconds: 7 * 86_400, iso: "W" },
  days: { seconds: 86_400, iso: "D" },
  hours: { seconds: 3_600, iso: "H" },
  minutes: { seconds: 60, iso: "M" },
  seconds: { seconds: 1, iso: "S" },
};

interface Unit {
  seconds: number;
  /** The ISO-8601 role: date components ride P (W, D); time components
   *  need the T designator — P45M alone means 45 MONTHS. */
  iso: "W" | "D" | "TH" | "TM" | "TS";
}

const WORDS: Array<[RegExp, Unit]> = [
  [/\b(?:weeks?|semanas?)\b/i, { seconds: UNITS.weeks.seconds, iso: "W" }],
  [/\b(?:days?|d[ií]as?)\b/i, { seconds: UNITS.days.seconds, iso: "D" }],
  [/\b(?:hours?|horas?|hrs?|h)\b/i, { seconds: UNITS.hours.seconds, iso: "TH" }],
  [/\b(?:minutes?|minutos?|mins?|m)\b/i, { seconds: UNITS.minutes.seconds, iso: "TM" }],
  [/\b(?:seconds?|segundos?|secs?|s)\b/i, { seconds: UNITS.seconds.seconds, iso: "TS" }],
];

/** "30 days" → 2592000 / P30D. Compact forms ("1h", "30m") ride the same
 *  word table; a bare number plus a unit word is the canonical grammar. */
export function extractDurations(
  text: string,
  opts: { pay: (n?: number) => boolean },
): { facts: DurationFact[]; steps: number } {
  const facts: DurationFact[] = [];
  const seen = new Set<string>();

  // number + unit word (spelled out or compact), optionally with a space
  for (const m of text.matchAll(/\b(\d{1,6})\s{0,2}(weeks?|semanas?|days?|d[ií]as?|hours?|horas?|hrs?|h|minutes?|minutos?|mins?|m|seconds?|segundos?|secs?|s)\b/gi)) {
    if (!opts.pay(2)) break;
    const unit = matchUnit(m[2]);
    if (!unit) continue;
    const n = Number(m[1]);
    const total = n * unit.seconds;
    const key = `${total}:${m[0].toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // P<n>W / P<n>D / PT<n>H / PT<n>M / PT<n>S — the designator carries.
    const norm = unit.iso.startsWith("T") ? `PT${n}${unit.iso[1]}` : `P${n}${unit.iso}`;
    facts.push({
      kind: "DURATION",
      text: m[0],
      num: total,
      unit: "s",
      norm,
      confidence: "EXACT",
    });
  }

  // ISO-8601 durations written in the text: "P30D", "PT1H30M" — pass
  // through normalized to seconds.
  for (const m of text.matchAll(/\bP(?:(\d{1,3})W)?(?:(\d{1,3})D)?(?:T(?:(\d{1,3})H)?(?:(\d{1,3})M)?(?:(\d{1,3})S)?)?\b/g)) {
    if (!opts.pay(3)) break;
    const [w, d, h, min, s] = [1, 2, 3, 4, 5].map((i) => Number(m[i] ?? 0));
    const total = w * UNITS.weeks.seconds + d * UNITS.days.seconds + h * UNITS.hours.seconds + min * UNITS.minutes.seconds + s;
    if (total === 0) continue;
    const norm = `P${w ? `${w}W` : ""}${d ? `${d}D` : ""}${h || min || s ? "T" : ""}${h ? `${h}H` : ""}${min ? `${min}M` : ""}${s ? `${s}S` : ""}`;
    const key = `${total}:${norm}`;
    if (seen.has(key)) continue;
    seen.add(key);
    facts.push({ kind: "DURATION", text: m[0], num: total, unit: "s", norm, confidence: "EXACT" });
  }

  return { facts, steps: 0 };
}

function matchUnit(word: string): Unit | null {
  for (const [re, unit] of WORDS) {
    if (re.test(word)) return unit;
  }
  return null;
}
