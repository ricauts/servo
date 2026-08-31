import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { forbid } from "@/lib/permissions";
import { reextractDocument } from "@/lib/kb/reingest";

export const dynamic = "force-dynamic";

/**
 * POST /api/kb/documents/:id/reextract (dcl-09) — re-run extraction on the
 * stored bytes with the currently configured extractor. Permission shape
 * matches kb-03's document access: a REQUESTER gets 403; a non-owner
 * without kb.manage gets 403; the document's owner and admins may proceed.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  const denied = forbid(user, "kb.view");
  if (denied) return denied;

  const { id } = await params;
  const doc = await db.document.findUnique({ where: { id }, select: { ownerId: true } });
  if (!doc) return Response.json({ error: "Unknown document." }, { status: 404 });

  const isOwner = doc.ownerId === user.id;
  const canManage = !forbid(user, "kb.manage");
  // AGENTs see the KB but only re-extract their own documents; ADMINs
  // (kb.manage) may re-extract anyone's. REQUESTERs never reach here —
  // kb.view already refused them.
  if (!isOwner && !canManage) {
    return Response.json(
      { error: "Only the document's owner or an admin may re-extract it." },
      { status: 403 },
    );
  }

  try {
    const result = await reextractDocument(id);
    return Response.json(result);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Re-extraction failed." },
      { status: 400 },
    );
  }
}
