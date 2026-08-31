// ext-06: structured filters INSIDE the retrieval statement.
//
// Two halves, and the second is the one that matters: the parser turns a
// question into typed filters, and the SQL applies them without ever
// assembling a document set outside the entitlement fragment. The red team
// here is the filter path's version of kb-10's: a filter whose only match
// is a document the principal may not read must be indistinguishable from a
// filter that matches nothing at all.

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { PrismaClient } from "@prisma/client";
import { tmpDb, type TmpDb } from "./helpers/tmp-db";

type ServoDb = { [key: string]: unknown };
const holder = vi.hoisted(() => ({ db: null as unknown as ServoDb }));
vi.mock("@/lib/db", () => ({ get db() { return holder.db; } }));

import {
  parseQueryFilters,
  quarterLabel,
  expandMagnitude,
  QUERY_INPUT_CAP,
  type QueryFilter,
} from "@/lib/kb/query-filters";
import { DEFAULT_RULESET } from "@/lib/kb/facts";
import { kbSearch, countEntitledDocumentsMatching, filterExistsSql } from "@/lib/kb/search";
import { mockEmbed, MOCK_EMBEDDER_MODEL } from "@/lib/kb/mock-embedder";
import { ingestDocument } from "@/lib/kb/ingest";
import { KB_EXTRACT_BUDGET_ENV } from "@/lib/kb/settings";

// Same tightening kb-05's and ext-04's own files make: the fixtures must
// not wait out the shipped extraction budget.
process.env[KB_EXTRACT_BUDGET_ENV] = "20000";

/** The frozen reference date every parse in this file resolves against. */
const RULESET = { ...DEFAULT_RULESET, refDate: "2026-01-15" };

// Q4 2025, in epoch ms — what "last quarter" means against that refDate.
const Q4_2025_START = Date.parse("2025-10-01T00:00:00Z");
const Q4_2025_END = Date.parse("2026-01-01T00:00:00Z");

