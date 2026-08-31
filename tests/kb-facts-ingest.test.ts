// ext-04: the ingestion wiring, the idempotent upsert and the ruleset
// backfill. Everything here runs against a tmpDb() and the REAL forked
// worker — the point of the item is that the pass leaves this process, so
// a test that stubbed the fork would assert nothing.

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { PrismaClient } from "@prisma/client";
import { tmpDb, type TmpDb } from "./helpers/tmp-db";

type ServoDb = { [key: string]: unknown };
const holder = vi.hoisted(() => ({ db: null as unknown as ServoDb }));
vi.mock("@/lib/db", () => ({ get db() { return holder.db; } }));

import { EXTRACT_LIMITS, runFactsJob } from "@/lib/kb/extract";
import { KB_EXTRACT_BUDGET_ENV } from "@/lib/kb/settings";
import { DEFAULT_RULESET, EXTRACTOR_VERSION, extractFacts } from "@/lib/kb/facts";
import {
  persistFactsForDocument,
  rulesetForDocument,
  upsertChunkFacts,
  factRow,
  numIsOutOfRange,
  NUM_ABS_LIMIT,
} from "@/lib/kb/facts/persist";
import { backfillFacts, isBelowCurrentVersion } from "@/lib/kb/facts/backfill";
import { keywordPass } from "@/lib/kb/keywords";
import { ingestDocument } from "@/lib/kb/ingest";

// Same tightening kb-05's own file makes, for the same reason: the fixtures
// must not wait out the shipped 360 s budget.
process.env[KB_EXTRACT_BUDGET_ENV] = "20000";

const handles: TmpDb[] = [];
afterAll(async () => {
  for (const h of handles) await h.dispose();
});

let db: PrismaClient;
let admin: { id: string };

beforeEach(async () => {
  if (handles.length > 1) await handles.shift()?.dispose();
  const handle = await tmpDb();
  handles.push(handle);
  db = handle.client;
  holder.db = db as unknown as ServoDb;
  admin = await db.user.create({ data: { name: "A", email: `a${Date.now()}@x.com`, role: "ADMIN" } });
});

const zipBomb = () => readFileSync("tests/fixtures/kb/zip-bomb.xlsx");

const SAMPLE =
  "Invoice INV-2024-113 was raised on 2026-03-01 for $2,400.00 and support runs 30 days.\n" +
  "Write to billing@example.com or see https://example.com/invoices/113?ref=x for the terms.\n";

async function ingestText(name: string, text: string) {
  return ingestDocument({
    name,
    contentType: "text/markdown",
    bytes: Buffer.from(text, "utf8"),
    ownerId: admin.id,
  });
}

/** A document plus one chunk, created directly — the persist/backfill unit
 *  cases need a chunk without paying for a full ingestion. */
async function makeChunk(text: string, createdAt?: Date) {
  const doc = await db.document.create({
    data: {
      name: `d-${Math.random().toString(36).slice(2)}.md`,
      contentType: "text/markdown",
      byteSize: text.length,
      sha256: "1".repeat(64),
      data: new Uint8Array(Buffer.from(text)),
      ownerId: admin.id,
      visibility: "PRIVATE",
      textStatus: "EXTRACTED",
      ...(createdAt ? { createdAt } : {}),
    },
  });
  const chunk = await db.documentChunk.create({
    data: { documentId: doc.id, index: 0, text, locator: { lines: "1" } },
  });
  return { doc, chunk };
}

