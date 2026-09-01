// xds-03: the S3 crawler in INDEX mode.
//
// Everything here runs against a REAL object store — adobe/s3mock on 9090,
// published by docker-compose.test.yml — and a real throwaway Postgres. A
// crawler whose only proof is a mocked SDK is a crawler that has never seen a
// socket, and the two properties this item exists for (the ambient credential
// chain is off, and the 25 MB cap holds against a store that lies about it)
// are both properties of what actually goes over the wire.
//
// The test SEEDS the bucket with a write command. That is deliberate and it is
// the reason the "no write path" criterion is scoped to `src/`: the crawler's
// import list is three read commands wide and a test below proves it, while
// the fixtures still have to get into the bucket somehow.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";
import { PrismaClient } from "@prisma/client";
import {
  CreateBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { tmpDb, type TmpDb } from "./helpers/tmp-db";

// Set before the module registry loads @/lib/secret-store, so the credential
// below travels the SEALED path rather than the legacy-plaintext one.
vi.hoisted(() => {
  process.env.SERVO_ENCRYPTION_KEY =
    "0000000000000000000000000000000000000000000000000000000000000001";
});

type ServoDb = { [key: string]: unknown };
const holder = vi.hoisted(() => ({
  db: null as unknown as ServoDb,
  user: null as unknown as { id: string; role: string },
}));
vi.mock("@/lib/db", () => ({ get db() { return holder.db; } }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: async () => holder.user }));

import {
  AMBIENT_CREDENTIALS_REFUSED,
  KB_SOURCES_EGRESS_KEY,
  MAX_OBJECT_BYTES,
  assertEndpointAllowed,
  buildS3Client,
  contentTypeForKey,
  crawlS3Scope,
  documentName,
  endpointHostPort,
  inScope,
  loadS3Credentials,
  normalizeEtag,
  overCapMessage,
  parseS3Secret,
  readCapped,
  refuseAmbientCredentials,
  s3ClientOptions,
  type S3ScopeEntry,
  type S3Target,
} from "@/lib/kb/sources/s3";
import { MAX_UPLOAD_BYTES } from "@/lib/kb/ingest";
import { SourceConfigError, sourceSecretKey } from "@/lib/kb/sources";
import { webTools } from "@/lib/ai/tools/web";
import { seal } from "@/lib/secret-store";
import { POST as createSource } from "@/app/api/kb/sources/route";

const S3_ENDPOINT = process.env.S3_TEST_ENDPOINT?.trim() || "http://127.0.0.1:9090";
const S3_HOST_PORT = new URL(S3_ENDPOINT).host; // "127.0.0.1:9090"
const CREDS = { accessKeyId: "servo-test", secretAccessKey: "servo-test-secret" };
const BUCKET = `xds03-${process.pid}`;

const handles: TmpDb[] = [];
let db: PrismaClient;
let admin: { id: string; role: string };
let seeder: S3Client;

/** A counting middleware: every command this client issues, by name. The
 *  "not fetched at all" and "no GetObject on an unchanged ETag" criteria are
 *  both request-count assertions, and a count is only honest if it comes from
 *  inside the client that made the requests. */
function counting(client: S3Client): Record<string, number> {
  const counts: Record<string, number> = {};
  client.middlewareStack.add(
    (next, context) => async (args) => {
      const name = String((context as { commandName?: string }).commandName ?? "?");
      counts[name] = (counts[name] ?? 0) + 1;
      return next(args);
    },
    { step: "initialize", name: `xds03-count-${Math.random().toString(36).slice(2)}` },
  );
  return counts;
}

async function put(key: string, body: Buffer): Promise<void> {
  await seeder.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body }));
}

/** A source row plus its sealed credential, ready to crawl. */
async function makeSource(
  name: string,
  opts: { secret?: string | null; config?: S3Target } = {},
): Promise<{ id: string; name: string; configJson: unknown; createdById: string }> {
  const row = await db.dataSource.create({
    data: {
      name,
      kind: "S3",
      configJson: (opts.config ?? { endpoint: S3_ENDPOINT, region: "us-east-1" }) as object,
      secretRef: "",
      scopeJson: [],
      status: "READY",
      createdById: admin.id,
    },
  });
  await db.dataSource.update({
    where: { id: row.id },
    data: { secretRef: sourceSecretKey(row.id) },
  });
  const secret = opts.secret === undefined ? JSON.stringify(CREDS) : opts.secret;
  if (secret !== null) {
    await db.setting.create({
      data: { key: sourceSecretKey(row.id), value: seal(secret) },
    });
  }
  return { id: row.id, name: row.name, configJson: row.configJson, createdById: admin.id };
}

