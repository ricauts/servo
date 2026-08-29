// Money fact extraction (ext-02). MONEY is stored in INTEGER MINOR UNITS
// — num is never a float. Exponents come from currencies.json; a symbol or
// code absent from that table produces NO money fact (it stays a keyword).
//
// Symbol resolution: "$" is legally USD, MXN, CLP, AUD and more — a bare
// ambiguous symbol resolves through ruleset.defaultCurrency with confidence
// ASSUMED; an unambiguous code or symbol (EUR, €, £, ¥, CLP$) is EXACT.
// Regex safety: bounded quantifiers, no nesting; the number grammar is a
// fixed-shape alternation, not a recursive one.

import currencies from "./currencies.json";
import type { MoneyFact, FactConfidence } from "./types";

type CurrencyMeta = { symbol: string; exponent: number };
const TABLE = currencies as Record<string, CurrencyMeta>;

/** code → minor-unit exponent, with the documented spot values pinned by
 *  the test (JPY 0, CLP 0, USD 2). */
export function exponentFor(code: string): number | null {
  const meta = TABLE[code];
  return meta ? meta.exponent : null;
}

/** The symbols that mean exactly ONE code in our table (unambiguous). */
const SYMBOL_TO_CODE = new Map<string, string>();
/** Symbols shared by several codes ("$" alone) — resolve via the default. */
const AMBIGUOUS_SYMBOLS = new Set<string>(["$"]);
for (const [code, meta] of Object.entries(TABLE)) {
  if (!AMBIGUOUS_SYMBOLS.has(meta.symbol)) {
    SYMBOL_TO_CODE.set(meta.symbol, code);
  }
}

/** Parse a western number with . or , grouping and the OTHER mark as the
 *  decimal separator — deterministic: if both appear, the rightmost is the
 *  decimal; if one appears and exactly (exponent) digits follow it at the
 *  end, it is the decimal; otherwise it is grouping. */
export function parseAmount(raw: string, exponent: number): number | null {
  const neg = raw.startsWith("-");
  const body = neg ? raw.slice(1) : raw;
  const lastDot = body.lastIndexOf(".");
  const lastComma = body.lastIndexOf(",");
  let intPart = body;
  let fracPart = "";
  const lastSep = Math.max(lastDot, lastComma);
  if (lastDot >= 0 && lastComma >= 0) {
    intPart = body.slice(0, lastSep);
    fracPart = body.slice(lastSep + 1);
  } else if (lastSep >= 0) {
    const tail = body.slice(lastSep + 1);
    if (tail.length === exponent && exponent > 0) {
      intPart = body.slice(0, lastSep);
      fracPart = tail;
    } else if (tail.length === 3 && (exponent === 0 || body.length - tail.length > 1)) {
      intPart = body.slice(0, lastSep) + tail; // a thousands group
    } else if (tail.length <= exponent) {
      intPart = body.slice(0, lastSep);
      fracPart = tail;
    } else {
      return null;
    }
  }
  const int = intPart.replace(/[.,]/g, "");
  if (!/^\d{1,15}$/.test(int)) return null;
  const minor = Number(int) * 10 ** exponent + Number((fracPart + "0".repeat(exponent)).slice(0, exponent) || 0) * (exponent > 0 ? 1 : 0);
  const value = neg ? -minor : minor;
  return Number.isSafeInteger(value) ? value : null;
}

export interface MoneyPassResult {
  facts: MoneyFact[];
  steps: number;
}

export function extractMoney(
  text: string,
  opts: { defaultCurrency: string; pay: (n?: number) => boolean },
): MoneyPassResult {
  const facts: MoneyFact[] = [];
  const seen = new Set<string>();

  const emit = (text2: string, code: string, amountRaw: string, confidence: FactConfidence) => {
    const exponent = exponentFor(code);
    if (exponent === null) return; // unknown code: no fact, stays a keyword
    const num = parseAmount(amountRaw, exponent);
    if (num === null) return;
    const key = `${code}:${num}`;
    if (seen.has(key)) return;
    seen.add(key);
    facts.push({ kind: "MONEY", text: text2, num, unit: code, norm: `${code}:${num}`, confidence });
  };

  // All symbols the table knows, longest first so CLP$ wins over $, with
  // the regex metacharacter escaped.
  const escaped = [...SYMBOL_TO_CODE.keys(), ...AMBIGUOUS_SYMBOLS]
    .sort((a, b) => b.length - a.length)
    .map((s) => s.replace(/[$]/g, "\\$"))
    .join("|");

  // Amount grammar: grouped thousands ("1,234.56"), plain with optional
  // decimals ("1234.56", "50"), all bounded. The leading \\b keeps a match
  // from starting mid-number.
  const amount = "-?\\d{1,3}(?:[.,]\\d{3})+(?:[.,]\\d{1,2})?|-?\\d+(?:[.,]\\d{1,2})?";

  // SYMBOL + amount: "$1,234.56", "€1.234,56", "CLP$3.000"
  for (const m of text.matchAll(new RegExp(`(${escaped})\\s{0,2}(${amount})\\b`, "g"))) {
    if (!opts.pay(2)) break;
    const sym = m[1];
    if (AMBIGUOUS_SYMBOLS.has(sym)) {
      emit(m[0], opts.defaultCurrency, m[2], "ASSUMED");
    } else {
      emit(m[0], SYMBOL_TO_CODE.get(sym)!, m[2], "EXACT");
    }
  }

  // Amount + CODE: "1234.56 USD", "12 CLP" — and CODE + amount:
  // "USD 1,234.56", "EUR 50". Both unambiguous by construction.
  const codeAlt = "USD|EUR|GBP|JPY|CHF|CLP|COP|MXN|BRL|CAD|INR|SEK";
  for (const m of text.matchAll(new RegExp(`\\b(${amount})\\s{0,2}(${codeAlt})\\b`, "g"))) {
    if (!opts.pay(2)) break;
    emit(m[0], m[2], m[1], "EXACT");
  }
  for (const m of text.matchAll(new RegExp(`\\b(${codeAlt})\\s{0,2}(${amount})\\b`, "g"))) {
    if (!opts.pay(2)) break;
    emit(m[0], m[1], m[2], "EXACT");
  }

  return { facts, steps: 0 };
}
