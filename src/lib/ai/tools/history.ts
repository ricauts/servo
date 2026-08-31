// Desk-memory tools: let an agent consult the tickets this desk has already
// solved before it invents an answer. A service desk repeats itself — the same
// VPN failure, the same licence request — and the resolution a colleague wrote
// last month is better evidence than a plausible guess.
//
// All three are read-only lookups (risk LOW, no approval). They deliberately
// withhold the identity of *other* requesters: precedent is useful, but an
// agent working Dana's ticket must not learn — or repeat back — that Ravi
// filed the original. See mayRevealRequester() in ../ticket-history.ts.

import { db } from "@/lib/db";
import {
  formatSearchHit,
  formatTicketDetail,
  outcomeOf,
  rankTickets,
  searchTerms,
  truncate,
  type HistoryTicket,
} from "../ticket-history";
import { errorMessage, RESULT_LIMIT, str, type ToolDef } from "./types";

/** Rows scored in memory per search. Bounded so a big desk stays cheap. */
const CANDIDATE_WINDOW = 60;
/** Comments loaded per candidate — enough to reach the resolution note. */
const COMMENT_WINDOW = 20;
const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;

const ticketSelect = {
  id: true,
  number: true,
  title: true,
  description: true,
  status: true,
  priority: true,
  category: true,
  createdAt: true,
  resolvedAt: true,
  requesterId: true,
  requester: { select: { name: true, email: true } },
} as const;

const commentsInclude = {
  select: { body: true, kind: true },
  orderBy: { createdAt: "desc" },
  take: COMMENT_WINDOW,
} as const;

type Row = HistoryTicket & { id: string };

/** Prisma hands comments back newest-first; the formatters read oldest-first. */
function oldestFirst<T extends { comments: unknown[] }>(row: T): T {
  return { ...row, comments: [...row.comments].reverse() };
}

function boundedLimit(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(n), MAX_LIMIT);
}

function cap(text: string): string {
  return text.length > RESULT_LIMIT ? `${text.slice(0, RESULT_LIMIT)}…\n(truncated)` : text;
}

/**
 * The ticket the run is working on, or null when there is none — an MCP client
 * calls these tools outside any run. A null current ticket means every other
 * requester's identity stays withheld, which is the safe default.
 */
async function currentTicket(ticketId: string) {
  if (!ticketId || ticketId === "mcp-external") return null;
  return db.ticket.findUnique({
    where: { id: ticketId },
    select: { id: true, requesterId: true },
  });
}

