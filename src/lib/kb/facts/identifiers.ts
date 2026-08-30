// Reference matchers (ext-03): IDENTIFIER, EMAIL and URL — the three
// "points at something" fact kinds. All three are pure string work: no
// network (a URL fact is EXTRACTED, never fetched), no clock, no locale.
//
// IDENTIFIER is deliberately conservative — it must contain both a letter
// and a digit (or be a #-prefixed numeral), because a letters-only token is
// a keyword (kb-08's lexical half owns those) and a digits-only token is a
// bare numeral, which extracts nothing by rule.

import type { EmailFact, IdentifierFact, UrlFact } from "./types";

/** True when the token carries at least one letter AND one digit. */
function hasLetterAndDigit(s: string): boolean {
  return /[a-z]/i.test(s) && /\d/.test(s);
}

/**
 * Case-fold and collapse every separator run AWAY: "INV-2024-113" and
 * "inv_2024_113" both normalize to "inv2024113". Space is not a
 * separator, so a spaced reference never matches in the first place.
 */
export function normalizeIdentifier(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

// Letter/digit groups joined by 1–3 internal separators (INV-2024-113,
// PO/2024/88, case_4821), or a letters-then-digits form (SR00123). The
// #-prefixed numeral (#4821) is a SEPARATE alternative: a leading \b can
// never fire before "#", which is not a word character. Bounded, no
// nesting.
const IDENT_RE = /\b(?:[A-Za-z0-9]+(?:[-_/.][A-Za-z0-9]+){1,3}|[A-Za-z]{2,}[0-9]{3,})\b|#[0-9]{2,}\b/g;

/** Extract IDENTIFIER facts. Bounded: one pass, every candidate pays. */
export function extractIdentifiers(
  text: string,
  opts: { pay: (n?: number) => boolean },
): { facts: IdentifierFact[]; steps: number } {
  const facts: IdentifierFact[] = [];
  IDENT_RE.lastIndex = 0;
  for (let m = IDENT_RE.exec(text); m !== null; m = IDENT_RE.exec(text)) {
    if (!opts.pay()) break;
    const raw = m[0];
    // "#" is a reference marker, not part of the normalized form. The
    // guards below are for the OTHER two grammar arms only: a #-form is
    // digits by construction, so requiring a letter would delete every
    // ticket-style reference.
    const body = raw.startsWith("#") ? raw.slice(1) : raw;
    if (!raw.startsWith("#")) {
      if (raw.length < 5) continue;
      if (!hasLetterAndDigit(body)) continue;
      if (/^\d+$/.test(body)) continue; // digits-only, no #: bare numeral
    }
    facts.push({
      kind: "IDENTIFIER",
      text: raw,
      offset: m.index,
      length: raw.length,
      extractor: "facts@1",
      norm: normalizeIdentifier(raw),
      confidence: "EXACT",
    });
  }
  return { facts, steps: 0 };
}

const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

/** Extract EMAIL facts, case-folded whole. */
export function extractEmails(
  text: string,
  opts: { pay: (n?: number) => boolean },
): { facts: EmailFact[]; steps: number } {
  const facts: EmailFact[] = [];
  EMAIL_RE.lastIndex = 0;
  for (let m = EMAIL_RE.exec(text); m !== null; m = EMAIL_RE.exec(text)) {
    if (!opts.pay()) break;
    facts.push({
      kind: "EMAIL",
      text: m[0],
      offset: m.index,
      length: m[0].length,
      extractor: "facts@1",
      norm: m[0].toLowerCase(),
    });
  }
  return { facts, steps: 0 };
}

const URL_RE = /\bhttps?:\/\/[^\s<>"')\]]+/gi;

/**
 * Extract URL facts: origin plus path, query and fragment DROPPED —
 * "https://x.io/a/b?token=1#top" normalizes to "https://x.io/a/b". A URL
 * fact is never fetched; egress belongs to the caller's transport.
 */
export function extractUrls(
  text: string,
  opts: { pay: (n?: number) => boolean },
): { facts: UrlFact[]; steps: number } {
  const facts: UrlFact[] = [];
  URL_RE.lastIndex = 0;
  for (let m = URL_RE.exec(text); m !== null; m = URL_RE.exec(text)) {
    if (!opts.pay()) break;
    const raw = m[0].replace(/[.,;:!?]+$/, ""); // trailing sentence punctuation
    let norm: string;
    try {
      const u = new URL(raw);
      norm = u.origin + u.pathname;
    } catch {
      continue; // not parseable — leave it to the keyword half
    }
    facts.push({
      kind: "URL",
      text: raw,
      offset: m.index,
      length: raw.length,
      extractor: "facts@1",
      norm,
    });
  }
  return { facts, steps: 0 };
}
