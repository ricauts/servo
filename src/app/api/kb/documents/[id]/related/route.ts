import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { forbid } from "@/lib/permissions";
import { relatedDocuments } from "@/lib/kb/graph";
import { entitledDocumentIds } from "@/lib/kb/entitlement";

export const dynamic = "force-dynamic";

/**
 * ACL-filtered related documents (kb-08). Computation is corpus-wide; READS
 * are always filtered — the entitlement CTE gates BOTH endpoints of every
 * edge, so a principal entitled to A but not B receives no edge to B: not
 * its id, not its name, and not the shared evidence.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  const denied = forbid(user, "kb.view");
  if (denied) return denied;

  const { id } = await params;
  // The anchor itself must be readable — same oracle, same answer.
  const readable = await entitledDocumentIds(db, { humanId: user.id, agentId: null });
  if (!readable.includes(id)) {
    return Response.json({ error: "Unknown document." }, { status: 404 });
  }

  const related = await relatedDocuments(db, { humanId: user.id, agentId: null }, id);
  return Response.json({ related });
}