async function allowlist(value: string): Promise<void> {
  await db.setting.upsert({
    where: { key: KB_SOURCES_EGRESS_KEY },
    create: { key: KB_SOURCES_EGRESS_KEY, value },
    update: { value },
  });
}

beforeAll(async () => {
  const handle = await tmpDb();
  handles.push(handle);
  db = handle.client;
  holder.db = db as unknown as ServoDb;
  admin = {
    ...(await db.user.create({ data: { name: "A", email: "a@x.com", role: "ADMIN" } })),
    role: "ADMIN",
  };
  holder.user = admin;

  seeder = buildS3Client({ endpoint: S3_ENDPOINT, region: "us-east-1" }, CREDS);
  await seeder.send(new CreateBucketCommand({ Bucket: BUCKET })).catch(() => undefined);
  await put("handbook/policy.md", readFileSync("tests/fixtures/s3/policy.md"));
  await put("handbook/manual.pdf", readFileSync("tests/fixtures/kb/manual.pdf"));
  await put("handbook/pricing.xlsx", readFileSync("tests/fixtures/kb/pricing.xlsx"));
  // Outside the suffix allowlist, inside the prefix.
  await put("handbook/notes.bin", Buffer.from("not a document"));
  // Outside the prefix entirely.
  await put("scratch/other.md", Buffer.from("# elsewhere\n"));
  // Hostile objects, in their own prefix so the happy-path crawl is clean.
  await put("hostile/zip-bomb.xlsx", readFileSync("tests/fixtures/kb/zip-bomb.xlsx"));
  await put("hostile/xxe.xlsx", readFileSync("tests/fixtures/kb/xxe.xlsx"));
  await allowlist(S3_HOST_PORT);
}, 120_000);

afterAll(async () => {
  for (const handle of handles) await handle.dispose();
});

const HANDBOOK: S3ScopeEntry = {
  bucket: BUCKET,
  prefix: "handbook/",
  suffixes: [".md", ".pdf", ".xlsx"],
};

// ---------------------------------------------------------------------------

