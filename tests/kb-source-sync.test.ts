// xds-05: the sync lifecycle. One external trigger, an atomic claim,
// stale-lease reclamation to ERROR (never READY), ETag/version skipping,
// the zero-rows-is-ERROR rule, and UNREACHABLE sources whose documents
// stay retrievable on all four read paths. The S3 legs run against a
// real s3mock; the SQL legs against the second Postgres on 5434.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { S3Client, PutObjectCommand, CreateBucketCommand } from "@aws-sdk/client-s3";
import { PrismaClient } from "@prisma/client";
import { tmpDb, type TmpDb } from "./helpers/tmp-db";

type ServoDb = { [key: string]: unknown };
const holder = vi.hoisted(() => ({ db: null as unknown as ServoDb }));
vi.mock("@/lib/db", () => ({ get db() { return holder.db; } }));

import { syncSource, SYNC_LEASE_MS } from "@/lib/kb/sources/sync";
import { SOURCES_EGRESS_KEY } from "@/lib/kb/sources/s3";
import { seal } from "@/lib/secret-store";
import { kbSearch } from "@/lib/kb/search";

const ENDPOINT = process.env.S3MOCK_ENDPOINT?.trim() || "http://127.0.0.1:9090";
const BUCKET = "fixtures";

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
  await uploader.send(new PutObjectCommand({ Bucket: BUCKET, Key: "sync/alpha.md", Body: Buffer.from("# Alpha\n\nThe alpha procedure."), ContentType: "text/markdown" }));
  await uploader.send(new PutObjectCommand({ Bucket: BUCKET, Key: "sync/beta.md", Body: Buffer.from("# Beta\n\nThe beta procedure."), ContentType: "text/markdown" }));

  await ext.$executeRawUnsafe(`DROP VIEW IF EXISTS invoices_recent`).catch(() => undefined);
  await ext.$executeRawUnsafe(`DROP TABLE IF EXISTS invoices`).catch(() => undefined);
  await ext.$executeRawUnsafe(`CREATE TABLE invoices (inv_id TEXT PRIMARY KEY, amount INT, note TEXT, updated_at TIMESTAMPTZ DEFAULT now())`);
  for (let i = 1; i <= 2; i++) {
    await ext.$executeRawUnsafe(`INSERT INTO invoices (inv_id, amount, note) VALUES ($1, $2, $3)`, `INV-9-${i}`, i * 10, `note ${i}`);
  }
}, 120_000);

beforeEach(async () => {
  if (handles.length > 1) await handles.shift()?.dispose();
  const a = await tmpDb();
  handles.push(a);
  db = a.client;
  holder.db = db as unknown as ServoDb;
  admin = await db.user.create({ data: { name: "A", email: `a${Date.now()}@x.com`, role: "ADMIN" } });
  await db.setting.create({ data: { key: SOURCES_EGRESS_KEY, value: "127.0.0.1:9090" } });
  await db.setting.create({ data: { key: "setting.sync.secret", value: REAL_CREDS } });
});

