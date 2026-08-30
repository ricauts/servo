// The ruleset backfill (spec ext-04). Every stored fact carries the
// ruleset that produced it — `facts@1` today (ext-03) — because output is
// a function of the ruleset and mixing two versions in one table makes
// every query a lie about which rules it is answering under.
//
// So when a parser changes, EXTRACTOR_VERSION changes and this walks the
// chunks whose facts are stamped BELOW it, re-extracts them, and upserts
// on the same (chunkId, offset, kind) key ingestion uses. Two properties
// matter and are asserted:
//
//   - it commits in BATCHES, never in one transaction. A corpus-wide
//     re-extraction inside a single transaction is a lock held for as long
//     as the corpus is large, and a crash at 99% throws away 99% of the
//     work. Each batch stands on its own; a re-run resumes rather than
//     restarts, because the stamp of a done batch is no longer below the
//     current version.
//   - with no stale rows it is a NO-OP: no fork, no write, no transaction.
//
// refDate is the DOCUMENT'S createdAt here too, so a backfilled fact and a
// freshly ingested one agree — see persist.ts.

import { runFactsJob } from "@/lib/kb/extract";
import { EXTRACTOR_VERSION } from "@/lib/kb/facts";
import {
  rulesetForDocument,
  upsertChunkFacts,
  type FactsPersistClient,
} from "@/lib/kb/facts/persist";

/** Chunks re-extracted per batch. One fork and one commit per batch. */
export const FACTS_BACKFILL_BATCH = 50;

/**
 * The version ordering, spelled out rather than assumed. `facts@N` sorts by
 * N; anything that does not parse is treated as stale, because a stamp this
 * code cannot read is a stamp it cannot vouch for. A row stamped ABOVE the
 * current version does not make its chunk a candidate — that would be a
 * downgrade.
 *
 * Stated exactly, because the selection is per-CHUNK and the rewrite is
 * chunk-wide: a chunk whose facts are ALL at or above the current version
 * is never selected, but a chunk carrying a below-version row alongside an
 * above-version one IS re-extracted whole, and the above-version rows go
 * with it. Making that true is why the query below does NOT use `distinct`
 * — which row of a mixed chunk survives a distinct is arbitrary, and the
 * day it picked the above-version row the chunk would be skipped and its
 * stale rows would never drain. Every non-current row is read and the
 * chunk set is reduced here instead. Unreachable with shipped code —
 * `facts@1` is the highest version that exists — and pinned anyway.
 */
export function isBelowCurrentVersion(
  extractor: string,
  current: string = EXTRACTOR_VERSION,
): boolean {
  const parse = (value: string): number | null => {
    const match = /^facts@(\d+)$/.exec(value);
    return match ? Number(match[1]) : null;
  };
  const have = parse(extractor);
  const want = parse(current);
  if (have === null) return true;
  if (want === null) return false;
  return have < want;
}

/** The extra reads the backfill needs beyond what persisting requires,
 *  plus the interactive transaction each BATCH commits in. */
export interface FactsBackfillClient extends FactsPersistClient {
  $transaction<T>(fn: (tx: FactsPersistClient) => Promise<T>): Promise<T>;
  documentFact: FactsPersistClient["documentFact"] & {
    findMany(args: {
      where: { extractor: { not: string } };
      select: { chunkId: true; documentId: true; extractor: true };
      orderBy: { chunkId: "asc" };
    }): Promise<Array<{ chunkId: string; documentId: string; extractor: string }>>;
  };
  documentChunk: FactsPersistClient["documentChunk"] & {
    findMany(args: {
      where: { id: { in: string[] } };
      select: { id: true; text: true; documentId: true };
    }): Promise<Array<{ id: string; text: string; documentId: string }>>;
  };
}

export interface BackfillResult {
  /** Chunks whose facts were re-extracted. */
  chunks: number;
  /** Fact rows written (created or updated). */
  facts: number;
  /** Batches committed — 0 when there was nothing to do. */
  batches: number;
}

