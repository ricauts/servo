// Ticket query helpers + KPI aggregation. Dataset is small (POC), so KPIs are
// computed with plain Prisma queries and in-memory grouping.

import { db } from "@/lib/db";
import { CATEGORIES, PRIORITIES } from "@/lib/types";
import type { KpiResponse } from "@/lib/types";
import { evaluateSla } from "@/lib/sla-rules";

/** Compact user shape embedded in ticket list/detail payloads. */
export const userSummarySelect = {
  id: true,
  name: true,
  color: true,
  role: true,
} as const;

/** Compact group shape embedded in ticket payloads. */
export const groupSummarySelect = {
  id: true,
  name: true,
} as const;

/** Include for `GET /api/tickets` list items. */
export const ticketListInclude = {
  requester: { select: userSummarySelect },
  assignee: { select: userSummarySelect },
  group: { select: groupSummarySelect },
} as const;

/** Include for `GET /api/tickets/[id]` detail payloads. */
export const ticketDetailInclude = {
  requester: { select: userSummarySelect },
  assignee: { select: userSummarySelect },
  group: { select: groupSummarySelect },
  comments: {
    include: { author: true },
    orderBy: { createdAt: "asc" },
  },
  runs: {
    include: {
      steps: { orderBy: { index: "asc" } },
      approvals: true,
    },
    orderBy: { createdAt: "asc" },
  },
  approvals: {
    include: { decider: true },
    orderBy: { requestedAt: "asc" },
  },
  // Metadata only — the bytes are served by /api/attachments/[id], so a
  // ticket payload never carries screenshots inline.
  attachments: {
    select: { id: true, name: true, caption: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  },
} as const;

/** Next sequential ticket number, from the Postgres sequence
 *  `ticket_number_seq` (db-03, migration 0002): a sequence hands out
 *  distinct numbers to concurrent creates by construction, where
 *  max(number)+1 raced and one create always died on the unique
 *  constraint. The three creation sites (POST /api/tickets, the MCP
 *  create_ticket tool, inbound email) all route through here. */
export async function nextTicketNumber(): Promise<number> {
  const [row] = await db.$queryRaw<{ n: bigint }[]>`SELECT nextval('ticket_number_seq') AS n`;
  return Number(row.n);
}

/** Local-date YYYY-MM-DD (KPI series buckets use local calendar days). */
function localYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export async function getKpis(): Promise<KpiResponse> {
  const now = new Date();
  // Last 30 calendar days inclusive of today, from local midnight.
  const since = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29);

  const [openTickets, resolved30, created30, allApprovals, drafts30] = await Promise.all([
    db.ticket.findMany({
      where: { status: { notIn: ["RESOLVED", "CLOSED"] } },
      select: {
        category: true,
        priority: true,
        status: true,
        createdAt: true,
        firstResponseAt: true,
        resolvedAt: true,
        responseDueAt: true,
        resolutionDueAt: true,
      },
    }),
    db.ticket.findMany({
      where: { resolvedAt: { gte: since } },
      select: {
        createdAt: true,
        resolvedAt: true,
        assignee: { select: { role: true } },
      },
    }),
    db.ticket.findMany({
      where: { createdAt: { gte: since } },
      select: {
        createdAt: true,
        firstResponseAt: true,
        requester: { select: { name: true } },
      },
    }),
    db.approval.findMany({ select: { status: true } }),
    // Pending drafts (whenever created) + decisions of the last 30 days.
    db.replyDraft.findMany({
      where: { OR: [{ status: "PENDING" }, { decidedAt: { gte: since } }] },
      select: { status: true, edited: true },
    }),
  ]);

  // --- totals -------------------------------------------------------------
  const responded = created30.filter((t) => t.firstResponseAt !== null);
  const avgFirstResponseMinutes =
    responded.length === 0
      ? null
      : Math.round(
          responded.reduce(
            (sum, t) =>
              sum + (t.firstResponseAt!.getTime() - t.createdAt.getTime()) / 60_000,
            0,
          ) / responded.length,
        );

  const avgResolutionHours =
    resolved30.length === 0
      ? null
      : Math.round(
          (resolved30.reduce(
            (sum, t) =>
              sum + (t.resolvedAt!.getTime() - t.createdAt.getTime()) / 3_600_000,
            0,
          ) /
            resolved30.length) *
            10,
        ) / 10;

  const aiResolved = resolved30.filter(
    (t) => t.assignee?.role === "AI_AGENT",
  ).length;
  const aiResolutionRate =
    resolved30.length === 0 ? 0 : aiResolved / resolved30.length;

  const approvalStats = { approved: 0, rejected: 0, pending: 0 };
  for (const a of allApprovals) {
    if (a.status === "APPROVED") approvalStats.approved++;
    else if (a.status === "REJECTED") approvalStats.rejected++;
    else if (a.status === "PENDING") approvalStats.pending++;
  }

  const draftStats = { pending: 0, sentAsIs: 0, edited: 0, discarded: 0 };
  for (const d of drafts30) {
    if (d.status === "PENDING") draftStats.pending++;
    else if (d.status === "SENT") d.edited ? draftStats.edited++ : draftStats.sentAsIs++;
    else if (d.status === "REJECTED") draftStats.discarded++;
  }

  // --- createdByDay (zero-filled, local calendar days) --------------------
  const byDay = new Map<string, { date: string; created: number; resolved: number }>();
  for (let i = 0; i < 30; i++) {
    const d = new Date(since.getFullYear(), since.getMonth(), since.getDate() + i);
    const key = localYmd(d);
    byDay.set(key, { date: key, created: 0, resolved: 0 });
  }
  for (const t of created30) {
    const bucket = byDay.get(localYmd(t.createdAt));
    if (bucket) bucket.created++;
  }
  for (const t of resolved30) {
    const bucket = byDay.get(localYmd(t.resolvedAt!));
    if (bucket) bucket.resolved++;
  }

  // --- distributions (open + in-flight tickets) ---------------------------
  const catCounts = new Map<string, number>();
  const prioCounts = new Map<string, number>();
  for (const t of openTickets) {
    catCounts.set(t.category, (catCounts.get(t.category) ?? 0) + 1);
    prioCounts.set(t.priority, (prioCounts.get(t.priority) ?? 0) + 1);
  }

  // --- top requesters (created last 30d) ----------------------------------
  const requesterCounts = new Map<string, number>();
  for (const t of created30) {
    requesterCounts.set(
      t.requester.name,
      (requesterCounts.get(t.requester.name) ?? 0) + 1,
    );
  }
  const topRequesters = [...requesterCounts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return {
    totals: {
      open: openTickets.length,
      resolvedLast30d: resolved30.length,
      avgFirstResponseMinutes,
      avgResolutionHours,
      aiResolutionRate,
      pendingApprovals: approvalStats.pending,
      slaBreached: openTickets.filter(
        (t) => evaluateSla(t, now).state === "breached",
      ).length,
    },
    createdByDay: [...byDay.values()],
    byCategory: CATEGORIES.map((category) => ({
      category,
      count: catCounts.get(category) ?? 0,
    })),
    byPriority: PRIORITIES.map((priority) => ({
      priority,
      count: prioCounts.get(priority) ?? 0,
    })),
    aiVsHuman: [
      { resolver: "AI", count: aiResolved },
      { resolver: "HUMAN", count: resolved30.length - aiResolved },
    ],
    approvalStats,
    draftStats,
    topRequesters,
  };
}
