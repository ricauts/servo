import { getCurrentUser } from "@/lib/auth";
import { forbid } from "@/lib/permissions";
import { packsState } from "@/lib/packs/state";

export const dynamic = "force-dynamic";

/** GET /api/packs (kb-lib-5) — the catalog merged with this install's
 *  state, and the local plugin bundles with their items. Read-only; every
 *  change goes through the route that owns the row. */
export async function GET() {
  const user = await getCurrentUser();
  const denied = forbid(user, "packs.view");
  if (denied) return denied;
  return Response.json(await packsState());
}
