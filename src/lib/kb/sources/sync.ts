// The sync lifecycle (xds-05): ONE external trigger, an atomic claim,
// incremental cursors, and failure states that never read as empty.
//
// NO SCHEDULER EXISTS HERE — that is the design, not an omission:
// syncEveryMin is a recorded HINT for an external caller, and the route
// is the only trigger. A test greps src/ for setInterval/cron and fails
// if one ever appears.
//
// THE CLAIM is one updateMany: {id, status:'READY'} → 'SYNCING'. A
// rowcount of 1 proceeds; zero means either a concurrent run (told so)
// or a lease left behind by a crashed crawl — a SYNCING row past its
// wall-clock lease returns to ERROR on the next call, NEVER to READY
// (a stale lease must not become a silent re-entry).
//
// FAILURE IS LOUD: a vanished bucket or table makes the crawl INCOMPLETE
// and the source ERROR — zero rows is never "the scope is empty". A
// transport failure lands UNREACHABLE; auth lands ERROR. In every case
// the indexed documents stay retrievable through all four read paths,
// and statusError carries no credential material.

import { db } from "@/lib/db";
import { crawlSqlScope, renderRow, externalLocator as sqlLocator, type SqlScopeEntry } from "./sql";
import { listScope, getObject, s3Locator, contentTypeFor, nameForKey, sha256Of, makeS3Client } from "./s3";
import { chunkMarkdown } from "@/lib/kb/chunk";
import { keywordPass } from "@/lib/kb/keywords";
import type { Prisma } from "@prisma/client";

/** How long a SYNCING lease may sit before the next call reclaims it. */
export const SYNC_LEASE_MS = 10 * 60 * 1000;

export interface SyncOutcome {
  /** true when EVERY scope entry completed without error. */
  complete: boolean;
  status: string; // the source's resulting status
  statusError: string | null;
  documentsWritten: number;
  documentsSkipped: number;
  /** The named reason a concurrent caller was refused, or null. */
  busy: string | null;
}

type SourceRow = {
  id: string;
  name: string;
  kind: string; // S3 | POSTGRES
  status: string;
  configJson: Prisma.JsonValue;
  scopeJson: Prisma.JsonValue;
  cursorJson: Prisma.JsonValue;
  maxRows: number;
  createdById: string;
  secretRef: string;
  statusError: string | null;
  lastSyncAt: Date | null;
  lastCompleteSyncAt: Date | null;
};

/** Reclaim a stale lease — to ERROR, never READY. */
async function reclaimStaleLease(source: SourceRow): Promise<boolean> {
  if (source.status !== "SYNCING") return false;
  const started = source.lastSyncAt?.getTime() ?? 0;
  if (started > 0 && Date.now() - started < SYNC_LEASE_MS) return false;
  await db.dataSource.update({
    where: { id: source.id },
    data: {
      status: "ERROR",
      statusError: `A previous sync's lease expired after ${Math.round(SYNC_LEASE_MS / 60000)} minutes — it was reclaimed, not resumed. Re-run the sync.`,
    },
  });
  return true;
}

/** The ONE entry point. Claims atomically, crawls every scope entry,
 *  stamps what it saw, and lands the honest final status. */
