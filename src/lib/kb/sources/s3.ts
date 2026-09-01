// The S3 crawler in INDEX mode (xds-03). Three read commands, explicit
// credentials, its own egress allowlist, and every crawled byte treated as
// an untrusted upload that arrived by a different door.
//
// THE IMPORT LIST IS THE SECURITY BOUNDARY. Exactly ListObjectsV2Command,
// HeadObjectCommand and GetObjectCommand are imported, and
// tests/kb-source-s3.test.ts reads this file's import list and fails on any
// other command name. There is no write path to an object store anywhere in
// src/ — not a partial one, not a disabled one — and the same test greps for
// it, because "we only ever call read commands" is a claim a reviewer should
// be able to check mechanically rather than by reading every branch.
//
// CREDENTIALS ARE EXPLICIT, AND THE AMBIENT CHAIN IS SWITCHED OFF. The client
// is constructed with the key pair opened from the sealed store AND with a
// credentialDefaultProvider that THROWS. That second half is the one that
// matters: without it, a source whose secret row is missing silently falls
// back to AWS_ACCESS_KEY_ID, ~/.aws/credentials, an ECS task role or the
// instance metadata endpoint — the classic confused deputy, where Servo
// crawls whatever the machine it happens to be running on can reach. The
// refusal is asserted with AWS_* set in the test environment, and it happens
// BEFORE any client is built, so no network call is made either.
//
// THE ALLOWLIST IS ITS OWN, AND IT IS DENY-BY-DEFAULT. The endpoint host is
// checked against `kb.sources.egress.allowlist`, never against
// `integration.egress.allowlist` — that second list is the AGENT-facing one
// that web_fetch and the custom HTTP tools read, and an operator naming their
// on-prem object store there would be handing every model-steerable fetch a
// new destination. The two lists are separate settings for that reason and a
// test asserts a host permitted here is still refused by web_fetch.
//
// Unlike src/lib/egress.ts this path does NOT refuse private addresses: an
// operator's MinIO, a fixture s3mock and every on-prem store live on exactly
// those addresses, and the destination here comes from an admin's stored
// configuration rather than from a model, a ticket or a URL. The admin's
// explicit entry IS the control, which is why an empty list refuses
// everything instead of allowing everything the way matchAllowlist() does for
// the agent-facing list.
//
// EXTRACTION RUNS IN kb-05's FORKED WORKER. Crawled bytes go through the same
// extractDocument() seam an upload does, so the entry-count, decompressed-
// size, wall-clock and heap caps apply unchanged and a crafted object from a
// bucket is exactly as hostile as a crafted upload. The 25 MB cap is enforced
// against the HeadObject size AND on the GetObject stream, because the remote
// store controls the header and a lying Content-Length is free.

