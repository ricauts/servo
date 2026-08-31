import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { forbid } from "@/lib/permissions";
import { canAdministerDocument, revokeGrant, shareGrant } from "@/lib/kb/grants";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Share or revoke access to one document (kb-03). Behind kb.share, and only
 *  for the owner or a MANAGE grant — a READ grant is not re-shareable.
 *
 *  Catalog cards can never be shared (cat-06): their access is DERIVED from
 *  the data source, and a grant row would be a second source of truth that
 *  survives a source revocation — the exact failure derived entitlement
 *  exists to prevent. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  const denied = forbid(user, "kb.share") ?? forbid(user, "kb.view");
  if (denied) return denied;

  const { id } = await params;
  const target = await db.document.findUnique({
    where: { id },
    select: { kind: true },
  });
  if (target?.kind === "CATALOG") {
    return Response.json(
      { error: "catalog cards inherit their data source's access — share the data source instead" },
      { status: 403 },
    );
  }
  if (!(await canAdministerDocument(user.id, id))) {
    return Response.json(
      { error: "Only the owner or a MANAGE grant can share this document." },
      { status: 403 },
    );
  }

  const body = (await req.json().catch(() => null)) as {
    subjectType?: string;
    subjectId?: string;
    access?: string;
  } | null;
  const subjectType = body?.subjectType;
  const subjectId = body?.subjectId?.trim();
  if (
    !subjectId ||
    (subjectType !== "USER" && subjectType !== "GROUP" && subjectType !== "AGENT")
  ) {
    return Response.json(
      { error: "subjectType must be USER, GROUP or AGENT, and subjectId is required." },
      { status: 400 },
    );
  }
  const access = body?.access === "MANAGE" ? "MANAGE" : "READ";

  const grant = await shareGrant(
    { target: { documentId: id }, subjectType, subjectId, access },
    user.id,
  );
  return Response.json({ grant: { ...grant, grantedBy: undefined } }, { status: 201 });
}

/** Revoke a grant by id. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  const denied = forbid(user, "kb.share") ?? forbid(user, "kb.view");
  if (denied) return denied;

  const { id } = await params;
  if (!(await canAdministerDocument(user.id, id))) {
    return Response.json(
      { error: "Only the owner or a MANAGE grant can share this document." },
      { status: 403 },
    );
  }
  const grantId = new URL(req.url).searchParams.get("grantId");
  if (!grantId) {
    return Response.json({ error: "grantId is required." }, { status: 400 });
  }
  await revokeGrant(grantId);
  return Response.json({ ok: true });
}
