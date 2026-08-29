import type { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { forbid } from "@/lib/permissions";
import { nextTicketNumber, ticketListInclude } from "@/lib/tickets";
import { CATEGORIES, TICKET_STATUSES } from "@/lib/types";
import type { Prisma } from "@prisma/client";
import { runTriage } from "@/lib/ai/engine";
import { getAiSettings } from "@/lib/ai/settings";
import { notifyTicketCreated } from "@/lib/notify";
import { applySlaToTicket } from "@/lib/sla";
import { emitTicketEvent } from "@/lib/webhooks";

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();

  const params = req.nextUrl.searchParams;
  const status = params.get("status");
  const category = params.get("category");
  const assigneeId = params.get("assigneeId");
  const q = params.get("q");

  const where: Prisma.TicketWhereInput = {};
  // Requesters only ever see their own tickets.
  if (user.role === "REQUESTER") where.requesterId = user.id;

  if (status) {
    if (status === "OPEN_ALL") {
      where.status = { notIn: ["RESOLVED", "CLOSED"] };
    } else if ((TICKET_STATUSES as string[]).includes(status)) {
      where.status = status;
    } else {
      return Response.json({ error: `Invalid status: ${status}` }, { status: 400 });
    }
  }
  if (category) {
    if (!(CATEGORIES as string[]).includes(category)) {
      return Response.json({ error: `Invalid category: ${category}` }, { status: 400 });
    }
    where.category = category;
  }
  if (assigneeId) {
    where.assigneeId = assigneeId;
  }
  if (q) {
    where.OR = [{ title: { contains: q, mode: "insensitive" } }, { description: { contains: q, mode: "insensitive" } }];
  }

  const tickets = await db.ticket.findMany({
    where,
    include: ticketListInclude,
    orderBy: { createdAt: "desc" },
  });
  return Response.json({ tickets });
}

const createSchema = z.object({
  title: z.string().min(1, "Title is required").max(200),
  description: z.string().min(1, "Description is required"),
});

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  const denied = forbid(user, "ticket.create");
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request body" },
      { status: 400 },
    );
  }

  const number = await nextTicketNumber();
  const ticket = await db.ticket.create({
    data: {
      number,
      title: parsed.data.title,
      description: parsed.data.description,
      status: "OPEN",
      channel: "WEB", // explicit: the form is the WEB entry (ux-03)
      priority: "MEDIUM",
      category: "OTHER",
      requesterId: user.id,
    },
  });

  await applySlaToTicket(ticket.id);
  void notifyTicketCreated(ticket.id);
  void emitTicketEvent("ticket.created", ticket.id);

  // getAiSettings supplies the same default (true when the row is missing)
  // that the settings API/UI report, so behavior and display never diverge.
  const { autoTriage } = await getAiSettings();
  if (autoTriage) {
    try {
      await runTriage(ticket.id);
    } catch (err) {
      // Triage failure must never fail ticket creation.
      console.error(`Auto-triage failed for ticket ${ticket.id}:`, err);
    }
  }

  const fresh = await db.ticket.findUnique({
    where: { id: ticket.id },
    include: ticketListInclude,
  });
  return Response.json({ ticket: fresh }, { status: 201 });
}