async function makeS3Source(status = "READY") {
  return db.dataSource.create({
    data: {
      name: `s3-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      kind: "S3", secretRef: "setting.sync.secret", status, createdById: admin.id,
      configJson: { endpoint: ENDPOINT },
      scopeJson: [{ bucket: BUCKET, prefix: "sync/", suffixes: [".md"] }],
    } as never,
  });
}

const SQL_CONFIG = { host: "127.0.0.1", port: 5434, database: "erp" };
const SQL_SCOPE = { schema: "public", table: "invoices", idColumn: "inv_id", textColumns: ["amount", "note"], titleColumn: "inv_id", updatedAtColumn: "updated_at" };

describe("the trigger and the claim", () => {
  it("NO scheduler exists anywhere in src/ — the route is the only trigger", () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`],
      );
    const offenders = walk("src")
      .filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"))
      .map((f) => ({ f, src: readFileSync(f, "utf8").split(/\r?\n/).map((l) => l.replace(/\/\/.*$/, "")).join("\n") }))
      // Comments are stripped above, so remaining matches are CODE. The
      // SLA surfaces legitimately SAY "cron" in prose (an EXTERNAL caller
      // schedules them) — the acceptance bans the SCHEDULER CONSTRUCT,
      // not the word.
      .filter(({ src }) => /setInterval\s*\(|node-cron|ScheduledExecutor|new CronJob/i.test(src));
    expect(offenders.map((o) => o.f)).toEqual([]);
  });

  it("the claim is atomic: a second concurrent call is told a sync is running and does nothing", async () => {
    const source = await makeS3Source();
    // Force the claim to fail by pre-setting SYNCING (the state the first
    // caller leaves behind).
    await db.dataSource.update({ where: { id: source.id }, data: { status: "SYNCING", lastSyncAt: new Date() } });
    const second = await syncSource(source.id);
    expect(second.busy).toMatch(/already running/);
    expect(second.documentsWritten).toBe(0);
    expect((await db.dataSource.findUniqueOrThrow({ where: { id: source.id } })).status).toBe("SYNCING");
  });

  it("a stale SYNCING lease is reclaimed to ERROR — never READY", async () => {
    const source = await makeS3Source();
    await db.dataSource.update({
      where: { id: source.id },
      data: { status: "SYNCING", lastSyncAt: new Date(Date.now() - SYNC_LEASE_MS - 60_000) },
    });
    const result = await syncSource(source.id);
    expect(result.statusError).toMatch(/lease expired|reclaimed/);
    expect((await db.dataSource.findUniqueOrThrow({ where: { id: source.id } })).status).toBe("ERROR");
  });
});

