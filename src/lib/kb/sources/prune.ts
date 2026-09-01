// Deletion propagation, GONE, and the human purge (xds-06).
//
// THE GENERATION RULE: propagation runs ONLY when lastCompleteSyncAt moved
// on THIS run — a document of the source whose externalSeenAt predates the
// run's start was not observed by a complete crawl, so the upstream store
// no longer has it. An INCOMPLETE crawl deletes and erases NOTHING (a
// fault after the first of two scope entries leaves every document, both
// timestamps honest: lastSyncAt moved, lastCompleteSyncAt did not).
//
// THE SEARCHABLE SURFACE IS ERASED, not just the chunks: chunks, facts
// and touching edges deleted; summary and keywords zeroed. Deleting
// chunks does not cascade edges, and summary is a deterministic extract
// of the upstream text — leaving either behind keeps a searchable residue
// of a revoked record.
//
// Document.data is NOT zeroed by a crawl — that is the design, not an
// omission: GONE is excluded from every read path including download,
// so the content is unreachable; destroying stored bytes is the explicit
// admin Purge action, never a machine's decision on a crawl it may have
// gotten wrong.

import { db } from "@/lib/db";

export interface PruneReport {
  gone: number;
  /** lastCompleteSyncAt moved on this run — propagation was licensed. */
  complete: boolean;
}

/**
 * Propagate deletions for one source after a crawl. `runStartedAt` is the
 * crawl's own start; `complete` is whether lastCompleteSyncAt moved.
 */
export async function propagateDeletions(sourceId: string, runStartedAt: Date, complete: boolean): Promise<PruneReport> {
  if (!complete) return { gone: 0, complete: false };
  // Everything the complete run did NOT observe. externalSeenAt is stamped
  // on observed documents INCLUDING unchanged skips (xds-05), so this
  // comparison is exact: seen-before-start means upstream dropped it.
  const stale = await db.document.findMany({
    where: { sourceId, externalSeenAt: { lt: runStartedAt }, textStatus: { not: "GONE" } },
    select: { id: true },
  });
  for (const doc of stale) await markGone(doc.id);
  return { gone: stale.length, complete: true };
}

/** Erase one document's searchable surface and mark it GONE. */
async function markGone(documentId: string): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.documentChunk.deleteMany({ where: { documentId } });
    await tx.documentFact.deleteMany({ where: { documentId } });
    await tx.knowledgeEdge.deleteMany({ where: { fromId: documentId } });
    await tx.knowledgeEdge.deleteMany({ where: { toId: documentId } });
    await tx.document.update({
      where: { id: documentId },
      data: {
        textStatus: "GONE",
        summary: "",
        keywords: [],
        // data is deliberately NOT zeroed: see the module header.
      },
    });
  });
}

export interface PurgeReport {
  purged: number;
  /** Documents the purge REFUSED to touch, with the citations naming them. */
  refused: Array<{ documentId: string; name: string; citations: string[] }>;
}

/**
 * The explicit admin purge: zero Document.data on GONE documents. Refuses
 * any document still cited by a ReplyDraft.sources entry — a purge that
 * erases the audit trail is the failure the GONE design exists to
 * prevent — naming the citation.
 */
export async function purgeGone(sourceId: string): Promise<PurgeReport> {
  const gone = await db.document.findMany({
    where: { sourceId, textStatus: "GONE" },
    select: { id: true, name: true },
  });
  const report: PurgeReport = { purged: 0, refused: [] };
  for (const doc of gone) {
    // Every draft whose sources cite this document.
    const drafts = await db.replyDraft.findMany({ select: { id: true, sources: true, ticketId: true } });
    const citing = drafts.filter((d) => {
      try {
        const sources = JSON.parse(String(d.sources)) as Array<{ docId?: string }>;
        return sources.some((s) => s.docId === doc.id);
      } catch {
        return false;
      }
    });
    if (citing.length > 0) {
      report.refused.push({ documentId: doc.id, name: doc.name, citations: citing.map((c) => `draft ${c.id} (ticket ${c.ticketId})`) });
      continue;
    }
    await db.document.update({ where: { id: doc.id }, data: { data: new Uint8Array(0), byteSize: 0 } });
    report.purged++;
  }
  return report;
}