describe("the import list IS the boundary", () => {
  const source = readFileSync("src/lib/kb/sources/s3.ts", "utf8");

  it("imports exactly ListObjectsV2Command, HeadObjectCommand and GetObjectCommand", () => {
    // Collected over EVERY import from ANY @aws-sdk / @smithy module, in
    // either quote style, plus require(). An earlier shape of this test
    // matched one double-quoted `from "@aws-sdk/client-s3"` block and counted
    // the `*Command` names inside it, which let a SECOND import — single
    // quotes, or a sibling package — carry any command at all past both
    // assertions. The set is the assertion now, not the block.
    const specifiers: string[] = [];
    const modules: string[] = [];
    const importRe =
      /import\s*(?:type\s*)?\{([\s\S]*?)\}\s*from\s*['"](@aws-sdk\/[^'"]+|@smithy\/[^'"]+|aws-sdk)['"]/g;
    for (const m of source.matchAll(importRe)) {
      modules.push(m[2]);
      for (const raw of m[1].split(",")) {
        const name = raw.trim().split(/\s+as\s+/)[0].trim();
        if (name) specifiers.push(name);
      }
    }
    // A default or namespace import, or a require(), would carry the whole
    // SDK surface past a named-specifier scan. None may exist.
    expect(source).not.toMatch(/import\s+(?:\*\s+as\s+)?[A-Za-z_$][\w$]*\s*(?:,|from)[^\n]*aws-sdk/);
    expect(source).not.toMatch(/require\(\s*['"](?:@aws-sdk|@smithy|aws-sdk)/);

    expect([...new Set(modules)]).toEqual(["@aws-sdk/client-s3"]);
    // The WHOLE specifier set, not just the `*Command` subset: the aggregated
    // `S3` client exposes every operation as a method, so admitting it by
    // name would open a write path this test could not see.
    expect([...specifiers].sort()).toEqual([
      "GetObjectCommand",
      "HeadObjectCommand",
      "ListObjectsV2Command",
      "S3Client",
    ]);
  });

  it("no write command appears anywhere in src/", () => {
    expect(execGrep()).toEqual([]);
  });
});

/** grep src/ for the write-command name, CASE-INSENSITIVELY — `putObject` is
 *  how the aggregated client spells the same operation, and a case-sensitive
 *  scan would walk past it. Spelled by concatenation so this test file's own
 *  source does not answer its own search if the scan is ever widened. */
function execGrep(): string[] {
  const { execFileSync } = require("node:child_process") as typeof import("node:child_process");
  const needle = "Put" + "Object";
  try {
    const out = execFileSync("grep", ["-ril", needle, "src"], { encoding: "utf8" });
    return out.split("\n").filter(Boolean);
  } catch {
    // grep exits 1 with no output when nothing matched — the passing case.
    return [];
  }
}

// ---------------------------------------------------------------------------

describe("credentials are explicit and the ambient chain throws", () => {
  it("the same client options without explicit credentials refuse to resolve any", async () => {
    const options = s3ClientOptions({ endpoint: S3_ENDPOINT }, CREDS);
    const withoutExplicit = new S3Client({ ...options, credentials: undefined });
    await expect(withoutExplicit.config.credentials()).rejects.toThrow(
      AMBIENT_CREDENTIALS_REFUSED,
    );
  });

  it("the provider itself throws, so nothing can resolve through it", async () => {
    await expect(refuseAmbientCredentials()()).rejects.toThrow(/ambient AWS credential chain/);
  });

  it("explicit credentials win over AWS_* in the environment", async () => {
    process.env.AWS_ACCESS_KEY_ID = "AMBIENT-SHOULD-NEVER-BE-USED";
    process.env.AWS_SECRET_ACCESS_KEY = "AMBIENT-SECRET";
    try {
      const client = buildS3Client({ endpoint: S3_ENDPOINT }, CREDS);
      const resolved = await client.config.credentials();
      expect(resolved.accessKeyId).toBe(CREDS.accessKeyId);
    } finally {
      delete process.env.AWS_ACCESS_KEY_ID;
      delete process.env.AWS_SECRET_ACCESS_KEY;
    }
  });

  it("with AWS_* set and the secret row missing, the crawl refuses and makes NO network call", async () => {
    process.env.AWS_ACCESS_KEY_ID = "AKIAIOSFODNN7EXAMPLE";
    process.env.AWS_SECRET_ACCESS_KEY = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
    const seen: string[] = [];
    const server = createServer((req, res) => {
      seen.push(req.url ?? "");
      res.statusCode = 200;
      res.end();
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as AddressInfo).port;
    try {
      await allowlist(`127.0.0.1:${port}`);
      const source = await makeSource("no-credential", {
        secret: null,
        config: { endpoint: `http://127.0.0.1:${port}` },
      });
      await expect(crawlS3Scope(source, { ...HANDBOOK, bucket: BUCKET })).rejects.toThrow(
        /No credential is stored/,
      );
      expect(seen).toEqual([]);
    } finally {
      delete process.env.AWS_ACCESS_KEY_ID;
      delete process.env.AWS_SECRET_ACCESS_KEY;
      await new Promise<void>((r) => server.close(() => r()));
      await allowlist(S3_HOST_PORT);
    }
  });

  it("a sealed credential round-trips, and a malformed one is refused by shape without echoing it", async () => {
    const source = await makeSource("sealed-cred");
    const row = await db.setting.findUniqueOrThrow({ where: { key: sourceSecretKey(source.id) } });
    expect(row.value.startsWith("enc:v1:")).toBe(true);
    expect(row.value).not.toContain(CREDS.secretAccessKey);
    expect(await loadS3Credentials(db as never, source)).toEqual({
      accessKeyId: "servo-test",
      secretAccessKey: "servo-test-secret",
    });

    expect(() => parseS3Secret("not json")).toThrow(/not JSON/);
    try {
      parseS3Secret(JSON.stringify({ accessKeyId: "k", secretAccessKey: "" }));
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as Error).message).toMatch(/missing accessKeyId or secretAccessKey/);
      expect((err as Error).message).not.toContain("k");
    }
  });
});

// ---------------------------------------------------------------------------

describe("the client is pinned to path style and follows no redirect", () => {
  it("forcePathStyle is on and region redirects are off", () => {
    const options = s3ClientOptions({ endpoint: S3_ENDPOINT }, CREDS);
    expect(options.forcePathStyle).toBe(true);
    expect(options.followRegionRedirects).toBe(false);
  });

  it("an HTTP redirect is NOT followed — the second host is never contacted", async () => {
    const target: string[] = [];
    const destination = createServer((req, res) => {
      target.push(req.url ?? "");
      res.statusCode = 200;
      res.end("<ListBucketResult></ListBucketResult>");
    });
    await new Promise<void>((r) => destination.listen(0, "127.0.0.1", r));
    const destPort = (destination.address() as AddressInfo).port;

    const redirector = createServer((req, res) => {
      res.statusCode = 302;
      res.setHeader("location", `http://127.0.0.1:${destPort}${req.url ?? "/"}`);
      res.end();
    });
    await new Promise<void>((r) => redirector.listen(0, "127.0.0.1", r));
    const redirPort = (redirector.address() as AddressInfo).port;

    try {
      await allowlist(`127.0.0.1:${redirPort}`);
      const source = await makeSource("redirector", {
        config: { endpoint: `http://127.0.0.1:${redirPort}` },
      });
      await expect(crawlS3Scope(source, { ...HANDBOOK, bucket: BUCKET })).rejects.toThrow();
      expect(target).toEqual([]);
    } finally {
      await new Promise<void>((r) => destination.close(() => r()));
      await new Promise<void>((r) => redirector.close(() => r()));
      await allowlist(S3_HOST_PORT);
    }
  }, 30_000);
});

// ---------------------------------------------------------------------------

describe("the data-source allowlist is its own, and deny-by-default", () => {
  it("is spelled kb.sources.egress.allowlist, and is not the agent-facing key", () => {
    // Pinned as a LITERAL: every other assertion in this file goes through the
    // exported constant, which would follow the name wherever it drifted to.
    expect(KB_SOURCES_EGRESS_KEY).toBe("kb.sources.egress.allowlist");
    expect(KB_SOURCES_EGRESS_KEY).not.toBe("integration.egress.allowlist");
    // And the crawler never READS the agent-facing one: it neither names it as
    // a string literal nor reaches it through egress.ts's own reader. (It does
    // discuss it in prose, which is why the assertion is on the quoted form
    // and on the imports, not on the word.)
    const crawler = readFileSync("src/lib/kb/sources/s3.ts", "utf8");
    expect(crawler).not.toMatch(/['"]integration\.egress\.allowlist['"]/);
    expect(crawler).not.toMatch(/getEgressConfig|EGRESS_SETTING_KEYS/);
  });

  it("an empty list refuses every endpoint, naming the setting", () => {
    try {
      assertEndpointAllowed({ endpoint: S3_ENDPOINT }, []);
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(SourceConfigError);
      expect((err as Error).message).toContain(KB_SOURCES_EGRESS_KEY);
    }
  });

  it("a literal entry admits the host; a different host is still refused", () => {
    expect(() => assertEndpointAllowed({ endpoint: S3_ENDPOINT }, [S3_HOST_PORT])).not.toThrow();
    expect(() =>
      assertEndpointAllowed({ endpoint: "http://10.9.9.9:9090" }, [S3_HOST_PORT]),
    ).toThrow(/10\.9\.9\.9/);
  });

  it("an absent endpoint resolves to the AWS regional host, so an entry can name it", () => {
    expect(endpointHostPort({ region: "eu-west-1" })).toEqual({
      host: "s3.eu-west-1.amazonaws.com",
      port: 443,
    });
  });

  it("the save is REFUSED while the host is absent from the list", async () => {
    await allowlist("");
    const res = await createSource(
      new Request("http://x/api/kb/sources", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "refused-source",
          kind: "S3",
          config: { endpoint: S3_ENDPOINT },
          scope: [],
        }),
      }) as never,
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain(KB_SOURCES_EGRESS_KEY);
    expect(await db.dataSource.findUnique({ where: { name: "refused-source" } })).toBeNull();
  });

  it("the same save SUCCEEDS once a literal entry is present", async () => {
    await allowlist(S3_HOST_PORT);
    const res = await createSource(
      new Request("http://x/api/kb/sources", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "allowed-source",
          kind: "S3",
          config: { endpoint: S3_ENDPOINT },
          scope: [],
        }),
      }) as never,
    );
    expect(res.status).toBe(201);
    expect(await db.dataSource.findUnique({ where: { name: "allowed-source" } })).not.toBeNull();
  });

  it("a source that names NO endpoint saves, and is then refused at CRAWL time", async () => {
    // The save-time check has nothing to validate when no endpoint is given —
    // that source points at AWS itself. The crawl derives the regional host
    // and refuses it, so the destination is unreachable either way; the
    // difference is only WHERE the operator is told.
    await allowlist(S3_HOST_PORT);
    const res = await createSource(
      new Request("http://x/api/kb/sources", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "aws-default", kind: "S3", config: {}, scope: [] }),
      }) as never,
    );
    expect(res.status).toBe(201);

    const source = await makeSource("aws-default-crawl", { config: { region: "us-east-1" } });
    await expect(crawlS3Scope(source, { bucket: "anything" })).rejects.toThrow(
      new RegExp(`s3\\.us-east-1\\.amazonaws\\.com[\\s\\S]*${KB_SOURCES_EGRESS_KEY}`),
    );
  });

  it("a host permitted for DATA SOURCES is still refused by web_fetch — asserted on the tool", async () => {
    // Not asserted by observing that two constants differ: the agent-facing
    // decision is taken by running the agent-facing tool, against the same
    // database, with the data-source list naming this host.
    await allowlist(S3_HOST_PORT);
    expect(
      await db.setting.findUnique({ where: { key: "integration.egress.allowlist" } }),
    ).toBeNull();

    const result = await webTools.fetch_url.execute(
      { url: `${S3_ENDPOINT}/${BUCKET}/handbook/policy.md` },
      { ticketId: "t", runId: "r", agentUser: admin as never } as never,
    );
    // The tool reports an egress refusal as the guard's own message.
    expect(result).toMatch(/^Blocked/);
    expect(result).toMatch(/private|reserved|internal|allowlist/i);
    // And nothing of the object came back through it.
    expect(result).not.toContain("Refund policy");
    // And the same object IS reachable to the crawler with that very list —
    // otherwise the assertion above would be satisfied by the store being
    // down rather than by the two lists being separate.
    const source = await makeSource("two-lists");
    const reached = await crawlS3Scope(source, {
      bucket: BUCKET,
      prefix: "handbook/",
      suffixes: [".md"],
    });
    expect(reached.fetched).toBe(1);
  }, 60_000);
});

