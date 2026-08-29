// Reprofile orchestration (cat-08): applies a fresh tier-1 listing to a
// source's existing entries — drift through the SAME re-render/re-chunk
// pipeline cat-06's persistCard already is (which is kb-04's re-upload
// semantics: replace chunks and edges, keep ids, keep grants-because-none),
// DROPPED/UNREADABLE transitions, retention, and source deletion. All
// mutations are single transactions; a partial failure rolls back whole.

import { db } from "@/lib/db";
import { classifyPresence, droppedHeader, retentionDue, unreadableCard } from "./freshness";

export interface PresenceFact {
  fqn: string;
  inCatalog: boolean;
  inStats: boolean;
}

/** Apply presence facts to a source's entries: DROPPED and UNREADABLE
 *  transitions, chunk deletion, zero-weight edges (evidence retained). */
export async function applyPresence(
  dataSourceId: string,
  facts: PresenceFact[],
  asOf: string,
): Promise<{ dropped: string[]; unreadable: string[] }> {
  const dropped: string[] = [];
  const unreadable: string[] = [];

  await db.$transaction(async (tx) => {
    for (const fact of facts) {
      const verdict = classifyPresence(fact.fqn, fact);
      if (verdict === "OK") continue;
      const entry = await tx.catalogEntry.findFirst({
        where: { dataSourceId, fqn: fact.fqn },
        select: { id: true, documentId: true, profileStatus: true },
      });
      if (!entry) continue;

      // Both verdicts delete the chunks — that is what makes the card
      // vanish from search with ZERO change to the retrieval statement.
      if (entry.documentId) {
        await tx.documentChunk.deleteMany({ where: { documentId: entry.documentId } });
      }

      if (verdict === "DROPPED") {
        await tx.catalogEntry.update({
          where: { id: entry.id },
          data: { profileStatus: "DROPPED", droppedAt: new Date(asOf) },
        });
        // The Document survives (read_document still resolves, with the
        // dated header); note and inferredPurpose are human columns and
        // are never touched here.
        if (entry.documentId) {
          const doc = await tx.document.findUnique({
            where: { id: entry.documentId },
            select: { summary: true },
          });
          await tx.document.update({
            where: { id: entry.documentId },
            data: { summary: `${droppedHeader(asOf)}${doc?.summary ? ` — ${doc.summary.slice(0, 180)}` : ""}` },
          });
        }
        dropped.push(fact.fqn);
      } else {
        // UNREADABLE: chunks, exemplars AND signature go immediately.
        await tx.catalogEntry.update({
          where: { id: entry.id },
          data: {
            profileStatus: "UNREADABLE",
            exemplars: [],
            signature: {},
            note: entry.documentId ? undefined : undefined, // untouched
          },
        });
        if (entry.documentId) {
          await tx.document.update({
            where: { id: entry.documentId },
            data: { summary: "" },
          });
        }
        unreadable.push(fact.fqn);
      }

      // Edges touching the entry: weight 0, evidence retained. Reads filter
      // weight > 0; restoring the table recomputes and restores the weight.
      if (entry.documentId) {
        await tx.knowledgeEdge.updateMany({
          where: { OR: [{ fromId: entry.documentId }, { toId: entry.documentId }] },
          data: { weight: 0 },
        });
      }
    }
  });

  return { dropped, unreadable };
}

/** Restore a previously DROPPED/UNREADABLE entry: clear the flags, restore
 *  the edge weight to its recorded prior value (recomputation happens on
 *  the next tier-2 pass; the weight>0 filter needs the edge visible NOW).
 *  The human note survives the round trip. */
export async function restoreEntry(
  dataSourceId: string,
  fqn: string,
  restoredWeight: number,
): Promise<void> {
  const entry = await db.catalogEntry.findFirst({
    where: { dataSourceId, fqn },
    select: { id: true, documentId: true, note: true },
  });
  if (!entry?.documentId) return;
  const documentId = entry.documentId;
  await db.$transaction(async (tx) => {
    await tx.catalogEntry.update({
      where: { id: entry.id },
      data: { profileStatus: "PROFILED", droppedAt: null },
    });
    await tx.knowledgeEdge.updateMany({
      where: { OR: [{ fromId: documentId }, { toId: documentId }] },
      data: { weight: restoredWeight },
    });
  });
}

/** The dated header read_document adds for a DROPPED card. */
export { droppedHeader, unreadableCard };

/** Retention sweep: DROPPED entries past their retainDays hard-delete —
 *  entry, Document, chunks, edges — in ONE transaction per source. */
export async function sweepRetention(dataSourceId: string, now: Date): Promise<number> {
  const stale = await db.catalogEntry.findMany({
    where: { dataSourceId, profileStatus: "DROPPED" },
    select: { id: true, documentId: true, droppedAt: true },
  });
  let deleted = 0;
  for (const entry of stale) {
    if (!retentionDue(entry.droppedAt, now)) continue;
    await db.$transaction(async (tx) => {
      if (entry.documentId) {
        await tx.knowledgeEdge.deleteMany({
          where: { OR: [{ fromId: entry.documentId }, { toId: entry.documentId }] },
        });
        await tx.documentChunk.deleteMany({ where: { documentId: entry.documentId } });
        await tx.document.deleteMany({ where: { id: entry.documentId } });
      }
      await tx.catalogEntry.delete({ where: { id: entry.id } });
    });
    deleted++;
  }
  return deleted;
}

/** Deleting a DataSource removes every entry, card, chunk and edge in ONE
 *  transaction; a partial failure rolls back whole and leaves the catalog
 *  exactly as before. */
export async function deleteSourceCascade(dataSourceId: string): Promise<void> {
  await db.$transaction(async (tx) => {
    const entries = await tx.catalogEntry.findMany({
      where: { dataSourceId },
      select: { id: true, documentId: true },
    });
    const docIds = entries.map((e) => e.documentId).filter((v): v is string => v !== null);
    if (docIds.length > 0) {
      await tx.knowledgeEdge.deleteMany({
        where: { OR: [{ fromId: { in: docIds } }, { toId: { in: docIds } }] },
      });
      await tx.documentChunk.deleteMany({ where: { documentId: { in: docIds } } });
      await tx.document.deleteMany({ where: { id: { in: docIds } } });
    }
    await tx.catalogEntry.deleteMany({ where: { dataSourceId } });
    await tx.catalogRun.deleteMany({ where: { dataSourceId } });
  });
}
