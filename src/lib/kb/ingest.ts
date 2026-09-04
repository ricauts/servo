// Ingestion pipeline (spec kb-04): upload → extract → chunk. Every step
// writes textStatus so a failure is visible and retryable, never silent.
// There is NO model call anywhere in ingest — Document.summary is a
// deterministic first-chunk excerpt (an AI abstract is Roadmap, and when it
// ships it must route through withUsage like every other call).
//
// Text formats chunk by lines (kb-04); xlsx workbooks carry their own
// {sheet, range} chunk locators (kb-06), PDF pages their {page} locators
// (kb-07); the hardened worker (kb-05) wraps every extraction in a forked
// child with resource caps.

import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { chunkMarkdown } from "@/lib/kb/chunk";
import { extractDocument } from "@/lib/kb/extractors/run";
import { getKbExtractBudgetMs, getDoclingConfig } from "@/lib/kb/settings";
import { documentProfile, keywordPass } from "@/lib/kb/keywords";
import { persistFactsForDocument } from "@/lib/kb/facts/persist";
import { rebuildEdgesFor } from "@/lib/kb/graph";

/** Stored-byte cap, enforced before anything touches the database. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/** Zip-shaped containers go through the hardened path even when their
 *  content type is unknown — the caps do not trust the declared type. */