// ---------------------------------------------------------------------------

describe("scope filtering happens before anything is fetched", () => {
  it("keeps only the prefix and the suffix list", () => {
    expect(inScope(HANDBOOK, "handbook/policy.md")).toBe(true);
    expect(inScope(HANDBOOK, "handbook/notes.bin")).toBe(false);
    expect(inScope(HANDBOOK, "scratch/other.md")).toBe(false);
  });

  it("an object outside the prefix or the suffix list is never headed and never fetched", async () => {
    const source = await makeSource("scope-filter");
    const client = buildS3Client(source.configJson as S3Target, CREDS);
    const counts = counting(client);
    const result = await crawlS3Scope(source, HANDBOOK, { client });

    expect(result.listed).toBe(3);
    // Three objects in scope: three heads, three gets. notes.bin and
    // scratch/other.md cost nothing beyond the listing they appeared in.
    expect(counts.HeadObjectCommand ?? 0).toBe(3);
    expect(counts.GetObjectCommand ?? 0).toBe(3);
    const names = (
      await db.document.findMany({ where: { sourceId: source.id }, select: { name: true } })
    ).map((d) => d.name);
    expect(names.sort()).toEqual(
      [
        documentName(BUCKET, "handbook/manual.pdf"),
        documentName(BUCKET, "handbook/policy.md"),
        documentName(BUCKET, "handbook/pricing.xlsx"),
      ].sort(),
    );
  }, 180_000);
});

