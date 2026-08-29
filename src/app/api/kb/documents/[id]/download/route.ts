import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { forbid } from "@/lib/permissions";
import { entitledDocumentIds } from "@/lib/kb/entitlement";

export const dynamic = "force-dynamic";

/** The ONE route that materializes Document.data (kb-16): every other query
 *  selects without it. The anchor resolves through the entitlement oracle. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  const denied = forbid(user, "kb.view");
  if (denied) return denied;

  const { id } = await params;
  const readable = await entitledDocumentIds(db, { humanId: user.id, agentId: null });
  if (!readable.includes(id)) {
    return Response.json({ error: "Unknown document." }, { status: 404 });
  }
  const doc = await db.document.findUnique({ where: { id } });
  if (!doc) return Response.json({ error: "Unknown document." }, { status: 404 });

  return new Response(new Uint8Array(doc.data), {
    headers: {
      "content-type": doc.contentType || "application/octet-stream",
      "content-disposition": `attachment; filename="${encodeURIComponent(doc.name)}"`,
      "content-length": String(doc.byteSize),
    },
  });
}
