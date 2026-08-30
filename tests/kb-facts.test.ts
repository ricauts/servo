// ext-02: the fact extractor — dates, money, durations. The extractor is
// PURE (no clock, no locale, no database, no provider); dates are UTC
// intervals; money is integer minor units with table-driven exponents;
// durations are seconds with ISO-8601 norms; every regex is bounded with
// no nesting; the budget is enforced on a STEP COUNTER, never on elapsed
// milliseconds.

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { extractFacts, exponentFor, FACT_PRECEDENCE, MAX_FACTS_PER_CALL, type FactRuleset } from "@/lib/kb/facts";

const RULESET: FactRuleset = {
  refDate: "2026-01-15",
  dateOrder: "DMY",
  defaultCurrency: "USD",
  stepBudget: 250_000,
};

describe("purity — enforced at the source level", () => {
  it("no clock read, no db, no locale anywhere under src/lib/kb/facts/", () => {
    const dir = "src/lib/kb/facts";
    for (const name of readdirSync(dir)) {
      // Strip line comments first: the headers SAY "no Intl" and the
      // check must look at code, not at the sentence banning the API.
      const source = readFileSync(`${dir}/${name}`, "utf8")
        .split(/\r?\n/)
        .map((l) => l.replace(/\/\/.*$/, ""))
        .join("\n");
      expect(source, `${dir}/${name} constructs a Date`).not.toMatch(/new\s+Date\s*\(/);
      expect(source, `${dir}/${name} reads the clock`).not.toMatch(/Date\.now\s*\(/);
      expect(source, `${dir}/${name} imports the database`).not.toMatch(/from\s+"@\/lib\/db"/);
      expect(source, `${dir}/${name} uses Intl or host locale`).not.toMatch(/Intl\.|toLocaleDateString/);
    }
  });
});

describe("golden corpora — byte-identical, twice in one test", () => {
  const corpora = [
    "dates.en", "dates.es", "money.en", "money.es", "duration.en", "duration.es",
    "identifiers.en", "identifiers.es", "quantity.en", "references.en",
    "overlap.en", "numeric.en",
  ];

  for (const corpus of corpora) {
    it(`${corpus}: same input + same ruleset → byte-identical output`, () => {
      const inputs = readFileSync(`tests/fixtures/facts/${corpus}.txt`, "utf8")
        .split(/\r?\n/)
        .filter((l) => l.trim().length > 0);
      const expected = JSON.parse(
        readFileSync(`tests/fixtures/facts/${corpus}.expected.json`, "utf8"),
      );
      expect(inputs.length).toBe(expected.length);

      const run = () => JSON.stringify(inputs.map((line) => extractFacts(line, RULESET).facts));
      const first = run();
      expect(first).toBe(run());
      expect(first).toBe(JSON.stringify(expected));

      // ext-03: every fact slices back out of its line at its own offset —
      // the locator contract, asserted for every golden fixture.
      for (let i = 0; i < inputs.length; i++) {
        for (const f of expected[i]) {
          expect(inputs[i].slice(f.offset, f.offset + f.length), `${corpus} line ${i + 1}`).toBe(f.text);
          expect(f.extractor).toBe("facts@1");
        }
      }
    });
  }
});

describe("ext-03 — identifiers, quantities, emails, URLs", () => {
  it("INV-2024-113 yields exactly ONE identifier and NO date for the embedded 2024", () => {
    const facts = extractFacts("Invoice INV-2024-113 was paid.", RULESET).facts;
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({ kind: "IDENTIFIER", norm: "inv2024113" });
  });

  it("identifiers normalize case and separator runs away — one reference, two spellings", () => {
    const facts = extractFacts("Normalization: inv_2024_113 and INV-2024-113 are one reference.", RULESET).facts;
    expect(facts.map((f) => f.norm)).toEqual(["inv2024113", "inv2024113"]);
  });

  it("letters-only and digits-only tokens are NOT identifiers", () => {
    expect(extractFacts("Team GB won, Room 42 lost, and v1.2 shipped.", RULESET).facts).toEqual([]);
  });

  it("BARE NUMERALS ARE NOT EXTRACTED — the numeric-only fixture yields zero facts", () => {
    const lines = readFileSync("tests/fixtures/facts/numeric.en.txt", "utf8").split(/\r?\n/).filter((l) => l.trim());
    for (const line of lines) {
      expect(extractFacts(line, RULESET).facts, `"${line}"`).toEqual([]);
    }
  });

  it("quantities: num and unit set, norm '<value>:<unit>'; time stays DURATION", () => {
    const facts = extractFacts("Shipped 12 kg at 50% in 3.5 GB.", RULESET).facts;
    expect(facts).toMatchObject([
      { kind: "QUANTITY", num: 12, unit: "kg", norm: "12:kg" },
      { kind: "QUANTITY", num: 50, unit: "%", norm: "50:%" },
      { kind: "QUANTITY", num: 3.5, unit: "gb", norm: "3.5:gb" },
    ]);
    const [dur] = extractFacts("kept 30 days", RULESET).facts;
    expect(dur).toMatchObject({ kind: "DURATION", num: 2_592_000, unit: "s" });
  });

  it("URLs keep origin and path, drop query and fragment; emails case-fold", () => {
    const [url] = extractFacts("Docs at https://docs.example.com/guides/setup?lang=en#intro", RULESET).facts;
    expect(url).toMatchObject({ kind: "URL", norm: "https://docs.example.com/guides/setup" });
    const [mail] = extractFacts("Write to OPS@Example.COM.", RULESET).facts;
    expect(mail).toMatchObject({ kind: "EMAIL", norm: "ops@example.com" });
  });
});

describe("ext-03 — overlap precedence and the 64 cap", () => {
  it("LONGEST MATCH wins: a URL swallows the identifier inside its path", () => {
    const facts = extractFacts("Ref https://app.example.com/INV-2024-113?token=1 only.", RULESET).facts;
    expect(facts).toHaveLength(1);
    expect(facts[0].kind).toBe("URL");
  });

  it("equal spans settle by the fixed order: IDENTIFIER outranks MONEY", () => {
    // "USD1234" is a legal MONEY match and a legal letters-then-digits
    // IDENTIFIER over the same span — the precedence table decides.
    const facts = extractFacts("paid USD1234 upfront", RULESET).facts;
    expect(facts).toHaveLength(1);
    expect(facts[0].kind).toBe("IDENTIFIER");
  });

  it("the precedence table is the spec's order, as data", () => {
    expect(Object.entries(FACT_PRECEDENCE).sort((a, b) => a[1] - b[1]).map(([k]) => k)).toEqual([
      "URL", "EMAIL", "IDENTIFIER", "MONEY", "DATE", "DURATION", "QUANTITY",
    ]);
  });

  it("at most 64 facts, kept in offset order, dropped deterministically", () => {
    const text = Array.from({ length: 70 }, (_, i) => `ref-${String(i).padStart(4, "0")}-x`).join(" ");
    const first = extractFacts(text, RULESET).facts;
    const second = extractFacts(text, RULESET).facts;
    expect(first).toHaveLength(64);
    expect(first).toEqual(second);
    // Offset order, and the survivors are the FIRST 64 by offset.
    const offsets = first.map((f) => f.offset);
    expect([...offsets].sort((a, b) => a - b)).toEqual(offsets);
    expect(first[63].text).toContain("ref-0063");
  });

  it("MAX_FACTS_PER_CALL is a constant, not a Setting the ruleset carries", () => {
    expect(MAX_FACTS_PER_CALL).toBe(64);
    expect(RULESET).not.toHaveProperty("maxFacts");
  });
});

describe("ext-03 — the module header states its coverage limits", () => {
  it("index.ts says, in plain words, what is English/Spanish-only and what is deliberately not extracted", () => {
    // Read the header as PROSE: comment wrapping must not be able to hide
    // an absence by breaking a phrase across lines.
    const header = readFileSync("src/lib/kb/facts/index.ts", "utf8")
      .slice(0, 2400)
      .replace(/\s*\/\/\s*/g, " ")
      .replace(/\s+/g, " ");
    expect(header).toMatch(/English and Spanish only/);
    for (const absent of ["person names", "organisations", "places", "phone numbers", "times of day"]) {
      expect(header).toContain(absent);
    }
    // Capitalized multi-word names stay in kb-08's lexical half.
    expect(header).toMatch(/kb-08/);
  });
});

describe("every DATE fact is an interval", () => {
  it("a single day: tsEnd = ts + 1 day; a month spans its length; a quarter three", () => {
    const [day] = extractFacts("on 2026-01-31", RULESET).facts;
    expect(day).toMatchObject({ kind: "DATE", ts: Date.parse("2026-01-31T00:00:00Z"), tsEnd: Date.parse("2026-02-01T00:00:00Z") });

    const [month] = extractFacts("during January 2026", RULESET).facts;
    expect(month).toMatchObject({
      ts: Date.parse("2026-01-01T00:00:00Z"),
      tsEnd: Date.parse("2026-02-01T00:00:00Z"),
    });
    const [q] = extractFacts("in Q3 2026", RULESET).facts;
    expect(q).toMatchObject({ ts: Date.parse("2026-07-01T00:00:00Z"), tsEnd: Date.parse("2026-10-01T00:00:00Z") });
    // February of a non-leap year ends on the 28th — no Date object needed.
    const [feb] = extractFacts("February 2027", RULESET).facts;
    expect(feb).toMatchObject({ tsEnd: Date.parse("2027-03-01T00:00:00Z") });
  });

  it("relative spans resolve against the RULESET's refDate, not a clock", () => {
    const [y] = extractFacts("yesterday", RULESET).facts;
    expect(y).toMatchObject({ ts: Date.parse("2026-01-14T00:00:00Z"), confidence: "ASSUMED" });
    const [y2] = extractFacts("yesterday", { ...RULESET, refDate: "2030-06-01" }).facts;
    expect(y2).toMatchObject({ ts: Date.parse("2030-05-31T00:00:00Z") });
  });
});

describe("numeric-date ambiguity", () => {
  it("day <= 12 resolves through dateOrder with ASSUMED; day > 12 ignores the setting", () => {
    const dmy = extractFacts("on 01/02/2026", { ...RULESET, dateOrder: "DMY" }).facts[0];
    expect(dmy).toMatchObject({ ts: Date.parse("2026-02-01T00:00:00Z"), confidence: "ASSUMED" });

    const mdy = extractFacts("on 01/02/2026", { ...RULESET, dateOrder: "MDY" }).facts[0];
    expect(mdy).toMatchObject({ ts: Date.parse("2026-01-02T00:00:00Z"), confidence: "ASSUMED" });

    for (const order of ["DMY", "MDY"] as const) {
      const unambiguous = extractFacts("on 31/01/2026", { ...RULESET, dateOrder: order }).facts[0];
      expect(unambiguous).toMatchObject({ ts: Date.parse("2026-01-31T00:00:00Z"), confidence: "EXACT" });
    }
  });
});

describe("money — integer minor units, table exponents", () => {
  it("the documented exponents: JPY 0, CLP 0, USD 2 — never a float", () => {
    expect(exponentFor("JPY")).toBe(0);
    expect(exponentFor("CLP")).toBe(0);
    expect(exponentFor("USD")).toBe(2);
    const [yen] = extractFacts("¥3,000", RULESET).facts;
    expect(yen).toMatchObject({ kind: "MONEY", num: 3000, unit: "JPY", norm: "JPY:3000" });
    const [usd] = extractFacts("$1,234.56", RULESET).facts;
    expect(usd).toMatchObject({ num: 123456, unit: "USD", norm: "USD:123456" });
    expect(usd).toMatchObject({ num: 123456 });
    expect(Number.isInteger((usd as { num: number }).num)).toBe(true);
  });

  it("a bare ambiguous symbol resolves through defaultCurrency as ASSUMED; unambiguous is EXACT", () => {
    const [assumed] = extractFacts("$100", RULESET).facts;
    expect(assumed).toMatchObject({ unit: "USD", num: 10000, confidence: "ASSUMED" });

    const [otherDesk] = extractFacts("$100", { ...RULESET, defaultCurrency: "CLP" }).facts;
    expect(otherDesk).toMatchObject({ unit: "CLP", num: 100, confidence: "ASSUMED" });

    const [exactCode] = extractFacts("EUR 50", RULESET).facts;
    expect(exactCode).toMatchObject({ unit: "EUR", confidence: "EXACT" });
    const [exactSymbol] = extractFacts("£9.99", RULESET).facts;
    expect(exactSymbol).toMatchObject({ unit: "GBP", confidence: "EXACT" });
  });

  it("a symbol or code absent from the table produces NO money fact — it stays a keyword", () => {
    const facts = extractFacts("BTC 5 and 3 US$ and ₭200", RULESET).facts;
    expect(facts.filter((f) => f.kind === "MONEY")).toHaveLength(0);
  });
});

describe("duration", () => {
  it('"30 days" -> 2592000 seconds / P30D; minutes carry the T designator', () => {
    const [d] = extractFacts("30 days", RULESET).facts;
    expect(d).toMatchObject({ kind: "DURATION", num: 2_592_000, unit: "s", norm: "P30D" });
    const [m] = extractFacts("45 minutos", RULESET).facts;
    expect(m).toMatchObject({ num: 2700, norm: "PT45M" }); // NOT P45M (months!)
    const [h] = extractFacts("2 hours", RULESET).facts;
    expect(h).toMatchObject({ num: 7200, norm: "PT2H" });
    const [iso] = extractFacts("PT1H30M", RULESET).facts;
    expect(iso).toMatchObject({ num: 5400, norm: "PT1H30M" });
  });
});

describe("the step budget — enforced on the counter, never the clock", () => {
  it("a 100 KB pathological fixture of repeated currency symbols and digits stays inside the budget", () => {
    // "$1 $1 $1 ... 1 USD 1 USD ..." — pathological for a naive parser,
    // linear for bounded ones. Charged per candidate on the COUNTER.
    const chunk = "$1 1 USD €2 99 ";
    const pathological = chunk.repeat(Math.ceil(100_000 / chunk.length));
    expect(pathological.length).toBeGreaterThanOrEqual(100_000);

    const result = extractFacts(pathological, { ...RULESET, stepBudget: 250_000 });
    // The assertion is ON THE COUNTER: no elapsed-milliseconds flake.
    expect(result.steps).toBeLessThanOrEqual(250_000);
    // And the pass completed rather than truncating mid-way arbitrarily:
    expect(result.facts.length).toBeGreaterThan(0);
  });

  it("an exhausted budget stops the pass and reports the spend", () => {
    const text = "$1 ".repeat(50);
    const result = extractFacts(text, { ...RULESET, stepBudget: 5 });
    expect(result.steps).toBeLessThanOrEqual(7); // bounded overshoot only
    expect(result.facts.length).toBeLessThan(50);
  });
});
