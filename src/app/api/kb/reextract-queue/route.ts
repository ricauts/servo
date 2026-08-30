import { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { forbid } from "@/lib/permissions";
import { reextractFallbackQueue } from "@/lib/kb/reingest";

export const dynamic = "force-dynamic";

/**
 * GET: the fallback queue — documents whose preferred extractor was
 * unavailable when they landed (extractorFallback IS NOT NULL), oldest
 * first. POST: walk it one document at a time. kb.manage only.
 */
export async function GET() {
  const user = await getCurrentUser();
  const denied = forbid(user, "kb.manage");
  if (denied) return denied;
  const { db } = await import("@/lib/db");
  const queue = await db.document.findMany({
    where: { extractorFallback: { not: null } },
    orderBy: { extractedAt: "asc" },
    select: {
      id: true, name: true, extractorFallback: true, extractedAt: true,
      extractor: true, extractorVersion: true,
    },
  });
  return Response.json({ queue });
}

export async function POST(_req: NextRequest) {
  const user = await getCurrentUser();
  const denied = forbid(user, "kb.manage");
  if (denied) return denied;
  const result = await reextractFallbackQueue();
  return Response.json(result);
}
