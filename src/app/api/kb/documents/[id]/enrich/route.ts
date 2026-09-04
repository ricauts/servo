import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { forbid } from "@/lib/permissions";
import { enrichDocument, getEnrichSettings } from "@/lib/kb/enrich";

export const dynamic = "force-dynamic";

/**
 * POST /api/kb/documents/:id/enrich (kb-lib-2) — run the model enrichment
 * on one document now, re-running if it already has one. Same actor rule
 * as re-extract: the owner or an admin. Refuses while the switch is off,
 * naming the setting, so a button never sends content the operator has
 * not agreed to send.
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
  if (!isOwner && !canManage) {
    return Response.json({ error: "Only the document's owner or an admin may enrich it." }, { status: 403 });
  }

  const settings = await getEnrichSettings();
  if (!settings.enabled) {
    return Response.json(
      { error: "Enrichment is off — turn on kb.enrich.enabled in Knowledge → AI enrichment first." },
      { status: 409 },
    );
  }
  const outcome = await enrichDocument(id, { settings, force: true });
  if (outcome.status === "failed") return Response.json({ error: outcome.error, outcome }, { status: 502 });
  return Response.json({ outcome });
}
