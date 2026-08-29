// db-03: case-insensitive search is a Postgres behaviour-parity CONTRACT,
// not an implementation detail. The same ticket must be found by vpn, VPN
// and Vpn through every search surface — the agent's search_tickets tool
// and the queue's GET /api/tickets?q= — because `contains` alone on
// PostgreSQL is case-sensitive LIKE, and SQLite's ASCII-case-insensitive
// LIKE is what the desk used to have. The test is written so removing
// `mode: "insensitive"` anywhere reddens it (verified by mutation during
// the tick: stripping the mode from either site fails the matching block).

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { tmpDb, type TmpDb } from "./helpers/tmp-db";

type ServoDb = { [key: string]: unknown };
const holder = vi.hoisted(() => ({
  db: null as unknown as ServoDb,
  user: null as unknown as { id: string; role: string },
}));
vi.mock("@/lib/db", () => ({ get db() { return holder.db; } }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: async () => holder.user }));

import type { NextRequest } from "next/server";
import { GET as listTickets } from "@/app/api/tickets/route";

/** The queue reads req.nextUrl, which a bare Request lacks. */
function queueReq(q: string): NextRequest {
  const url = new URL(`http://x/api/tickets?q=${encodeURIComponent(q)}`);
  return Object.assign(new Request(url), { nextUrl: url }) as unknown as NextRequest;
}
import { historyTools } from "@/lib/ai/tools/history";

const handles: TmpDb[] = [];
afterAll(async () => {
  for (const h of handles) await h.dispose();
});

let db: PrismaClient;
let requester: { id: string; role: string };

beforeEach(async () => {
  if (handles.length > 1) await handles.shift()?.dispose();
  const a = await tmpDb();
  handles.push(a);
  db = a.client;
  holder.db = db as unknown as ServoDb;
  requester = {
    ...(await db.user.create({ data: { name: "R", email: "r@x.com", role: "REQUESTER" } })),
    role: "REQUESTER",
  };
  holder.user = requester;
  await db.ticket.create({
    data: {
      number: 1001,
      title: "VPN timeout every morning",
      // The word appears ONLY in the title's case: a case-sensitive LIKE
      // cannot rescue a lowercase query — the mutation this test catches.
      description: "The tunnel drops at 9am sharp.",
      requesterId: requester.id,
    },
  });
});

const CASES = ["vpn", "VPN", "Vpn", "vPn"] as const;

describe("the agent's search_tickets tool", () => {
  for (const q of CASES) {
    it(`finds the ticket for "${q}"`, async () => {
      const out = await historyTools.search_tickets.execute({ query: q } as never, {
        ticketId: "none",
      } as never);
      expect(String(out)).toContain("VPN timeout every morning");
    });
  }

  it("does not return unrelated tickets", async () => {
    await db.ticket.create({
      data: { number: 1002, title: "Printer jam", description: "Paper stuck.", requesterId: requester.id },
    });
    const out = await historyTools.search_tickets.execute({ query: "VPN" } as never, {
      ticketId: "none",
    } as never);
    expect(String(out)).not.toContain("Printer jam");
  });
});

describe("the queue's GET /api/tickets?q=", () => {
  for (const q of CASES) {
    it(`finds the ticket for "?q=${q}"`, async () => {
      const res = await listTickets(queueReq(q));
      expect(res.status).toBe(200);
      const { tickets } = await res.json();
      expect(tickets.map((t: { title: string }) => t.title)).toContain("VPN timeout every morning");
    });
  }

  it("an unrelated query returns an empty list, not everything", async () => {
    const res = await listTickets(queueReq("zzz-no-match"));
    const { tickets } = await res.json();
    expect(tickets).toHaveLength(0);
  });
});