export interface BackfillOptions {
  batchSize?: number;
  budgetMs?: number;
  signal?: AbortSignal;
}

/**
 * Re-extract every chunk whose facts are stamped below EXTRACTOR_VERSION.
 * Returns what it did; writes nothing when there is nothing stale.
 */
export async function backfillFacts(
  client: FactsBackfillClient,
  opts: BackfillOptions = {},
): Promise<BackfillResult> {
  const batchSize = Math.max(1, opts.batchSize ?? FACTS_BACKFILL_BATCH);

  // EVERY non-current row, then reduced to one entry per chunk here — see
  // isBelowCurrentVersion's note on why this is not a `distinct`. Ordered
  // by chunkId so batching is deterministic and a resumed run walks the
  // same sequence.
  const candidates = await client.documentFact.findMany({
    where: { extractor: { not: EXTRACTOR_VERSION } },
    select: { chunkId: true, documentId: true, extractor: true },
    orderBy: { chunkId: "asc" },
  });
  const seen = new Set<string>();
  const stale: Array<{ chunkId: string; documentId: string }> = [];
  for (const row of candidates) {
    if (seen.has(row.chunkId)) continue;
    // A chunk qualifies if ANY of its rows is below the current version.
    if (!isBelowCurrentVersion(row.extractor)) continue;
    seen.add(row.chunkId);
    stale.push({ chunkId: row.chunkId, documentId: row.documentId });
  }
  if (stale.length === 0) return { chunks: 0, facts: 0, batches: 0 };

  const rulesets = new Map<string, ReturnType<typeof rulesetForDocument>>();
  let chunks = 0;
  let facts = 0;
  let batches = 0;

  for (let start = 0; start < stale.length; start += batchSize) {
    const slice = stale.slice(start, start + batchSize);
    const rows = await client.documentChunk.findMany({
      where: { id: { in: slice.map((row) => row.chunkId) } },
      select: { id: true, text: true, documentId: true },
    });
    if (rows.length === 0) continue;

    // The pass groups by document because refDate is per-document; one
    // fork per (batch, document) keeps the extraction off this process
    // exactly as ingestion does.
    const byDocument = new Map<string, Array<{ id: string; text: string }>>();
    for (const row of rows) {
      const list = byDocument.get(row.documentId) ?? [];
      list.push({ id: row.id, text: row.text });
      byDocument.set(row.documentId, list);
    }

    // Every fork for this batch runs FIRST, outside any transaction:
    // holding one open across a child process is how a batch turns into a
    // lock nobody can explain.
    const pending: Array<{ documentId: string; chunkId: string; facts: Parameters<typeof upsertChunkFacts>[3] }> = [];
    for (const [documentId, documentChunks] of byDocument) {
      let ruleset = rulesets.get(documentId);
      if (!ruleset) {
        const document = await client.document.findUnique({
          where: { id: documentId },
          select: { createdAt: true },
        });
        if (!document) continue;
        ruleset = rulesetForDocument(document.createdAt);
        rulesets.set(documentId, ruleset);
      }
      const job = await runFactsJob(documentChunks, ruleset, {
        budgetMs: opts.budgetMs,
        signal: opts.signal,
      });
      if (!job.ok) throw new Error(job.error);
      for (const result of job.results) {
        pending.push({ documentId, chunkId: result.chunkId, facts: result.facts });
      }
    }
    if (pending.length === 0) continue;

    // ONE transaction per batch — the whole point of batching. A crash
    // between batches keeps every batch already committed.
    const written = await client.$transaction(async (tx) => {
      let count = 0;
      for (const item of pending) {
        count += await upsertChunkFacts(tx, item.documentId, item.chunkId, item.facts);
      }
      return count;
    });
    facts += written;
    chunks += pending.length;
    batches += 1;
  }

  return { chunks, facts, batches };
}