export async function syncSource(sourceId: string): Promise<SyncOutcome> {
  const source = (await db.dataSource.findUnique({ where: { id: sourceId } })) as SourceRow | null;
  if (!source) throw new Error("Unknown source.");

  if (await reclaimStaleLease(source)) {
    return { complete: false, status: "ERROR", statusError: "stale lease reclaimed", documentsWritten: 0, documentsSkipped: 0, busy: null };
  }

  // THE ATOMIC CLAIM: only a READY row transitions, exactly once.
  const claimed = await db.dataSource.updateMany({
    where: { id: source.id, status: "READY" },
    data: { status: "SYNCING", statusError: null, lastSyncAt: new Date() },
  });
  if (claimed.count === 0) {
    return {
      complete: false,
      status: source.status,
      statusError: source.statusError,
      documentsWritten: 0,
      documentsSkipped: 0,
      busy: `A sync is already ${source.status === "SYNCING" ? "running" : `blocked by status ${source.status}`} — only one crawl at a time.`,
    };
  }

  const runStartedAt = new Date();
  const outcome: SyncOutcome = { complete: true, status: "READY", statusError: null, documentsWritten: 0, documentsSkipped: 0, busy: null };
  const scope = Array.isArray(source.scopeJson) ? (source.scopeJson as unknown[]) : [];

  try {
    for (const entry of scope) {
      if (source.kind === "S3") await syncS3Entry(source, entry as never, runStartedAt, outcome);
      else if (source.kind === "POSTGRES") await syncSqlEntry(source, entry as never, runStartedAt, outcome);
      // An unknown kind cannot reach here: the catalog CHECK pins it.
    }
  } catch (err) {
    // Transport vs auth: an unreachable endpoint is transient (UNREACHABLE,
    // documents stay retrievable); an auth/config failure is ERROR.
    const message = err instanceof Error ? err.message : String(err);
    const transport = /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|fetch failed|network|unreachable/i.test(message);
    outcome.complete = false;
    outcome.status = transport ? "UNREACHABLE" : "ERROR";
    // No credential material: only the message's own text, which the
    // callers above compose without secrets.
    outcome.statusError = scrub(message);
  }

  const completedAt = outcome.complete ? new Date() : null;
  await db.dataSource.update({
    where: { id: source.id },
    data: {
      status: outcome.status,
      statusError: outcome.statusError,
      ...(completedAt ? { lastCompleteSyncAt: completedAt } : {}),
    },
  });
  // xds-06: deletion propagation runs ONLY when the run was complete —
  // an incomplete crawl deletes and erases NOTHING, whatever it saw.
  const { propagateDeletions } = await import("./prune");
  await propagateDeletions(source.id, runStartedAt, outcome.complete);
  return outcome;
}

/** Remove anything shaped like a credential from an error message. */
function scrub(message: string): string {
  return message
    .replace(/(accessKeyId|secretAccessKey|password|token|Authorization)\s*[:=]\s*\S+/gi, "$1: [redacted]")
    .replace(/\b(AKIA|ASIA)[A-Z0-9]{12,}\b/g, "[redacted-key]")
    .replace(/\bsk-[A-Za-z0-9-]{8,}\b/g, "[redacted]");
}

/** One S3 scope entry: paginated listing, ETag-keyed skip, one doc per object. */
async function syncS3Entry(source: SourceRow, entry: { bucket: string; prefix: string; suffixes: string[] }, runStartedAt: Date, outcome: SyncOutcome): Promise<void> {
  const client = await makeS3Client(
    `${(source.configJson as { endpoint?: string }).endpoint ?? "http://127.0.0.1:9090"}`,
    source.secretRef,
  );
  let listed: Awaited<ReturnType<typeof listScope>>;
  try {
    listed = await listScope(client, entry);
  } catch (err) {
    // A vanished bucket is INCOMPLETE, never "empty scope".
    throw new Error(`The bucket "${entry.bucket}" could not be listed (${err instanceof Error ? err.message : String(err)}).`);
  }
  if (listed.length === 0) {
    throw new Error(`The bucket "${entry.bucket}" listed zero objects under "${entry.prefix}" — the scope may have been deleted upstream.`);
  }
  for (const obj of listed) {
    // Stamp what we OBSERVED — including unchanged skips.
    await stampSeen(source.id, obj.key, obj.etag ?? "", runStartedAt);
    const existing = await db.document.findFirst({
      where: { sourceId: source.id, externalLocator: { path: ["key"], equals: obj.key } },
      select: { id: true, externalVersion: true },
    });
    if (existing?.externalVersion === (obj.etag ?? "")) {
      outcome.documentsSkipped++;
      continue; // unchanged: no GetObject, no extraction
    }
    const got = await getObject(client, entry.bucket, obj.key);
    const locator = s3Locator(entry.bucket, obj.key, got.etag);
    await upsertCrawledDocument(source, {
      locator,
      externalVersion: got.etag,
      name: nameForKey(obj.key),
      contentType: got.contentType || contentTypeFor(obj.key),
      bytes: got.bytes,
      runStartedAt,
    });
    outcome.documentsWritten++;
  }
}

