// Ingestion wiring for the typed-fact pass (spec ext-04). Two jobs, and
// nothing else:
//
//   1. Resolve the ruleset for a document. ext-02 made the extractor PURE —
//      it reads no clock and no Setting — so SOMEBODY has to resolve
//      refDate, and for ingestion that somebody is here: refDate is the
//      DOCUMENT'S createdAt, never `new Date()`. A document re-ingested
//      next year must produce the same facts it produced on upload, and
//      "today" moving underneath a relative date would silently rewrite
//      history. dateOrder and defaultCurrency come from DEFAULT_RULESET;
//      making either a Setting is exactly what ext-03 forbade, because a
//      setting that changes extraction output invalidates every stored row.
//
//   2. Persist what the pass produced, as UPSERTS on (chunkId, offset,
//      kind) — the unique ext-01 put on the table. Re-running ingestion on
//      an unchanged document therefore replaces rather than duplicates,
//      and the row count is a function of the text, not of how many times
//      the pass has run.
//
// The pass itself runs in kb-05's forked worker (runFactsJob), never on
// the request path. This module only decides WHAT to ask for and HOW to
// write the answer down.
//
// NOT THIS ITEM'S JOB, deliberately: kb-08's keyword/entity pass is
// untouched here. Document.keywords, DocumentChunk.keywords, the
// tokenizer, the stopword list, the top-N selection and the
// SHARED_KEYWORD / SHARED_ENTITY / SAME_COLLECTION edges are byte-
// identical before and after ext-04. Removing an entity that a fact now
// also covers would be a scope violation, not a cleanup.

import { Prisma } from "@prisma/client";
import { runFactsJob, type FactsJobChunk } from "@/lib/kb/extract";
import { DEFAULT_RULESET, type Fact, type FactRuleset } from "@/lib/kb/facts";

/**
 * The structural slice of the Prisma client this module needs. Named
 * structurally rather than as `PrismaClient` for the same reason
 * `ReclaimClient` in extract.ts is: the app's client is `$extends`-ed, and
 * a transaction client is narrower than both.
 */
export interface FactsPersistClient {
  document: {
    findUnique(args: {
      where: { id: string };
      select: { createdAt: true };
    }): Promise<{ createdAt: Date } | null>;
  };
  documentChunk: {
    findMany(args: {
      where: { documentId: string };
      select: { id: true; text: true };
      orderBy: { index: "asc" };
    }): Promise<Array<{ id: string; text: string }>>;
  };
  documentFact: {
    upsert(args: {
      where: { chunkId_offset_kind: { chunkId: string; offset: number; kind: string } };
      create: FactRow & { documentId: string; chunkId: string };
      update: FactRow;
      select: { id: true };
    }): Promise<{ id: string }>;
    deleteMany(args: {
      where: { chunkId: string; id?: { notIn: string[] } };
    }): Promise<{ count: number }>;
  };
}

/** The column set one fact writes — the same object on create and update,
 *  so the two branches can never drift apart. */
interface FactRow {
  kind: string;
  norm: string;
  num: Prisma.Decimal | null;
  unit: string;
  ts: bigint | null;
  tsEnd: bigint | null;
  text: string;
  offset: number;
  length: number;
  confidence: string;
  extractor: string;
}

/**
 * The ruleset for one document. `refDate` is the document's `createdAt` as
 * a UTC calendar day — the extractor takes a YYYY-MM-DD string and reads no
 * clock of its own (ext-02).
 */
export function rulesetForDocument(createdAt: Date): FactRuleset {
  return { ...DEFAULT_RULESET, refDate: createdAt.toISOString().slice(0, 10) };
}

/**
 * The absolute value DECIMAL(38,6) cannot hold: with a scale of 6, the
 * integer part has 32 digits, and Postgres raises 22003 rather than
 * truncating.
 *
 * MONEY can never reach it — money.ts caps its integer part at 15 digits —
 * but QUANTITY's numerator is unbounded, so a 33-digit run followed by a
 * unit ("...901234567890123 gb", which is what OCR noise looks like)
 * produces a value the column refuses. That refusal is not a harmless
 * dropped fact: persisting is chunk-by-chunk, so it truncates a document's
 * fact set midway, and inside the backfill it aborts the whole batch —
 * permanently, because the rows it failed to update stay stale and the
 * next run picks the same poison chunk. Refusing the VALUE here, where the
 * column's width is known, keeps one unparseable number from wedging the
 * corpus. The fact is dropped rather than clamped for the same reason
 * ext-02 emits no MONEY fact for a currency it cannot resolve: a wrong
 * number is worse than no number.
 */
