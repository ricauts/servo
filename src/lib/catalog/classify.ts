// The deterministic semantic classifier (cat-02, canon:
// docs/design/data-fabric.md "What a sample IS"). This is a RULES REGISTRY,
// Presidio-shaped, not a machine-learning classifier — and that is stated
// plainly here rather than pretended around: **no credible off-the-shelf
// semantic-type inference library exists for Node.** Nothing was adopted
// for inference; `validator` and `libphonenumber-js` supply only the
// PREDICATES (isEmail, isCreditCard, isValidPhoneNumber) applied to the
// k-floored top-K list.
//
// Every recogniser runs; the highest confidence wins; ties break on
// recogniser NAME (ascending) — a pure function of its inputs, byte-
// identical on every run. The inputs are the column name, the declared
// type, the shape statistics and the k-floored top-K list ONLY: the
// signature has no slot a raw row fits into, because a rare value must
// never decide a field's class. Declared constraints beat inference: a
// declared FK column IS an identifier, before any recogniser is consulted.

import isEmail from "validator/lib/isEmail";
import isCreditCard from "validator/lib/isCreditCard";
import isIBAN from "validator/lib/isIBAN";
import isDate from "validator/lib/isDate";
import { isValidPhoneNumber } from "libphonenumber-js";

/** The semantic types the registry can assert. UNKNOWN means no recogniser
 *  fired and no constraint applied — the classifier had no opinion. */
export type SemanticType =
  | "IDENTIFIER"
  | "EMAIL"
  | "PHONE"
  | "NATIONAL_ID"
  | "ACCOUNT"
  | "CARD"
  | "PERSON_NAME"
  | "ADDRESS"
  | "DATE_OF_BIRTH"
  | "COMPENSATION"
  | "HEALTH"
  | "CREDENTIAL"
  | "TEMPORAL"
  | "ENUM"
  | "MEASURE"
  | "FREE_TEXT"
  | "UNKNOWN";

export type Sensitivity = "SHAPE_ONLY" | "INTERNAL" | "UNKNOWN";

/** Shape statistics — always stored, never a value. Computed in SQL by the
 *  profiler (cat-03+); counts and ratios only. */
export interface ColumnShape {
  rows: number;
  nulls: number;
  distinct: number;
  /** Whether `distinct` is an exact count (true) or an estimate (false).
   *  An estimate and a count are different facts and are never conflated. */
  exact: boolean;
  minLength: number;
  maxLength: number;
  avgLength: number;
  digitRatio: number;
  letterRatio: number;
  punctRatio: number;
  spaceRatio: number;
  /** Value bounds as STRINGS (numeric or temporal), when the column has
   *  them; shape-only for SHAPE_ONLY fields is decided downstream. */
  minValue: string | null;
  maxValue: string | null;
}

/** A k-floored top-K entry: a domain member that already survived the
 *  in-source HAVING count(*) >= k floor. Never a raw row. */
export interface TopKValue {
  value: string;
  count: number;
}

/** The classifier's entire world. No field of this shape holds a row. */
export interface ClassifyInput {
  columnName: string;
  declaredType: string;
  nullable: boolean;
  /** Declared FK beats inference (cat-02). */
  isForeignKey: boolean;
  isUnique: boolean;
  shape: ColumnShape;
  topK: TopKValue[];
}

export interface Classification {
  semanticType: SemanticType;
  sensitivity: Sensitivity;
  confidence: number;
  /** The recogniser that won, or "fk-constraint" / "no-match". */
  recogniser: string;
}

interface Recogniser {
  name: string;
  semanticType: Exclude<SemanticType, "IDENTIFIER" | "UNKNOWN">;
  contextWords: string[];
  /** Predicate over the declared type and the shape statistics. */
  matchesShape: (input: ClassifyInput) => boolean;
  /** Predicate over the k-floored top-K values, when the type needs
   *  evidence stronger than a name (email, phone, card, IBAN, dates). */
  matchesValues?: (input: ClassifyInput) => boolean;
  confidence: number;
  /** Confidence bonus when a context word matches the column name. */
  contextBonus: number;
}

const norm = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, " ");
const nameHas = (input: ClassifyInput, words: string[]) => {
  const n = ` ${norm(input.columnName)} `;
  return words.some((w) => {
    const t = norm(w);
    return n.includes(` ${t} `) || n.includes(`${t} `) || n.includes(` ${t}`);
  });
};

const NUMERIC_TYPE = /numeric|decimal|integer|int\b|bigint|real|double|float|money/i;
const TEMPORAL_TYPE = /date|timestamp|time\b/i;

/** The registry. Order in this array is irrelevant — selection is by
 *  (confidence desc, name asc) — but every entry is pure. */
