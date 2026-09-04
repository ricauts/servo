import type { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { forbid } from "@/lib/permissions";
import { canAdministerDocument } from "@/lib/kb/grants";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  /** A collection id, or null to take the document off its shelf. */
  collectionId: z.string().min(1).nullable().optional(),
  visibility: z.enum(["PRIVATE", "STAFF", "PUBLIC"]).optional(),
});

/**
 * PATCH /api/kb/documents/:id (kb-lib-2) — file a document on a shelf and
 * set its visibility. Same actor rule as sharing: the owner or a MANAGE
 * grant. Catalog cards are not filed by hand (their shelf is their data
 * source, cat-06).
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  const denied = forbid(user, "kb.view");
  if (denied) return denied;

  const { id } = await params;
  const doc = await db.document.findUnique({ where: { id }, select: { kind: true } });
  if (!doc) return Response.json({ error: "Unknown document." }, { status: 404 });
  if (doc.kind === "CATALOG") {
    return Response.json({ error: "catalog cards are filed by their data source, not by hand" }, { status: 403 });
  }
  if (!(await canAdministerDocument(user.id, id))) {
    return Response.json({ error: "Only the owner or a MANAGE grant can file this document." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" }, { status: 400 });
  }
  const data: { collectionId?: string | null; visibility?: string } = {};
  if (parsed.data.collectionId !== undefined) {
    if (parsed.data.collectionId !== null) {
      const shelf = await db.collection.findUnique({ where: { id: parsed.data.collectionId }, select: { id: true } });
      if (!shelf) return Response.json({ error: "Unknown collection." }, { status: 400 });
    }
    data.collectionId = parsed.data.collectionId;
  }
  if (parsed.data.visibility !== undefined) data.visibility = parsed.data.visibility;
  if (Object.keys(data).length === 0) {
    return Response.json({ error: "Nothing to change." }, { status: 400 });
  }

  const updated = await db.document.update({
    where: { id },
    data,
    select: { id: true, collectionId: true, visibility: true, collection: { select: { name: true } } },
  });
  return Response.json({
    document: {
      id: updated.id,
      collectionId: updated.collectionId,
      collectionName: updated.collection?.name ?? null,
      visibility: updated.visibility,
    },
  });
}