/** One SQL scope entry: changed-rows-only re-render over a FULL id sweep. */
async function syncSqlEntry(source: SourceRow, scope: SqlScopeEntry, runStartedAt: Date, outcome: SyncOutcome): Promise<void> {
  let rows: Awaited<ReturnType<typeof crawlSqlScope>>;
  try {
    rows = await crawlSqlScope(source, scope);
  } catch (err) {
    throw new Error(`The table "${scope.schema}.${scope.table}" could not be crawled (${err instanceof Error ? err.message : String(err)}).`);
  }
  if (rows.overCap) {
    throw new Error(`The table "${scope.table}" exceeds maxRows (${source.maxRows}). Raise the cap or crawl a view over it — truncation is not an option.`);
  }
  if (rows.rows.length === 0) {
    throw new Error(`The table "${scope.table}" returned zero rows — it may have been dropped or emptied upstream.`);
  }
  // The FULL id sweep: every observed id, so a vanished row is visible to
  // deletion propagation even when updatedAtColumn filtering skips it.
  for (const row of rows.rows) {
    // The stamp key is the LOCATOR's own stable id — the same shape the
    // skip-lookup below matches, so an observed row is always stamped.
    await stampSeen(source.id, row.externalId, row.version, runStartedAt);
    const locator = sqlLocator(scope, source.name, row.externalId);
    const existing = await db.document.findFirst({
      where: { sourceId: source.id, externalLocator: { path: ["id"], equals: row.externalId } },
      select: { id: true, externalVersion: true },
    });
    if (existing?.externalVersion === row.version) {
      outcome.documentsSkipped++;
      continue;
    }
    await upsertCrawledDocument(source, {
      locator,
      externalVersion: row.version,
      name: row.name,
      contentType: "text/markdown",
      bytes: Buffer.from(row.text, "utf8"),
      runStartedAt,
    });
    outcome.documentsWritten++;
  }
}

interface CrawledInput {
  locator: Record<string, unknown>;
  externalVersion: string;
  name: string;
  contentType: string;
  bytes: Buffer;
  runStartedAt: Date;
}

/** Upsert one crawled document: new rows are created; changed versions
 *  REPLACE chunks (kb-04's re-upload rule — grants untouched). */
async function upsertCrawledDocument(source: SourceRow, input: CrawledInput): Promise<void> {
  const sha = sha256Of(input.bytes);
  // The STABLE identity is the external key/id inside the locator — never
  // the whole locator, whose etag/version half is exactly what changes.
  const stableKey = String((input.locator as { key?: unknown; id?: unknown }).key ?? (input.locator as { id?: unknown }).id ?? "");
  const existing = await db.document.findFirst({
    where: {
      sourceId: source.id,
      OR: [
        { externalLocator: { path: ["key"], equals: stableKey } },
        { externalLocator: { path: ["id"], equals: stableKey } },
      ],
    },
    select: { id: true },
  });
  const chunks = chunkMarkdown(input.bytes.toString("utf8"));
  const docId = existing?.id;
  if (docId) {
    await db.$transaction(async (tx) => {
      await tx.documentChunk.deleteMany({ where: { documentId: docId } });
      if (chunks.length > 0) {
        await tx.documentChunk.createMany({
          data: chunks.map((c) => ({
            documentId: docId, index: c.index, text: c.text,
            locator: c.locator as object, keywords: keywordPass(c.text).keywords,
          })),
        });
      }
      await tx.document.update({
        where: { id: docId },
        data: {
          name: input.name, contentType: input.contentType, byteSize: input.bytes.byteLength,
          sha256: sha, textStatus: "EXTRACTED", textError: null,
          summary: (chunks[0]?.text ?? "").slice(0, 300),
          externalVersion: input.externalVersion, externalSeenAt: new Date(),
          runStartedAt: input.runStartedAt,
        },
      });
    });
    return;
  }
  await db.$transaction(async (tx) => {
    const created = await tx.document.create({
      data: {
        name: input.name, contentType: input.contentType, byteSize: input.bytes.byteLength,
        sha256: sha, data: new Uint8Array(0), textStatus: "EXTRACTED",
        ownerId: source.createdById, visibility: "PRIVATE", sourceId: source.id,
        summary: (chunks[0]?.text ?? "").slice(0, 300),
        externalLocator: input.locator as object,
        externalVersion: input.externalVersion, externalSeenAt: new Date(),
        runStartedAt: input.runStartedAt,
      },
      select: { id: true },
    });
    if (chunks.length > 0) {
      await tx.documentChunk.createMany({
        data: chunks.map((c) => ({
          documentId: created.id, index: c.index, text: c.text,
          locator: c.locator as object, keywords: keywordPass(c.text).keywords,
        })),
      });
    }
  });
}

/** externalSeenAt on every OBSERVED document — unchanged skips included. */
async function stampSeen(sourceId: string, externalKey: string, version: string, runStartedAt: Date): Promise<void> {
  void version;
  await db.document.updateMany({
    where: { sourceId, OR: [{ externalLocator: { path: ["key"], equals: externalKey } }, { externalLocator: { path: ["id"], equals: externalKey } }] },
    data: { externalSeenAt: new Date(), runStartedAt },
  });
}