export const historyTools: Record<string, ToolDef> = {
  search_tickets: {
    name: "search_tickets",
    description:
      "Search the tickets this service desk has already handled and read how they ended. Use it BEFORE acting on anything that might be a recurring problem — the resolution a colleague recorded is stronger evidence than a guess. Results are ranked by relevance and prefer tickets that actually reached a resolution. Other requesters' identities are withheld: treat the outcomes as precedent, never quote another person's details back to this requester.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "What to look for, in natural language (e.g. 'vpn disconnects on wifi' or 'adobe licence request').",
        },
        category: {
          type: "string",
          description:
            "Optional filter: ACCESS, HARDWARE, SOFTWARE, DATABASE, DEVOPS, NETWORK or OTHER.",
        },
        resolvedOnly: {
          type: "boolean",
          description: "Only return tickets that were resolved or closed (default false).",
        },
        limit: { type: "number", description: `How many hits to return (default ${DEFAULT_LIMIT}, max ${MAX_LIMIT}).` },
      },
      required: ["query"],
    },
    async execute(input, ctx) {
      const query = str(input.query).trim();
      if (!query) return "Error: query is required.";
      const terms = searchTerms(query);
      if (terms.length === 0) {
        return `No searchable words in "${query}" — try naming the system or the symptom, e.g. "vpn timeout".`;
      }

      const category = str(input.category).trim().toUpperCase();
      const current = await currentTicket(ctx.ticketId);

      try {
        // Case-insensitive search is a contract (db-03): `mode:
        // "insensitive"` is ILIKE on PostgreSQL — plain `contains` would be
        // case-sensitive LIKE. tests/search-case.test.ts pins vpn/VPN/Vpn
        // equivalence for this tool and for the queue's ?q= filter.
        const rows = (await db.ticket.findMany({
          where: {
            ...(current ? { id: { not: current.id } } : {}),
            ...(category ? { category } : {}),
            ...(input.resolvedOnly === true ? { status: { in: ["RESOLVED", "CLOSED"] } } : {}),
            OR: terms.flatMap((term) => [
              { title: { contains: term, mode: "insensitive" } },
              { description: { contains: term, mode: "insensitive" } },
            ]),
          },
          orderBy: { createdAt: "desc" },
          take: CANDIDATE_WINDOW,
          select: { ...ticketSelect, comments: commentsInclude },
        })) as Row[];

        const ranked = rankTickets(rows.map(oldestFirst), terms, boundedLimit(input.limit));
        if (ranked.length === 0) return `No past ticket matches "${query}".`;

        const header = `${ranked.length} past ticket${ranked.length === 1 ? "" : "s"} matching "${query}" (most relevant first). Read one in full with read_ticket.`;
        const body = ranked
          .map(({ ticket }) => formatSearchHit(ticket, current?.requesterId ?? null))
          .join("\n");
        return cap(`${header}\n\n${body}`);
      } catch (err) {
        return `Ticket search failed: ${errorMessage(err)}`;
      }
    },
  },

  read_ticket: {
    name: "read_ticket",
    description:
      "Read one past ticket in full by its number: the original request, the replies sent, which tools the agent used, and the recorded resolution. Use it after search_tickets to copy an approach that already worked.",
    inputSchema: {
      type: "object",
      properties: {
        number: { type: "number", description: "The ticket number, e.g. 1042." },
      },
      required: ["number"],
    },
    async execute(input, ctx) {
      const number = Number(input.number);
      if (!Number.isInteger(number) || number <= 0) {
        return "Error: number must be a positive ticket number.";
      }
      try {
        const row = (await db.ticket.findUnique({
          where: { number },
          select: {
            ...ticketSelect,
            comments: { select: { body: true, kind: true }, orderBy: { createdAt: "asc" } },
            runs: {
              select: {
                steps: {
                  where: { type: "TOOL_CALL" },
                  select: { toolName: true },
                  orderBy: { index: "asc" },
                },
              },
            },
          },
        })) as (Row & { runs: { steps: { toolName: string | null }[] }[] }) | null;
        if (!row) return `No ticket #${number} exists on this desk.`;

        const current = await currentTicket(ctx.ticketId);
        if (current && current.id === row.id) {
          return `#${number} is the ticket you are working on — its history is already in your briefing.`;
        }

        const toolsUsed = [
          ...new Set(
            row.runs.flatMap((run) =>
              run.steps.map((step) => step.toolName).filter((n): n is string => Boolean(n)),
            ),
          ),
        ];
        return cap(formatTicketDetail(row, current?.requesterId ?? null, toolsUsed));
      } catch (err) {
        return `Reading ticket #${number} failed: ${errorMessage(err)}`;
      }
    },
  },

  requester_history: {
    name: "requester_history",
    description:
      "List the other tickets this requester has filed, newest first, with how each ended. Use it to spot a recurring fault (the third replacement dock in two months is a hardware problem, not a user problem) before treating the request as new.",
    inputSchema: {
      type: "object",
      properties: {
        email: {
          type: "string",
          description:
            "Optional: the requester's email. Defaults to the requester of the ticket being worked.",
        },
        limit: { type: "number", description: `How many tickets to list (default ${DEFAULT_LIMIT}, max ${MAX_LIMIT}).` },
      },
    },
    async execute(input, ctx) {
      const email = str(input.email).trim().toLowerCase();
      try {
        const current = await currentTicket(ctx.ticketId);
        const requesterId = email
          ? (await db.user.findUnique({ where: { email }, select: { id: true } }))?.id
          : current?.requesterId;
        if (!requesterId) {
          return email
            ? `No requester with the email ${email} exists on this desk.`
            : "Error: no ticket in context — pass the requester's email.";
        }

        const rows = (await db.ticket.findMany({
          where: {
            requesterId,
            ...(current ? { id: { not: current.id } } : {}),
          },
          orderBy: { createdAt: "desc" },
          take: boundedLimit(input.limit),
          select: { ...ticketSelect, comments: commentsInclude },
        })) as Row[];
        if (rows.length === 0) return "This requester has no other tickets on the desk.";

        // The requester is either the one in context or the one asked for by
        // email, so their own identity is never withheld here.
        const body = rows.map(oldestFirst).map((ticket) => {
          const outcome = outcomeOf(ticket);
          return `#${ticket.number} [${ticket.status}/${ticket.category}] ${ticket.title}\n  ${outcome ? truncate(outcome, 200) : "no outcome recorded"}`;
        });
        return cap(`${rows.length} earlier ticket(s) from this requester, newest first:\n\n${body.join("\n")}`);
      } catch (err) {
        return `Requester history lookup failed: ${errorMessage(err)}`;
      }
    },
  },
};
