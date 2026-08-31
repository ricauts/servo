import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { forbid } from "@/lib/permissions";
import { sourceView } from "@/lib/kb/sources";

export const dynamic = "force-dynamic";

/** One data source (xds-01). The response is built by sourceView, which has
 *  no secretRef field at all — the pointer and the sealed credential behind
 *  it both stay server-side, and a route cannot leak either by forgetting to
 *  strip it. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  const denied = forbid(user, "kb.sources.view");
  if (denied) return denied;

  const { id } = await ctx.params;
  const source = await db.dataSource.findUnique({ where: { id } });
  if (!source) return Response.json({ error: "Data source not found." }, { status: 404 });

  const hasSecret =
    source.secretRef !== "" && (await db.setting.findUnique({ where: { key: source.secretRef } })) !== null;
  return Response.json({ source: sourceView(source, hasSecret) });
}
