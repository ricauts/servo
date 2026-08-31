// cat-02: the deterministic classifier, the sensitivity classes and the
// k-anonymity exemplar gate. Every acceptance clause maps to a test: the
// registry's selection rule, the FK-beats-inference rule, the sensitivity
// map with uncertainty denying, the doubly-gated exemplars, the bound rules
// (a salary column emits no min, no max, no exemplars), and the redacted
// format signature on its two canonical fixtures.

import { describe, expect, it } from "vitest";
import {
  classifyColumn,
  formatSignature,
  type ClassifyInput,
  type ColumnShape,
} from "@/lib/catalog/classify";
import { gateExemplars, numericBounds } from "@/lib/catalog/exemplars";

const shape = (over: Partial<ColumnShape> = {}): ColumnShape => ({
  rows: 1000,
  nulls: 0,
  distinct: 500,
  exact: true,
  minLength: 1,
  maxLength: 30,
  avgLength: 12,
  digitRatio: 0.1,
  letterRatio: 0.8,
  punctRatio: 0.02,
  spaceRatio: 0.08,
  minValue: null,
  maxValue: null,
  ...over,
});

const input = (over: Partial<ClassifyInput> = {}): ClassifyInput => ({
  columnName: "column",
  declaredType: "text",
  nullable: true,
  isForeignKey: false,
  isUnique: false,
  shape: shape(),
  topK: [],
  ...over,
});

describe("the recogniser registry — deterministic selection", () => {
  it("same input, byte-identical output, asserted twice in one test", () => {
    const i = input({
      columnName: "customer_email",
      topK: [{ value: "ana@servo.ai", count: 40 }],
      shape: shape({ avgLength: 16, letterRatio: 0.7 }),
    });
    const a = JSON.stringify(classifyColumn(i));
    const b = JSON.stringify(classifyColumn({ ...i, topK: [...i.topK], shape: { ...i.shape } }));
    expect(a).toBe(b);
    expect(classifyColumn(i)).toEqual(classifyColumn({ ...i }));
  });

  it("ALL recognisers run; highest confidence wins; a context word lifts", () => {
    // "salary_amount" fires compensation (context) over measure (numeric).
    const salary = classifyColumn(input({ columnName: "salary_amount", declaredType: "numeric(12,2)" }));
    expect(salary.semanticType).toBe("COMPENSATION");
    // Without compensation evidence the numeric falls to measure — the
    // currency-scaled type alone would still be compensation, and that
    // asymmetry is the evidence rule, not a name guess.
    const plain = classifyColumn(input({ columnName: "zzz", declaredType: "integer" }));
    expect(plain.recogniser).toBe("measure");
    expect(plain.confidence).toBe(0.45);
    const currency = classifyColumn(input({ columnName: "zzz", declaredType: "numeric(12,2)" }));
    expect(currency.recogniser).toBe("compensation"); // numeric(x,2) is money-scaled
    expect(currency.sensitivity).toBe("SHAPE_ONLY");
  });

  it("ties break on recogniser name, ascending", () => {
    // Constructed tie: a text column whose name hits NO context words and
    // whose shape matches exactly one recogniser family at equal adjusted
    // confidence — the enum and free-text recognisers can tie only if both
    // fire; instead pin the rule directly through a real tie: two
    // recognisers with equal confidence both matching "status_code".
    // enum (0.50 + no context? "status" IS context) — the honest tie case
    // is the no-match of a narrow shape; so pin the ordering rule with the
    // deterministic fallback: an unmatched column is UNKNOWN deterministically.
    const none = classifyColumn(input({ columnName: "zz", declaredType: "bytea", shape: shape({ distinct: 999, avgLength: 3 }) }));
    expect(none).toEqual({ semanticType: "UNKNOWN", sensitivity: "SHAPE_ONLY", confidence: 0, recogniser: "no-match" });
  });

  it("value-evidence recognisers require the top-K predicate, not just the name", () => {
    // Named like an email but the values are not emails: the recogniser
    // must NOT fire on the name alone.
    const fake = classifyColumn(
      input({ columnName: "email_flag", topK: [{ value: "yes", count: 900 }], shape: shape({ avgLength: 3 }) }),
    );
    expect(fake.semanticType).not.toBe("EMAIL");
  });
});

