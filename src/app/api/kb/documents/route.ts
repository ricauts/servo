import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { forbid } from "@/lib/permissions";
import { ingestDocument, MAX_UPLOAD_BYTES } from "@/lib/kb/ingest";
import { entitledDocumentIds } from "@/lib/kb/entitlement";

export const dynamic = "force-dynamic";

/** The fields every KB query selects — `data` (bytea) is deliberately absent:
 *  only the download route may materialize the stored bytes. */
const DOCUMENT_LIST_SELECT = {
  id: true,
  name: true,
  contentType: true,
  byteSize: true,
  sha256: true,
  textStatus: true,
  textError: true,
  summary: true,
  ownerId: true,
  collectionId: true,
  visibility: true,
  createdAt: true,
  updatedAt: true,
} as const;

/** List the documents the CURRENT human may read (kb-04). The human chain
 *  only — browsing is a person's act; agent chains arrive with the tools. */
export async function GET() {
  const user = await getCurrentUser();
  const denied = forbid(user, "kb.view");
  if (denied) return denied;

  const ids = await entitledDocumentIds(db, { humanId: user.id, agentId: null });
  const documents = await db.document.findMany({
    where: { id: { in: ids } },
    select: DOCUMENT_LIST_SELECT,
    orderBy: { createdAt: "desc" },
  });
  return Response.json({ documents });
}

/** Upload a document (multipart). The 25 MB stored-byte cap is enforced
 *  BEFORE anything touches the database — an oversized file leaves no row. */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  const denied = forbid(user, "kb.upload") ?? forbid(user, "kb.view");
  if (denied) return denied;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "Expected multipart form data." }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: 'A "file" field is required.' }, { status: 400 });
  }
  const visibility = form.get("visibility");
  const parsedVisibility =
    visibility === "STAFF" || visibility === "PUBLIC" ? visibility : "PRIVATE";

  if (file.size > MAX_UPLOAD_BYTES) {
    return Response.json(
      {
        error: `"${file.name}" is ${file.size} bytes; the stored-byte cap is 25 MB. Nothing was stored.`,
      },
      { status: 413 },
    );
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  try {
    const result = await ingestDocument({
      name: file.name,
      contentType: file.type || "application/octet-stream",
      bytes,
      ownerId: user.id,
      visibility: parsedVisibility,
    });
    return Response.json(result, { status: result.replacedExisting ? 200 : 201 });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Ingestion failed." },
      { status: 400 },
    );
  }
}
