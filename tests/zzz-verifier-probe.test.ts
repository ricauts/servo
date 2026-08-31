// Independent verifier probe. Not part of the repo's suite.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { tmpDb, type TmpDb } from "./helpers/tmp-db";

type ServoDb = { [key: string]: unknown };
const holder = vi.hoisted(() => ({ db: null as unknown as ServoDb }));
vi.mock("@/lib/db", () => ({ get db() { return holder.db; } }));

import { kbSearch, countEntitledDocumentsMatching } from "@/lib/kb/search";
import type { QueryFilter } from "@/lib/kb/query-filters";
import { mockEmbed, MOCK_EMBEDDER_MODEL } from "@/lib/kb/mock-embedder";
import { ingestDocument } from "@/lib/kb/ingest";
import { KB_EXTRACT_BUDGET_ENV } from "@/lib/kb/settings";
process.env[KB_EXTRACT_BUDGET_ENV] = "20000";

let handle: TmpDb;
let db: PrismaClient;
let admin: { id: string };
const ids: Record<string, string> = {};

async function embedAll() {
  const chunks = await db.documentChunk.findMany({ select: { id: true, text: true } });
  for (const c of chunks) {
    const v = mockEmbed(c.text);
    await db.$executeRawUnsafe(
      `UPDATE "DocumentChunk" SET embedding = '[${v.join(",")}]'::vector, "embeddingModel" = '${MOCK_EMBEDDER_MODEL}', "embeddingDims" = 256 WHERE id = '${c.id}'`);
  }
}

beforeAll(async () => {
  handle = await tmpDb();
  db = handle.client;
  holder.db = db as unknown as ServoDb;
  admin = await db.user.create({ data: { name: "A", email: `a${Date.now()}@x.com`, role: "ADMIN" } });
  const corpus = [
    // matches tsv on "zebrafish", has NO money fact at all
    { key: "tsvNoFact", name: "a.md", text: "# A\n\nzebrafish notes with no amounts whatsoever here." },
    // matches tsv on "zebrafish", has a SMALL money fact
    { key: "tsvSmall", name: "b.md", text: "# B\n\nzebrafish ledger. Total $500.00 dated 2025-11-20." },
    // does NOT contain zebrafish; only reachable through the vector branch
    { key: "vecOnly", name: "c.md", text: "# C\n\nunrelated marmoset content, no amounts at all here." },
    // does not contain zebrafish, has a big money fact
    { key: "vecBig", name: "d.md", text: "# D\n\nunrelated marmoset ledger. Total $8,000.00 dated 2025-12-05." },
  ];
  for (const e of corpus) {
    const r = await ingestDocument({ name: e.name, contentType: "text/markdown", ownerId: admin.id, visibility: "PUBLIC", bytes: Buffer.from(e.text, "utf8") });
    ids[e.key] = r.documentId;
  }
  await embedAll();
}, 120_000);

afterAll(async () => { await handle?.dispose(); });

const chain = { humanId: "", agentId: null as string | null };
const M2K: QueryFilter = { kind: "MONEY", comparator: ">=", num: 200_000, unit: "USD", confidence: "EXACT", text: "$2k" };

