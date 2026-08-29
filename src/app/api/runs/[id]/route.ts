// GET /api/runs/:id — one run's full audit trail (spec ux-05): the
// AgentStep timeline ordered by index, plus the approvals the run raised
// with their decider names. agents.view-gated, read-only. The run's
// CONVERSATION is never serialized — steps are the audit trail a human
// reviews; the conversation is engine-resume state (key-absence asserted
// by test). Before ux-05 this route had no gate and no select: any signed-in
// user could read any run's full conversation.

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!can(user, "agents.view")) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }
  const { id } = await params;

  const run = await db.agentRun.findUnique({
    where: { id },
    select: {
      id: true,
      kind: true,
      status: true,
      summary: true,
      error: true,
      qaVerdict: true,
      qaNotes: true,
      createdAt: true,
      completedAt: true,
      agentUserId: true,
      ticket: { select: { id: true, number: true, title: true } },
      profile: { select: { name: true } },
      steps: {
        orderBy: { index: "asc" },
        select: {
          id: true,
          index: true,
          type: true,
          toolName: true,
          content: true,
          riskLevel: true,
          createdAt: true,
        },
      },
      approvals: {
        orderBy: { requestedAt: "asc" },
        select: {
          id: true,
          toolName: true,
          riskLevel: true,
          status: true,
          reason: true,
          requestedAt: true,
          decidedAt: true,
          decider: { select: { name: true } },
        },
      },
    },
  });
  if (!run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  // agentUserId is a bare FK (no relation — the engine never navigates from
  // a run to its user), so the name resolves in a second query.
  const agent = await db.user.findUnique({
    where: { id: run.agentUserId },
    select: { name: true, aiKind: true },
  });
  const { agentUserId, ...rest } = run;
  return NextResponse.json({
    run: { ...rest, agent: agent ?? { name: "unknown agent", aiKind: null } },
  });
}
