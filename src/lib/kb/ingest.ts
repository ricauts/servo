// Ingestion pipeline (spec kb-04): upload → extract → chunk. Every step
// writes textStatus so a failure is visible and retryable, never silent.
// There is NO model call anywhere in ingest — Document.summary is a
// deterministic first-chunk excerpt (an AI abstract is Roadmap, and when it
// ships it must route through withUsage like every other call).
//
// kb-04 covers text/markdown and text/plain. Other content types land
// UNSUPPORTED with a message naming the item that brings them (kb-06 xlsx,
// kb-07 PDF); the hardened worker (kb-05) wraps extraction in a forked child
// with resource caps — plain-text extraction needs no parser and is safe
// inline.

import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { chunkMarkdown } from "@/lib/kb/chunk";
import { keywordPass } from "@/lib/kb/keywords";
import { rebuildEdgesFor } from "@/lib/kb/graph";

/** Stored-byte cap, enforced before anything touches the database. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export const TEXT_CONTENT_TYPES = new Set([
  "text/markdown",
  "text/plain",
  "application/markdown",
]);

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

    if (!TEXT_CONTENT_TYPES.has(input.contentType)) {
      await tx.document.update({
        where: { id: documentId },
        data: {
          textStatus: "UNSUPPORTED",
          textError:
            input.contentType === "application/pdf"
              ? "PDF extraction arrives with kb-07."
              : input.contentType.includes("sheet") || input.contentType.includes("excel")
                ? "Spreadsheet extraction arrives with kb-06."
                : `No extractor for ${input.contentType} yet.`,
        },
      });
      return { documentId, textStatus: "UNSUPPORTED", chunkCount: 0 };
    }

    const text = input.bytes.toString("utf8");
    const chunks = chunkMarkdown(text);
    if (chunks.length > 0) {
      // The deterministic keyword/entity pass rides along per chunk (kb-08);
      // graph edges are built after the transaction, corpus-wide.
      await tx.documentChunk.createMany({
        data: chunks.map((c) => ({
          documentId,
          index: c.index,
          text: c.text,
          locator: c.locator,
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
      },
    });
    return { documentId, textStatus: "EXTRACTED", chunkCount: chunks.length };
  });

  if (document.textStatus === "EXTRACTED") {
    await rebuildEdgesFor(document.documentId).catch(() => 0);
  }

  return {
    documentId: document.documentId,
    textStatus: document.textStatus,
    chunks: document.chunkCount,
    replacedExisting: existing !== null,
  };
}