describe("verifier probe", () => {
  it("facts were actually extracted", async () => {
    const rows = await db.$queryRawUnsafe<{ documentId: string; kind: string; num: string | null; unit: string }[]>(
      `SELECT "documentId", kind, num::text AS num, unit FROM "DocumentFact" ORDER BY "documentId"`);
    console.log("FACTS:", JSON.stringify(rows, null, 1));
    expect(rows.length).toBeGreaterThan(0);
  });

  it("PRECEDENCE: keyword-matched chunks are NOT exempt from the filter", async () => {
    const c = { humanId: admin.id, agentId: null };
    const un = await kbSearch(db, c, "zebrafish", {});
    const withF = await kbSearch(db, c, "zebrafish", { filters: [M2K] });
    console.log("kw unfiltered:", [...new Set(un.map(h => h.docName))], "filtered:", [...new Set(withF.map(h => h.docName))]);
    expect(new Set(un.map(h => h.documentId))).toEqual(new Set([ids.tsvNoFact, ids.tsvSmall]));
    expect(withF).toEqual([]); // neither has a >= $2k money fact
  });

  it("PRECEDENCE: vector-matched chunks are NOT exempt from the filter", async () => {
    const c = { humanId: admin.id, agentId: null };
    const opts = { queryVector: mockEmbed("zebrafish"), embeddingModel: MOCK_EMBEDDER_MODEL, limit: 10 };
    const un = await kbSearch(db, c, "zebrafish", opts);
    console.log("vec unfiltered:", [...new Set(un.map(h => h.docName))]);
    // the vector branch pulls in every embedded chunk, including the ones
    // that do not match the tsquery
    expect(new Set(un.map(h => h.documentId))).toEqual(new Set(Object.values(ids)));
    const withF = await kbSearch(db, c, "zebrafish", { ...opts, filters: [M2K] });
    console.log("vec filtered:", [...new Set(withF.map(h => h.docName))]);
    expect(new Set(withF.map(h => h.documentId))).toEqual(new Set([ids.vecBig]));
    expect(withF.some(h => h.vec !== null)).toBe(true);
  });

  it("INJECTION: hostile norm / unit / kind cannot escape the literal", async () => {
    const c = { humanId: admin.id, agentId: null };
    const hostile: QueryFilter[][] = [
      [{ kind: "IDENTIFIER", comparator: "=", norm: "x' OR '1'='1", confidence: "EXACT", text: "x" }],
      [{ kind: "IDENTIFIER", comparator: "=", norm: "'); DROP TABLE \"DocumentFact\"; --", confidence: "EXACT", text: "x" }],
      [{ kind: "IDENTIFIER", comparator: "=", norm: "a\\' OR 1=1 --", confidence: "EXACT", text: "x" }],
      [{ kind: "MONEY", comparator: "=", num: 1, unit: "USD' OR '1'='1", confidence: "EXACT", text: "x" }],
      [{ kind: "MONEY' OR '1'='1" as unknown as QueryFilter["kind"], comparator: "=", num: 1, unit: "USD", confidence: "EXACT", text: "x" }],
    ];
    for (const f of hostile) {
      const r = await kbSearch(db, c, "zebrafish", { filters: f });
      expect(r, JSON.stringify(f)).toEqual([]);
    }
    const still = await db.$queryRawUnsafe<{ n: bigint }[]>(`SELECT COUNT(*) AS n FROM "DocumentFact"`);
    expect(Number(still[0].n)).toBeGreaterThan(0);
  });

  it("NUMERIC edge: huge / fractional / negative numbers stay valid SQL", async () => {
    const c = { humanId: admin.id, agentId: null };
    const cases = [1e21, 1e30, -1e21, 0.0000001, 1e-30, Number.MAX_SAFE_INTEGER, 1.5];
    for (const n of cases) {
      const f: QueryFilter[] = [{ kind: "MONEY", comparator: ">=", num: n, unit: "USD", confidence: "EXACT", text: "x" }];
      try {
        const r = await kbSearch(db, c, "zebrafish", { filters: f });
        console.log("num", n, "->", r.length, "hits");
      } catch (err) {
        console.log("num", n, "-> ERROR", (err as Error).message.split("\n").slice(0,3).join(" | "));
        throw err;
      }
    }
  });

  it("NaN / Infinity are rejected rather than emitted", async () => {
    const c = { humanId: admin.id, agentId: null };
    await expect(kbSearch(db, c, "zebrafish", { filters: [{ kind: "MONEY", comparator: ">=", num: NaN, unit: "USD", confidence: "EXACT", text: "x" }] })).rejects.toThrow();
  });

  it("ONE statement only, with 3 filters", async () => {
    const calls: string[] = [];
    const client = { $queryRawUnsafe<T>(sql: string) { calls.push(sql); return db.$queryRawUnsafe<T>(sql); } };
    await kbSearch(client, { humanId: admin.id, agentId: null }, "zebrafish", { filters: [M2K, M2K, M2K] });
    expect(calls).toHaveLength(1);
    expect((calls[0].match(/EXISTS \(/g) ?? []).length).toBe(3);
    expect((calls[0].match(/"DocumentFact"/g) ?? []).length).toBe(3);
  });

  it("agent chain also carries the gate inside the EXISTS", async () => {
    const calls: string[] = [];
    const client = { $queryRawUnsafe<T>(sql: string) { calls.push(sql); return db.$queryRawUnsafe<T>(sql); } };
    await kbSearch(client, { humanId: admin.id, agentId: "builtin:resolver" }, "zebrafish", { filters: [M2K] });
    expect(calls[0]).toContain('JOIN entitled e_0 ON e_0.id = f_0."documentId"');
    expect(calls[0]).toContain("agent_docs");
  });
});
