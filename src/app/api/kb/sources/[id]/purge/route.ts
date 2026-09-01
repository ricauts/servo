import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { forbid } from "@/lib/permissions";
import { db } from "@/lib/db";
import { purgeGone } from "@/lib/kb/sources/prune";

export const dynamic = "force-dynamic";

/**
 * POST /api/kb/sources/:id/purge (xds-06) — the explicit admin action that
 * zeroes stored bytes on GONE documents. kb.sources.manage; the body must
 * carry { confirm: true } (an unconfirmed purge is a 400, not a half-step).
 * Documents still cited by a draft's sources are REFUSED with the citation
 * named — erasing the audit trail is the failure GONE exists to prevent.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  const denied = forbid(user, "kb.sources.manage");
  if (denied) return denied;

  const { id } = await params;
  const source = await db.dataSource.findUnique({ where: { id }, select: { id: true } });
  if (!source) return Response.json({ error: "Unknown source." }, { status: 404 });

  const body = (await req.json().catch(() => null)) as { confirm?: boolean } | null;
  if (!body?.confirm) {
    return Response.json(
      { error: "A purge destroys stored bytes and cannot be undone — send { confirm: true }." },
      { status: 400 },
    );
  }

  const report = await purgeGone(id);
  return Response.json(report);
}
