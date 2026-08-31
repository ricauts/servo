// The three desk-memory tools, exercised against a stubbed Prisma client so
// the suite stays database-free like the rest of tests/. What is asserted here
// is the tool contract: never throw for an expected failure, always return a
// string the model can act on, and never leak another requester's identity.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@prisma/client";

const findManyTicket = vi.fn();
const findUniqueTicket = vi.fn();
const findUniqueUser = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    ticket: {
      findMany: (args: unknown) => findManyTicket(args),
      findUnique: (args: unknown) => findUniqueTicket(args),
    },
    user: { findUnique: (args: unknown) => findUniqueUser(args) },
  },
}));

const { historyTools } = await import("@/lib/ai/tools/history");
const { TOOLS } = await import("@/lib/ai/tools");
const { DEFAULT_TOOL_POLICIES } = await import("@/lib/ai/tool-policies");

const agentUser = { id: "ai-resolver", name: "Servo Resolver" } as User;
const ctx = { ticketId: "ticket-current", runId: "run-1", agentUser };
const mcpCtx = { ticketId: "mcp-external", runId: "mcp-external", agentUser };

/** The ticket the run is working on: filed by Dana. */
const CURRENT = { id: "ticket-current", requesterId: "user-dana" };

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "ticket-past",
    number: 1001,
    title: "VPN drops every few minutes",
    description: "Disconnects on home wifi.",
    status: "RESOLVED",
    priority: "HIGH",
    category: "NETWORK",
    createdAt: new Date("2026-01-10T09:00:00Z"),
    resolvedAt: new Date("2026-01-10T11:00:00Z"),
    requesterId: "user-ravi",
    requester: { name: "Ravi Menon", email: "ravi@company.com" },
    // Prisma returns these newest-first; the tool reverses them.
    comments: [
      { body: "Resolved by Servo Resolver: Reissued the VPN certificate.", kind: "SYSTEM" },
      { body: "Looking into your VPN profile.", kind: "COMMENT" },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  findUniqueTicket.mockResolvedValue(CURRENT);
});

describe("registry wiring", () => {
  it("exposes all three tools with a default policy each", () => {
    for (const name of ["search_tickets", "read_ticket", "requester_history"]) {
      expect(TOOLS).toHaveProperty(name);
      const policy = DEFAULT_TOOL_POLICIES.find((p) => p.toolName === name);
      expect(policy, `missing policy for ${name}`).toBeDefined();
      // Read-only lookups: low risk, and nothing to approve.
      expect(policy?.riskLevel).toBe("LOW");
      expect(policy?.requiresApproval).toBe(false);
    }
  });
});

