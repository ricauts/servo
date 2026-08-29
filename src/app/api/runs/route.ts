// GET /api/runs — the runs console's list (spec ux-05). Read-only
// cross-ticket view of AgentRun rows for admins and agents (agents.view).
// The query itself lives in src/lib/runs-views.ts — the same function the
// /runs page renders from, so the API and the page can never disagree.
// AgentRun.conversation is never selected: steps are the audit trail,
// conversation is engine-resume state (key-absence is asserted by test).

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { listRuns } from "@/lib/runs-views";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!can(user, "agents.view")) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }
  const url = new URL(request.url);
  const runs = await listRuns({
    status: url.searchParams.get("status") ?? undefined,
    kind: url.searchParams.get("kind") ?? undefined,
    limit: Number(url.searchParams.get("limit")) || undefined,
  });
  return NextResponse.json({ runs });
}
