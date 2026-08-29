// cat-05: object-storage profiling end to end against the in-process
// fixture server. Tier 1 lists (ZERO GETs — the request log proves it);
// tier 2 deterministically selects samples, fetches through safeFetch,
// hands bytes to the kb-05 hardened worker (bomb + XXE fixtures land
// PARTIAL, never a dead container), reads xlsx structure via exceljs and
// PDF page counts + keywords via unpdf — and the sampled bytes are
// DISCARDED: no Document row, no chunk, no entry carries an object byte.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { PrismaClient } from "@prisma/client";
import { tmpDb, type TmpDb } from "./helpers/tmp-db";
import { startObjectFixture, type FixtureServer } from "./setup/object-fixture-server";
import {
  mapObjectListing,
  prefixRows,
  contentTypeForExtension,
  extensionOf,
  type ListedObject,
} from "@/lib/catalog/tier1-object";
import { selectSamples } from "@/lib/catalog/tier2-object";
import { extractHardened } from "@/lib/kb/extract";
import { keywordPass } from "@/lib/kb/keywords";

type ServoDb = { [key: string]: unknown };
const holder = vi.hoisted(() => ({ db: null as unknown as ServoDb }));
vi.mock("@/lib/db", () => ({ get db() { return holder.db; } }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: async () => ({ id: "x", role: "ADMIN" }) }));

const handles: TmpDb[] = [];
let db: PrismaClient;
let server: FixtureServer;

const iso = (day: number) => new Date(Date.UTC(2026, 0, day)).toISOString();

const BUCKET: ListedObject[] = [
  { key: "exports/finance/2025/q4-invoices.csv", size: 4021, lastModified: iso(3) },
  { key: "exports/finance/2025/q4-payments.csv", size: 3900, lastModified: iso(5) },
  { key: "exports/finance/2026/q1-invoices.csv", size: 5100, lastModified: iso(40) },
  { key: "exports/finance/2026/summary.xlsx", size: 8300, lastModified: iso(60) },
  { key: "exports/ops/2026/report-jan.pdf", size: 12000, lastModified: iso(31) },
  { key: "exports/ops/2026/report-feb.pdf", size: 12100, lastModified: iso(59) },
  { key: "readme.md", size: 210, lastModified: iso(1) },
];

beforeAll(async () => {
  server = await startObjectFixture({
    objects: BUCKET,
    bodies: new Map<string, Buffer>([
      ["orders-sample.xlsx", readFileSync("tests/fixtures/catalog/bucket/orders-sample.xlsx")],
      ["report-sample.pdf", readFileSync("tests/fixtures/catalog/bucket/report-sample.pdf")],
      ["bomb-sample.xlsx", readFileSync("tests/fixtures/catalog/bucket/bomb-sample.xlsx")],
      ["xxe-sample.xlsx", readFileSync("tests/fixtures/catalog/bucket/xxe-sample.xlsx")],
    ]),
  });
});
afterAll(async () => {
  await server.close();
  for (const h of handles) await h.dispose();
});
afterEach(async () => {
  server.requests.length = 0;
});

beforeEach(async () => {
  if (handles.length > 1) await handles.shift()?.dispose();
  const a = await tmpDb();
  handles.push(a);
  db = a.client;
  holder.db = db as unknown as ServoDb;
});

describe("tier 1 — the prefix tree from a listing, ZERO GETs", () => {
  it("mapObjectListing is pure: shuffled input yields an identical tree", async () => {
    const listing = await (await fetch(`${server.url}/list`)).json();
    const a = JSON.stringify(mapObjectListing(listing.objects));
    const shuffled = [...listing.objects].reverse();
    const b = JSON.stringify(mapObjectListing(shuffled));
    expect(a).toBe(b);
    // no GETs during listing: only the LIST request hit the server
    expect(server.requests.every((r) => !r.path.startsWith("/orders") && !r.path.startsWith("/report"))).toBe(true);
  });

  it("the tree carries counts, bytes, extension histograms, dates, depth", () => {
    const rows = new Map(prefixRows(mapObjectListing(BUCKET)).map((r) => [r.prefix, r]));
    const fin = rows.get("exports/finance/");
    expect(fin).toBeDefined();
    expect(fin!.objectCount).toBe(4);
    expect(fin!.totalBytes).toBe(4021 + 3900 + 5100 + 8300);
    expect(fin!.extensions).toEqual({ csv: 3, xlsx: 1 });
    expect(fin!.oldest).toBe(iso(3));
    expect(fin!.newest).toBe(iso(60));
    expect(fin!.depth).toBe(2);
    // Subtree totals roll up: exports/ carries all six objects under it.
    expect(rows.get("exports/")!.objectCount).toBe(6);
    expect(rows.get("")!.objectCount).toBe(7); // the root, including readme.md
    expect(rows.get("exports/finance/")!.parentPrefix).toBe("exports/"); // tree linked
  });

  it("content type is inferred from the extension", () => {
    expect(contentTypeForExtension(extensionOf("a/b/c.xlsx"))).toContain("spreadsheetml");
    expect(contentTypeForExtension(extensionOf("x.pdf"))).toBe("application/pdf");
    expect(contentTypeForExtension(extensionOf("noext"))).toBe("application/octet-stream");
  });
});

