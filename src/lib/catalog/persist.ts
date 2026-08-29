// Card persistence (cat-06): the CatalogEntry and its rendered Document
// land in ONE transaction — kind 'CATALOG', the catalog media type, data
// NULL (the profile lives in CatalogEntry.profile and nowhere else),
// textStatus 'EXTRACTED' set directly (the kb-05 extraction worker is NOT
// invoked for card text: the renderer already produced the chunks),
// visibility PRIVATE, and the Servo Catalog system user as owner. Chunks
// carry the {entry, section, from?} locators verbatim.

import { db } from "@/lib/db";
import { renderCard, cardSummary, type RenderInput, type RenderedChunk } from "./render";

export const CATALOG_MEDIA_TYPE = "application/vnd.servo.catalog+json";

export interface PersistResult {
  documentId: string;
  entryId: string;
  chunkCount: number;
}

/** Write one entry's card. Idempotent per (dataSourceId, fqn): a re-profile
 *  REPLACES the chunks and the profile, keeps the same ids, and — per the
 *  canon — never touches note or inferredPurpose (those are human/model
 *  columns; the caller re-reads them around this call). */
export async function persistCard(
  input: RenderInput,
  profileJson: Record<string, unknown>,
  catalogUserId: string,
): Promise<PersistResult> {
  const chunks = renderCard(input);
  const summary = cardSummary(input);
  const rawProfile = JSON.stringify(profileJson);

  return db.$transaction(async (tx) => {
    const existing = await tx.catalogEntry.findUnique({
      where: { dataSourceId_fqn: { dataSourceId: input.dataSourceId, fqn: input.fqn } },
      select: { id: true, documentId: true },
    });

    let documentId: string;
    let entryId: string;
    if (existing?.documentId) {
      documentId = existing.documentId;
      entryId = existing.id;
      await tx.document.update({
        where: { id: documentId },
        data: {
          byteSize: Buffer.byteLength(rawProfile),
          sha256: hash(rawProfile),
          summary,
          textStatus: "EXTRACTED",
          textError: null,
        },
      });
      await tx.documentChunk.deleteMany({ where: { documentId } });
      await tx.catalogEntry.update({
        where: { id: entryId },
        data: { profile: profileJson, lastSeenAt: new Date() },
      });
    } else {
      const doc = await tx.document.create({
        data: {
          name: input.displayName,
          contentType: CATALOG_MEDIA_TYPE,
          sha256: hash(rawProfile),
          byteSize: Buffer.byteLength(rawProfile),
          data: null,
          textStatus: "EXTRACTED",
          summary,
          ownerId: catalogUserId,
          visibility: "PRIVATE",
          kind: "CATALOG",
        },
        select: { id: true },
      });
      documentId = doc.id;
      const entry = await tx.catalogEntry.create({
        data: {
          dataSourceId: input.dataSourceId,
          level: "DATASET",
          fqn: input.fqn,
          displayName: input.displayName,
          locator: { prefix: undefined, ...("schema" in profileJson ? { schema: (profileJson as { schema?: string }).schema } : {}) },
          profile: profileJson,
          documentId,
        },
        select: { id: true },
      });
      entryId = entry.id;
      await tx.document.update({ where: { id: documentId }, data: { catalogEntryId: entryId } });
    }

    if (chunks.length > 0) {
      await tx.documentChunk.createMany({
        data: chunks.map((c, index) => ({
          documentId,
          index,
          text: c.text,
          locator: c.locator as unknown as object,
        })),
      });
    }
    return { documentId, entryId, chunkCount: chunks.length };
  });
}

function hash(value: string): string {
  // Deterministic content hash for change detection; not a secret.
  let h = 0;
  for (let i = 0; i < value.length; i++) {
    h = (Math.imul(h, 31) + value.charCodeAt(i)) | 0;
  }
  return `card-${(h >>> 0).toString(16)}`;
}

export type { RenderInput, RenderedChunk };
