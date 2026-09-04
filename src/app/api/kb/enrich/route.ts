import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { forbid } from "@/lib/permissions";
import { enrichPending, getEnrichSettings } from "@/lib/kb/enrich";

export const dynamic = "force-dynamic";

/** GET /api/kb/enrich (kb-lib-2) — the switch state and how many indexed
 *  documents still lack an enrichment. Admin only, like the panel. */
export async function GET() {
  const user = await getCurrentUser();
  const denied = forbid(user, "kb.manage");
  if (denied) return denied;
  const [settings, pending] = await Promise.all([
    getEnrichSettings(),
    db.document.count({ where: { textStatus: "EXTRACTED", kind: "FILE", enrichedAt: null } }),
  ]);
  return Response.json({ ...settings, pending });
}

/** POST /api/kb/enrich (kb-lib-2) — enrich the documents that have none
 *  yet, oldest first, up to 25 per press. Admin only. */
export async function POST() {
  const user = await getCurrentUser();
  const denied = forbid(user, "kb.manage");
  if (denied) return denied;
  const settings = await getEnrichSettings();
  if (!settings.enabled) {
    return Response.json({ error: "Enrichment is off — turn it on first." }, { status: 409 });
  }
  const report = await enrichPending(25);
  return Response.json(report);
}
