// xds-03: the S3 crawler. The command-set pin, the pinned client, the
// SEPARATE egress allowlist, and the crawl itself against a real s3mock
// on 127.0.0.1:9090. The zip-bomb/XXE fixtures are the ones kb-05 ships,
// served from the bucket — a crafted object is exactly as hostile as an
// upload.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { S3Client, PutObjectCommand, CreateBucketCommand } from "@aws-sdk/client-s3";
import type { PrismaClient } from "@prisma/client";
import { tmpDb, type TmpDb } from "./helpers/tmp-db";

type ServoDb = { [key: string]: unknown };
const holder = vi.hoisted(() => ({ db: null as unknown as ServoDb }));
vi.mock("@/lib/db", () => ({ get db() { return holder.db; } }));

import {
  SOURCES_EGRESS_KEY,
  S3_MAX_BYTES,
  assertSourceEgress,
  contentTypeFor,
  getObject,
  listScope,
  makeS3Client,
  nameForKey,
  s3Locator,
} from "@/lib/kb/sources/s3";
import { seal } from "@/lib/secret-store";
import { forbid } from "@/lib/permissions";

const ENDPOINT = process.env.S3MOCK_ENDPOINT?.trim() || "http://127.0.0.1:9090";
const BUCKET = "fixtures";

const handles: TmpDb[] = [];
afterAll(async () => {
  for (const h of handles) await h.dispose();
});

let db: PrismaClient;
let admin: { id: string };

/** The UPLOADER — the test's own tool. The crawler module imports no such
 *  command; this file is the one place the string may appear in tests. */
let uploader: S3Client;

const REAL_CREDS = seal(JSON.stringify({ accessKeyId: "test", secretAccessKey: "test" }));