describe("parseQueryFilters — the same extractor, a closed comparator table, and the residue", () => {
  it("reads 'invoices over $2k from last quarter' as residue plus a MONEY bound plus a DATE interval", () => {
    const { filters, residue } = parseQueryFilters("invoices over $2k from last quarter", RULESET);
    expect(residue).toBe("invoices");
    expect(filters).toHaveLength(2);
    expect(filters[0]).toMatchObject({
      kind: "MONEY", comparator: ">=", num: 200_000, unit: "USD", confidence: "ASSUMED",
    });
    // The readback's material is what the OPERATOR typed, never the
    // rewritten form the extractor was handed.
    expect(filters[0].text).toBe("$2k");
    expect(filters[1]).toMatchObject({ kind: "DATE", ts: Q4_2025_START, tsEnd: Q4_2025_END });
    expect(filters[1].text).toBe("last quarter");
  });

  it("reads the Spanish form the same way", () => {
    const { filters, residue } = parseQueryFilters(
      "facturas más de 2000 USD del último trimestre",
      RULESET,
    );
    expect(residue).toBe("facturas");
    expect(filters[0]).toMatchObject({ kind: "MONEY", comparator: ">=", num: 200_000, unit: "USD" });
    expect(filters[1]).toMatchObject({ kind: "DATE", ts: Q4_2025_START, tsEnd: Q4_2025_END });
  });

  it("emits exactly >=, <=, between and = — the set is closed and lives in data", () => {
    const cases: Array<[string, string]> = [
      ["over $5,000", ">="], ["above $5,000", ">="], ["more than $5,000", ">="],
      ["at least $5,000", ">="], ["greater than $5,000", ">="],
      ["under $5,000", "<="], ["below $5,000", "<="], ["less than $5,000", "<="],
      ["at most $5,000", "<="], ["no more than $5,000", "<="],
      ["más de 5000 USD", ">="], ["mas de 5000 USD", ">="], ["al menos 5000 USD", ">="],
      ["menos de 5000 USD", "<="], ["por debajo de 5000 USD", "<="], ["como máximo 5000 USD", "<="],
      ["between $1,000 and $5,000", "between"], ["entre 1000 USD y 5000 USD", "between"],
      ["$5,000", "="],
    ];
    const emitted = new Set<string>();
    for (const [query, comparator] of cases) {
      const { filters } = parseQueryFilters(query, RULESET);
      expect(filters.length, query).toBeGreaterThan(0);
      expect(filters[0].comparator, query).toBe(comparator);
      emitted.add(filters[0].comparator);
    }
    expect([...emitted].sort()).toEqual(["<=", "=", ">=", "between"]);

    // The table is DATA, not branching code: no comparator string is
    // produced by an if/else chain over query words.
    const src = readFileSync("src/lib/kb/query-filters.ts", "utf8");
    expect(src).toContain("COMPARATOR_PHRASES");
    expect(src).not.toMatch(/if\s*\(\s*\w+\s*===\s*"over"/);
  });

  it("a comparator with nothing to bind to stays a keyword — a dropped word is a different query", () => {
    const { filters, residue } = parseQueryFilters("escalations over the weekend", RULESET);
    expect(filters).toEqual([]);
    expect(residue).toBe("escalations over the weekend");
  });

  it("keeps a connective that is not stranded against a consumed span", () => {
    const { filters, residue } = parseQueryFilters("handover notes from Ana", RULESET);
    expect(filters).toEqual([]);
    expect(residue).toBe("handover notes from Ana");
  });

  it("between takes both bounds and refuses to mix units", () => {
    const both = parseQueryFilters("contracts between $1,000 and $2,000", RULESET);
    expect(both.residue).toBe("contracts");
    expect(both.filters).toHaveLength(1);
    expect(both.filters[0]).toMatchObject({ kind: "MONEY", comparator: "between", num: 100_000, num2: 200_000, unit: "USD" });

    // No unit conversion anywhere in this area: a mixed-currency range is
    // not a range, so neither half is consumed as one.
    const mixed = parseQueryFilters("contracts between 1000 USD and 2000 EUR", RULESET);
    expect(mixed.filters.every((f) => f.comparator !== "between")).toBe(true);
  });

  it("caps its input at 512 characters", () => {
    expect(QUERY_INPUT_CAP).toBe(512);
    const padding = "invoice ".repeat(70); // 560 characters
    const { filters, residue } = parseQueryFilters(`${padding}over $5,000`, RULESET);
    expect(filters).toEqual([]); // the money never reached the parser
    expect(residue.length).toBeLessThanOrEqual(QUERY_INPUT_CAP);
  });

  it("is PURE: refDate decides the relative period, and no clock is read", () => {
    const a = parseQueryFilters("invoices last quarter", RULESET);
    const b = parseQueryFilters("invoices last quarter", RULESET);
    expect(a).toEqual(b);

    const shifted = parseQueryFilters("invoices last quarter", { ...RULESET, refDate: "2026-05-02" });
    expect(shifted.filters[0]).toMatchObject({
      kind: "DATE", ts: Date.parse("2026-01-01T00:00:00Z"), tsEnd: Date.parse("2026-04-01T00:00:00Z"),
    });

    const src = readFileSync("src/lib/kb/query-filters.ts", "utf8");
    expect(src).not.toContain("new Date(");
    expect(src).not.toContain("Date.now(");
    expect(src).not.toContain("toLocaleDateString");
  });

  it("quarter labels and magnitude expansion are plain arithmetic", () => {
    expect(quarterLabel("2026-01-15", -1)).toBe("Q4 2025");
    expect(quarterLabel("2026-01-15", 0)).toBe("Q1 2026");
    expect(quarterLabel("2026-11-30", 1)).toBe("Q1 2027");
    expect(expandMagnitude("2", 3)).toBe("2000");
    expect(expandMagnitude("1.5", 3)).toBe("1500");
    expect(expandMagnitude("2.4", 6)).toBe("2400000");
  });

  it("expands a magnitude only in a currency context — a bare 50k is not an amount", () => {
    expect(parseQueryFilters("part 50k tolerance", RULESET).filters).toEqual([]);
    expect(parseQueryFilters("invoices over $50k", RULESET).filters[0]).toMatchObject({
      kind: "MONEY", num: 5_000_000, unit: "USD",
    });
  });
});

// ---------------------------------------------------------------------------

const handles: TmpDb[] = [];
afterAll(async () => {
  for (const h of handles) await h.dispose();
});

let db: PrismaClient;
let admin: { id: string };
let requester: { id: string };
let docs: Record<string, string>;

/** Records every statement kbSearch issues — the "no second query" proof. */
function recording(client: PrismaClient) {
  const calls: string[] = [];
  return {
    calls,
    client: {
      $queryRawUnsafe<T>(sql: string): Promise<T> {
        calls.push(sql);
        return client.$queryRawUnsafe<T>(sql);
      },
    },
  };
}

async function embed(documentId: string) {
  const chunks = await db.documentChunk.findMany({ where: { documentId }, select: { id: true, text: true } });
  for (const c of chunks) {
    const v = mockEmbed(c.text);
    await db.$executeRawUnsafe(
      `UPDATE "DocumentChunk" SET embedding = '[${v.join(",")}]'::vector, "embeddingModel" = '${MOCK_EMBEDDER_MODEL}', "embeddingDims" = 256 WHERE id = '${c.id}'`,
    );
  }
}

// The corpus. Every document says "invoices" so the residue matches all of
// them: what separates them is money and date, which is the point.
const CORPUS: Array<{ key: string; name: string; visibility: "PUBLIC" | "PRIVATE"; text: string }> = [
  { key: "bigRecent", name: "big-recent.md", visibility: "PUBLIC",
    text: "# Ledger\n\nConsulting invoices for the quarter. Total $3,000.00 dated 2025-11-14." },
  { key: "smallRecent", name: "small-recent.md", visibility: "PUBLIC",
    text: "# Ledger\n\nConsulting invoices for the quarter. Total $500.00 dated 2025-11-20." },
  { key: "bigOld", name: "big-old.md", visibility: "PUBLIC",
    text: "# Ledger\n\nConsulting invoices from earlier. Total $4,000.00 dated 2025-06-10." },
  { key: "secret", name: "secret-big-recent.md", visibility: "PRIVATE",
    text: "# Ledger\n\nConsulting invoices, CONFIDENTIAL-ZEBRA-PLAN. Total $9,000.00 dated 2025-12-01." },
];

beforeEach(async () => {
  if (handles.length > 1) await handles.shift()?.dispose();
  const handle = await tmpDb();
  handles.push(handle);
  db = handle.client;
  holder.db = db as unknown as ServoDb;
  admin = await db.user.create({ data: { name: "A", email: `a${Date.now()}@x.com`, role: "ADMIN" } });
  requester = await db.user.create({ data: { name: "R", email: `r${Date.now()}@x.com`, role: "REQUESTER" } });
  docs = {};
  for (const entry of CORPUS) {
    const ingested = await ingestDocument({
      name: entry.name,
      contentType: "text/markdown",
      ownerId: admin.id,
      visibility: entry.visibility,
      bytes: Buffer.from(entry.text, "utf8"),
    });
    docs[entry.key] = ingested.documentId;
  }
}, 60_000);

const MONEY_2K: QueryFilter = { kind: "MONEY", comparator: ">=", num: 200_000, unit: "USD", confidence: "ASSUMED", text: "$2k" };
const LAST_QUARTER: QueryFilter = { kind: "DATE", comparator: "=", ts: Q4_2025_START, tsEnd: Q4_2025_END, confidence: "EXACT", text: "last quarter" };

describe("filters inside kb-10's single statement", () => {
  it("compiles to ONE correlated EXISTS per filter, in the WHERE, with the gate joined", async () => {
    const rec = recording(db);
    await kbSearch(rec.client, { humanId: requester.id, agentId: null }, "invoices", {
      filters: [MONEY_2K, LAST_QUARTER],
    });

    expect(rec.calls).toHaveLength(1); // no second query, no post-filter pass
    const sql = rec.calls[0];
    expect(sql.match(/EXISTS \(/g)).toHaveLength(2);
    // Correlated to a documentId the outer query already constrained...
    expect(sql).toContain('f_0."documentId" = c."documentId"');
    expect(sql).toContain('f_1."documentId" = c."documentId"');
    // ...and joined to the entitlement fragment as well.
    expect(sql).toContain('JOIN entitled e_0 ON e_0.id = f_0."documentId"');
    expect(sql).toContain('JOIN entitled e_1 ON e_1.id = f_1."documentId"');
    // The EXISTS clauses are ANDed onto the WHERE, not a separate SELECT.
    expect(sql.match(/SELECT \* FROM \(/g)).toHaveLength(1);

    // The comment that explains why the redundant join is kept — the reason
    // the next fact-only read path copies a block with the gate in it.
    const src = readFileSync("src/lib/kb/search.ts", "utf8");
    expect(src).toMatch(/Redundant here[\s\S]{0,200}KEPT so the pattern carries the gate/);
  });

  it("no filters ⇒ kb-10's statement is untouched", async () => {
    const rec = recording(db);
    await kbSearch(rec.client, { humanId: requester.id, agentId: null }, "invoices");
    expect(rec.calls).toHaveLength(1);
    expect(rec.calls[0]).not.toContain("DocumentFact");
    expect(rec.calls[0]).not.toContain("EXISTS (");
  });

  it("FILTERS NARROW, NEVER WIDEN — with and without embeddings, the identical code path", async () => {
    for (const key of Object.keys(docs)) await embed(docs[key]);

    // The whole composition, end to end: the residue is what reaches
    // websearch_to_tsquery and the filters are what reach the WHERE.
    const parsed = parseQueryFilters("invoices over $2k from last quarter", RULESET);
    expect(parsed.residue).toBe("invoices");
    expect(parsed.filters).toHaveLength(2);

    for (const withVectors of [false, true]) {
      const opts = withVectors
        ? { queryVector: mockEmbed(parsed.residue), embeddingModel: MOCK_EMBEDDER_MODEL }
        : {};
      const chain = { humanId: requester.id, agentId: null };
      const ids = async (filters?: QueryFilter[]) =>
        new Set((await kbSearch(db, chain, parsed.residue, { ...opts, filters })).map((h) => h.documentId));

      const both = await ids(parsed.filters);
      const moneyOnly = await ids(parsed.filters.filter((f) => f.kind === "MONEY"));
      const dateOnly = await ids(parsed.filters.filter((f) => f.kind === "DATE"));
      const unfiltered = await ids();

      // Exactly the fixture documents satisfying both.
      expect([...both], `vectors=${withVectors}`).toEqual([docs.bigRecent]);
      // Dropping either filter returns STRICTLY MORE, never fewer.
      expect([...moneyOnly].sort()).toEqual([docs.bigOld, docs.bigRecent].sort());
      expect([...dateOnly].sort()).toEqual([docs.bigRecent, docs.smallRecent].sort());
      for (const wider of [moneyOnly, dateOnly, unfiltered]) {
        for (const id of both) expect(wider.has(id)).toBe(true);
        expect(wider.size).toBeGreaterThan(both.size);
      }
      // The unfiltered set is every ENTITLED document — never the secret one.
      expect(unfiltered.size).toBe(3);
      expect(unfiltered.has(docs.secret)).toBe(false);

      if (withVectors) {
        const hits = await kbSearch(db, chain, parsed.residue, { ...opts, filters: parsed.filters });
        expect(hits.some((h) => h.vec !== null)).toBe(true); // vector path live
      }
    }
  }, 60_000);

  it("RED TEAM: a filter whose only match is a non-entitled document is indistinguishable from one that matches nothing", async () => {
    const chain = { humanId: requester.id, agentId: null };
    // $9,000 exists — in the document this principal may not read.
    const onlyTheSecret: QueryFilter = { ...MONEY_2K, num: 900_000, comparator: ">=", text: "$9k" };
    // $9,000,000 exists nowhere at all.
    const nothingAtAll: QueryFilter = { ...MONEY_2K, num: 900_000_000, comparator: ">=", text: "$9m" };

    const a = await kbSearch(db, chain, "invoices", { filters: [onlyTheSecret] });
    const b = await kbSearch(db, chain, "invoices", { filters: [nothingAtAll] });

    expect(a).toEqual([]);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b)); // character for character
    const blob = JSON.stringify(a) + JSON.stringify(b);
    expect(blob).not.toContain("CONFIDENTIAL-ZEBRA-PLAN");
    expect(blob).not.toContain("secret-big-recent.md");
    expect(blob).not.toContain(docs.secret);

    // The admin, who IS entitled, sees it — so the row exists and the
    // requester's empty answer is the gate, not an empty table.
    const asAdmin = await kbSearch(db, { humanId: admin.id, agentId: null }, "invoices", {
      filters: [onlyTheSecret],
    });
    expect(asAdmin.map((h) => h.documentId)).toEqual([docs.secret]);
  });

  it("a count over DocumentFact counts ENTITLED documents only", async () => {
    const asRequester = await countEntitledDocumentsMatching(db, { humanId: requester.id, agentId: null }, [MONEY_2K]);
    const asAdmin = await countEntitledDocumentsMatching(db, { humanId: admin.id, agentId: null }, [MONEY_2K]);

    // big-recent + big-old for the requester; the admin also reads the
    // secret one. A count over the raw table would answer 3 to both — an
    // existence oracle with a nicer UI.
    expect(asRequester).toBe(2);
    expect(asAdmin).toBe(3);

    const raw = await db.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT COUNT(DISTINCT "documentId") AS n FROM "DocumentFact" WHERE kind = 'MONEY' AND num >= 200000`,
    );
    expect(Number(raw[0].n)).toBe(3); // what the gate is subtracting from
  });

  it("the interval predicate is overlap, and units are compared rather than converted", () => {
    const date = filterExistsSql(LAST_QUARTER, "0", 'c."documentId"');
    expect(date).toContain(`f_0.ts < ${Q4_2025_END}`);
    expect(date).toContain(`f_0."tsEnd" > ${Q4_2025_START}`);

    const gigabytes = filterExistsSql(
      { kind: "QUANTITY", comparator: ">=", num: 1.5, unit: "gb", confidence: "EXACT", text: "1.5 GB" },
      "0",
      'c."documentId"',
    );
    expect(gigabytes).toContain("f_0.unit = 'gb'");
    expect(gigabytes).toContain("f_0.num >= 1.500000");
  });
});
