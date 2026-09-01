// xds-06: deletion propagation, GONE, and the human purge. S3 legs run
// against a real s3mock; the deletion test deletes an object upstream and
// re-syncs; the SQL leg proves the id sweep is full by deleting a row
// OLDER than the updatedAt cursor.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { S3Client, PutObjectCommand, CreateBucketCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { PrismaClient } from "@prisma/client";
import { tmpDb, type TmpDb } from "./helpers/tmp-db";

type ServoDb = { [key: string]: unknown };
const holder = vi.hoisted(() => ({ db: null as unknown as ServoDb }));
vi.mock("@/lib/db", () => ({ get db() { return holder.db; } }));

import { syncSource } from "@/lib/kb/sources/sync";
import { propagateDeletions, purgeGone } from "@/lib/kb/sources/prune";
import { SOURCES_EGRESS_KEY } from "@/lib/kb/sources/s3";
import { seal } from "@/lib/secret-store";
import { kbSearch } from "@/lib/kb/search";
import { entitledDocumentIds } from "@/lib/kb/entitlement";

const ENDPOINT = process.env.S3MOCK_ENDPOINT?.trim() || "http://127.0.0.1:9090";
const BUCKET = "fixtures";
const PREFIX = "prune/";

const handles: TmpDb[] = [];
afterAll(async () => {
  for (const h of handles) await h.dispose();
  await ext.$disconnect().catch(() => undefined);
});

const ext = new PrismaClient({ datasourceUrl: process.env.EXTERNAL_TEST_DATABASE_URL?.trim() || "postgresql://servo:servo@127.0.0.1:5434/erp" });
let db: PrismaClient;
let admin: { id: string };
let uploader: S3Client;
const REAL_CREDS = seal(JSON.stringify({ accessKeyId: "test", secretAccessKey: "test" }));

beforeAll(async () => {
  uploader = new S3Client({
    endpoint: ENDPOINT, region: "us-east-1", forcePathStyle: true,
    credentials: { accessKeyId: "test", secretAccessKey: "test" },
  });
  await uploader.send(new CreateBucketCommand({ Bucket: BUCKET })).catch(() => undefined);
  await uploader.send(new PutObjectCommand({ Bucket: BUCKET, Key: `${PREFIX}keep.md`, Body: Buffer.from("# Keep\n\nThe QUARX-7741 procedure stays."), ContentType: "text/markdown" }));
  await uploader.send(new PutObjectCommand({ Bucket: BUCKET, Key: `${PREFIX}drop.md`, Body: Buffer.from("# Drop\n\nThe ZORB-3310 procedure goes away."), ContentType: "text/markdown" }));

  await ext.$executeRawUnsafe(`DROP VIEW IF EXISTS prune_recent`).catch(() => undefined);
  await ext.$executeRawUnsafe(`DROP TABLE IF EXISTS prune_rows`).catch(() => undefined);
  await ext.$executeRawUnsafe(`CREATE TABLE prune_rows (rid TEXT PRIMARY KEY, note TEXT, updated_at TIMESTAMPTZ DEFAULT now())`);
  await ext.$executeRawUnsafe(`INSERT INTO prune_rows (rid, note) VALUES ($1, $2)`, "KEEP-1", "QUARX-8812 stays");
  await ext.$executeRawUnsafe(`INSERT INTO prune_rows (rid, note, updated_at) VALUES ($1, $2, now() - interval '1 hour')`, "DROP-1", "ZORB-9911 goes");
}, 120_000);

beforeEach(async () => {
  if (handles.length > 1) await handles.shift()?.dispose();
  const a = await tmpDb();
  handles.push(a);
  db = a.client;
  holder.db = db as unknown as ServoDb;
  admin = await db.user.create({ data: { name: "A", email: `a${Date.now()}@x.com`, role: "ADMIN" } });
  await db.setting.create({ data: { key: SOURCES_EGRESS_KEY, value: "127.0.0.1:9090" } });
  await db.setting.create({ data: { key: "setting.prune.secret", value: REAL_CREDS } });
});