describe("the pass runs after chunking, in kb-05's forked worker, off this process", () => {
  it("kb-05's caps are unchanged by this item", () => {
    expect(EXTRACT_LIMITS.maxEntries).toBe(2_000);
    expect(EXTRACT_LIMITS.maxDecompressedBytes).toBe(64 * 1024 * 1024);
    expect(EXTRACT_LIMITS.maxOldSpaceMb).toBe(512);
  });

  it("the fork answers the facts route, and the answer matches the in-process extractor exactly", async () => {
    const job = await runFactsJob([{ id: "c1", text: SAMPLE }], DEFAULT_RULESET, { budgetMs: 20_000 });
    expect(job.ok).toBe(true);
    if (!job.ok) return;
    expect(job.results).toHaveLength(1);
    expect(job.results[0].chunkId).toBe("c1");
    // The worker imports the SHIPPED parser rather than a second copy, so
    // the two sides agree fact for fact. A CommonJS reimplementation would
    // fail exactly here.
    const inProcess = extractFacts(SAMPLE, DEFAULT_RULESET).facts;
    expect(job.results[0].facts).toEqual(inProcess);
    expect(inProcess.length).toBeGreaterThan(0);
  }, 30_000);

  it("neither the persist module nor ingest calls the extractor in-process", () => {
    const persistSrc = readFileSync("src/lib/kb/facts/persist.ts", "utf8");
    const backfillSrc = readFileSync("src/lib/kb/facts/backfill.ts", "utf8");
    const ingestSrc = readFileSync("src/lib/kb/ingest.ts", "utf8");
    for (const [name, src] of [
      ["persist.ts", persistSrc],
      ["backfill.ts", backfillSrc],
      ["ingest.ts", ingestSrc],
    ] as const) {
      expect(src.includes("extractFacts("), `${name} must not run the pass in this process`).toBe(false);
    }
    // ...and the worker is where it does run.
    const workerSrc = readFileSync("src/lib/kb/extract-worker.cjs", "utf8");
    expect(workerSrc).toContain("extractFacts(");
    expect(workerSrc).toContain('msg.route === "facts"');
  });

  it("uploading a document lands its facts, keyed to its chunks", async () => {
    const result = await ingestText("invoice.md", SAMPLE);
    expect(result.textStatus).toBe("EXTRACTED");
    const facts = await db.documentFact.findMany({
      where: { documentId: result.documentId },
      orderBy: { offset: "asc" },
    });
    expect(facts.length).toBeGreaterThan(0);
    const kinds = new Set(facts.map((f) => f.kind));
    expect(kinds.has("IDENTIFIER")).toBe(true);
    expect(kinds.has("MONEY")).toBe(true);
    for (const fact of facts) {
      expect(fact.extractor).toBe(EXTRACTOR_VERSION);
      const chunk = await db.documentChunk.findUniqueOrThrow({ where: { id: fact.chunkId } });
      expect(chunk.documentId).toBe(result.documentId);
      // The span still slices back out of the chunk it was found in.
      expect(chunk.text.slice(fact.offset, fact.offset + fact.length)).toBe(fact.text);
    }
    // MONEY is integer minor units in a DECIMAL column, not a float.
    const money = facts.find((f) => f.kind === "MONEY");
    expect(money?.num?.toString()).toBe("240000");
    expect(money?.unit).toBe("USD");
  }, 30_000);

  it("refDate is the DOCUMENT'S createdAt, not the clock", async () => {
    const createdAt = new Date("2020-06-15T09:30:00.000Z");
    expect(rulesetForDocument(createdAt).refDate).toBe("2020-06-15");

    const { doc, chunk } = await makeChunk("The parcel shipped last week.", createdAt);
    await persistFactsForDocument(db, doc.id, { budgetMs: 20_000 });
    const fact = await db.documentFact.findFirstOrThrow({ where: { chunkId: chunk.id, kind: "DATE" } });
    // 2020-06-15 minus seven days — a clock read would land in the year
    // this test is running in, never here.
    expect(new Date(Number(fact.ts)).toISOString().slice(0, 10)).toBe("2020-06-08");
  }, 30_000);
});

