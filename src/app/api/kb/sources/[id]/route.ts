import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { forbid } from "@/lib/permissions";
import { redactSource, sourceSecretKey } from "@/lib/kb/sources";

export const dynamic = "force-dynamic";

/** One source (xds-01). Behind kb.sources.view, and redacted by the same
 *  function the list uses — a second hand-written response shape is how a
 *  secret reaches a body that the list route had already learned to omit. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  const denied = forbid(user, "kb.sources.view");
  if (denied) return denied;

  const { id } = await ctx.params;
  const row = await db.dataSource.findUnique({ where: { id } });
  if (!row) return Response.json({ error: "Not found." }, { status: 404 });

  const key = sourceSecretKey(row.id);
  const setting = await db.setting.findUnique({ where: { key }, select: { key: true } });
  return Response.json({ source: redactSource(row, setting !== null) });
}
