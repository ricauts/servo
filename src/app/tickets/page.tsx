import Link from "next/link";
import { Inbox, Plus } from "lucide-react";
import type { Prisma } from "@prisma/client";
import { Button } from "@/components/ui/button";
import EmptyState from "@/components/legacy/EmptyState";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import PageHeader from "@/components/shell/PageHeader";
import TicketFilters from "@/components/tickets/TicketFilters";
import TicketsTable, {
  type TicketRow,
} from "@/components/tickets/TicketsTable";
import {
  CATEGORIES,
  TICKET_STATUSES,
  type Category,
  type TicketStatus,
} from "@/lib/types";

function firstString(v: string | string[] | undefined): string {
  return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
}

function NewTicketButton() {
  return (
    <Button asChild className="font-heading">
      <Link href="/tickets/new">
        <Plus />
        New ticket
      </Link>
    </Button>
  );
}

export default async function TicketsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const rawStatus = firstString(params.status);
  const rawCategory = firstString(params.category);
  const q = firstString(params.q).trim();

  const status =
    rawStatus === "OPEN_ALL" ||
    TICKET_STATUSES.includes(rawStatus as TicketStatus)
      ? rawStatus
      : "";
  const category = CATEGORIES.includes(rawCategory as Category)
    ? rawCategory
    : "";

  const where: Prisma.TicketWhereInput = {};
  // Requesters only ever see their own tickets — with real SSO, any employee
  // in the IdP can sign in, and one requester's thread is not another's.
  const currentUser = await getCurrentUser();
  if (currentUser.role === "REQUESTER") {
    where.requesterId = currentUser.id;
  }
  if (status === "OPEN_ALL") {
    where.status = { notIn: ["RESOLVED", "CLOSED"] };
  } else if (status) {
    where.status = status;
  }
  if (category) where.category = category;
  if (q) {
    where.OR = [{ title: { contains: q, mode: "insensitive" } }, { description: { contains: q, mode: "insensitive" } }];
  }

  const tickets = await db.ticket.findMany({
    where,
    include: { requester: true, assignee: true },
    orderBy: { createdAt: "desc" },
  });

  const hasFilters = Boolean(status || category || q);

  const rows: TicketRow[] = tickets.map((ticket) => ({
    id: ticket.id,
    number: ticket.number,
    title: ticket.title,
    requesterName: ticket.requester.name,
    status: ticket.status,
    channel: ticket.channel,
    priority: ticket.priority,
    category: ticket.category,
    assigneeName: ticket.assignee?.name ?? null,
    assigneeColor: ticket.assignee?.color ?? null,
    assigneeIsAi: ticket.assignee?.role === "AI_AGENT",
    updatedAt: ticket.updatedAt.toISOString(),
    createdAt: ticket.createdAt.toISOString(),
    firstResponseAt: ticket.firstResponseAt?.toISOString() ?? null,
    resolvedAt: ticket.resolvedAt?.toISOString() ?? null,
    responseDueAt: ticket.responseDueAt?.toISOString() ?? null,
    resolutionDueAt: ticket.resolutionDueAt?.toISOString() ?? null,
  }));

  return (
    <>
      <PageHeader
        title="Tickets"
        description="Every request in one queue — worked by humans and AI agents."
        actions={<NewTicketButton />}
      />

      <div className="p-4 md:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TicketFilters status={status} category={category} q={q} />
          <span className="font-mono text-xs text-muted-foreground">
            {tickets.length} {tickets.length === 1 ? "ticket" : "tickets"}
          </span>
        </div>

        <div className="mt-5">
          {rows.length === 0 ? (
            <EmptyState
              icon={Inbox}
              title={
                hasFilters ? "No tickets match these filters" : "No tickets yet"
              }
              hint={
                hasFilters
                  ? "Try widening the status or category filter, or clearing the search."
                  : "Create the first ticket and let Servo triage it."
              }
              action={<NewTicketButton />}
            />
          ) : (
            <div className="overflow-hidden rounded-md border border-border bg-card shadow-sm">
              <TicketsTable rows={rows} />
            </div>
          )}
        </div>
      </div>
    </>
  );
}