describe("the reply survives the size of an ordinary document", () => {
  // The regression this describe exists for: process.send() is async, and a
  // disconnect beside it discarded any reply the IPC channel had not
  // flushed. The parent saw a clean exit 0, ingestion swallowed it, and a
  // routine multi-hundred-chunk upload landed EXTRACTED with ZERO facts —
  // invisibly. Every case below is above the payload size that used to lose
  // the reply.
  const section = (i: number) =>
    `## Section ${i}\n\nInvoice INV-2024-${1000 + i} was raised on 2026-03-01 for $${i + 1},400.00 ` +
    `and support runs 30 days. Write to billing${i}@example.com or see ` +
    `https://example.com/invoices/${i} for the terms.\n`;

  it("a 300-section markdown document keeps every fact the extractor found", async () => {
    const text = Array.from({ length: 300 }, (_, i) => section(i)).join("\n");
    // Comfortably past the ~38 KB document that used to come back factless:
    // the reply is several times the input, and the loss began near a
    // 125 KB reply payload.
    expect(text.length).toBeGreaterThan(50_000);
    const result = await ingestText("large.md", text);
    expect(result.textStatus).toBe("EXTRACTED");
    expect(result.chunks).toBeGreaterThan(100);
    const facts = await db.documentFact.count({ where: { documentId: result.documentId } });
    expect(facts).toBeGreaterThan(500);
  }, 120_000);

  it("a 1000-chunk facts job round-trips over IPC rather than exiting silently", async () => {
    const chunks = Array.from({ length: 1000 }, (_, i) => ({ id: `c${i}`, text: section(i) }));
    const job = await runFactsJob(chunks, DEFAULT_RULESET, { budgetMs: 120_000 });
    expect(job.ok).toBe(true);
    if (!job.ok) return;
    expect(job.results).toHaveLength(1000);
    const total = job.results.reduce((n, r) => n + r.facts.length, 0);
    expect(total).toBeGreaterThan(3000);
  }, 120_000);

  it("the worker closes its channel only after the send completes", () => {
    const src = readFileSync("src/lib/kb/extract-worker.cjs", "utf8");
    // The shape that lost replies: a bare .finally(disconnect) beside an
    // un-callbacked send.
    expect(src).not.toMatch(/\.finally\(\(\)\s*=>\s*\{\s*(\/\/[^\n]*\n\s*)*process\.disconnect\(\)/);
    expect(src).toMatch(/process\.send\(payload,\s*\(\)\s*=>/);
  });
});

describe("the wall-clock cap is armed by the job, not by the caller", () => {
  it("a budget the job cannot meet kills the child even with no AbortSignal passed", async () => {
    const chunks = Array.from({ length: 400 }, (_, i) => ({
      id: `c${i}`,
      text: `Invoice INV-2024-${i} for $${i}.00 on 2026-03-01, ships in 30 days.`,
    }));
    // No `signal` — only budgetMs. Before the fix this returned ok:true
    // because budgetMs merely composed an error string.
    const job = await runFactsJob(chunks, DEFAULT_RULESET, { budgetMs: 1 });
    expect(job.ok).toBe(false);
    if (job.ok) return;
    expect(job.error).toMatch(/exceeded 1 ms/);
    expect(job.breach).toBe("budget");
  }, 30_000);

  it("a budget past setTimeout's 32-bit ceiling is clamped, not silently rewritten to 1 ms", async () => {
    // Node turns a delay above 2^31-1 into 1 ms with only a warning, which
    // would make a generous budget kill every document instantly.
    const job = await runFactsJob([{ id: "c1", text: SAMPLE }], DEFAULT_RULESET, {
      budgetMs: 2_147_483_648,
    });
    expect(job.ok).toBe(true);
  }, 30_000);

  it("the abort listener is removed when the job settles, so a reused signal does not accumulate", async () => {
    // getEventListeners is not in this @types/node's namespace export.
    const { getEventListeners } = (await import("node:events")) as unknown as {
      getEventListeners(target: unknown, event: string): unknown[];
    };
    const controller = new AbortController();
    for (let i = 0; i < 3; i++) {
      const job = await runFactsJob([{ id: `c${i}`, text: SAMPLE }], DEFAULT_RULESET, {
        budgetMs: 20_000,
        signal: controller.signal,
      });
      expect(job.ok).toBe(true);
    }
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
  }, 45_000);
});

describe("a number the column cannot hold is refused, not left to wedge the corpus", () => {
  const POISON = "capacity 123456789012345678901234567890123 gb of noise here";

  it("the extractor really does emit an out-of-range QUANTITY for this text", () => {
    const facts = extractFacts(POISON, DEFAULT_RULESET).facts;
    const quantity = facts.find((f) => f.kind === "QUANTITY");
    expect(quantity).toBeDefined();
    expect(numIsOutOfRange(quantity!)).toBe(true);
    // DECIMAL(38,6) holds 32 integer digits; Postgres raises 22003 rather
    // than truncating, which is what used to abort the write.
    expect(NUM_ABS_LIMIT).toBe(1e32);
  });

  it("persisting such a chunk succeeds, drops only that fact, and keeps the rest", async () => {
    const { doc, chunk } = await makeChunk(`${POISON}\nInvoice INV-2024-113 for $2,400.00.`);
    const result = await persistFactsForDocument(db, doc.id, { budgetMs: 20_000 });
    expect(result.facts).toBeGreaterThan(0);
    const rows = await db.documentFact.findMany({ where: { chunkId: chunk.id } });
    expect(rows.some((r) => r.kind === "MONEY")).toBe(true);
    for (const row of rows) {
      expect(Math.abs(Number(row.num ?? 0))).toBeLessThan(NUM_ABS_LIMIT);
    }
  }, 30_000);

  it("and the backfill drains a batch containing one, instead of throwing forever", async () => {
    const { doc, chunk } = await makeChunk(`${POISON}\nInvoice INV-2024-113 for $2,400.00.`);
    await db.documentFact.create({
      data: {
        documentId: doc.id,
        chunkId: chunk.id,
        kind: "IDENTIFIER",
        norm: "stale",
        unit: "",
        text: "stale",
        offset: 0,
        length: 5,
        extractor: "facts@0",
      },
    });
    const first = await backfillFacts(db, { batchSize: 2, budgetMs: 20_000 });
    expect(first.batches).toBe(1);
    expect(await db.documentFact.count({ where: { extractor: "facts@0" } })).toBe(0);
    // Drained for good: the second run has nothing left.
    expect(await backfillFacts(db, { batchSize: 2, budgetMs: 20_000 })).toEqual({
      chunks: 0,
      facts: 0,
      batches: 0,
    });
  }, 45_000);
});

describe("a failing pass is loud, and never un-ingests a document", () => {
  it("persistFactsForDocument THROWS when the fork cannot answer — it does not quietly write nothing", async () => {
    const { doc } = await makeChunk(SAMPLE);
    await expect(
      persistFactsForDocument(db, doc.id, { signal: AbortSignal.abort() }),
    ).rejects.toThrow(/killed|died|failed/i);
    expect(await db.documentFact.count({ where: { documentId: doc.id } })).toBe(0);
  }, 30_000);

  it("and ingestion catches it: the document is still EXTRACTED, with its chunks, and no facts", async () => {
    vi.resetModules();
    vi.doMock("@/lib/kb/facts/persist", () => ({
      persistFactsForDocument: () => Promise.reject(new Error("fork unavailable")),
    }));
    try {
      const { ingestDocument: ingestWithBrokenFacts } = await import("@/lib/kb/ingest");
      const result = await ingestWithBrokenFacts({
        name: "resilient.md",
        contentType: "text/markdown",
        bytes: Buffer.from(SAMPLE, "utf8"),
        ownerId: admin.id,
      });
      expect(result.textStatus).toBe("EXTRACTED");
      expect(result.chunks).toBeGreaterThan(0);
      expect(await db.documentChunk.count({ where: { documentId: result.documentId } })).toBe(
        result.chunks,
      );
      expect(await db.documentFact.count({ where: { documentId: result.documentId } })).toBe(0);
    } finally {
      vi.doUnmock("@/lib/kb/facts/persist");
      vi.resetModules();
    }
  }, 30_000);
});

describe("a failed document commits no facts", () => {
  it("the zip bomb lands FAILED, with no chunks and no facts", async () => {
    const result = await ingestDocument({
      name: "bomb.xlsx",
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      bytes: zipBomb(),
      ownerId: admin.id,
    });
    expect(result.textStatus).toBe("FAILED");
    const doc = await db.document.findUniqueOrThrow({ where: { id: result.documentId } });
    expect(doc.textError).toMatch(/entries|decompressed/);
    expect(await db.documentChunk.count({ where: { documentId: doc.id } })).toBe(0);
    expect(await db.documentFact.count({ where: { documentId: doc.id } })).toBe(0);
  }, 30_000);
});

describe("writes are upserts on (chunkId, offset, kind)", () => {
  it("re-running the pass on unchanged chunks changes no row — count, content or id", async () => {
    const { doc } = await makeChunk(SAMPLE);
    const first = await persistFactsForDocument(db, doc.id, { budgetMs: 20_000 });
    expect(first.facts).toBeGreaterThan(0);
    const before = await db.documentFact.findMany({
      where: { documentId: doc.id },
      orderBy: [{ offset: "asc" }, { kind: "asc" }],
    });

    const second = await persistFactsForDocument(db, doc.id, { budgetMs: 20_000 });
    expect(second.facts).toBe(first.facts);
    const after = await db.documentFact.findMany({
      where: { documentId: doc.id },
      orderBy: [{ offset: "asc" }, { kind: "asc" }],
    });

    expect(after).toHaveLength(before.length);
    // By content...
    expect(after.map((f) => [f.kind, f.norm, f.offset, f.length, f.unit, f.confidence])).toEqual(
      before.map((f) => [f.kind, f.norm, f.offset, f.length, f.unit, f.confidence]),
    );
    // ...and by identity: an upsert keeps the row, a delete-and-recreate
    // would mint new ids and new createdAt values.
    expect(after.map((f) => f.id)).toEqual(before.map((f) => f.id));
    expect(after.map((f) => f.createdAt.getTime())).toEqual(before.map((f) => f.createdAt.getTime()));
  }, 45_000);

  it("the unique key really is (chunkId, offset, kind): a second write at the same key updates in place", async () => {
    const { doc, chunk } = await makeChunk(SAMPLE);
    const facts = extractFacts(SAMPLE, DEFAULT_RULESET).facts;
    const written = await upsertChunkFacts(db, doc.id, chunk.id, facts);
    expect(written).toBe(facts.length);
    const again = await upsertChunkFacts(db, doc.id, chunk.id, facts);
    expect(again).toBe(facts.length);
    expect(await db.documentFact.count({ where: { chunkId: chunk.id } })).toBe(facts.length);
  }, 30_000);

  it("a key the new pass no longer produces is removed, scoped to its chunk", async () => {
    const { doc, chunk } = await makeChunk(SAMPLE);
    await persistFactsForDocument(db, doc.id, { budgetMs: 20_000 });
    // A row at an offset the pass will never produce — a stale key from a
    // ruleset that used to match here.
    await db.documentFact.create({
      data: {
        documentId: doc.id,
        chunkId: chunk.id,
        kind: "QUANTITY",
        norm: "9:kg",
        unit: "kg",
        text: "9 kg",
        offset: 100_000,
        length: 4,
        extractor: "facts@0",
      },
    });
    const other = await makeChunk("A separate document with billing@example.com in it.");
    await persistFactsForDocument(db, other.doc.id, { budgetMs: 20_000 });
    const otherBefore = await db.documentFact.count({ where: { chunkId: other.chunk.id } });

    await persistFactsForDocument(db, doc.id, { budgetMs: 20_000 });
    expect(await db.documentFact.count({ where: { chunkId: chunk.id, offset: 100_000 } })).toBe(0);
    // The other chunk's rows are untouched — the delete is chunk-scoped.
    expect(await db.documentFact.count({ where: { chunkId: other.chunk.id } })).toBe(otherBefore);
  }, 45_000);
});

describe("backfillFacts", () => {
  it("is a no-op with no stale rows: nothing written, no batch", async () => {
    const { doc } = await makeChunk(SAMPLE);
    await persistFactsForDocument(db, doc.id, { budgetMs: 20_000 });
    const before = await db.documentFact.findMany({ where: { documentId: doc.id }, orderBy: { id: "asc" } });
    expect(before.length).toBeGreaterThan(0);

    const result = await backfillFacts(db, { budgetMs: 20_000 });
    expect(result).toEqual({ chunks: 0, facts: 0, batches: 0 });
    const after = await db.documentFact.findMany({ where: { documentId: doc.id }, orderBy: { id: "asc" } });
    expect(after.map((f) => f.id)).toEqual(before.map((f) => f.id));
  }, 45_000);

  it("re-extracts chunks stamped below the current version, committing in batches", async () => {
    // Three documents, each with one chunk, all stamped facts@0.
    const made = [];
    for (let i = 0; i < 3; i++) {
      const m = await makeChunk(`Doc ${i}: invoice INV-2024-11${i} for $1${i}.00 on 2026-03-0${i + 1}.`);
      made.push(m);
      await db.documentFact.create({
        data: {
          documentId: m.doc.id,
          chunkId: m.chunk.id,
          kind: "IDENTIFIER",
          norm: "stale",
          unit: "",
          text: "stale",
          offset: 0,
          length: 5,
          extractor: "facts@0",
        },
      });
    }
    expect(await db.documentFact.count({ where: { extractor: "facts@0" } })).toBe(3);

    // batchSize 2 over 3 stale chunks — two batches, so "batches, not one
    // transaction" is observable rather than asserted by reading the code.
    const result = await backfillFacts(db, { batchSize: 2, budgetMs: 20_000 });
    expect(result.chunks).toBe(3);
    expect(result.batches).toBe(2);
    expect(result.facts).toBeGreaterThan(0);

    // Nothing is left below the current version, and the stale placeholder
    // is gone rather than sitting beside the fresh rows.
    expect(await db.documentFact.count({ where: { extractor: "facts@0" } })).toBe(0);
    expect(await db.documentFact.count({ where: { norm: "stale" } })).toBe(0);
    for (const m of made) {
      const rows = await db.documentFact.findMany({ where: { chunkId: m.chunk.id } });
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) expect(row.extractor).toBe(EXTRACTOR_VERSION);
    }

    // Idempotent: a second run has nothing left to do.
    expect(await backfillFacts(db, { batchSize: 2, budgetMs: 20_000 })).toEqual({
      chunks: 0,
      facts: 0,
      batches: 0,
    });
  }, 60_000);

  it("a chunk with a mixed stamp drains whichever row the database returns first", async () => {
    // The selection must not depend on which of a chunk's non-current rows
    // a `distinct` happens to keep: if it kept the ABOVE-version one the
    // chunk would be skipped and its stale rows would never drain. Both
    // insertion orders are exercised.
    for (const aboveFirst of [true, false]) {
      const { doc, chunk } = await makeChunk(`Invoice INV-2024-11${aboveFirst ? 7 : 8} for $9.00.`);
      const rows = [
        { kind: "DURATION", norm: "above", offset: 1, extractor: "facts@9" },
        { kind: "IDENTIFIER", norm: "below", offset: 2, extractor: "facts@0" },
      ];
      for (const row of aboveFirst ? rows : [...rows].reverse()) {
        await db.documentFact.create({
          data: {
            documentId: doc.id,
            chunkId: chunk.id,
            kind: row.kind,
            norm: row.norm,
            unit: "",
            text: "x",
            offset: row.offset,
            length: 1,
            extractor: row.extractor,
          },
        });
      }
      const result = await backfillFacts(db, { batchSize: 5, budgetMs: 20_000 });
      expect(result.chunks, `aboveFirst=${aboveFirst}`).toBe(1);
      expect(
        await db.documentFact.count({ where: { chunkId: chunk.id, extractor: "facts@0" } }),
        `aboveFirst=${aboveFirst}: the stale row must drain`,
      ).toBe(0);
    }
  }, 60_000);

  it("the version comparison is BELOW, not merely different", () => {
    expect(isBelowCurrentVersion("facts@0")).toBe(true);
    expect(isBelowCurrentVersion(EXTRACTOR_VERSION)).toBe(false);
    // A newer stamp is left alone: rewriting a newer extractor's output as
    // older is worse than leaving it.
    expect(isBelowCurrentVersion("facts@9")).toBe(false);
    // An unreadable stamp cannot be vouched for, so it is stale.
    expect(isBelowCurrentVersion("who-knows")).toBe(true);
  });
});

describe("kb-08's keyword/entity pass is untouched by this item", () => {
  it("neither the tokenizer nor the graph builder knows facts exist", () => {
    const keywords = readFileSync("src/lib/kb/keywords.ts", "utf8");
    const graph = readFileSync("src/lib/kb/graph.ts", "utf8");
    for (const [name, src] of [["keywords.ts", keywords], ["graph.ts", graph]] as const) {
      expect(src.toLowerCase().includes("documentfact"), `${name} must not reference facts`).toBe(false);
      expect(src.includes("kb/facts"), `${name} must not import the facts module`).toBe(false);
    }
    // SHARED_FACT is ext-05's edge, not this item's.
    expect(graph.includes("SHARED_FACT")).toBe(false);
  });

  it("an ingested document's chunk keywords are still exactly keywordPass's output", async () => {
    const result = await ingestText("keywords.md", SAMPLE);
    const chunks = await db.documentChunk.findMany({
      where: { documentId: result.documentId },
      orderBy: { index: "asc" },
    });
    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(chunk.keywords).toEqual(keywordPass(chunk.text).keywords);
    }
  }, 30_000);
});

describe("facts die with their chunks and their documents", () => {
  it("deleting a chunk cascades its facts; deleting the document cascades both", async () => {
    const result = await ingestText("cascade.md", SAMPLE);
    const documentId = result.documentId;
    expect(await db.documentFact.count({ where: { documentId } })).toBeGreaterThan(0);

    const chunk = await db.documentChunk.findFirstOrThrow({ where: { documentId } });
    await db.documentChunk.delete({ where: { id: chunk.id } });
    expect(await db.documentFact.count({ where: { chunkId: chunk.id } })).toBe(0);

    await db.document.delete({ where: { id: documentId } });
    expect(await db.documentFact.count({ where: { documentId } })).toBe(0);
  }, 30_000);

  it("re-ingesting the same (owner, name) replaces the facts rather than doubling them", async () => {
    const first = await ingestText("replace.md", SAMPLE);
    const before = await db.documentFact.count({ where: { documentId: first.documentId } });
    expect(before).toBeGreaterThan(0);

    const beforeRows = await db.documentFact.findMany({
      where: { documentId: first.documentId },
      orderBy: [{ offset: "asc" }, { kind: "asc" }],
    });

    const second = await ingestText("replace.md", SAMPLE);
    expect(second.documentId).toBe(first.documentId);
    expect(second.replacedExisting).toBe(true);
    expect(await db.documentFact.count({ where: { documentId: first.documentId } })).toBe(before);

    // ...and BY CONTENT, not just by count. Re-ingestion replaces the
    // chunks, so the rows are new rows behind the FK cascade — what must
    // be identical is what they SAY.
    const afterRows = await db.documentFact.findMany({
      where: { documentId: first.documentId },
      orderBy: [{ offset: "asc" }, { kind: "asc" }],
    });
    const shape = (rows: typeof afterRows) =>
      rows.map((f) => [
        f.kind,
        f.norm,
        f.offset,
        f.length,
        f.unit,
        f.confidence,
        f.text,
        f.num?.toString() ?? null,
        f.ts?.toString() ?? null,
        f.tsEnd?.toString() ?? null,
        f.extractor,
      ]);
    expect(shape(afterRows)).toEqual(shape(beforeRows));
  }, 60_000);
});

describe("the column mapping", () => {
  // SAMPLE alone produces six of the seven kinds — QUANTITY, the only kind
  // whose num column is unbounded, never appears in it. The extra line is
  // there so the loop below actually covers all seven.
  const ALL_KINDS = `${SAMPLE}The rack holds 3.5 kg of hardware and runs at 80 % load.\n`;

  it("covers all seven kinds, so the num column is not asserted on six of them", () => {
    const kinds = new Set(extractFacts(ALL_KINDS, DEFAULT_RULESET).facts.map((f) => f.kind));
    for (const kind of ["DATE", "MONEY", "DURATION", "IDENTIFIER", "QUANTITY", "EMAIL", "URL"]) {
      expect(kinds.has(kind as never), `${kind} must be exercised`).toBe(true);
    }
  });

  it("maps every kind onto the canonized columns", () => {
    const facts = extractFacts(ALL_KINDS, DEFAULT_RULESET).facts;
    expect(facts.length).toBeGreaterThan(0);
    for (const fact of facts) {
      const row = factRow(fact);
      expect(row.extractor).toBe(EXTRACTOR_VERSION);
      expect(row.text).toBe(fact.text);
      expect(typeof row.unit).toBe("string"); // NOT NULL in the schema
      expect(["EXACT", "ASSUMED"]).toContain(row.confidence);
      if (fact.kind === "DATE") {
        expect(row.ts).toBe(BigInt(fact.ts));
        expect(row.tsEnd).toBe(BigInt(fact.tsEnd));
        expect(row.num).toBeNull();
      } else {
        expect(row.ts).toBeNull();
        expect(row.tsEnd).toBeNull();
      }
      if ("num" in fact) expect(row.num?.toString()).toBe(String(fact.num));
    }
  });
});
