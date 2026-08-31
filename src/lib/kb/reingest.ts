// Re-extraction (dcl-09): re-run steps 2-5 of §5's pipeline on the STORED
// bytes with the CURRENTLY configured extractor — identical semantics to a
// re-upload (chunks and edges replaced, embeddings recomputed through the
// kb-09 backfill, GRANTS UNTOUCHED), but from the stored Document.data
// rather than a fresh upload.
//
// The provenance columns update with the outcome: a successful
// NON-FALLBACK re-extraction CLEARS extractorFallback to null — that is
// what drains the "the sidecar was down when these landed" queue — and a
// document with no configured high-fidelity extractor re-extracts on
// baseline happily: the absence of a sidecar is not an error.
//
// A re-extraction DELETES chunk rows, so a PENDING ReplyDraft citing one
// dangles; kb-13's send-time re-verification (draft.ts) treats a missing
// chunk id as a citation that went dark and refuses the send.

import { db } from "@/lib/db";
import { extractDocument } from "@/lib/kb/extractors/run";
import { getKbExtractBudgetMs, getDoclingConfig } from "@/lib/kb/settings";
import { chunkMarkdown, type Chunked } from "@/lib/kb/chunk";
import { keywordPass } from "@/lib/kb/keywords";
import { persistFactsForDocument } from "@/lib/kb/facts/persist";
import { rebuildEdgesFor } from "@/lib/kb/graph";
import { backfillEmbeddings } from "@/lib/kb/backfill";

export interface ReextractResult {
  documentId: string;
  textStatus: string;
  chunks: number;
  /** The fallback state AFTER the run — null means the queue drained. */
  extractorFallback: string | null;
}

/** Re-extract one stored document. Refuses catalog cards (no bytes) and
 *  missing ids loudly; everything else runs the full pipeline. */
export async function reextractDocument(documentId: string): Promise<ReextractResult> {
  const doc = await db.document.findUnique({ where: { id: documentId } });
  if (!doc) throw new Error("Unknown document.");
  if (doc.data === null) {
    throw new Error("This document has no stored bytes to re-extract (catalog cards profile their source instead).");
  }
  const bytes = Buffer.from(doc.data);

  const budgetMs = await getKbExtractBudgetMs(db);
  const docling = await getDoclingConfig(db).catch((err: unknown) => {
    console.error(`[servo] docling lane disabled: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  });
  const ran = await extractDocument(bytes, doc.contentType, {
    signal: AbortSignal.timeout(budgetMs),
    budgetMs,
    docling,
  });

  const result = await db.$transaction(async (tx) => {
    // Replace chunks and this document's edges — grants untouched, the
    // same re-upload semantics kb-04 asserts.
    await tx.documentChunk.deleteMany({ where: { documentId } });
    await tx.knowledgeEdge.deleteMany({ where: { fromId: documentId } });
    await tx.knowledgeEdge.deleteMany({ where: { toId: documentId } });

    if (ran.outcome.status !== "EXTRACTED") {
      await tx.document.update({
        where: { id: documentId },
        data: {
          textStatus: ran.outcome.status,
          textError: ran.outcome.status === "UNSUPPORTED" || ran.outcome.status === "FAILED"
            ? ran.outcome.error ?? "Extraction failed."
            : null,
        },
      });
      return { documentId, textStatus: ran.outcome.status, chunks: 0, extractorFallback: null };
    }

    const chunked: Chunked[] =
      ran.outcome.chunks?.map((c, index) => ({ index, text: c.text, locator: c.locator as { lines: string } })) ??
      chunkMarkdown(ran.outcome.text);
    if (chunked.length > 0) {
      await tx.documentChunk.createMany({
        data: chunked.map((c) => ({
          documentId,
          index: c.index,
          text: c.text,
          locator: c.locator as object,
          keywords: keywordPass(c.text).keywords,
        })),
      });
    }
    await tx.document.update({
      where: { id: documentId },
      data: {
        textStatus: "EXTRACTED",
        textError: null,
        summary: (chunked[0]?.text ?? "").slice(0, 300),
        extractor: ran.extractorId || "baseline",
        extractorVersion: ran.extractorVersion,
        // A successful NON-FALLBACK run clears the queue entry; a fallback
        // run records today's reason, keeping the document queued.
        extractorFallback: ran.extractorFallback ?? null,
        extractedAt: new Date(),
      },
    });
    return { documentId, textStatus: "EXTRACTED" as const, chunks: chunked.length, extractorFallback: ran.extractorFallback ?? null };
  });

  if (result.textStatus === "EXTRACTED") {
    // Steps 4-5: the graph corpus rebuild, then the kb-09 embedding
    // backfill over the freshly-nulled chunks. Both best-effort at this
    // layer — the same calls the upload path makes.
    // ext-04: this path DELETES the chunks and recreates them, so the FK
    // cascade has just taken every fact with them. Re-running the pass
    // here is what keeps re-extraction from silently emptying the facts
    // table — same forked worker, same budget, same best-effort posture as
    // the two calls below.
    await persistFactsForDocument(db, documentId, { budgetMs }).catch((err: unknown) => {
      console.error(
        `[servo] fact extraction skipped for ${documentId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    });
    await rebuildEdgesFor(documentId).catch(() => 0);
    // Recompute embeddings over the fresh chunks (kb-09). expectModel ""
    // accepts whatever the configured embedder reports, the same posture
    // as the corpus backfill on boot.
    await backfillEmbeddings(db as unknown as Parameters<typeof backfillEmbeddings>[0], "").catch(() => 0);
  }
  return result;
}

/**
 * The fallback queue: documents whose preferred extractor was unavailable
 * when they landed (extractorFallback IS NOT NULL). The bulk walk re-runs
 * ONE DOCUMENT AT A TIME, re-selecting after each, so a run that lands on
 * baseline again re-queues itself honestly and a run that clears keeps the
 * queue shrinking — it drains, it never loops over the same rows blind.
 * Returns how many documents were walked.
 */
export async function reextractFallbackQueue(limit = 50): Promise<{ walked: number; drained: number }> {
  let walked = 0;
  let drained = 0;
  for (;;) {
    if (walked >= limit) break;
    const next = await db.document.findFirst({
      where: { extractorFallback: { not: null } },
      orderBy: { extractedAt: "asc" },
      select: { id: true },
    });
    if (!next) break;
    walked++;
    const result = await reextractDocument(next.id);
    if (result.extractorFallback === null) drained++;
  }
  return { walked, drained };
}