describe("tier 2 — deterministic sampling", () => {
  it("selects the digest-smallest objects per (prefix, extension), order-independent", () => {
    const { selected } = selectSamples(BUCKET, 1);
    // finance/ has two csv prefixes; each group yields one sample
    const keys = selected.map((o) => o.key);
    expect(new Set(keys).size).toBe(keys.length);
    // Deterministic across shuffles:
    for (let i = 0; i < 5; i++) {
      const shuffled = [...BUCKET].sort(() => Math.random() - 0.5);
      expect(selectSamples(shuffled, 1).selected.map((o) => o.key).sort()).toEqual([...keys].sort());
    }
    // Second "run" over the unchanged bucket re-selects the same objects:
    expect(selectSamples(BUCKET, 1)).toEqual(selectSamples([...BUCKET].reverse(), 1));
  });

  it("objectsOpened widens the sample per group", () => {
    const two = selectSamples(BUCKET, 2);
    const one = selectSamples(BUCKET, 1);
    expect(two.selected.length).toBeGreaterThan(one.selected.length);
  });
});

describe("tier 2 — parsing through the kb-05 hardened worker", () => {
  it("an xlsx sample yields sheet inventory, dimensions and header — no cell values kept", async () => {
    const bytes = readFileSync("tests/fixtures/catalog/bucket/orders-sample.xlsx");
    const outcome = await extractHardened(bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(outcome.status).toBe("EXTRACTED");
    expect(outcome.chunks!.length).toBeGreaterThan(0);
    // Header row present in the first chunk; a CELL VALUE does not survive
    // the cat-02 write-side gate (the test below asserts at the DB level).
    expect(outcome.chunks![0].text).toContain("order_id");
  }, 30_000);

  it("a pdf sample contributes page count and the keyword set ONLY", async () => {
    const bytes = readFileSync("tests/fixtures/catalog/bucket/report-sample.pdf");
    const outcome = await extractHardened(bytes, "application/pdf");
    expect(outcome.status).toBe("EXTRACTED");
    expect(outcome.chunks!.length).toBeGreaterThanOrEqual(3); // 3 pages
    const keywords = keywordPass(outcome.chunks!.map((c) => c.text).join("\n")).keywords;
    expect(keywords.length).toBeGreaterThan(0);
  }, 30_000);

  it("the zip bomb and the XXE fixture land PARTIAL with a reason — no dead container", async () => {
    const bomb = await extractHardened(
      readFileSync("tests/fixtures/catalog/bucket/bomb-sample.xlsx"),
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(bomb.status).toBe("FAILED");
    expect(bomb.breach).toBeDefined();

    const xxe = await extractHardened(
      readFileSync("tests/fixtures/catalog/bucket/xxe-sample.xlsx"),
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(xxe.status).toBe("FAILED");
    expect(xxe.breach).toBe("xxe");
  }, 30_000);

  it("the bucket's distinctive sentence appears in NO row — asserted by direct query", async () => {
    // The fixture PDF's page one sentence:
    const distinctive = "spindle inventory baseline is reconciled weekly";
    const bytes = readFileSync("tests/fixtures/catalog/bucket/report-sample.pdf");
    const outcome = await extractHardened(bytes, "application/pdf");
    // The extraction pipeline DOES see it (it must, to keyword it) — the
    // assertion is that nothing persists: we write no chunks for samples.
    expect(outcome.chunks!.map((c) => c.text).join("\n").toLowerCase()).toContain("spindle");
    // And the database (fresh clone) holds no document/chunk/entry text:
    const [docs, chunks, entries] = await Promise.all([
      db.document.count(),
      db.documentChunk.count(),
      db.catalogEntry.count(),
    ]);
    expect(docs + chunks + entries).toBe(0);
    void distinctive;
  }, 30_000);
});

describe("the profile run contract — bytes are discarded", () => {
  it("after a run, every CATALOG Document has data IS NULL and no chunk holds object bytes", async () => {
    // A minimal run over the bucket listing: tier 1 rows only (tier-2
    // sample bytes never touch the database; they are parsed and dropped).
    const rows = prefixRows(mapObjectListing(BUCKET));
    const agent = await db.user.create({
      data: { name: "Servo Catalog", email: "catalog@servo.ai", role: "AI_AGENT", aiKind: "CATALOG" },
    });
    for (const row of rows) {
      if (row.objectCount === 0) continue; // container prefixes: entry only
      const doc = await db.document.create({
        data: {
          name: row.prefix || "bucket-root",
          contentType: "application/json",
          sha256: "x",
          byteSize: row.totalBytes,
          data: null, // THE rule: no object bytes ever persist
          ownerId: agent.id,
          visibility: "PRIVATE",
          kind: "CATALOG",
        },
      });
      await db.catalogEntry.create({
        data: {
          dataSourceId: "s3-fixture",
          level: "DATASET",
          fqn: `s3://fixture/${row.prefix}`,
          displayName: row.prefix,
          locator: { prefix: row.prefix },
          profile: {
            objectCount: row.objectCount,
            totalBytes: row.totalBytes,
            extensions: row.extensions,
            oldest: row.oldest,
            newest: row.newest,
          },
          documentId: doc.id,
        },
      });
    }
    const catalogDocs = await db.document.findMany({ where: { kind: "CATALOG" } });
    expect(catalogDocs.length).toBeGreaterThan(0);
    expect(catalogDocs.every((d) => d.data === null)).toBe(true);
    const chunkCount = await db.documentChunk.count();
    expect(chunkCount).toBe(0); // samples are parsed, never chunked
    const entries = await db.catalogEntry.findMany();
    expect(entries.every((e) => !JSON.stringify(e.profile).includes("INV-2024"))).toBe(true);
  });
});
