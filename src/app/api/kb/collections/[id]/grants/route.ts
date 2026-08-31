import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { forbid } from "@/lib/permissions";
import { revokeGrant, shareGrant } from "@/lib/kb/grants";

export const dynamic = "force-dynamic";

/** Collection grants (kb-03): sharing needs kb.share; the collection must
 *  exist. Administering collections themselves (create/rename) is kb.manage. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  const denied = forbid(user, "kb.share") ?? forbid(user, "kb.view");
  if (denied) return denied;

  const { id } = await params;
  const collection = await db.collection.findUnique({ where: { id }, select: { id: true } });
  if (!collection) return Response.json({ error: "Unknown collection." }, { status: 404 });

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
    { target: { collectionId: id }, subjectType, subjectId, access },
    user.id,
  );
  return Response.json({ grant: { ...grant, grantedBy: undefined } }, { status: 201 });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  const denied = forbid(user, "kb.share") ?? forbid(user, "kb.view");
  if (denied) return denied;

  const { id } = await params;
  const collection = await db.collection.findUnique({ where: { id }, select: { id: true } });
  if (!collection) return Response.json({ error: "Unknown collection." }, { status: 404 });

  const grantId = new URL(req.url).searchParams.get("grantId");
  if (!grantId) return Response.json({ error: "grantId is required." }, { status: 400 });
  await revokeGrant(grantId);
  return Response.json({ ok: true });
}