const RECOGNISERS: Recogniser[] = [
  {
    // Pure-context type: a credential has no distinguishing SHAPE, so the
    // recogniser fires ONLY on its context words — never on every column.
    name: "credential",
    semanticType: "CREDENTIAL",
    contextWords: ["password", "passwd", "secret", "token", "apikey", "api_key", "credential", "privatekey"],
    matchesShape: (i) => nameHas(i, ["password", "passwd", "secret", "token", "apikey", "api_key", "credential", "privatekey"]),
    confidence: 0.95,
    contextBonus: 0,
  },
  {
    name: "email-values",
    semanticType: "EMAIL",
    contextWords: ["email", "mail", "contact"],
    matchesShape: (i) => i.shape.avgLength >= 6 && i.shape.letterRatio > 0.4,
    matchesValues: (i) => i.topK.length > 0 && i.topK.every((v) => isEmail(v.value)),
    confidence: 0.75,
    contextBonus: 0.2,
  },
  {
    name: "phone-values",
    semanticType: "PHONE",
    contextWords: ["phone", "tel", "mobile", "msisdn", "fax"],
    matchesShape: (i) => i.shape.digitRatio > 0.5,
    matchesValues: (i) => i.topK.length > 0 && i.topK.every((v) => isValidPhoneNumber(v.value)),
    confidence: 0.75,
    contextBonus: 0.2,
  },
  {
    name: "card-values",
    semanticType: "CARD",
    contextWords: ["card", "pan", "cc"],
    matchesShape: (i) => i.shape.digitRatio > 0.6 && i.shape.minLength >= 12 && i.shape.maxLength <= 19,
    matchesValues: (i) => i.topK.length > 0 && i.topK.every((v) => isCreditCard(v.value)),
    confidence: 0.85,
    contextBonus: 0.1,
  },
  {
    name: "account-iban",
    semanticType: "ACCOUNT",
    contextWords: ["account", "iban", "wallet", "acct"],
    matchesShape: (i) => i.shape.avgLength >= 10 && i.shape.letterRatio > 0.2,
    matchesValues: (i) => i.topK.length > 0 && i.topK.every((v) => isIBAN(v.value)),
    confidence: 0.8,
    contextBonus: 0.15,
  },
  {
    name: "national-id",
    semanticType: "NATIONAL_ID",
    contextWords: ["ssn", "sin", "nin", "nif", "cif", "dni", "nie", "passport", "nationalid", "national_id"],
    matchesShape: (i) => i.shape.digitRatio > 0.4 && i.shape.maxLength <= 20,
    confidence: 0.7,
    contextBonus: 0.25,
  },
  {
    name: "person-name",
    semanticType: "PERSON_NAME",
    contextWords: ["name", "firstname", "lastname", "surname", "fullname", "owner", "customer", "employee"],
    // Context-carried: "looks like words" is every text column — a person
    // name is asserted by what the column is called, never guessed from shape.
    matchesShape: (i) =>
      nameHas(i, ["name", "firstname", "lastname", "surname", "fullname", "owner", "customer", "employee"]) &&
      !NUMERIC_TYPE.test(i.declaredType) &&
      i.shape.letterRatio > 0.7 &&
      i.shape.avgLength >= 3 &&
      i.shape.avgLength <= 40,
    confidence: 0.55,
    contextBonus: 0.25,
  },
  {
    name: "address",
    semanticType: "ADDRESS",
    contextWords: ["address", "street", "avenue", "city", "zipcode", "postcode", "postal"],
    // Context-carried, for the same reason as person-name.
    matchesShape: (i) =>
      nameHas(i, ["address", "street", "avenue", "city", "zipcode", "postcode", "postal"]) &&
      i.shape.avgLength >= 6,
    confidence: 0.6,
    contextBonus: 0.2,
  },
  {
    name: "date-of-birth",
    semanticType: "DATE_OF_BIRTH",
    contextWords: ["dob", "birth", "born", "birthday"],
    matchesShape: (i) => TEMPORAL_TYPE.test(i.declaredType) || i.shape.digitRatio > 0.3,
    matchesValues: (i) => i.topK.length > 0 && i.topK.every((v) => isDate(v.value)),
    confidence: 0.7,
    contextBonus: 0.25,
  },
  {
    // Needs EVIDENCE, not just numeric-ness: a compensation context word,
    // or a currency-scaled type (money / numeric(x,2)) without one.
    name: "compensation",
    semanticType: "COMPENSATION",
    contextWords: ["salary", "pay", "comp", "wage", "bonus", "remuneration", "netpay", "grosspay"],
    matchesShape: (i) =>
      NUMERIC_TYPE.test(i.declaredType) &&
      (nameHas(i, ["salary", "pay", "comp", "wage", "bonus", "remuneration", "netpay", "grosspay"]) ||
        /money|numeric\s*\(\s*\d+\s*,\s*2\s*\)/i.test(i.declaredType)),
    confidence: 0.7,
    contextBonus: 0.25,
  },
  {
    // Pure-context type, like credential: no shape distinguishes health
    // data, so the words carry the whole signal.
    name: "health",
    semanticType: "HEALTH",
    contextWords: ["health", "diagnosis", "diagnostic", "medical", "medication", "patient", "clinical"],
    matchesShape: (i) =>
      nameHas(i, ["health", "diagnosis", "diagnostic", "medical", "medication", "patient", "clinical"]),
    confidence: 0.65,
    contextBonus: 0.3,
  },
  {
    name: "temporal",
    semanticType: "TEMPORAL",
    contextWords: ["date", "at", "when", "time"],
    matchesShape: (i) => TEMPORAL_TYPE.test(i.declaredType),
    matchesValues: (i) => i.topK.length > 0 && i.topK.every((v) => isDate(v.value)),
    confidence: 0.6,
    contextBonus: 0.15,
  },
  {
    name: "enum",
    semanticType: "ENUM",
    contextWords: ["status", "state", "kind", "type", "category", "stage", "phase"],
    matchesShape: (i) => {
      if (NUMERIC_TYPE.test(i.declaredType) || TEMPORAL_TYPE.test(i.declaredType)) return false;
      const coverage = i.shape.rows > 0 ? i.topK.reduce((s, v) => s + v.count, 0) / i.shape.rows : 0;
      return i.shape.distinct <= 100 && (coverage >= 0.5 || i.shape.distinct <= 12);
    },
    confidence: 0.5,
    contextBonus: 0.15,
  },
  {
    name: "measure",
    semanticType: "MEASURE",
    contextWords: ["count", "qty", "quantity", "amount", "total", "sum", "length", "size", "weight", "duration"],
    matchesShape: (i) => NUMERIC_TYPE.test(i.declaredType),
    confidence: 0.45,
    contextBonus: 0.1,
  },
  {
    name: "free-text",
    semanticType: "FREE_TEXT",
    contextWords: ["notes", "comment", "description", "body", "message", "text"],
    matchesShape: (i) =>
      !NUMERIC_TYPE.test(i.declaredType) &&
      i.shape.avgLength >= 40 &&
      i.shape.rows > 0 &&
      i.shape.distinct / i.shape.rows >= 0.9,
    confidence: 0.6,
    contextBonus: 0.1,
  },
];

