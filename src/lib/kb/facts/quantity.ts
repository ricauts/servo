// QUANTITY fact extraction (ext-03): a number with a NON-time unit —
// percent, mass, bytes, distance, volume, screen pixels, temperature.
// Time units belong to DURATION (duration.ts); a bare numeral with no unit
// and no currency produces NO fact anywhere in this module, by rule and by
// test. Symbols only, so the matcher is language-neutral; unit words
// ("kilograms") stay keywords. Bounded quantifiers, no nesting.

import type { QuantityFact } from "./types";

/**
 * The unit table. Single-letter and word-collision-prone symbols are
 * deliberately absent: "m" is DURATION minutes, "g"/"l"/"t"/"in" read as
 * words more often than units. Everything here is unambiguous.
 */
const UNITS = new Set([
  "%", "kg", "mg", "lb", "oz", "km", "cm", "mm", "mi", "ft",
  "kb", "mb", "gb", "tb", "kib", "mib", "gib", "tib",
  "ml", "px", "°c", "°f",
]);

// A number (thousands separators tolerated) adjacent — with or without a
// space — to a unit symbol.
const QTY_RE = /(\d+(?:[.,]\d+)?)\s?(%|kg|mg|lb|oz|km|cm|mm|mi|ft|kib|mib|gib|tib|kb|mb|gb|tb|ml|px|°c|°f)(?=[^a-z0-9]|$)/gi;

/** Parse "3.5" / "3,5" / "1.234" into a number, locale-free by rule. */
function parseNumber(raw: string): number {
  return Number(raw.replace(/,/g, raw.includes(",") && !raw.includes(".") ? "" : "."));
}

/** Extract QUANTITY facts. norm is "<value>:<unit>". */
export function extractQuantities(
  text: string,
  opts: { pay: (n?: number) => boolean },
): { facts: QuantityFact[]; steps: number } {
  const facts: QuantityFact[] = [];
  QTY_RE.lastIndex = 0;
  for (let m = QTY_RE.exec(text); m !== null; m = QTY_RE.exec(text)) {
    if (!opts.pay()) break;
    const num = parseNumber(m[1]);
    if (!Number.isFinite(num)) continue;
    const unit = m[2].toLowerCase();
    if (!UNITS.has(unit)) continue;
    // The URL/email/identifier overlap cases are resolved in index.ts; here
    // we only refuse the degenerate ones this matcher owns.
    facts.push({
      kind: "QUANTITY",
      text: m[0],
      offset: m.index,
      length: m[0].length,
      extractor: "facts@1",
      num,
      unit,
      norm: `${String(num)}:${unit}`,
    });
  }
  return { facts, steps: 0 };
}
