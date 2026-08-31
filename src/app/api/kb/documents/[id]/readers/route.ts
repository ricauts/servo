import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { forbid } from "@/lib/permissions";
import { effectiveReaders } from "@/lib/kb/grants";

export const dynamic = "force-dynamic";

/**
 * The effective-readers preview (kb-03): who can read this document right
 * now, resolved through the SAME entitlement CTE retrieval uses. Sits behind
 * kb.share because it belongs to the share panel; if the preview and
 * retrieval ever disagree, one of them is a bug.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  const denied = forbid(user, "kb.share") ?? forbid(user, "kb.view");
  if (denied) return denied;

  const { id } = await params;
  const doc = await db.document.findUnique({ where: { id }, select: { id: true } });
  if (!doc) return Response.json({ error: "Unknown document." }, { status: 404 });

  // Candidates: every human account. The resolver stays the one definition
  // of "may read"; this endpoint never re-derives it.
  const candidates = await db.user.findMany({
    where: { role: { in: ["ADMIN", "AGENT", "REQUESTER"] } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  const readers = await effectiveReaders(id, candidates);
  return Response.json({ readers });
}
