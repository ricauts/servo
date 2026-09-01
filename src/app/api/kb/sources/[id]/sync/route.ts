import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { forbid } from "@/lib/permissions";
import { db } from "@/lib/db";
import { syncSource } from "@/lib/kb/sources/sync";

export const dynamic = "force-dynamic";

/**
 * POST /api/kb/sources/:id/sync (xds-05) — THE trigger, and the only one.
 * kb.sources.manage; syncEveryMin is a recorded hint for an external
 * caller and this route is what that caller hits. No scheduler exists
 * anywhere in Servo, by design.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  const denied = forbid(user, "kb.sources.manage");
  if (denied) return denied;

  const { id } = await params;
  const source = await db.dataSource.findUnique({ where: { id }, select: { id: true } });
  if (!source) return Response.json({ error: "Unknown source." }, { status: 404 });

  try {
    const outcome = await syncSource(id);
    if (outcome.busy) return Response.json({ ...outcome, error: outcome.busy }, { status: 409 });
    return Response.json(outcome);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "The sync failed." },
      { status: 400 },
    );
  }
}
