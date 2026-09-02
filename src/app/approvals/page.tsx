import { Lock, ShieldCheck } from "lucide-react";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { can, canDecideApproval } from "@/lib/permissions";
import PageHeader from "@/components/shell/PageHeader";
import Badge from "@/components/common/Badge";
import EmptyState from "@/components/common/EmptyState";
import ApprovalCard, {
  type PendingApprovalView,
} from "@/components/admin/ApprovalCard";
import DraftQueueCard, {
  type DraftQueueView,
} from "@/components/admin/DraftQueueCard";
import ApprovalHistoryTable, {
  type ApprovalHistoryRow,
} from "@/components/admin/ApprovalHistoryTable";
import type { ApprovalStatus, RiskLevel } from "@/lib/types";

export const dynamic = "force-dynamic";

function prettyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

export default async function ApprovalsPage() {
  const user = await getCurrentUser();
  if (!can(user, "approval.view")) {
    return (
      <>
        <PageHeader
          title="Approvals"
          description="Risky agent actions pause here until a human signs off."
        />
        <div className="p-4 md:p-8">
          <EmptyState
            icon={Lock}
            title="Approver access required"
            hint="Only admins and agents can see the approval queue. Switch to an admin or agent user from the sidebar."
          />
        </div>
      </>
    );
  }

  const [pending, decided, aiUsers, pendingDrafts] = await Promise.all([
    db.approval.findMany({
      where: { status: "PENDING" },
      include: { ticket: true, run: true },
      orderBy: { requestedAt: "desc" },
    }),
    db.approval.findMany({
      where: { status: { in: ["APPROVED", "REJECTED"] } },
      include: { ticket: true, decider: true },
      orderBy: { decidedAt: "desc" },
      take: 50,
    }),
    db.user.findMany({ where: { role: "AI_AGENT" } }),
    db.replyDraft.findMany({
      where: { status: "PENDING" },
      include: { ticket: { include: { requester: true } } },
      orderBy: { createdAt: "asc" }, // oldest first: answer who has waited longest
    }),
  ]);

  const agentNameById = new Map(aiUsers.map((u) => [u.id, u.name]));

  const pendingViews: PendingApprovalView[] = pending.map((a) => ({
    id: a.id,
    toolName: a.toolName,
    toolInput: prettyJson(a.toolInput),
    riskLevel: a.riskLevel as RiskLevel,
    requestedAt: a.requestedAt.toISOString(),
    agentName: agentNameById.get(a.run.agentUserId) ?? null,
    ticket: {
      id: a.ticket.id,
      number: a.ticket.number,
      title: a.ticket.title,
    },
  }));

  const draftViews: DraftQueueView[] = pendingDrafts.map((d) => ({
    id: d.id,
    body: d.body,
    agentName: d.agentName,
    createdAt: d.createdAt.toISOString(),
    requesterName: d.ticket.requester.name,
    ticket: {
      id: d.ticket.id,
      number: d.ticket.number,
      title: d.ticket.title,
      status: d.ticket.status,
    },
  }));

  const historyRows: ApprovalHistoryRow[] = decided.map((a) => ({
    id: a.id,
    status: a.status as ApprovalStatus,
    toolName: a.toolName,
    riskLevel: a.riskLevel as RiskLevel,
    ticketId: a.ticket.id,
    ticketNumber: a.ticket.number,
    ticketTitle: a.ticket.title,
    deciderName: a.decider?.name ?? null,
    decidedAt: a.decidedAt ? a.decidedAt.toISOString() : null,
  }));

  return (
    <>
      <PageHeader
        title="Approvals"
        description="Risky agent actions pause here until a human signs off. HIGH-risk actions can only be decided by admins."
      />
      <div className="space-y-8 p-4 md:p-8">
        <section>
          <div className="flex items-center gap-2">
            <h2 className="font-heading text-base font-semibold tracking-tight">
              Pending queue
            </h2>
            {pendingViews.length > 0 && (
              <Badge tone="warn">{pendingViews.length}</Badge>
            )}
          </div>
          <div className="mt-3">
            {pendingViews.length === 0 ? (
              <EmptyState
                icon={ShieldCheck}
                title="The approval queue is clean"
                hint="When an AI agent wants to run a tool that requires human sign-off, it will pause and show up here."
              />
            ) : (
              <div className="flex flex-col gap-4">
                {pendingViews.map((a) => (
                  <ApprovalCard
                    key={a.id}
                    approval={a}
                    canDecide={canDecideApproval(user, a.riskLevel)}
                  />
                ))}
              </div>
            )}
          </div>
        </section>

        <section>
          <div className="flex items-center gap-2">
            <h2 className="font-heading text-base font-semibold tracking-tight">
              Reply drafts awaiting review
            </h2>
            {draftViews.length > 0 && <Badge tone="brand">{draftViews.length}</Badge>}
          </div>
          <div className="mt-3">
            {draftViews.length === 0 ? (
              <p className="font-sans text-sm text-muted-foreground">
                No drafts waiting. When the AI drafts a reply to a requester
                (automatically for inbound email, or from a ticket), it shows up
                here for a human to approve and send.
              </p>
            ) : (
              <div className="flex flex-col gap-4">
                {draftViews.map((d) => (
                  <DraftQueueCard key={d.id} draft={d} />
                ))}
              </div>
            )}
          </div>
        </section>

        <section>
          <h2 className="font-heading text-base font-semibold tracking-tight">
            History
          </h2>
          <div className="mt-3">
            {historyRows.length === 0 ? (
              <p className="font-sans text-sm text-muted-foreground">
                No decisions yet.
              </p>
            ) : (
              <ApprovalHistoryTable rows={historyRows} />
            )}
          </div>
        </section>
      </div>
    </>
  );
}