/** Sensitivity: uncertainty DENIES. Every identifying or regulated class,
 *  unclassified free text, and UNKNOWN itself map to SHAPE_ONLY; only
 *  ordinary business data (TEMPORAL, ENUM, MEASURE) is INTERNAL. */
const SHAPE_ONLY_TYPES = new Set<SemanticType>([
  "IDENTIFIER",
  "EMAIL",
  "PHONE",
  "NATIONAL_ID",
  "ACCOUNT",
  "CARD",
  "PERSON_NAME",
  "ADDRESS",
  "DATE_OF_BIRTH",
  "COMPENSATION",
  "HEALTH",
  "CREDENTIAL",
  "FREE_TEXT",
  "UNKNOWN",
]);

/** The classifier. Pure: same input, byte-identical output. */
export function classifyColumn(input: ClassifyInput): Classification {
  // Declared constraints beat inference, before any recogniser runs.
  if (input.isForeignKey) {
    return { semanticType: "IDENTIFIER", sensitivity: "SHAPE_ONLY", confidence: 1, recogniser: "fk-constraint" };
  }

  let best: { r: Recogniser; confidence: number } | null = null;
  for (const r of RECOGNISERS) {
    if (!r.matchesShape(input)) continue;
    if (r.matchesValues && !r.matchesValues(input)) continue;
    const confidence = r.confidence + (nameHas(input, r.contextWords) ? r.contextBonus : 0);
    // Highest confidence wins; ties break on recogniser name (ascending).
    if (
      !best ||
      confidence > best.confidence ||
      (confidence === best.confidence && r.name < best.r.name)
    ) {
      best = { r, confidence };
    }
  }

  if (!best) {
    // No recogniser fired: UNKNOWN sensitivity is SHAPE_ONLY — uncertainty
    // denies, mirroring isPrivateAddress() refusing the unparseable.
    return { semanticType: "UNKNOWN", sensitivity: "SHAPE_ONLY", confidence: 0, recogniser: "no-match" };
  }
  const semanticType = best.r.semanticType;
  return {
    semanticType,
    sensitivity: SHAPE_ONLY_TYPES.has(semanticType) ? "SHAPE_ONLY" : "INTERNAL",
    confidence: Math.round(best.confidence * 1000) / 1000,
    recogniser: best.r.name,
  };
}

/**
 * The redacted format signature — a shape signal, never a value. Uppercase
 * letters stay per-char `A` and digits per-char `N` (case and digit layout
 * carry meaning for codes: `INV-2024-113` → `AAA-NNNN-NNN`); LOWERCASE
 * runs collapse to `a{n}` (free-text prose carries no per-char meaning:
 * `ana@servo.ai` → `a{3}@a{5}.a{2}`). Punctuation passes through.
 */
export function formatSignature(value: string): string {
  let out = "";
  let lowerRun = 0;
  const flush = () => {
    if (lowerRun > 0) {
      out += lowerRun === 1 ? "a" : `a{${lowerRun}}`;
      lowerRun = 0;
    }
  };
  for (const ch of value) {
    if (ch >= "a" && ch <= "z") {
      lowerRun++;
    } else {
      flush();
      if (ch >= "A" && ch <= "Z") out += "A";
      else if (ch >= "0" && ch <= "9") out += "N";
      else out += ch;
    }
  }
  flush();
  return out;
}
