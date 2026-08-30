import { getCurrentUser } from "@/lib/auth";
import { forbid } from "@/lib/permissions";
import { extractorHealth } from "@/lib/kb/extractors/docling";

export const dynamic = "force-dynamic";

/**
 * GET /api/kb/extractor-health (dcl-09) — the sidecar surface for the KB
 * settings page: configured URL, the reported docling-serve version (or
 * the unknown literal — never a guess), and the circuit state, so a
 * mismatched digest shows up as a VERSION rather than as a permanent
 * stream of fallback baselines. LANE 1: unconfigured answers without any
 * fetch. kb.manage only.
 */
export async function GET() {
  const user = await getCurrentUser();
  const denied = forbid(user, "kb.manage");
  if (denied) return denied;
  const { db } = await import("@/lib/db");
  const health = await extractorHealth(db);
  return Response.json(health);
}