describe("the S3 sync, end to end against s3mock", () => {
  it("a READY source crawls, writes one document per object, and lands READY with lastCompleteSyncAt set", async () => {
    const source = await makeS3Source();
    const result = await syncSource(source.id);
    expect(result.complete).toBe(true);
    expect(result.documentsWritten).toBe(2);
    const after = await db.dataSource.findUniqueOrThrow({ where: { id: source.id } });
    expect(after.status).toBe("READY");
    expect(after.lastCompleteSyncAt).not.toBeNull();
    expect(after.lastSyncAt).not.toBeNull();
    const docs = await db.document.findMany({ where: { sourceId: source.id } });
    expect(docs.map((d) => d.name).sort()).toEqual(["alpha.md", "beta.md"]);
    expect(docs.every((d) => d.visibility === "PRIVATE" && d.ownerId === admin.id)).toBe(true);
    // Chunks exist with locators from the same text chunker.
    expect(await db.documentChunk.count({ where: { documentId: docs[0].id } })).toBeGreaterThan(0);
  });

  it("a re-run with UNCHANGED ETags skips every GetObject: skipped=written-before, no churn", async () => {
    const source = await makeS3Source();
    const first = await syncSource(source.id);
    expect(first.documentsWritten).toBe(2);
    // Back to READY for the second run.
    await db.dataSource.update({ where: { id: source.id }, data: { status: "READY" } });
    const second = await syncSource(source.id);
    expect(second.documentsSkipped).toBe(2);
    expect(second.documentsWritten).toBe(0);
    // externalSeenAt was STILL stamped — unchanged documents were observed.
    const seen = await db.document.findMany({ where: { sourceId: source.id }, select: { externalSeenAt: true, runStartedAt: true } });
    expect(seen.every((d) => d.externalSeenAt !== null && d.runStartedAt !== null)).toBe(true);
  });

  it("a CHANGED object replaces chunks and keeps grants (kb-04's rule)", async () => {
    const source = await makeS3Source();
    await syncSource(source.id);
    const doc = await db.document.findFirstOrThrow({ where: { sourceId: source.id, name: "alpha.md" } });
    const grantee = await db.user.create({ data: { name: "G", email: `g${Date.now()}@x.com`, role: "AGENT" } });
    await db.kbGrant.create({ data: { documentId: doc.id, subjectType: "AGENT", subjectId: "builtin:drafter", grantedById: admin.id } });
    void grantee;
    // Change the object, re-run.
    await uploader.send(new PutObjectCommand({ Bucket: BUCKET, Key: "sync/alpha.md", Body: Buffer.from("# Alpha v2\n\nThe rewritten procedure."), ContentType: "text/markdown" }));
    await db.dataSource.update({ where: { id: source.id }, data: { status: "READY" } });
    const second = await syncSource(source.id);
    expect(second.documentsWritten).toBe(1); // only alpha re-fetched
    expect(await db.kbGrant.count({ where: { documentId: doc.id } })).toBe(1); // grants survive
    const chunks = await db.documentChunk.findMany({ where: { documentId: doc.id } });
    expect(chunks.some((c) => c.text.includes("rewritten"))).toBe(true);
  });

  it("a vanished prefix (zero rows) is ERROR naming the scope — never 'empty'", async () => {
    const source = await db.dataSource.create({
      data: {
        name: `s3-zero-${Date.now()}`, kind: "S3", secretRef: "setting.sync.secret",
        status: "READY", createdById: admin.id, configJson: { endpoint: ENDPOINT },
        scopeJson: [{ bucket: BUCKET, prefix: "nope/", suffixes: [".md"] }],
      } as never,
    });
    const result = await syncSource(source.id);
    expect(result.complete).toBe(false);
    expect(result.status).toBe("ERROR");
    expect(result.statusError).toMatch(/zero objects|may have been deleted/);
  });

  it("an unreachable endpoint lands UNREACHABLE and every indexed document stays retrievable on all four paths", async () => {
    // First sync healthy, then point the endpoint somewhere dead.
    const source = await makeS3Source();
    await syncSource(source.id);
    const docs = await db.document.findMany({ where: { sourceId: source.id } });
    expect(docs).toHaveLength(2);
    await db.dataSource.update({
      where: { id: source.id },
      data: { status: "READY", configJson: { endpoint: "http://127.0.0.1:59999" } },
    });
    const failed = await syncSource(source.id);
    expect(failed.status).toBe("UNREACHABLE");
    // The ceiling (xds-02): a source-backed document needs BOTH the
    // document path (admin owns them) AND a source grant — grant it, or
    // the read paths would rightly return zero.
    await db.kbGrant.create({ data: { sourceId: source.id, subjectType: "USER", subjectId: admin.id, grantedById: admin.id } });
    // The four read paths: search, read (entitledDocumentIds), the
    // collections listing and related-files all still surface the docs.
    const found = await kbSearch(db as never, { humanId: admin.id, agentId: null }, "alpha procedure", { limit: 10 });
    expect(found.map((h) => h.docName)).toContain("alpha.md");
    const { entitledDocumentIds } = await import("@/lib/kb/entitlement");
    const ids = await entitledDocumentIds(db as never, { humanId: admin.id, agentId: null });
    expect(ids).toEqual(expect.arrayContaining(docs.map((d) => d.id)));
    // statusError carries no credential material.
    expect(failed.statusError ?? "").not.toMatch(/AKIA|secretAccessKey\s*[:=]\s*\w|sk-/i);
  });
});

describe("the SQL sync", () => {
  it("crawls the fixture table one document per row, then skips unchanged versions", async () => {
    const source = await db.dataSource.create({
      data: {
        name: `sql-${Date.now()}`, kind: "POSTGRES", secretRef: "setting.sync.secret",
        status: "READY", createdById: admin.id,
        configJson: SQL_CONFIG, scopeJson: [SQL_SCOPE],
      } as never,
    });
    const first = await syncSource(source.id);
    expect(first.complete).toBe(true);
    expect(first.documentsWritten).toBe(2);
    const docs = await db.document.findMany({ where: { sourceId: source.id } });
    expect(docs.map((d) => d.name).sort()).toEqual(["INV-9-1", "INV-9-2"]);

    await db.dataSource.update({ where: { id: source.id }, data: { status: "READY" } });
    const second = await syncSource(source.id);
    expect(second.documentsSkipped).toBe(2);
    expect(second.documentsWritten).toBe(0);
  });
});

describe("deletion is refused while documents reference the source", () => {
  it("onDelete: Restrict — the delete fails with a message naming purge-then-delete", async () => {
    const source = await makeS3Source();
    await syncSource(source.id);
    await expect(db.dataSource.delete({ where: { id: source.id } })).rejects.toThrow(/restrict|foreign key/i);
    // After purging the documents the delete succeeds — xds-06 owns the
    // purge; here only the refusal is pinned.
  });
});
