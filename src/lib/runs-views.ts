// Shared read shape for the runs console (spec ux-05): one select used by
// both the server page's first paint and GET /api/runs, so the console can
// never show two different notions of a run. Read-only — this module has no
// mutation path and never touches AgentRun.conversation: steps are the
// audit trail; the conversation is engine-resume state.
//
// agentUserId is a bare FK with no Prisma relation (the engine never
// navigates from a run to its user), so agent identities resolve in a
// second query and the views below carry the resolved name instead.

import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

export const RUN_STATUSES = ["RUNNING", "WAITING_APPROVAL", "COMPLETED", "FAILED"] as const;
export const RUN_KINDS = ["TRIAGE", "RESOLVE"] as const;

export const RUN_LIST_SELECT = {
  id: true,
  kind: true,
  status: true,
  summary: true,
  error: true,
  qaVerdict: true,
  createdAt: true,
  completedAt: true, // real column — the draft's startedAt/finishedAt never existed
  agentUserId: true,
  ticket: { select: { id: true, number: true, title: true } },
  profile: { select: { name: true } },
  _count: { select: { steps: true, approvals: true } },
} satisfies Prisma.AgentRunSelect;

export type RunRow = Prisma.AgentRunGetPayload<{ select: typeof RUN_LIST_SELECT }>;
export type RunView = Omit<RunRow, "agentUserId" | "_count"> & {
  steps: number;
  approvals: number;
  agent: { name: string; aiKind: string | null };
};

/** Minimal surface the query needs — satisfied by the real client, by a
 *  transaction, and by the $extends-wrapped client the app exports. */

/** The console's list query — the single owner of what a run looks like,
 *  shared by the /runs page's first paint and GET /api/runs. Uses the app's
 *  db module directly (the codebase's pattern); tests mock @/lib/db. */
export async function listRuns(
  filters: { status?: string; kind?: string; limit?: number } = {},
): Promise<RunView[]> {
  const status = RUN_STATUSES.find((s) => s === filters.status);
  const kind = RUN_KINDS.find((k) => k === filters.kind);
  const limit = Math.min(filters.limit ?? 50, 200);

  const rows = await db.agentRun.findMany({
    where: { ...(status ? { status } : {}), ...(kind ? { kind } : {}) },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: RUN_LIST_SELECT,
  });

  const agents = await db.user.findMany({
    where: { id: { in: [...new Set(rows.map((r) => r.agentUserId))] } },
    select: { id: true, name: true, aiKind: true },
  });
  const agentById = new Map(agents.map((a) => [a.id, a]));

  return rows.map(({ agentUserId, _count, ...rest }) => ({
    ...rest,
    steps: _count.steps,
    approvals: _count.approvals,
    agent: agentById.get(agentUserId) ?? { name: "unknown agent", aiKind: null },
  }));
}