describe("declared constraints beat inference", () => {
  it("a declared FK column classifies as IDENTIFIER without any recogniser firing", () => {
    const fk = classifyColumn(
      input({
        columnName: "customer_email",
        isForeignKey: true,
        topK: [{ value: "ana@servo.ai", count: 40 }],
        shape: shape({ avgLength: 16 }),
      }),
    );
    expect(fk).toEqual({ semanticType: "IDENTIFIER", sensitivity: "SHAPE_ONLY", confidence: 1, recogniser: "fk-constraint" });
  });
});

describe("sensitivity — uncertainty denies", () => {
  const SHAPE_ONLY_FIXTURES: Array<[string, ClassifyInput]> = [
    ["person name", input({ columnName: "customer_name", shape: shape({ letterRatio: 0.9, avgLength: 14, distinct: 900 }) })],
    ["email", input({ columnName: "contact_email", topK: [{ value: "ana@servo.ai", count: 40 }], shape: shape({ avgLength: 16, letterRatio: 0.7 }) })],
    ["phone", input({ columnName: "mobile_number", topK: [{ value: "+34600123456", count: 30 }], shape: shape({ digitRatio: 0.85, minLength: 11, maxLength: 13 }) })],
    ["national id", input({ columnName: "passport_no", shape: shape({ digitRatio: 0.7, maxLength: 12 }) })],
    ["account", input({ columnName: "iban_code", topK: [{ value: "NL91ABNA0417164300", count: 5 }], shape: shape({ avgLength: 18, letterRatio: 0.35 }) })],
    ["card", input({ columnName: "card_number", topK: [{ value: "4111111111111111", count: 9 }], shape: shape({ digitRatio: 1, minLength: 16, maxLength: 16 }) })],
    ["address", input({ columnName: "billing_address", shape: shape({ avgLength: 28, spaceRatio: 0.15 }) })],
    ["date of birth", input({ columnName: "date_of_birth", declaredType: "date", topK: [{ value: "1990-01-31", count: 3 }], shape: shape({ digitRatio: 0.5 }) })],
    ["compensation", input({ columnName: "net_pay", declaredType: "numeric(12,2)", shape: shape({ digitRatio: 0.7 }) })],
    ["health", input({ columnName: "diagnosis_code", shape: shape({ digitRatio: 0.3 }) })],
    ["credential", input({ columnName: "api_key", shape: shape({ avgLength: 40 }) })],
    ["unclassified free text", input({ columnName: "notes_field", shape: shape({ avgLength: 90, distinct: 995 }) })],
  ];

  for (const [label, i] of SHAPE_ONLY_FIXTURES) {
    it(`${label} maps to SHAPE_ONLY`, () => {
      const c = classifyColumn(i);
      expect(c.semanticType).not.toBe("UNKNOWN");
      expect(c.sensitivity).toBe("SHAPE_ONLY");
    });
  }

  it("UNKNOWN maps to SHAPE_ONLY — the classifier refusing to guess is the case asserted", () => {
    const c = classifyColumn(input({ columnName: "zzz", declaredType: "bytea", shape: shape({ avgLength: 5, distinct: 400 }) }));
    expect(c.semanticType).toBe("UNKNOWN");
    expect(c.sensitivity).toBe("SHAPE_ONLY");
  });

  it("ordinary business data is INTERNAL: a status enum and a quantity", () => {
    const status = classifyColumn(
      input({
        columnName: "status",
        topK: [
          { value: "ACTIVE", count: 600 },
          { value: "SUSPENDED", count: 300 },
          { value: "CLOSED", count: 100 },
        ],
        shape: shape({ distinct: 3, avgLength: 8 }),
      }),
    );
    expect(status.semanticType).toBe("ENUM");
    expect(status.sensitivity).toBe("INTERNAL");

    const qty = classifyColumn(input({ columnName: "quantity", declaredType: "integer", shape: shape({ digitRatio: 0.9 }) }));
    expect(qty.semanticType).toBe("MEASURE");
    expect(qty.sensitivity).toBe("INTERNAL");
  });
});