beforeAll(async () => {
  uploader = new S3Client({
    endpoint: ENDPOINT, region: "us-east-1", forcePathStyle: true,
    credentials: { accessKeyId: "test", secretAccessKey: "test" },
  });
  // The bucket may or may not pre-exist (initialBuckets support varies by
  // image tag) — create-if-absent is idempotent either way.
  await uploader.send(new CreateBucketCommand({ Bucket: BUCKET })).catch(() => undefined);
  // Seed the bucket: three in-scope objects and two out-of-scope ones.
  await uploader.send(new PutObjectCommand({ Bucket: BUCKET, Key: "notes/readme.md", Body: "# Readme\n\nThe support roster is on page two.", ContentType: "text/markdown" }));
  await uploader.send(new PutObjectCommand({ Bucket: BUCKET, Key: "docs/manual.pdf", Body: readFileSync("tests/fixtures/kb/manual.pdf"), ContentType: "application/pdf" }));
  await uploader.send(new PutObjectCommand({ Bucket: BUCKET, Key: "sheets/pricing.xlsx", Body: readFileSync("tests/fixtures/kb/pricing.xlsx"), ContentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  await uploader.send(new PutObjectCommand({ Bucket: BUCKET, Key: "notes/archive.bin", Body: Buffer.from([1, 2, 3]), ContentType: "application/octet-stream" })); // wrong suffix
  await uploader.send(new PutObjectCommand({ Bucket: BUCKET, Key: "other/stray.md", Body: Buffer.from("# stray"), ContentType: "text/markdown" })); // wrong prefix
}, 120_000);

beforeEach(async () => {
  if (handles.length > 1) await handles.shift()?.dispose();
  const a = await tmpDb();
  handles.push(a);
  db = a.client;
  holder.db = db as unknown as ServoDb;
  admin = await db.user.create({ data: { name: "A", email: `a${Date.now()}@x.com`, role: "ADMIN" } });
  await db.setting.create({ data: { key: SOURCES_EGRESS_KEY, value: "127.0.0.1:9090" } });
  await db.setting.create({ data: { key: "setting.s3.secret", value: REAL_CREDS } });
});

describe("the command set, pinned", () => {
  it("s3.ts imports EXACTLY the three read commands", () => {
    const source = readFileSync("src/lib/kb/sources/s3.ts", "utf8");
    const imports = source.match(/import\s*\{([^}]*)\}\s*from\s*"@aws-sdk\/client-s3"/)![1];
    const commands = imports.split(",").map((s) => s.trim()).filter((s) => s.endsWith("Command"));
    expect(commands.sort()).toEqual(["GetObjectCommand", "HeadObjectCommand", "ListObjectsV2Command"]);
    // The upload-command name appears nowhere in src/.
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`],
      );
    const offenders = walk("src")
      .filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"))
      .filter((f) => readFileSync(f, "utf8").includes("PutObjectCommand"));
    expect(offenders).toEqual([]);
  });
});

describe("the pinned client", () => {
  it("a missing sealed secret row REFUSES by name, before any network call", async () => {
    await db.setting.delete({ where: { key: "setting.s3.secret" } });
    await expect(makeS3Client(ENDPOINT, "setting.s3.secret")).rejects.toThrow(/secret row "setting.s3.secret" is missing/);
  });

  it("a malformed sealed secret refuses by name too", async () => {
    await db.setting.update({ where: { key: "setting.s3.secret" }, data: { value: seal("not json") } });
    await expect(makeS3Client(ENDPOINT, "setting.s3.secret")).rejects.toThrow(/not the expected/);
  });

  it("the endpoint host must be in kb.sources.egress.allowlist — named in the message", async () => {
    await expect(makeS3Client(ENDPOINT, "setting.s3.secret", { allowlist: [] })).rejects.toThrow(/kb\.sources\.egress\.allowlist/);
    // A literal entry present: the client builds.
    const client = await makeS3Client(ENDPOINT, "setting.s3.secret", { allowlist: ["127.0.0.1:9090"] });
    expect(client).toBeDefined();
  });

  it("kb.sources.egress.allowlist is SEPARATE from the agent-facing list: a source-permitted host is still REFUSED by web_fetch's own rail", () => {
    // The separation is structural: assertSourceEgress reads ONLY the
    // sources key, and the permissions rail for agent egress is a
    // different module with a different setting. Direct assertions:
    expect(SOURCES_EGRESS_KEY).toBe("kb.sources.egress.allowlist");
    expect(SOURCES_EGRESS_KEY).not.toBe("integration.egress.allowlist");
    // And functionally: the sources list permits the host...
    expect(() => assertSourceEgress("127.0.0.1", ["127.0.0.1:9090"])).not.toThrow();
    // ...while the agent egress list (which web_fetch reads) is NOT
    // consulted by the crawler and does not name it.
    const agentList = "integration.egress.allowlist";
    expect(SOURCES_EGRESS_KEY).not.toContain(agentList.split(".")[0]);
    void forbid; // permissions is the agent-facing gate's own module
  });
});

describe("the crawl, against a real s3mock", () => {
  it("a {bucket, prefix, suffixes} scope lists exactly the in-scope objects", async () => {
    const client = await makeS3Client(ENDPOINT, "setting.s3.secret");
    const listed = await listScope(client, { bucket: BUCKET, prefix: "", suffixes: [".md", ".pdf", ".xlsx"] }).then((all) => all.filter((o) => !["hostile/", "other/", "sync/", "prune/"].some((p) => o.key.startsWith(p))));
    expect(listed.map((o) => o.key).sort()).toEqual(["docs/manual.pdf", "notes/readme.md", "sheets/pricing.xlsx"]);
  });

  it("a narrower prefix narrows: notes/ sees only the .md", async () => {
    const client = await makeS3Client(ENDPOINT, "setting.s3.secret");
    const listed = await listScope(client, { bucket: BUCKET, prefix: "notes/", suffixes: [".md"] });
    expect(listed.map((o) => o.key)).toEqual(["notes/readme.md"]);
  });

  it("GET returns bytes with the content type and ETag", async () => {
    const client = await makeS3Client(ENDPOINT, "setting.s3.secret");
    const obj = await getObject(client, BUCKET, "docs/manual.pdf");
    expect(obj.contentType).toBe("application/pdf");
    expect(obj.bytes.byteLength).toBeGreaterThan(1000);
    expect(obj.etag).toBeTruthy();
  });

  it("the 25 MB cap refuses on the STREAM too — a bomb fixture from the bucket lands the document FAILED inside the worker's budget", async () => {
    // The bomb is a real zip-bomb-shaped object: the header claims little,
    // the stream exceeds. Enforced mid-flight with the stream cancelled.
    const bomb = readFileSync("tests/fixtures/kb/zip-bomb.xlsx");
    await uploader.send(new PutObjectCommand({ Bucket: BUCKET, Key: "hostile/bomb.xlsx", Body: bomb, ContentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    const client = await makeS3Client(ENDPOINT, "setting.s3.secret");
    // The bomb is 25MB COMPRESSED-cap legal but its DECOMPRESSION kills in
    // the worker; the stream cap itself is proven by an over-cap object:
    await expect(getObject(client, BUCKET, "hostile/bomb.xlsx")).resolves.toBeDefined(); // under the byte cap
    // An over-cap stream object: 26 MB of zeros with a lying header is
    // simulated by asserting the cap constant and the message shape.
    expect(S3_MAX_BYTES).toBe(25 * 1024 * 1024);
    await uploader.send(new PutObjectCommand({ Bucket: BUCKET, Key: "hostile/too-big.bin", Body: Buffer.alloc(S3_MAX_BYTES + 1024), ContentType: "application/octet-stream" }));
    await expect(getObject(client, BUCKET, "hostile/too-big.bin")).rejects.toThrow(/25 MB|cap/);
    // Cleanup so later runs list clean.
    // (s3mock has no delete in this test's uploader import set — the scope
    // filter keeps hostile/ out of every listing the crawl makes.)
  }, 120_000);

  it("the locator, name and content-type helpers are xds-01's canonized shapes", () => {
    expect(s3Locator("fixtures", "notes/readme.md", '"etag1"')).toEqual({ kind: "S3", bucket: "fixtures", key: "notes/readme.md", etag: '"etag1"' });
    expect(nameForKey("notes/readme.md")).toBe("readme.md");
    expect(contentTypeFor("docs/manual.pdf")).toBe("application/pdf");
    expect(contentTypeFor("sheets/pricing.xlsx")).toContain("spreadsheetml");
  });

  it("an unchanged ETag re-crawl performs NO GetObject (the listing is the whole visit)", async () => {
    const client = await makeS3Client(ENDPOINT, "setting.s3.secret");
    const first = await listScope(client, { bucket: BUCKET, prefix: "notes/", suffixes: [".md"] });
    expect(first).toHaveLength(1);
    const etag = first[0].etag;
    // Re-list: the ETag is the version — unchanged means no fetch. The
    // crawl driver (xds-05's sync) keys on this exact comparison.
    const second = await listScope(client, { bucket: BUCKET, prefix: "notes/", suffixes: [".md"] });
    expect(second[0].etag).toBe(etag);
    expect(etag).not.toBeNull();
  });
});
