import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { BookOpen } from "lucide-react";
import Avatar from "@/components/common/Avatar";
import Badge from "@/components/common/Badge";
import Timeline from "@/components/tickets/Timeline";
import EscalatePanel from "@/components/tickets/EscalatePanel";
import SlaBadge from "@/components/tickets/SlaBadge";
import PendingApprovalCard from "@/components/tickets/PendingApprovalCard";
import PropertiesPanel from "@/components/tickets/PropertiesPanel";
import ReplyDraftCard from "@/components/tickets/ReplyDraftCard";
import AttachmentGallery from "@/components/tickets/AttachmentGallery";
import { getSmtpConfig } from "@/lib/notify";
import RelativeTime from "@/components/tickets/RelativeTime";
import RunResolverCard from "@/components/tickets/RunResolverCard";
import RunSummaryCard from "@/components/tickets/RunSummaryCard";
import CommentComposer from "@/components/tickets/CommentComposer";
import {
  CATEGORY_LABEL,
  PRIORITY_LABEL,
  PRIORITY_TONE,
  STATUS_LABEL,
  STATUS_TONE,
} from "@/lib/labels";
import type {
  Category,
  Priority,
  RiskLevel,
  TicketStatus,
} from "@/lib/types";

export default async function TicketDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const ticket = await db.ticket.findUnique({
    where: { id },
    include: {
      requester: true,
      assignee: true,
      group: true,
      comments: {
        include: { author: true },
        orderBy: { createdAt: "asc" },
      },
      runs: {
        include: {
          steps: { orderBy: { index: "asc" } },
          approvals: { include: { decider: true } },
          profile: { select: { name: true } },
        },
        orderBy: { createdAt: "asc" },
      },
      approvals: {
        include: { decider: true },
        orderBy: { requestedAt: "asc" },
      },
      attachments: {
        select: { id: true, caption: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!ticket) notFound();

  const currentUser = await getCurrentUser();
  // A requester can only open their own tickets (agents/admins see all).
  if (currentUser.role === "REQUESTER" && ticket.requesterId !== currentUser.id) {
    notFound();
  }
  const aiUsers = await db.user.findMany({ where: { role: "AI_AGENT" } });
  const agents = Object.fromEntries(aiUsers.map((u) => [u.id, u]));

  const canWorkTicket = can(currentUser, "ticket.update") && ticket.status !== "CLOSED";
  const [pendingDraft, smtp] = canWorkTicket
    ? await Promise.all([
        db.replyDraft.findFirst({ where: { ticketId: ticket.id, status: "PENDING" } }),
        getSmtpConfig(),
      ])
    : [null, null];

  const pendingApproval = ticket.approvals.find((a) => a.status === "PENDING");
  const hasActiveRun = ticket.runs.some(
    (r) => r.status === "RUNNING" || r.status === "WAITING_APPROVAL",
  );
  const railRuns = [...ticket.runs].reverse();

  // reb-05: provenance both ways — the "Distill into skill" action on a
  // resolved ticket, and the skills already distilled from this one.
  const distillable =
    (ticket.status === "RESOLVED" || ticket.status === "CLOSED") && can(currentUser, "skills.manage");
  const distilled = await db.skill.findMany({
    where: { sourceTicketId: ticket.id },
    select: { id: true, slug: true, name: true, enabled: true },
    orderBy: { createdAt: "asc" },
  });

  return (
    <>
      {/* Header */}
      <div className="border-b border-border bg-card px-4 md:px-8 py-6">
        <Link
          href="/tickets"
          className="inline-flex items-center gap-1.5 font-mono text-[11px] font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft size={12} />
          Tickets
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <span className="font-mono text-lg font-semibold text-muted-foreground">
            #{ticket.number}
          </span>
          <h1 className="font-heading text-2xl font-bold tracking-tight">
            {ticket.title}
          </h1>
        </div>
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <Badge tone={STATUS_TONE[ticket.status as TicketStatus]}>
            {STATUS_LABEL[ticket.status as TicketStatus] ?? ticket.status}
          </Badge>
          <Badge tone={PRIORITY_TONE[ticket.priority as Priority]}>
            {PRIORITY_LABEL[ticket.priority as Priority] ?? ticket.priority}
          </Badge>
          <Badge tone="neutral">
            {CATEGORY_LABEL[ticket.category as Category] ?? ticket.category}
          </Badge>
          {ticket.group && <Badge tone="brand">{ticket.group.name}</Badge>}
          <SlaBadge ticket={ticket} showKind />
          {distillable && (
            <Link
              href={`/skills?distill=${ticket.id}`}
              className="ml-1 inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 font-mono text-[10.5px] uppercase tracking-wide text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title="Open the skill editor prefilled from this ticket's resolution"
            >
              <BookOpen size={11} />
              Distill into skill
            </Link>
          )}
          {distilled.map((skill) => (
            <Link
              key={skill.id}
              href={`/skills#${skill.slug}`}
              className="inline-flex items-center gap-1 rounded-md bg-violet-soft px-2 py-0.5 font-mono text-[10.5px] uppercase tracking-wide text-violet transition-colors hover:bg-violet-soft/70"
              title={skill.enabled ? "Distilled skill (enabled)" : "Distilled skill (disabled)"}
            >
              skill · {skill.name}
            </Link>
          ))}
          <span className="ml-1 flex items-center gap-1.5">
            <Avatar
              name={ticket.requester.name}
              color={ticket.requester.color}
              size={18}
            />
            <span className="font-sans text-xs text-muted-foreground">
              {ticket.requester.name} · opened{" "}
              <RelativeTime value={ticket.createdAt} /> · updated{" "}
              <RelativeTime value={ticket.updatedAt} />
            </span>
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-8 p-4 md:p-8 xl:grid-cols-[minmax(0,1fr)_320px]">
        {/* Main column: approval callout + unified timeline + composer */}
        <div className="min-w-0 space-y-6">
          {pendingApproval && (
            <PendingApprovalCard
              approvalId={pendingApproval.id}
              toolName={pendingApproval.toolName}
              toolInput={pendingApproval.toolInput}
              riskLevel={pendingApproval.riskLevel as RiskLevel}
              requestedAt={pendingApproval.requestedAt}
            />
          )}

          <AttachmentGallery attachments={ticket.attachments} />

          {canWorkTicket && (
            <ReplyDraftCard
              ticketId={ticket.id}
              draft={pendingDraft}
              requesterName={ticket.requester.name}
              emailConfigured={Boolean(smtp && smtp.enabled && smtp.url.length > 0)}
            />
          )}

          <Timeline
            ticket={ticket}
            comments={ticket.comments}
            runs={ticket.runs}
            agents={agents}
          />

          <div className="pl-10">
            <CommentComposer ticketId={ticket.id} />
          </div>
        </div>

        {/* Right rail */}
        <div className="space-y-4">
          <PropertiesPanel
            ticketId={ticket.id}
            status={ticket.status}
            priority={ticket.priority}
            category={ticket.category}
            assigneeId={ticket.assigneeId}
            assigneeName={ticket.assignee?.name ?? null}
          />

          {can(currentUser, "ticket.escalate") && (
            <EscalatePanel
              ticketId={ticket.id}
              groupId={ticket.groupId}
              groupName={ticket.group?.name ?? null}
              escalationLevel={ticket.escalationLevel}
              closed={ticket.status === "RESOLVED" || ticket.status === "CLOSED"}
            />
          )}

          <RunResolverCard ticketId={ticket.id} hasActiveRun={hasActiveRun} />

          {railRuns.length > 0 && (
            <div className="space-y-3">
              <h2 className="px-1 font-heading text-sm font-semibold text-muted-foreground">
                Agent runs ({railRuns.length})
              </h2>
              {railRuns.map((run) => (
                <RunSummaryCard
                  key={run.id}
                  run={run}
                  agentName={
                    run.profile?.name ?? agents[run.agentUserId]?.name ?? "AI agent"
                  }
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