export const NUM_ABS_LIMIT = 1e32;

/** True when this fact's `num` is outside what the column can store. */
export function numIsOutOfRange(fact: Fact): boolean {
  if (!("num" in fact) || typeof fact.num !== "number") return false;
  return !Number.isFinite(fact.num) || Math.abs(fact.num) >= NUM_ABS_LIMIT;
}

/**
 * One fact as columns. `num` goes through Prisma.Decimal rather than a bare
 * float: the column is DECIMAL(38,6) and money is already integer minor
 * units, so nothing here should acquire a binary-float rounding error on
 * the way in.
 */
export function factRow(fact: Fact): FactRow {
  const num = "num" in fact && typeof fact.num === "number" ? new Prisma.Decimal(fact.num) : null;
  return {
    kind: fact.kind,
    norm: fact.norm,
    num,
    unit: "unit" in fact && typeof fact.unit === "string" ? fact.unit : "",
    ts: fact.kind === "DATE" ? BigInt(fact.ts) : null,
    tsEnd: fact.kind === "DATE" ? BigInt(fact.tsEnd) : null,
    text: fact.text,
    offset: fact.offset,
    length: fact.length,
    confidence: "confidence" in fact ? fact.confidence : "EXACT",
    extractor: fact.extractor,
  };
}

/**
 * Write one chunk's facts. Each row is an UPSERT on the (chunkId, offset,
 * kind) unique; anything the chunk used to carry at a key the new pass did
 * not produce is then deleted, scoped to that chunk. Without the delete a
 * ruleset bump would leave rows stamped with the old version behind
 * forever — and ext-04's own backfill, which selects on exactly that
 * stamp, would never terminate.
 */
export async function upsertChunkFacts(
  client: FactsPersistClient,
  documentId: string,
  chunkId: string,
  facts: Fact[],
): Promise<number> {
  const kept: string[] = [];
  for (const fact of facts) {
    if (numIsOutOfRange(fact)) continue;
    const row = factRow(fact);
    const written = await client.documentFact.upsert({
      where: { chunkId_offset_kind: { chunkId, offset: fact.offset, kind: fact.kind } },
      create: { ...row, documentId, chunkId },
      update: row,
      select: { id: true },
    });
    kept.push(written.id);
  }
  // `notIn: []` is a shape Prisma is entitled to fold away, so the
  // empty case says what it means instead of relying on it.
  if (kept.length === 0) {
    await client.documentFact.deleteMany({ where: { chunkId } });
  } else {
    await client.documentFact.deleteMany({ where: { chunkId, id: { notIn: kept } } });
  }
  return kept.length;
}

export interface PersistFactsResult {
  chunks: number;
  facts: number;
}

export interface PersistFactsOptions {
  /** Carried straight to the fork — kb.extract.workerBudgetMs, resolved by
   *  the caller exactly as the extraction step resolves it. */
  budgetMs?: number;
  signal?: AbortSignal;
  /** Test seam: chunks already loaded, so a caller can persist facts for a
   *  set it holds without a second query. */
  chunks?: FactsJobChunk[];
  /** Test seam: a ruleset the caller resolved (backfill passes the
   *  document's own). */
  ruleset?: FactRuleset;
}

/**
 * Extract and persist the facts of one document's chunks. Throws when the
 * forked pass fails, so the caller decides whether a fact failure is worth
 * failing an upload over — ingestion says no, and keeps the document
 * EXTRACTED with the reason logged, the same posture the graph pass and
 * the docling lane already take.
 */
export async function persistFactsForDocument(
  client: FactsPersistClient,
  documentId: string,
  opts: PersistFactsOptions = {},
): Promise<PersistFactsResult> {
  const chunks =
    opts.chunks ??
    (await client.documentChunk.findMany({
      where: { documentId },
      select: { id: true, text: true },
      orderBy: { index: "asc" },
    }));
  if (chunks.length === 0) return { chunks: 0, facts: 0 };

  let ruleset = opts.ruleset;
  if (!ruleset) {
    const document = await client.document.findUnique({
      where: { id: documentId },
      select: { createdAt: true },
    });
    if (!document) return { chunks: 0, facts: 0 };
    ruleset = rulesetForDocument(document.createdAt);
  }

  const job = await runFactsJob(chunks, ruleset, {
    budgetMs: opts.budgetMs,
    signal: opts.signal,
  });
  if (!job.ok) throw new Error(job.error);

  let facts = 0;
  for (const result of job.results) {
    facts += await upsertChunkFacts(client, documentId, result.chunkId, result.facts);
  }
  return { chunks: chunks.length, facts };
}
