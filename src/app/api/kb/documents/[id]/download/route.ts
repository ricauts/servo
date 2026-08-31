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
  // A catalog card has no bytes to download — its canonical profile lives
  // in CatalogEntry.profile and every redaction the renderer makes would be
  // bypassed by one download of Document.data (cat-01's CHECK keeps data
  // NULL for exactly this reason).
  if (doc.kind === "CATALOG") {
    return Response.json({ error: "Catalog cards have no downloadable file." }, { status: 403 });
  }

  return new Response(new Uint8Array(doc.data ?? new Uint8Array()), {
    headers: {
      "content-type": doc.contentType || "application/octet-stream",
      "content-disposition": `attachment; filename="${encodeURIComponent(doc.name)}"`,
      "content-length": String(doc.byteSize),
    },
  });
}