// ---------------------------------------------------------------------------

describe("one Document per object, with the canonized shape", () => {
  let sourceId: string;

  beforeAll(async () => {
    const source = await makeSource("shape");
    sourceId = source.id;
    await crawlS3Scope(source, HANDBOOK);
  }, 180_000);

  it("carries sourceId, PRIVATE visibility, the source's creator, and the ETag as externalVersion", async () => {
    const docs = await db.document.findMany({ where: { sourceId }, orderBy: { name: "asc" } });
    expect(docs.length).toBe(3);
    for (const doc of docs) {
      expect(doc.visibility).toBe("PRIVATE");
      expect(doc.ownerId).toBe(admin.id);
      expect(doc.externalVersion).toBeTruthy();
      expect(doc.externalSeenAt).not.toBeNull();
      const locator = doc.externalLocator as Record<string, unknown>;
      expect(locator.kind).toBe("S3");
      expect(locator.bucket).toBe(BUCKET);
      expect(String(locator.key).startsWith("handbook/")).toBe(true);
      expect(locator.etag).toBe(doc.externalVersion);
      expect(doc.name).toBe(documentName(BUCKET, String(locator.key)));
    }
  });

  it("the xlsx keeps kb-06's {sheet, range} locators and the pdf keeps kb-07's {page}", async () => {
    const xlsx = await db.document.findFirstOrThrow({
      where: { sourceId, name: documentName(BUCKET, "handbook/pricing.xlsx") },
      include: { chunks: { orderBy: { index: "asc" } } },
    });
    expect(xlsx.textStatus).toBe("EXTRACTED");
    expect(xlsx.chunks.length).toBeGreaterThan(0);
    expect(xlsx.chunks[0].locator).toHaveProperty("sheet");
    expect(xlsx.chunks[0].locator).toHaveProperty("range");

    const pdf = await db.document.findFirstOrThrow({
      where: { sourceId, name: documentName(BUCKET, "handbook/manual.pdf") },
      include: { chunks: { orderBy: { index: "asc" } } },
    });
    expect(pdf.textStatus).toBe("EXTRACTED");
    expect(pdf.chunks.length).toBeGreaterThan(0);
    expect(pdf.chunks[0].locator).toHaveProperty("page");
  });

  it("the markdown object chunks and carries its text", async () => {
    const md = await db.document.findFirstOrThrow({
      where: { sourceId, name: documentName(BUCKET, "handbook/policy.md") },
      include: { chunks: true },
    });
    expect(md.textStatus).toBe("EXTRACTED");
    expect(md.contentType).toBe("text/markdown");
    expect(md.chunks.map((c) => c.text).join("\n")).toContain("Refund policy");
    expect(md.summary.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------

describe("re-crawl is incremental, and a change keeps grants", () => {
  it("an unchanged ETag performs no GetObject and no re-extraction", async () => {
    const source = await makeSource("incremental");
    const scope: S3ScopeEntry = { bucket: BUCKET, prefix: "handbook/", suffixes: [".md"] };
    await crawlS3Scope(source, scope);
    const first = await db.document.findFirstOrThrow({ where: { sourceId: source.id } });

    const client = buildS3Client(source.configJson as S3Target, CREDS);
    const counts = counting(client);
    const again = await crawlS3Scope(source, scope, { client });

    expect(again.skipped).toBe(1);
    expect(again.fetched).toBe(0);
    expect(counts.GetObjectCommand ?? 0).toBe(0);
    expect(counts.HeadObjectCommand ?? 0).toBe(0);

    const second = await db.document.findUniqueOrThrow({ where: { id: first.id } });
    expect(second.extractedAt?.getTime()).toBe(first.extractedAt?.getTime());
    // The generation stamp moves even though nothing else did — xds-06 reads
    // it, and an unchanged object that was not stamped reads as deleted.
    expect(second.externalSeenAt!.getTime()).toBeGreaterThan(first.externalSeenAt!.getTime());
  }, 180_000);

  it("a changed ETag replaces chunks and edges and KEEPS grants", async () => {
    const key = "changing/doc.md";
    await put(key, Buffer.from("# first\n\nalpha bravo charlie\n"));
    const source = await makeSource("changing");
    const scope: S3ScopeEntry = { bucket: BUCKET, prefix: "changing/", suffixes: [".md"] };
    // A neighbour sharing the FIRST version's vocabulary, so the crawled
    // document actually has an edge to lose. Without one, "edges are replaced"
    // is a vacuous assertion over an empty set.
    const neighbour = await db.document.create({
      data: {
        name: "neighbour.md",
        contentType: "text/markdown",
        sha256: "n",
        byteSize: 1,
        ownerId: admin.id,
        textStatus: "EXTRACTED",
      },
    });
    await db.documentChunk.create({
      data: {
        documentId: neighbour.id,
        index: 0,
        text: "alpha bravo charlie",
        locator: {},
        keywords: ["alpha", "bravo", "charlie"],
      },
    });
    await crawlS3Scope(source, scope);

    const before = await db.document.findFirstOrThrow({
      where: { sourceId: source.id },
      include: { chunks: true },
    });
    const edgesBefore = await db.knowledgeEdge.count({
      where: { OR: [{ fromId: before.id }, { toId: before.id }] },
    });
    expect(edgesBefore).toBeGreaterThan(0);
    await db.kbGrant.create({
      data: {
        documentId: before.id,
        subjectType: "USER",
        subjectId: admin.id,
        grantedById: admin.id,
      },
    });

    await put(key, Buffer.from("# second\n\ndelta echo foxtrot\n"));
    const result = await crawlS3Scope(source, scope);
    expect(result.fetched).toBe(1);

    const after = await db.document.findUniqueOrThrow({
      where: { id: before.id },
      include: { chunks: true },
    });
    expect(after.externalVersion).not.toBe(before.externalVersion);
    expect(after.chunks.map((c) => c.text).join("\n")).toContain("delta echo foxtrot");
    expect(after.chunks.map((c) => c.text).join("\n")).not.toContain("alpha bravo charlie");
    // The edge to the neighbour was built from the OLD text and is gone; the
    // grant, which is an access decision, survived the content update.
    const edgesAfter = await db.knowledgeEdge.findMany({
      where: { OR: [{ fromId: before.id }, { toId: before.id }] },
    });
    expect(
      edgesAfter.filter((e) => e.fromId === neighbour.id || e.toId === neighbour.id),
    ).toEqual([]);
    expect(await db.kbGrant.count({ where: { documentId: before.id } })).toBe(1);
  }, 180_000);
});

// ---------------------------------------------------------------------------

describe("a crafted object from a bucket is exactly as hostile as an upload", () => {
  it("the zip bomb and the XXE workbook both land FAILED inside the budget, and the process survives", async () => {
    const source = await makeSource("hostile");
    const scope: S3ScopeEntry = { bucket: BUCKET, prefix: "hostile/", suffixes: [".xlsx"] };
    const started = Date.now();
    const result = await crawlS3Scope(source, scope);
    expect(Date.now() - started).toBeLessThan(180_000);

    expect(result.failed).toBe(2);
    const docs = await db.document.findMany({
      where: { sourceId: source.id },
      orderBy: { name: "asc" },
    });
    expect(docs.map((d) => d.textStatus)).toEqual(["FAILED", "FAILED"]);
    const bomb = docs.find((d) => d.name.endsWith("zip-bomb.xlsx"))!;
    const xxe = docs.find((d) => d.name.endsWith("xxe.xlsx"))!;
    expect(bomb.textError).toMatch(/entries|decompressed/i);
    expect(xxe.textError).toMatch(/external XML entity/i);
    for (const doc of docs) {
      expect(await db.documentChunk.count({ where: { documentId: doc.id } })).toBe(0);
    }
    // The parent is alive and its database still answers — the whole point of
    // the forked worker.
    expect(await db.document.count()).toBeGreaterThan(0);
  }, 180_000);
});

// ---------------------------------------------------------------------------

describe("the 25 MB cap holds on the header AND on the stream", () => {
  it("is the same number an upload gets", () => {
    expect(MAX_OBJECT_BYTES).toBe(MAX_UPLOAD_BYTES);
    expect(MAX_OBJECT_BYTES).toBe(25 * 1024 * 1024);
  });

  it("readCapped refuses rather than truncating", async () => {
    async function* big() {
      yield new Uint8Array(1024);
      yield new Uint8Array(1024);
    }
    expect(await readCapped(big(), 1500)).toBeNull();
    async function* small() {
      yield new Uint8Array(10);
    }
    expect((await readCapped(small(), 1500))!.byteLength).toBe(10);
  });

  it("an object whose HEADER declares more than the cap lands UNSUPPORTED, naming it", async () => {
    const key = "oversize/big.md";
    await put(key, Buffer.alloc(MAX_OBJECT_BYTES + 1024, 0x61));
    const source = await makeSource("oversize");
    const scope: S3ScopeEntry = { bucket: BUCKET, prefix: "oversize/", suffixes: [".md"] };
    const client = buildS3Client(source.configJson as S3Target, CREDS);
    const counts = counting(client);
    const result = await crawlS3Scope(source, scope, { client });

    expect(result.unsupported).toBe(1);
    // The header refusal costs one HEAD and no download.
    expect(counts.GetObjectCommand ?? 0).toBe(0);
    const doc = await db.document.findFirstOrThrow({ where: { sourceId: source.id } });
    expect(doc.textStatus).toBe("UNSUPPORTED");
    expect(doc.textError).toContain("25 MB");
    expect(doc.byteSize).toBe(0);
  }, 180_000);

  it("a store that LIES in the header is caught on the stream", async () => {
    // The remote store controls Content-Length. This one declares ONE BYTE in
    // HeadObject and then streams past the 25 MB cap on the download, which is
    // the exact case a header-side check cannot see. The GET response carries
    // no Content-Length at all (chunked), because Node refuses to write more
    // bytes than a declared one — a real store is under no such obligation.
    const server = createServer((req, res) => {
      const url = req.url ?? "";
      if (req.method === "HEAD") {
        res.setHeader("content-length", "1");
        res.setHeader("etag", '"liar"');
        res.statusCode = 200;
        return res.end();
      }
      if (url.includes("list-type=2")) {
        res.setHeader("content-type", "application/xml");
        res.statusCode = 200;
        return res.end(
          `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">` +
            `<Name>liar</Name><IsTruncated>false</IsTruncated>` +
            `<Contents><Key>liar/big.md</Key><ETag>&quot;liar&quot;</ETag><Size>1</Size></Contents>` +
            `</ListBucketResult>`,
        );
      }
      res.statusCode = 200;
      const megabyte = Buffer.alloc(1024 * 1024, 0x62);
      let written = 0;
      const pump = () => {
        while (written < MAX_OBJECT_BYTES + 2 * 1024 * 1024) {
          written += megabyte.byteLength;
          if (!res.write(megabyte)) {
            res.once("drain", pump);
            return;
          }
        }
        res.end();
      };
      pump();
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as AddressInfo).port;
    try {
      await allowlist(`127.0.0.1:${port}`);
      const source = await makeSource("liar", {
        config: { endpoint: `http://127.0.0.1:${port}` },
      });
      const client = buildS3Client(source.configJson as S3Target, CREDS);
      const result = await crawlS3Scope(
        source,
        { bucket: "liar", prefix: "liar/", suffixes: [".md"] },
        { client },
      );
      expect(result.unsupported).toBe(1);
      const doc = await db.document.findFirstOrThrow({ where: { sourceId: source.id } });
      expect(doc.textStatus).toBe("UNSUPPORTED");
      expect(doc.textError).toContain("25 MB");
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
      await allowlist(S3_HOST_PORT);
    }
  }, 60_000);

  it("the over-cap message always names the cap — never a silent skip", () => {
    expect(overCapMessage(null)).toContain("25 MB");
    expect(overCapMessage(99_999_999)).toContain("25 MB");
    expect(overCapMessage(99_999_999)).toContain("99999999");
  });
});

// ---------------------------------------------------------------------------

describe("small surfaces", () => {
  it("maps suffixes to content types and refuses the rest", () => {
    expect(contentTypeForKey("a/b.MD")).toBe("text/markdown");
    expect(contentTypeForKey("a/b.pdf")).toBe("application/pdf");
    expect(contentTypeForKey("a/b.xlsx")).toContain("spreadsheetml");
    expect(contentTypeForKey("a/b.exe")).toBeNull();
  });

  it("normalizes an ETag to one spelling", () => {
    expect(normalizeEtag('"abc"')).toBe("abc");
    expect(normalizeEtag('W/"abc"')).toBe("abc");
    expect(normalizeEtag(undefined)).toBe("");
  });
});