function isZipShaped(bytes: Buffer): boolean {
  return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

export const TEXT_CONTENT_TYPES = new Set([
  "text/markdown",
  "text/plain",
  "application/markdown",
]);

/** The xlsx family the worker's exceljs path covers (kb-06). Legacy binary
 *  .xls is deliberately absent — the worker says so specifically. */
function isSpreadsheetContentType(contentType: string): boolean {
  const ct = contentType.toLowerCase();
  return ct.includes("spreadsheetml") || ct.includes("xlsx");
}

export interface IngestInput {
  name: string;
  contentType: string;
  bytes: Buffer;
  ownerId: string;
  visibility?: "PRIVATE" | "STAFF" | "PUBLIC";
  collectionId?: string | null;
}

export interface IngestResult {
  documentId: string;
  textStatus: string;
  chunks: number;
  replacedExisting: boolean;
}

/**
 * Store bytes and run extraction. Re-uploading the same (owner, name)
 * REPLACES bytes and chunks and re-runs extraction in ONE transaction —
 * grants are untouched, because access decisions must survive content
 * updates.
 */
export async function ingestDocument(input: IngestInput): Promise<IngestResult> {
  if (input.bytes.byteLength > MAX_UPLOAD_BYTES) {
    throw new Error(
      `"${input.name}" is ${input.bytes.byteLength} bytes; the stored-byte cap is 25 MB.`,
    );
  }
  const sha256 = createHash("sha256").update(input.bytes).digest("hex");
  const byteSize = input.bytes.byteLength;

  const existing = await db.document.findFirst({
    where: { ownerId: input.ownerId, name: input.name },
    select: { id: true },
  });

  // Resolved once, before the transaction: the extraction step inside it
  // and the ext-04 fact pass after it run under the SAME
  // kb.extract.workerBudgetMs, and reading the setting twice could hand
  // them different numbers.
  const budgetMs = await getKbExtractBudgetMs(db);

  const document = await db.$transaction(async (tx) => {
    let documentId: string;
    if (existing) {
      // Replacement: new bytes, new extraction, SAME id and grants.
      await tx.document.update({
        where: { id: existing.id },
        data: {
          contentType: input.contentType,
          sha256,
          byteSize,
          data: new Uint8Array(input.bytes),
          textStatus: "EXTRACTING",
          textError: null,
          summary: "",
        },
      });
      await tx.documentChunk.deleteMany({ where: { documentId: existing.id } });
      await tx.knowledgeEdge.deleteMany({ where: { fromId: existing.id } });
      await tx.knowledgeEdge.deleteMany({ where: { toId: existing.id } });
      documentId = existing.id;
    } else {
      const created = await tx.document.create({
        data: {
          name: input.name,
          contentType: input.contentType,
          sha256,
          byteSize,
          data: new Uint8Array(input.bytes),
          ownerId: input.ownerId,
          visibility: input.visibility ?? "PRIVATE",
          ...(input.collectionId ? { collectionId: input.collectionId } : {}),
          textStatus: "EXTRACTING",
        },
        select: { id: true },
      });
      documentId = created.id;
    }

    if (
      !TEXT_CONTENT_TYPES.has(input.contentType) &&
      !isSpreadsheetContentType(input.contentType) &&
      input.contentType !== "application/pdf" &&
      !isZipShaped(input.bytes)
    ) {
      await tx.document.update({
        where: { id: documentId },
        data: {
          textStatus: "UNSUPPORTED",
          textError: `No extractor for ${input.contentType} yet.`,
        },
      });
      return { documentId, textStatus: "UNSUPPORTED", chunkCount: 0 };
    }

    // kb-05 via the dcl-01 seam: extraction runs in the HARDENED forked
    // worker — off this transaction and off the event loop, with the
    // zip/XXE/heap caps enforced BEFORE any parse — behind the extractor
    // registry, under the kb.extract.workerBudgetMs budget carried by the
    // AbortSignal. The transaction commits the row in EXTRACTING; the
    // extractor's outcome lands right after.
    // A misconfigured lane (bad URL, refused OCR engine) never breaks an
    // upload: the reason is named loudly here and the lane stays off for
    // this document — baseline answers, exactly as LANE 1.
    const docling = await getDoclingConfig(db).catch((err: unknown) => {
      console.error(`[servo] docling lane disabled: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    });
    const ran = await extractDocument(input.bytes, input.contentType, {
      signal: AbortSignal.timeout(budgetMs),
      budgetMs,
      docling,
    });
    const outcome = ran.outcome;
    if (outcome.status !== "EXTRACTED") {
      await tx.document.update({
        where: { id: documentId },
        data: {
          textStatus: outcome.status,
          textError: outcome.error ?? "Extraction failed.",
        },
      });
      return { documentId, textStatus: outcome.status, chunkCount: 0 };
    }

    // Structured formats ship their own locators ({sheet, range} for xlsx,
    // {page} for PDF); text falls back to line-based chunking (kb-04).
    const chunked =
      outcome.chunks?.map((c, index) => ({ index, text: c.text, locator: c.locator })) ??
      chunkMarkdown(outcome.text);
    const chunks = chunked;
    if (chunks.length > 0) {
      // The deterministic keyword/entity pass rides along per chunk (kb-08);
      // graph edges are built after the transaction, corpus-wide.
      await tx.documentChunk.createMany({
        data: chunks.map((c) => ({
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
        // Deterministic extract: the first chunk, capped. No provider call.
        summary: (chunks[0]?.text ?? "").slice(0, 300),
        // kb-lib-1: the document-level keyword profile the library view
        // renders and filters on — the same deterministic pass, aggregated.
        keywords: documentProfile(chunks.map((c) => c.text)).keywords,
        // dcl-01 provenance: the exact extractor and its library versions;
        // extractorFallback NULL on every successful non-fallback
        // extraction, so a future "the sidecar was down" queue drains by
        // this being NULL again.
        extractor: ran.extractorId || "baseline",
        extractorVersion: ran.extractorVersion,
        // The dcl-05 fallback taxonomy: the reason the preferred lane
        // failed when baseline answered; NULL on every successful
        // non-fallback extraction — the queue drains by this being NULL.
        extractorFallback: ran.extractorFallback ?? null,
        extractedAt: new Date(),
      },
    });
    return { documentId, textStatus: "EXTRACTED", chunkCount: chunks.length };
  });

  if (document.textStatus === "EXTRACTED") {
    // ext-04: the typed-fact pass is a STEP AFTER CHUNKING, run in kb-05's
    // forked worker under the same caps — never on this process. It sits
    // outside the transaction for the same reason the graph pass does: the
    // chunks are committed, and enrichment that fails must not un-ingest a
    // document that extracted cleanly. A document that lands FAILED never
    // reaches this line, so a failed document is never left holding a
    // partial set of facts.
    await persistFactsForDocument(db, document.documentId, { budgetMs }).catch(
      (err: unknown) => {
        console.error(
          `[servo] fact extraction skipped for ${document.documentId}: ${err instanceof Error ? err.message : String(err)}`,
        );
        return null;
      },
    );
    await rebuildEdgesFor(document.documentId).catch(() => 0);
  }

  return {
    documentId: document.documentId,
    textStatus: document.textStatus,
    chunks: document.chunkCount,
    replacedExisting: existing !== null,
  };
}