describe("search_tickets", () => {
  const search = historyTools.search_tickets;

  it("ranks matches and reports the recorded outcome", async () => {
    findManyTicket.mockResolvedValue([row()]);
    const out = await search.execute({ query: "vpn disconnects" }, ctx);
    expect(out).toContain("#1001 [RESOLVED/HIGH/NETWORK] VPN drops every few minutes");
    expect(out).toContain("outcome: Reissued the VPN certificate.");
    expect(out).toContain("read_ticket");
  });

  it("withholds the identity of a different requester", async () => {
    findManyTicket.mockResolvedValue([row()]);
    const out = await search.execute({ query: "vpn" }, ctx);
    expect(out).not.toContain("Ravi");
    expect(out).not.toContain("ravi@company.com");
    expect(out).toContain("another requester (withheld)");
  });

  it("excludes the ticket being worked and applies the filters it was given", async () => {
    findManyTicket.mockResolvedValue([]);
    await search.execute(
      { query: "vpn disconnects", category: "network", resolvedOnly: true },
      ctx,
    );
    const args = findManyTicket.mock.calls[0][0];
    expect(args.where.id).toEqual({ not: "ticket-current" });
    expect(args.where.category).toBe("NETWORK");
    expect(args.where.status).toEqual({ in: ["RESOLVED", "CLOSED"] });
    expect(args.where.OR).toContainEqual({ title: { contains: "vpn", mode: "insensitive" } });
  });

  it("caps the number of results at the documented maximum", async () => {
    findManyTicket.mockResolvedValue(
      Array.from({ length: 30 }, (_, i) => row({ id: `t${i}`, number: 2000 + i })),
    );
    const out = await search.execute({ query: "vpn", limit: 999 }, ctx);
    expect(out.match(/^#\d+ \[/gm) ?? []).toHaveLength(20);
  });

  it("asks for better words instead of running an empty query", async () => {
    const out = await search.execute({ query: "please help me" }, ctx);
    expect(out).toContain("No searchable words");
    expect(findManyTicket).not.toHaveBeenCalled();
  });

  it("requires a query", async () => {
    expect(await search.execute({ query: "   " }, ctx)).toBe("Error: query is required.");
  });

  it("says so plainly when nothing matches", async () => {
    findManyTicket.mockResolvedValue([]);
    expect(await search.execute({ query: "printer toner" }, ctx)).toContain("No past ticket");
  });

  it("returns the database error as text rather than throwing", async () => {
    findManyTicket.mockRejectedValue(new Error("database is locked"));
    const out = await search.execute({ query: "vpn" }, ctx);
    expect(out).toBe("Ticket search failed: database is locked");
  });

  it("withholds every identity when called from MCP, with no ticket in context", async () => {
    findManyTicket.mockResolvedValue([row()]);
    const out = await search.execute({ query: "vpn" }, mcpCtx);
    expect(findUniqueTicket).not.toHaveBeenCalled();
    expect(out).toContain("another requester (withheld)");
    expect(out).not.toContain("Ravi");
  });
});

describe("read_ticket", () => {
  const read = historyTools.read_ticket;

  it("returns the request, replies, tools used and resolution", async () => {
    findUniqueTicket.mockImplementation((args: { where: { number?: number } }) =>
      args.where.number
        ? Promise.resolve({
            ...row({
              comments: [
                { body: "Looking into your VPN profile.", kind: "COMMENT" },
                { body: "Resolved by Servo Resolver: Reissued the VPN certificate.", kind: "SYSTEM" },
              ],
            }),
            runs: [{ steps: [{ toolName: "query_ops_database" }, { toolName: "post_comment" }] }],
          })
        : Promise.resolve(CURRENT),
    );
    const out = await read.execute({ number: 1001 }, ctx);
    expect(out).toContain("#1001: VPN drops every few minutes");
    expect(out).toContain("Looking into your VPN profile.");
    expect(out).toContain("query_ops_database, post_comment");
    expect(out).toContain("Reissued the VPN certificate.");
    expect(out).not.toContain("ravi@company.com");
  });

  it("rejects a number that is not a ticket number", async () => {
    expect(await read.execute({ number: 0 }, ctx)).toContain("positive ticket number");
    expect(await read.execute({ number: "abc" }, ctx)).toContain("positive ticket number");
  });

  it("reports a missing ticket instead of failing", async () => {
    findUniqueTicket.mockImplementation((args: { where: { number?: number } }) =>
      args.where.number ? Promise.resolve(null) : Promise.resolve(CURRENT),
    );
    expect(await read.execute({ number: 4242 }, ctx)).toBe("No ticket #4242 exists on this desk.");
  });

  it("points the agent back at its own briefing for the ticket it is working", async () => {
    findUniqueTicket.mockImplementation((args: { where: { number?: number } }) =>
      args.where.number
        ? Promise.resolve({ ...row({ id: "ticket-current" }), runs: [] })
        : Promise.resolve(CURRENT),
    );
    expect(await read.execute({ number: 1001 }, ctx)).toContain("ticket you are working on");
  });
});

describe("requester_history", () => {
  const history = historyTools.requester_history;

  it("lists the requester's other tickets with how each ended", async () => {
    findManyTicket.mockResolvedValue([row({ requesterId: "user-dana" })]);
    const out = await history.execute({}, ctx);
    expect(findManyTicket.mock.calls[0][0].where).toMatchObject({
      requesterId: "user-dana",
      id: { not: "ticket-current" },
    });
    expect(out).toContain("#1001 [RESOLVED/NETWORK] VPN drops every few minutes");
    expect(out).toContain("Reissued the VPN certificate.");
  });

  it("resolves an explicit email to its requester", async () => {
    findUniqueUser.mockResolvedValue({ id: "user-ravi" });
    findManyTicket.mockResolvedValue([row()]);
    await history.execute({ email: "Ravi@Company.com" }, ctx);
    expect(findUniqueUser).toHaveBeenCalledWith({
      where: { email: "ravi@company.com" },
      select: { id: true },
    });
    expect(findManyTicket.mock.calls[0][0].where.requesterId).toBe("user-ravi");
  });

  it("reports an unknown email instead of silently listing nothing", async () => {
    findUniqueUser.mockResolvedValue(null);
    expect(await history.execute({ email: "nobody@company.com" }, ctx)).toContain(
      "No requester with the email nobody@company.com",
    );
  });

  it("asks for an email when there is no ticket in context", async () => {
    expect(await history.execute({}, mcpCtx)).toContain("pass the requester's email");
  });

  it("says the requester is new to the desk when they have no other tickets", async () => {
    findManyTicket.mockResolvedValue([]);
    expect(await history.execute({}, ctx)).toBe("This requester has no other tickets on the desk.");
  });

  it("returns the database error as text rather than throwing", async () => {
    findManyTicket.mockRejectedValue(new Error("no such table: Ticket"));
    expect(await history.execute({}, ctx)).toBe(
      "Requester history lookup failed: no such table: Ticket",
    );
  });
});