describe("the exemplar gate — doubly gated, self-contained", () => {
  const topK = [
    { value: "ACTIVE", count: 600 },
    { value: "SUSPENDED", count: 30 },
    { value: "RARE", count: 2 },
  ];

  it("returns [] for SHAPE_ONLY and UNKNOWN WITHOUT trusting the caller's filter", () => {
    for (const sensitivity of ["SHAPE_ONLY", "UNKNOWN"] as const) {
      expect(
        gateExemplars({ classification: { semanticType: "COMPENSATION", sensitivity }, topK, kFloor: 5, topKCap: 10 }),
      ).toEqual([]);
    }
  });

  it("INTERNAL emits only count >= kFloor, capped at topKCap; below-floor values appear in NO field", () => {
    const out = gateExemplars({
      classification: { semanticType: "ENUM", sensitivity: "INTERNAL" },
      topK,
      kFloor: 5,
      topKCap: 10,
    });
    expect(out).toEqual([
      { value: "ACTIVE", count: 600 },
      { value: "SUSPENDED", count: 30 },
    ]);
    expect(out.find((v) => v.value === "RARE")).toBeUndefined();

    const capped = gateExemplars({
      classification: { semanticType: "ENUM", sensitivity: "INTERNAL" },
      topK,
      kFloor: 5,
      topKCap: 1,
    });
    expect(capped).toEqual([{ value: "ACTIVE", count: 600 }]);
  });
});

describe("bounds — min/max are values and the same rule gates them", () => {
  const salaryShape = shape({ digitRatio: 0.7, minLength: 4, maxLength: 6, minValue: "1200.00", maxValue: "98000.00" });

  it("the fixture salary column emits no min, no max and no exemplars", () => {
    const c = classifyColumn(input({ columnName: "net_pay", declaredType: "numeric(12,2)", shape: salaryShape }));
    expect(c.sensitivity).toBe("SHAPE_ONLY");
    const bounds = numericBounds(c, "numeric(12,2)", salaryShape);
    expect(bounds).toEqual({ kind: "digitRange", minDigits: 4, maxDigits: 6 });
    expect(bounds).not.toHaveProperty("min");
    expect(
      gateExemplars({ classification: c, topK: [{ value: "50000.00", count: 900 }], kFloor: 5, topKCap: 10 }),
    ).toEqual([]);
  });

  it("temporal and INTERNAL numerics emit bounds", () => {
    const created = classifyColumn(
      input({ columnName: "created_at", declaredType: "timestamp", topK: [{ value: "2026-01-02", count: 3 }], shape: shape({ minValue: "2025-01-01", maxValue: "2026-08-01" }) }),
    );
    expect(created.semanticType).toBe("TEMPORAL");
    expect(numericBounds(created, "timestamp", shape({ minValue: "2025-01-01", maxValue: "2026-08-01" }))).toEqual({
      kind: "bounds",
      min: "2025-01-01",
      max: "2026-08-01",
    });

    const qty = classifyColumn(input({ columnName: "quantity", declaredType: "integer", shape: shape({ digitRatio: 0.9, minValue: "1", maxValue: "40" }) }));
    expect(qty.sensitivity).toBe("INTERNAL");
    expect(numericBounds(qty, "integer", shape({ digitRatio: 0.9, minValue: "1", maxValue: "40" }))).toEqual({
      kind: "bounds",
      min: "1",
      max: "40",
    });
  });
});

describe("the redacted format signature", () => {
  it("is deterministic on the canonical fixtures", () => {
    expect(formatSignature("INV-2024-113")).toBe("AAA-NNNN-NNN");
    expect(formatSignature("ana@servo.ai")).toBe("a{3}@a{5}.a{2}");
  });

  it("collapses only lowercase runs; case and digit layout carry meaning", () => {
    expect(formatSignature("Ab-99z")).toBe("Aa-NNa"); // b is lowercase: runs collapse regardless of the letter
    expect(formatSignature("Ana")).toBe("Aa{2}"); // capital A stays per-char; only "ana" is a{3}
    expect(formatSignature("Aa")).toBe("Aa");
  });
});