import {
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";
import { db as defaultDb } from "@/lib/db";
import { entryMatches, parseAllowlist } from "@/lib/egress";
import { chunkMarkdown } from "@/lib/kb/chunk";
import { extractDocument } from "@/lib/kb/extractors/run";
import { persistFactsForDocument } from "@/lib/kb/facts/persist";
import { rebuildEdgesFor } from "@/lib/kb/graph";
import { keywordPass } from "@/lib/kb/keywords";
import { getDoclingConfig, getKbExtractBudgetMs } from "@/lib/kb/settings";
import { SourceConfigError, sourceSecretKey } from "@/lib/kb/sources";
import { open as openSealed } from "@/lib/secret-store";

/**
 * The data-source egress allowlist. A DIFFERENT setting from
 * `integration.egress.allowlist`, deliberately: see the header.
 */
export const KB_SOURCES_EGRESS_KEY = "kb.sources.egress.allowlist";

/**
 * The stored-byte cap, the same 25 MB an upload gets (kb-04's
 * MAX_UPLOAD_BYTES). Restated here rather than imported so this module does
 * not pull the upload route's ingest pipeline in behind it; the test asserts
 * the two numbers are equal, which is the property that actually matters.
 */
export const MAX_OBJECT_BYTES = 25 * 1024 * 1024;

/** configJson for an S3 source, exactly the keys xds-01's CONFIG_KEYS admits. */
export interface S3Target {
  endpoint?: string;
  region?: string;
  forcePathStyle?: boolean;
}

/** One scope entry, exactly the keys xds-01's SCOPE_KEYS admits for S3. */
export interface S3ScopeEntry {
  bucket: string;
  prefix?: string;
  suffixes?: string[];
}

/** The credential, as the sealed Setting spells it. The route treats the
 *  secret as an opaque string and says the shape is the crawler's business
 *  (src/app/api/kb/sources/route.ts) — this is that shape. */
export interface S3Credentials {
  accessKeyId: string;
  secretAccessKey: string;
}

/** Suffix → content type. The scope's `suffixes` allowlist decides what is
 *  fetched at all, so the type is derived from the KEY rather than from the
 *  store's Content-Type header: the remote store controls that header, and
 *  routing extraction on a value the other side chose is how a .md gets
 *  parsed as a zip. */
const CONTENT_TYPES: Record<string, string> = {
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".txt": "text/plain",
  ".pdf": "application/pdf",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

export function contentTypeForKey(key: string): string | null {
  const lower = key.toLowerCase();
  for (const [suffix, type] of Object.entries(CONTENT_TYPES)) {
    if (lower.endsWith(suffix)) return type;
  }
  return null;
}

// ---------------------------------------------------------------------------
// The allowlist
// ---------------------------------------------------------------------------

/** The endpoint's host and port, or null when it is not a usable http(s) URL.
 *  A source with no endpoint at all is AWS itself — `s3.<region>.amazonaws.com`
 *  — and is named that way so an operator's allowlist entry can be explicit
 *  rather than implied by absence. */
export function endpointHostPort(config: S3Target): { host: string; port: number } | null {
  const raw = (config.endpoint ?? "").trim();
  if (raw === "") {
    const region = (config.region ?? "us-east-1").trim().toLowerCase();
    return { host: `s3.${region}.amazonaws.com`, port: 443 };
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const port = url.port === "" ? (url.protocol === "https:" ? 443 : 80) : Number(url.port);
  return { host: url.hostname.toLowerCase(), port };
}

/**
 * DENY BY DEFAULT. An empty list refuses every host — the opposite of
 * matchAllowlist()'s "empty means unrestricted", which is right for the
 * agent-facing list (where the private-address rules are the floor) and wrong
 * here (where private addresses are the normal case).
 *
 * entryMatches() is IMPORTED rather than re-implemented so `*.example.com`
 * and `host:port` mean the same thing on both lists; two hand-kept copies of
 * a matching rule drift, and this one decides where credentials are sent.
 */
export function assertEndpointAllowed(config: S3Target, allowlist: string[]): void {
  const target = endpointHostPort(config);
  if (!target) {
    throw new SourceConfigError(
      `"configJson.endpoint" is not an http(s) URL, so it cannot be checked against ${KB_SOURCES_EGRESS_KEY}.`,
      "configJson.endpoint",
    );
  }
  const allowed = allowlist.some((entry) => entryMatches(entry, target.host, target.port));
  if (!allowed) {
    throw new SourceConfigError(
      `${target.host} is not listed in ${KB_SOURCES_EGRESS_KEY}, so no data source may reach it. ` +
        `An admin adds it there — not to the agent-facing outbound allowlist, which is a different setting.`,
      "configJson.endpoint",
    );
  }
}

/** The minimal reader this module needs of a Setting table. */
export interface SettingReader {
  setting: {
    findUnique(args: { where: { key: string } }): Promise<{ value: string } | null>;
  };
}

/**
 * Read the data-source allowlist. Setting row only — no env override, unlike
 * the kb.extract.* settings: this list decides where a stored credential is
 * sent, and a process-environment variable is the wrong place to widen that
 * from, since it is invisible in the admin UI that shows the list.
 */
export async function readSourceEgressAllowlist(client: SettingReader): Promise<string[]> {
  const row = await client.setting.findUnique({ where: { key: KB_SOURCES_EGRESS_KEY } });
  return parseAllowlist(row?.value ?? "");
}

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

/** Parse the sealed credential. Never echoes one character of it: a bad shape
 *  is reported by SHAPE, because the value is the thing we are protecting. */
export function parseS3Secret(plain: string): S3Credentials {
  let parsed: unknown;
  try {
    parsed = JSON.parse(plain);
  } catch {
    throw new SourceConfigError(
      `The stored credential for this source is not JSON. An S3 credential is {"accessKeyId":"…","secretAccessKey":"…"}.`,
      "secret",
    );
  }
  const obj = parsed as Record<string, unknown> | null;
  const accessKeyId = obj && typeof obj.accessKeyId === "string" ? obj.accessKeyId : "";
  const secretAccessKey = obj && typeof obj.secretAccessKey === "string" ? obj.secretAccessKey : "";
  if (accessKeyId === "" || secretAccessKey === "") {
    throw new SourceConfigError(
      `The stored credential for this source is missing accessKeyId or secretAccessKey.`,
      "secret",
    );
  }
  return { accessKeyId, secretAccessKey };
}

/**
 * Open the source's credential, or REFUSE. The refusal is the whole point:
 * there is no path from "no credential stored" to "use whatever this machine
 * has", so this throws before any client exists and therefore before any
 * packet leaves.
 */
export async function loadS3Credentials(
  client: SettingReader,
  source: { id: string; name: string },
): Promise<S3Credentials> {
  const row = await client.setting.findUnique({ where: { key: sourceSecretKey(source.id) } });
  if (!row || row.value.trim() === "") {
    throw new SourceConfigError(
      `No credential is stored for source "${source.name}". A crawl uses the source's own key pair and never the ambient AWS credential chain — store one and try again.`,
      "secret",
    );
  }
  return parseS3Secret(openSealed(row.value));
}

/** The message the ambient chain is refused with. Exported so the test asserts
 *  the refusal it actually gets, not a paraphrase of it. */
export const AMBIENT_CREDENTIALS_REFUSED =
  "A data source crawl may not use the ambient AWS credential chain — the source's own key pair is the only credential.";

/**
 * The default credential provider, replaced by one that THROWS. Without this,
 * a client built without explicit credentials silently resolves
 * AWS_ACCESS_KEY_ID, ~/.aws/credentials, an ECS task role or the instance
 * metadata service — Servo crawling whatever the machine it runs on can reach.
 */
export const refuseAmbientCredentials = () => async () => {
  throw new Error(AMBIENT_CREDENTIALS_REFUSED);
};

/**
 * The client options, exported separately from the client so a test can build
 * the SAME client with the explicit credentials removed and prove the fallback
 * throws rather than resolving something. A test that only inspects the
 * literal proves nothing about what the SDK does with it.
 */
export function s3ClientOptions(config: S3Target, creds: S3Credentials) {
  return {
    region: config.region ?? "us-east-1",
    ...(config.endpoint ? { endpoint: config.endpoint } : {}),
    // Path style, always: a virtual-hosted request puts the bucket name in the
    // HOSTNAME, which is a different host from the one the allowlist just
    // approved.
    forcePathStyle: true,
    // COPIED, not passed through: the SDK stamps provenance onto the object it
    // is handed, and the caller's credential object is the one that came out
    // of the sealed store.
    credentials: { ...creds },
    credentialDefaultProvider: refuseAmbientCredentials,
    // A region redirect is the store telling us to talk to a different host.
    // The allowlist approved THIS host.
    followRegionRedirects: false,
    // One attempt: a crawl is triggered from outside and can simply be
    // triggered again, and a retrying client both multiplies load on a
    // misbehaving endpoint and makes "no GetObject was issued" unprovable.
    maxAttempts: 1,
  };
}

export function buildS3Client(config: S3Target, creds: S3Credentials): S3Client {
  return new S3Client(s3ClientOptions(config, creds));
}

// ---------------------------------------------------------------------------
// The crawl
// ---------------------------------------------------------------------------

/** One object as the listing describes it, before anything is fetched. */
export interface ListedObject {
  key: string;
  etag: string;
  size: number;
}

/** The externalLocator xds-01 canonized for an object. */
export function externalLocator(bucket: string, key: string, etag: string) {
  return { kind: "S3" as const, bucket, key, etag, versionId: null };
}

/** bucket + key IS the identity; the document name is exactly that pair, so
 *  the citation line reads `contracts/2026/q1/INV-2024-113.pdf` and the
 *  lookup key and the human-readable name cannot disagree. */
export function documentName(bucket: string, key: string): string {
  return `${bucket}/${key}`;
}

/** The suffix filter, applied to the LISTING — an object outside the prefix or
 *  the suffix list is never headed and never fetched. */
export function inScope(scope: S3ScopeEntry, key: string): boolean {
  const prefix = scope.prefix ?? "";
  if (prefix !== "" && !key.startsWith(prefix)) return false;
  const suffixes = scope.suffixes ?? [];
  if (suffixes.length === 0) return contentTypeForKey(key) !== null;
  const lower = key.toLowerCase();
  return suffixes.some((s) => lower.endsWith(s.toLowerCase()));
}

/** ETags come quoted out of S3 and out of the listing alike. Compared and
 *  stored in one spelling so an unchanged object is recognised as unchanged. */
export function normalizeEtag(etag: string | undefined): string {
  // The weak-validator marker comes FIRST, outside the quotes: `W/"abc"`.
  // Stripping quotes before it leaves the `W/` behind, and an object whose
  // ETag is spelled two ways is an object that is re-downloaded forever.
  return (etag ?? "").trim().replace(/^W\//i, "").replace(/^"|"$/g, "");
}

export interface S3CrawlDeps {
  /** Injected by tests so request counts are exact; production builds its own. */
  client?: S3Client;
  db?: typeof defaultDb;
}

export interface S3CrawlResult {
  /** Objects the listing returned that were inside the prefix and suffix filter. */
  listed: number;
  /** Objects whose ETag was unchanged: no HeadObject, no GetObject, no extraction. */
  skipped: number;
  /** Objects downloaded and extracted this run. */
  fetched: number;
  /** Objects that landed UNSUPPORTED — over the cap, or no extractor. */
  unsupported: number;
  /** Objects whose extraction FAILED inside the worker's caps. */
  failed: number;
  /** Every document id this crawl observed, skipped ones included. */
  documentIds: string[];
}

export interface CrawlableSource {
  id: string;
  name: string;
  configJson: unknown;
  createdById: string;
}

/**
 * Crawl ONE scope entry. The caller owns the source's status transitions and
 * the generation stamp for deletion propagation (xds-05/xds-06); this returns
 * what it observed.
 */
export async function crawlS3Scope(
  source: CrawlableSource,
  scope: S3ScopeEntry,
  deps: S3CrawlDeps = {},
): Promise<S3CrawlResult> {
  const db = deps.db ?? defaultDb;
  const config = (source.configJson ?? {}) as S3Target;

  // The order is the security order: the allowlist and the credential are
  // both resolved BEFORE a client exists, so a refusal on either is a refusal
  // that made no network call.
  assertEndpointAllowed(config, await readSourceEgressAllowlist(db));
  const creds = await loadS3Credentials(db, source);
  const client = deps.client ?? buildS3Client(config, creds);

  const runAt = new Date();
  const result: S3CrawlResult = {
    listed: 0,
    skipped: 0,
    fetched: 0,
    unsupported: 0,
    failed: 0,
    documentIds: [],
  };

  const budgetMs = await getKbExtractBudgetMs(db);
  // Parity with the upload path: a crawled PDF goes down the same lane an
  // uploaded one does. A misconfigured lane never breaks a crawl.
  const docling = await getDoclingConfig(db).catch((err: unknown) => {
    console.error(
      `[servo] docling lane disabled for crawl: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  });

  let continuationToken: string | undefined;
  do {
    const page = await client.send(
      new ListObjectsV2Command({
        Bucket: scope.bucket,
        ...(scope.prefix ? { Prefix: scope.prefix } : {}),
        ...(continuationToken ? { ContinuationToken: continuationToken } : {}),
      }),
    );
    for (const entry of page.Contents ?? []) {
      const key = entry.Key ?? "";
      if (key === "" || key.endsWith("/")) continue;
      if (!inScope(scope, key)) continue;
      result.listed += 1;
      const listed: ListedObject = {
        key,
        etag: normalizeEtag(entry.ETag),
        size: Number(entry.Size ?? 0),
      };
      const outcome = await syncObject(db, client, source, scope, listed, runAt, {
        budgetMs,
        docling,
      });
      result.documentIds.push(outcome.documentId);
      if (outcome.state === "SKIPPED") result.skipped += 1;
      if (outcome.state === "FETCHED") result.fetched += 1;
      if (outcome.state === "UNSUPPORTED") result.unsupported += 1;
      if (outcome.state === "FAILED") result.failed += 1;
    }
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);

  return result;
}

type ObjectState = "SKIPPED" | "FETCHED" | "UNSUPPORTED" | "FAILED";

async function syncObject(
  db: typeof defaultDb,
  client: S3Client,
  source: CrawlableSource,
  scope: S3ScopeEntry,
  listed: ListedObject,
  runAt: Date,
  extract: { budgetMs: number; docling: Awaited<ReturnType<typeof getDoclingConfig>> | null },
): Promise<{ state: ObjectState; documentId: string }> {
  const name = documentName(scope.bucket, listed.key);
  const existing = await db.document.findFirst({
    where: { sourceId: source.id, name },
    select: { id: true, externalVersion: true },
  });

  // The generation stamp goes on EVERY object this crawl observed, including
  // the ones it skips as unchanged — deletion propagation (xds-06) reads
  // externalSeenAt < runStartedAt, and an unchanged object that was not
  // stamped would be read as "gone from upstream" on the next complete crawl.
  if (existing && existing.externalVersion === listed.etag && listed.etag !== "") {
    await db.document.update({
      where: { id: existing.id },
      data: { externalSeenAt: runAt },
    });
    return { state: "SKIPPED", documentId: existing.id };
  }

  const contentType = contentTypeForKey(listed.key);
  const locator = externalLocator(scope.bucket, listed.key, listed.etag);
  const base = {
    name,
    sourceId: source.id,
    externalLocator: locator,
    externalVersion: listed.etag,
    externalSeenAt: runAt,
    ownerId: source.createdById,
    // A crawler cannot mint STAFF or PUBLIC. The source grant is the ceiling
    // and PRIVATE is the floor; xds-02's clause does the rest.
    visibility: "PRIVATE" as const,
  };

  if (contentType === null) {
    return {
      state: "UNSUPPORTED",
      documentId: await writeStub(db, existing?.id ?? null, base, {
        contentType: "application/octet-stream",
        textStatus: "UNSUPPORTED",
        textError: `No extractor for ${listed.key} yet.`,
      }),
    };
  }

  // Cap check 1, on the size the STORE declares. Cheap, and it means an
  // oversized object costs one HEAD rather than a download.
  const head = await client.send(
    new HeadObjectCommand({ Bucket: scope.bucket, Key: listed.key }),
  );
  const declared = Number(head.ContentLength ?? listed.size ?? 0);
  if (declared > MAX_OBJECT_BYTES) {
    return {
      state: "UNSUPPORTED",
      documentId: await writeStub(db, existing?.id ?? null, base, {
        contentType,
        textStatus: "UNSUPPORTED",
        textError: overCapMessage(declared),
      }),
    };
  }

  // Cap check 2, on the STREAM. The remote store controls Content-Length and
  // a lying header is free, so the bytes are counted as they arrive and the
  // read is abandoned the moment it crosses the cap — the process never holds
  // more than the cap plus one chunk.
  const body = await client.send(new GetObjectCommand({ Bucket: scope.bucket, Key: listed.key }));
  const streamed = await readCapped(body.Body as AsyncIterable<Uint8Array> | undefined);
  if (streamed === null) {
    return {
      state: "UNSUPPORTED",
      documentId: await writeStub(db, existing?.id ?? null, base, {
        contentType,
        textStatus: "UNSUPPORTED",
        textError: overCapMessage(null),
      }),
    };
  }

  // From here the bytes are an untrusted upload: kb-05's forked worker, its
  // caps, and the kb-06/kb-07 extractors an upload gets — same code, same
  // locators.
  const ran = await extractDocument(streamed, contentType, {
    signal: AbortSignal.timeout(extract.budgetMs),
    budgetMs: extract.budgetMs,
    docling: extract.docling,
  });
  const outcome = ran.outcome;

  const documentId = await db.$transaction(async (tx) => {
    const data = {
      ...base,
      contentType,
      sha256: createHash("sha256").update(streamed).digest("hex"),
      byteSize: streamed.byteLength,
      data: new Uint8Array(streamed),
      textStatus: "EXTRACTING",
      textError: null,
      summary: "",
    };
    let id: string;
    if (existing) {
      // A changed ETag REPLACES chunks and edges and KEEPS grants — kb-04's
      // re-upload rule, for exactly its reason: an access decision must
      // survive a content update.
      await tx.document.update({ where: { id: existing.id }, data });
      await tx.documentChunk.deleteMany({ where: { documentId: existing.id } });
      await tx.knowledgeEdge.deleteMany({ where: { fromId: existing.id } });
      await tx.knowledgeEdge.deleteMany({ where: { toId: existing.id } });
      id = existing.id;
    } else {
      const created = await tx.document.create({ data, select: { id: true } });
      id = created.id;
    }

    if (outcome.status !== "EXTRACTED") {
      await tx.document.update({
        where: { id },
        data: { textStatus: outcome.status, textError: outcome.error ?? "Extraction failed." },
      });
      return id;
    }

    const chunks =
      outcome.chunks?.map((c, index) => ({ index, text: c.text, locator: c.locator })) ??
      chunkMarkdown(outcome.text);
    if (chunks.length > 0) {
      await tx.documentChunk.createMany({
        data: chunks.map((c) => ({
          documentId: id,
          index: c.index,
          text: c.text,
          locator: c.locator as object,
          keywords: keywordPass(c.text).keywords,
        })),
      });
    }
    await tx.document.update({
      where: { id },
      data: {
        textStatus: "EXTRACTED",
        textError: null,
        summary: (chunks[0]?.text ?? "").slice(0, 300),
        extractor: ran.extractorId || "baseline",
        extractorVersion: ran.extractorVersion,
        extractorFallback: ran.extractorFallback ?? null,
        extractedAt: new Date(),
      },
    });
    return id;
  });

  if (outcome.status !== "EXTRACTED") {
    return { state: "FAILED", documentId };
  }

  // Outside the transaction for the same reason ingest keeps them there:
  // enrichment that fails must not un-index a document that extracted cleanly.
  await persistFactsForDocument(db, documentId, { budgetMs: extract.budgetMs }).catch(
    (err: unknown) => {
      console.error(
        `[servo] fact extraction skipped for ${documentId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    },
  );
  await rebuildEdgesFor(documentId).catch(() => 0);
  return { state: "FETCHED", documentId };
}

/** The message an over-cap object carries. Names the cap, always — an object
 *  that is silently skipped is an object an operator never learns about. */
export function overCapMessage(declared: number | null): string {
  const seen =
    declared === null
      ? "its stream ran past"
      : `it declares ${declared} bytes, over`;
  return `The object was not indexed: ${seen} the 25 MB object cap. Reduce it upstream, or exclude it from the scope.`;
}

/** A document row with no bytes: the object exists and is accounted for, but
 *  nothing was stored and nothing was parsed. */
async function writeStub(
  db: typeof defaultDb,
  existingId: string | null,
  base: Record<string, unknown>,
  fields: { contentType: string; textStatus: string; textError: string },
): Promise<string> {
  const data = {
    ...base,
    ...fields,
    sha256: "",
    byteSize: 0,
    data: null,
    summary: "",
    extractedAt: null,
  };
  if (existingId) {
    await db.document.update({ where: { id: existingId }, data: data as never });
    // The searchable surface goes with the bytes. An object that grew past the
    // cap between two crawls would otherwise keep answering from chunks the
    // store no longer backs, and keep an edge pointing at a document whose
    // chunks are gone — the same erasure xds-06 does for GONE, for the same
    // reason.
    await db.documentChunk.deleteMany({ where: { documentId: existingId } });
    await db.knowledgeEdge.deleteMany({ where: { fromId: existingId } });
    await db.knowledgeEdge.deleteMany({ where: { toId: existingId } });
    return existingId;
  }
  const created = await db.document.create({ data: data as never, select: { id: true } });
  return created.id;
}

/**
 * Read a body stream, refusing at the cap. Returns null when the object is
 * over — never a truncated Buffer, because a truncated xlsx is a corrupt
 * xlsx and "extraction failed" would be the wrong diagnosis for "too big".
 */
export async function readCapped(
  body: AsyncIterable<Uint8Array> | undefined,
  cap: number = MAX_OBJECT_BYTES,
): Promise<Buffer | null> {
  if (!body) return Buffer.alloc(0);
  const parts: Buffer[] = [];
  let total = 0;
  for await (const chunk of body) {
    const buf = Buffer.from(chunk);
    total += buf.byteLength;
    if (total > cap) {
      // Abandon the read rather than draining it: the caller gets the refusal
      // and the socket is dropped by the SDK when the iterator is abandoned.
      return null;
    }
    parts.push(buf);
  }
  return Buffer.concat(parts, total);
}
