// ux-03: ticket channel provenance. Every creation site stamps its channel —
// the web form WEB, inbound email EMAIL, the MCP create_ticket tool MCP —
// and CHAT stays in the union but stamped by nothing in v1 (the chat surface
// is Roadmap; the test pins that no code path claims it).

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { PrismaClient } from "@prisma/client";
import { tmpDb, type TmpDb } from "./helpers/tmp-db";

type ServoDb = { [key: string]: unknown };
const holder = vi.hoisted(() => ({
  db: null as unknown as ServoDb,
  user: null as unknown as { id: string; role: string },
}));
vi.mock("@/lib/db", () => ({ get db() { return holder.db; } }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: async () => holder.user }));

import { POST as postTicket, GET as listTickets } from "@/app/api/tickets/route";
import { ingestEmail } from "@/lib/inbound-email";
import { TICKET_CHANNELS, type TicketChannel } from "@/lib/types";

const handles: TmpDb[] = [];
afterAll(async () => {
  for (const h of handles) await h.dispose();
});

let db: PrismaClient;
let admin: { id: string; role: string };

beforeEach(async () => {
  if (handles.length > 1) await handles.shift()?.dispose();
  const a = await tmpDb();
  handles.push(a);
  db = a.client;
  holder.db = db as unknown as ServoDb;
  admin = { ...(await db.user.create({ data: { name: "Ad", email: "ad@x.com", role: "ADMIN" } })), role: "ADMIN" };
  holder.user = admin;
  // The MCP executor runs under the system resolver (mcpToolContext): it
  // must exist or every tools/call answers "run setup".
  await db.user.create({
    data: { name: "Servo Resolver", email: "resolver@servo.ai", role: "AI_AGENT", aiKind: "RESOLVER" },
  });
  await db.user.create({
    data: { name: "Servo Triage", email: "triage@servo.ai", role: "AI_AGENT", aiKind: "TRIAGE" },
  });
});

describe("the union", () => {
  it("carries CHAT unused — the roadmap surface nobody may delete or claim", () => {
    expect(TICKET_CHANNELS).toEqual(["WEB", "EMAIL", "MCP", "CHAT"]);
    const sources = [
      "src/app/api/tickets/route.ts",
      "src/lib/inbound-email.ts",
      "src/lib/mcp.ts",
    ]
      .map((p) => readFileSync(p, "utf8"))
      .join("\n");
    expect(sources).not.toMatch(/channel[:=]\s*["']CHAT["']/);
    // The three shipped stamps are exactly WEB / EMAIL / MCP.
    expect(sources).toMatch(/channel: "WEB"/);
    expect(sources).toMatch(/channel: "EMAIL"/);
    expect(sources).toMatch(/channel: "MCP"/);
  });
});

describe("POST /api/tickets stamps WEB", () => {
  it("creates with channel WEB", async () => {
    const res = await postTicket(
      new Request("http://x/api/tickets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "From the form", description: "filled in the portal" }),
      }) as never,
    );
    expect(res.status).toBe(201);
    const ticket = await db.ticket.findFirstOrThrow({ where: { title: "From the form" } });
    expect(ticket.channel).toBe("WEB");
  });
});

describe("inbound email stamps EMAIL", () => {
  it("creates a ticket through the email path with channel EMAIL", async () => {
    const result = await ingestEmail({
      from: "Person at Acme <person@acme.dev>",
      subject: "Printer jammed again",
      text: "Tray two eats the paper.",
    });
    if (result.action !== "created") throw new Error(`expected created, got ${result.action}`);
    const ticket = await db.ticket.findUniqueOrThrow({ where: { id: result.ticketId } });
    expect(ticket.channel).toBe("EMAIL");
  });
});

describe("the MCP create_ticket tool stamps MCP", () => {
  it("creates through the p0-01 executor path with channel MCP", async () => {
    const { POST } = await import("@/app/api/mcp/route");
    process.env.MCP_TOKEN = "test-mcp-token"; // read per request, like the gate test sets it
    const req = new Request("http://x/api/mcp", {
      method: "POST",
      headers: { authorization: "Bearer test-mcp-token", "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "create_ticket", arguments: { title: "Via MCP", description: "an external client" } },
      }),
    }) as never;
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    if (body.error) throw new Error(`MCP call failed: ${JSON.stringify(body.error)}`);
    expect(body.result?.isError ?? false).toBe(false);
    const ticket = await db.ticket.findFirstOrThrow({ where: { title: "Via MCP" } });
    expect(ticket.channel).toBe("MCP");
  });
});

describe("the queue carries channel and WEB renders no badge", () => {
  it("GET /api/tickets returns channel on every row", async () => {
    await db.ticket.create({
      data: { number: 3001, title: "x", description: "y", requesterId: admin.id, channel: "EMAIL" },
    });
    const url = new URL("http://x/api/tickets");
    const res = await listTickets(Object.assign(new Request(url), { nextUrl: url }) as never);
    const { tickets } = await res.json();
    expect(tickets.every((t: { channel: string }) => typeof t.channel === "string")).toBe(true);
    expect(tickets.find((t: { title: string }) => t.title === "x").channel).toBe("EMAIL");
  });

  it("TicketsTable badges non-WEB only, mono uppercase, token colours", () => {
    const source = readFileSync("src/components/tickets/TicketsTable.tsx", "utf8");
    expect(source).toMatch(/t\.channel && t\.channel !== "WEB"/);
    expect(source).toMatch(/font-mono[^"]*uppercase/);
    // Design tokens only: the badge rides Badge's neutral tone classes —
    // no hardcoded hex anywhere in the component (no-hex-lint enforces the
    // whole tree; this pins the badge uses Badge, not inline colour).
    expect(source).toMatch(/<Badge tone="neutral"/);
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it("historical rows default to WEB — the documented inaccuracy", async () => {
    // Created without a channel field: the default is the whole point.
    await db.$executeRawUnsafe(
      `INSERT INTO "Ticket" ("id","number","title","description","status","priority","category","requesterId","escalationLevel","createdAt","updatedAt")
       VALUES ('legacy_1', 3002, 'old', 'pre-column row', 'RESOLVED', 'LOW', 'OTHER', '${admin.id}', 0, NOW(), NOW())`,
    );
    const row = await db.ticket.findUniqueOrThrow({ where: { id: "legacy_1" } });
    expect(row.channel).toBe("WEB");
  });
});