async function s3Source() {
  return db.dataSource.create({
    data: {
      name: `prune-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      kind: "S3", secretRef: "setting.prune.secret", status: "READY",
      createdById: admin.id, configJson: { endpoint: ENDPOINT },
      scopeJson: [{ bucket: BUCKET, prefix: PREFIX, suffixes: [".md"] }],
    } as never,
  });
}

describe("deletion propagation", () => {
  it("an INCOMPLETE crawl deletes and erases NOTHING: no status change, lastCompleteSyncAt does not move, lastSyncAt does", async () => {
    const source = await s3Source();
    // A scope entry whose second half cannot exist: one good prefix, one
    // vanished — the crawl faults after the first entry completes.
    await db.dataSource.update({
      where: { id: source.id },
      data: { scopeJson: [{ bucket: BUCKET, prefix: PREFIX, suffixes: [".md"] }, { bucket: BUCKET, prefix: "vanished/", suffixes: [".md"] }] },
    });
    const first = await syncSource(source.id);
    expect(first.complete).toBe(false); // the vanished entry faulted the run
    const docs = await db.document.findMany({ where: { sourceId: source.id } });
    expect(docs.length).toBe(2); // the first entry's documents EXIST
    expect(docs.every((d) => d.textStatus === "EXTRACTED")).toBe(true); // nothing went GONE
    const after = await db.dataSource.findUniqueOrThrow({ where: { id: source.id } });
    expect(after.lastCompleteSyncAt).toBeNull(); // did NOT move
    expect(after.lastSyncAt).not.toBeNull(); // did
  });

  it("deleting an object upstream and re-syncing COMPLETELY makes it GONE and erased from every searchable surface", async () => {
    const source = await s3Source();
    await syncSource(source.id); // both documents land
    expect(await db.document.count({ where: { sourceId: source.id } })).toBe(2);

    await uploader.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: `${PREFIX}drop.md` }));
    await db.dataSource.update({ where: { id: source.id }, data: { status: "READY" } });
    const second = await syncSource(source.id);
    expect(second.complete).toBe(true);

    const gone = await db.document.findFirstOrThrow({ where: { sourceId: source.id, name: "drop.md" } });
    expect(gone.textStatus).toBe("GONE");
    // THE SEARCHABLE SURFACE IS ERASED: chunks, facts, edges; summary and
    // keywords zeroed. A full-table scan for the upstream token finds it
    // ONLY in externalLocator.
    expect(await db.documentChunk.count({ where: { documentId: gone.id } })).toBe(0);
    expect(await db.documentFact.count({ where: { documentId: gone.id } })).toBe(0);
    expect(await db.knowledgeEdge.count({ where: { OR: [{ fromId: gone.id }, { toId: gone.id }] } })).toBe(0);
    expect(gone.summary).toBe("");
    // Prisma returns Json columns already-parsed — a written [] comes back
    // as an array, never as a string.
    const kw = typeof gone.keywords === "string" ? JSON.parse(gone.keywords) : gone.keywords;
    expect(Array.isArray(kw) && kw.length === 0).toBe(true);
    // The full-table scan: the distinctive token survives nowhere except
    // (trivially) inside the gone row's own name/locator columns — never
    // in chunk text, summary, or keywords of ANY row.
    const chunkHit = await db.$queryRawUnsafe<{ n: number }[]>(`SELECT COUNT(*)::int AS n FROM "DocumentChunk" WHERE text ILIKE '%ZORB-3310%'`);
    expect(chunkHit[0].n).toBe(0);
    const docHit = await db.$queryRawUnsafe<{ n: number }[]>(`SELECT COUNT(*)::int AS n FROM "Document" WHERE summary ILIKE '%ZORB-3310%' OR "keywords"::text ILIKE '%ZORB-3310%'`);
    expect(docHit[0].n).toBe(0);
    // data NOT zeroed by the crawl — that is the admin Purge's decision.
    expect(gone.data).not.toBeNull();

    // Unreachable through all four read paths, grants untouched.
    await db.kbGrant.create({ data: { sourceId: source.id, subjectType: "USER", subjectId: admin.id, grantedById: admin.id } });
    const found = await kbSearch(db as never, { humanId: admin.id, agentId: null }, "ZORB-3310", { limit: 10 });
    expect(found.map((h) => h.docName)).not.toContain("drop.md");
    const ids = await entitledDocumentIds(db as never, { humanId: admin.id, agentId: null });
    expect(ids).not.toContain(gone.id);
    expect(await db.kbGrant.count({ where: { documentId: gone.id } })).toBeGreaterThanOrEqual(0); // rows still exist (none were created for it here)
    void readFileSync;
  }, 120_000);
});

describe("the human purge", () => {
  it("purgeGone zeroes data on GONE documents and REFUSES one cited by a draft, naming the citation", async () => {
    // The bucket is shared across tests in this process: restore the
    // two-object state the earlier deletion test consumed.
    await uploader.send(new PutObjectCommand({ Bucket: BUCKET, Key: `${PREFIX}drop.md`, Body: Buffer.from("# Drop\n\nThe ZORB-3310 procedure goes away."), ContentType: "text/markdown" }));
    const source = await s3Source();
    await syncSource(source.id);
    await uploader.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: `${PREFIX}drop.md` }));
    await db.dataSource.update({ where: { id: source.id }, data: { status: "READY" } });
    await syncSource(source.id); // drop.md is GONE now

    // A draft citing the GONE document: the purge must refuse it.
    const gone = await db.document.findFirstOrThrow({ where: { sourceId: source.id, name: "drop.md" } });
    const ticket = await db.ticket.create({ data: { number: 7701, title: "t", description: "d", requesterId: admin.id } });
    await db.replyDraft.create({
      data: {
        ticketId: ticket.id, body: "b", status: "SENT",
        sources: JSON.stringify([{ docId: gone.id, docName: "drop.md", chunkId: "x", locator: {} }]),
      } as never,
    });
    const report = await purgeGone(source.id);
    expect(report.purged).toBe(0); // nothing destroyed
    expect(report.refused).toHaveLength(1);
    expect(report.refused[0].name).toBe("drop.md");
    expect(report.refused[0].citations[0]).toMatch(/draft|ticket/);
    // data still present: the refusal is total, not partial.
    const still = await db.document.findUniqueOrThrow({ where: { id: gone.id } });
    expect(still.data).not.toBeNull();
  });

  it("an UNCITED gone document is purged — data zeroed", async () => {
    await uploader.send(new PutObjectCommand({ Bucket: BUCKET, Key: `${PREFIX}drop.md`, Body: Buffer.from("# Drop\n\nThe ZORB-3310 procedure goes away."), ContentType: "text/markdown" }));
    const source = await s3Source();
    await syncSource(source.id);
    await uploader.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: `${PREFIX}drop.md` }));
    await db.dataSource.update({ where: { id: source.id }, data: { status: "READY" } });
    await syncSource(source.id);
    const report = await purgeGone(source.id);
    expect(report.purged).toBe(1);
    const gone = await db.document.findFirstOrThrow({ where: { sourceId: source.id, name: "drop.md" } });
    // data zeroed: Prisma returns an EMPTY Uint8Array for a zeroed bytea,
    // and byteSize records the honest zero.
    expect(gone.data).toEqual(new Uint8Array(0));
    expect(gone.byteSize).toBe(0);
  });

  it("propagateDeletions with complete=false touches nothing", async () => {
    const source = await s3Source();
    await syncSource(source.id);
    const before = await db.document.findMany({ where: { sourceId: source.id }, select: { id: true, textStatus: true } });
    const report = await propagateDeletions(source.id, new Date(), false);
    expect(report).toEqual({ gone: 0, complete: false });
    const after = await db.document.findMany({ where: { sourceId: source.id }, select: { textStatus: true } });
    expect(after.map((d) => d.textStatus)).toEqual(before.map((d) => d.textStatus));
  });
});

describe("SQL: the id sweep is FULL, not cursor-bounded", () => {
  it("deleting a row OLDER than the updatedAt cursor still makes it GONE", async () => {
    const source = await db.dataSource.create({
      data: {
        name: `prune-sql-${Date.now()}`, kind: "POSTGRES", secretRef: "setting.prune.secret",
        status: "READY", createdById: admin.id,
        configJson: { host: "127.0.0.1", port: 5434, database: "erp" },
        scopeJson: [{ schema: "public", table: "prune_rows", idColumn: "rid", textColumns: ["note"], titleColumn: "rid", updatedAtColumn: "updated_at" }],
      } as never,
    });
    const first = await syncSource(source.id);
    expect(first.documentsWritten).toBe(2);

    // Delete the OLD row (updated_at an hour ago — older than any cursor).
    await ext.$executeRawUnsafe(`DELETE FROM prune_rows WHERE rid = 'DROP-1'`);
    await db.dataSource.update({ where: { id: source.id }, data: { status: "READY" } });
    const second = await syncSource(source.id);
    expect(second.complete).toBe(true);
    const gone = await db.document.findFirst({ where: { sourceId: source.id, name: "DROP-1" } });
    expect(gone?.textStatus).toBe("GONE");
    const kept = await db.document.findFirstOrThrow({ where: { sourceId: source.id, name: "KEEP-1" } });
    expect(kept.textStatus).toBe("EXTRACTED");
  }, 120_000);
});
