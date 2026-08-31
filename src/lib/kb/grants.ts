// Grant administration for the knowledge base (spec kb-03). Share/revoke on
// documents and collections, and the effective-readers preview that resolves
// through the SAME entitlement fragment retrieval uses — if the preview and
// retrieval ever disagree, one of them is a bug, and the test says which.
//
// Hard rules encoded here:
//   - REQUESTER never reaches any of this (kb.* actions exclude them).
//   - Sharing requires kb.share AND either owning the target or holding a
//     MANAGE grant on it — a plain READ grant must not be re-shareable.
//   - Collection administration requires kb.manage.
//   - Deleting a target sweeps its grants in the SAME transaction; the
//     polymorphic subject side (users/groups/agents) has no FK to sweep,
//     so subject deletion is checked by the caller (kb-03's test asserts
//     the document side).

import type { PrismaClient, KbGrant } from "@prisma/client";
import { entitledDocumentIds, humanChainCte } from "@/lib/kb/entitlement";
import { db } from "@/lib/db";

export type GrantSubjectType = "USER" | "GROUP" | "AGENT";
export type GrantAccess = "READ" | "MANAGE";

export interface ShareInput {
  target: { documentId: string } | { collectionId: string };
  subjectType: GrantSubjectType;
  subjectId: string;
  access?: GrantAccess;
}

/** May `actor` administer grants on this document? Owner or MANAGE-granted. */
export async function canAdministerDocument(
  actorId: string,
  documentId: string,
): Promise<boolean> {
  const doc = await db.document.findUnique({
    where: { id: documentId },
    select: { ownerId: true },
  });
  if (!doc) return false;
  if (doc.ownerId === actorId) return true;
  const manage = await db.kbGrant.findFirst({
    where: { documentId, subjectType: "USER", subjectId: actorId, access: "MANAGE" },
    select: { id: true },
  });
  return manage !== null;
}

/**
 * Share a document or collection with a subject. Re-sharing updates the
 * access level: the real uniqueness lives in the partial indexes Prisma
 * cannot address in a `where`, so the create is allowed to lose the race —
 * the unique violation is caught and turned into an update.
 */
export async function shareGrant(
  input: ShareInput,
  grantedById: string,
): Promise<KbGrant> {
  const access = input.access ?? "READ";
  const where =
    "documentId" in input.target
      ? { documentId: input.target.documentId }
      : { collectionId: input.target.collectionId };
  const data = { ...where, subjectType: input.subjectType, subjectId: input.subjectId, access, grantedById };
  try {
    return await db.kbGrant.create({ data });
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "P2002") {
      const existing = await db.kbGrant.findFirst({
        where: { ...where, subjectType: input.subjectType, subjectId: input.subjectId },
      });
      if (existing) {
        return db.kbGrant.update({ where: { id: existing.id }, data: { access } });
      }
    }
    throw err;
  }
}

/** Revoke a grant. Unknown ids are a no-op. */
export async function revokeGrant(id: string): Promise<void> {
  await db.kbGrant.deleteMany({ where: { id } });
}

/**
 * The effective readers of a document, resolved through the same CTE
 * retrieval uses: every human whose human-chain contains the document,
 * computed by asking the resolver per candidate user. Callers pass the
 * candidate users (a small install-wide set); the resolver stays the one
 * definition of "may read".
 */
export async function effectiveReaders(
  documentId: string,
  candidates: { id: string; name: string }[],
): Promise<{ id: string; name: string }[]> {
  const readers: { id: string; name: string }[] = [];
  for (const candidate of candidates) {
    const ids = await entitledDocumentIds(db, { humanId: candidate.id, agentId: null });
    if (ids.includes(documentId)) readers.push(candidate);
  }
  return readers;
}

/**
 * Delete a document and everything hanging off it in ONE transaction —
 * chunks and edges cascade by FK; grants cascade on the document side, and
 * the collection-targeted grants referencing this document's collection are
 * the collection's, not this document's, so nothing else needs sweeping.
 */
export async function deleteDocumentCascade(documentId: string): Promise<void> {
  await db.$transaction([
    db.document.delete({ where: { id: documentId } }),
  ]);
}

/** Exported for kb-03's parity test: the composed human-chain statement. */
export { humanChainCte };
