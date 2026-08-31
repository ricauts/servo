// reb-06: the three skill KPIs — informed runs (share of completed resolver
// runs with >=1 read_skill step), distilled skills this month (the reb-05
// column), and coverage (share of categories claimed by an enabled skill) —
// with the n/a discipline: a zero-run, zero-skill install reads null, never
// NaN, and the kb-14 SENT-with-null-decider draft must not crash or double
// count anything.

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

import { getKpis } from "@/lib/tickets";
import { GET as getKpisRoute } from "@/app/api/kpis/route";

const handles: TmpDb[] = [];
afterAll(async () => {
  for (const h of handles) await h.dispose();
});

let db: PrismaClient;
let admin: { id: string; role: string };
let requester: { id: string };
let resolver: { id: string };

beforeEach(async () => {
  if (handles.length > 1) await handles.shift()?.dispose();
  const a = await tmpDb();
  handles.push(a);
  db = a.client;
  holder.db = db as unknown as ServoDb;
  admin = { ...(await db.user.create({ data: { name: "Ad", email: "ad@x.com", role: "ADMIN" } })), role: "ADMIN" };
  requester = await db.user.create({ data: { name: "R", email: "r@x.com", role: "REQUESTER" } });
  resolver = await db.user.create({
    data: { name: "Servo Resolver", email: "resolver@servo.ai", role: "AI_AGENT", aiKind: "RESOLVER" },
  });
  holder.user = admin;
});

async function seedRun(opts: { completed: boolean; readSkillSteps?: number; daysAgo?: number }) {
  const ticket = await db.ticket.create({
    data: {
      number: Math.floor(Math.random() * 100000),
      title: "t",
      description: "d",
      requesterId: requester.id,
      createdAt: new Date(Date.now() - (opts.daysAgo ?? 0) * 86_400_000),
    },
  });
  const run = await db.agentRun.create({
    data: {
      ticketId: ticket.id,
      agentUserId: resolver.id,
      kind: "RESOLVE",
      status: opts.completed ? "COMPLETED" : "RUNNING",
      createdAt: new Date(Date.now() - (opts.daysAgo ?? 0) * 86_400_000),
      completedAt: opts.completed ? new Date() : null,
    },
  });
  for (let i = 0; i < (opts.readSkillSteps ?? 0); i++) {
    await db.agentStep.create({
      data: { runId: run.id, index: i, type: "TOOL_CALL", toolName: "read_skill", content: "read" },
    });
  }
  return run;
}

describe("the three skill KPIs", () => {
  it("informed share counts each run once, completed RESOLVE runs only", async () => {
    await seedRun({ completed: true, readSkillSteps: 2 }); // informed (counts ONCE)
    await seedRun({ completed: true }); // not informed
    await seedRun({ completed: true, readSkillSteps: 1, daysAgo: 40 }); // out of window
    await seedRun({ completed: false, readSkillSteps: 1 }); // RUNNING: not in denominator

    const kpis = await getKpis();
    expect(kpis.skills.skillInformedRunRate).toBe(1 / 2);
  });

  it("distilled-this-month counts only sourceTicketId skills in the calendar month", async () => {
    const ticket = await db.ticket.create({
      data: { number: 2001, title: "t", description: "d", requesterId: requester.id, status: "RESOLVED" },
    });
    await db.skill.create({
      data: {
        slug: "this-month", name: "This month", description: "x", body: "b",
        markdown: "---\nname: This month\n---\nb", categories: "[]",
        sourceTicketId: ticket.id, enabled: false, createdAt: new Date(),
      },
    });
    await db.skill.create({
      data: {
        slug: "old-month", name: "Old", description: "x", body: "b",
        markdown: "---\nname: Old\n---\nb", categories: "[]",
        sourceTicketId: ticket.id, enabled: false,
        createdAt: new Date(Date.now() - 40 * 86_400_000),
      },
    });
    await db.skill.create({
      data: {
        slug: "handwritten", name: "Hand", description: "x", body: "b",
        markdown: "---\nname: Hand\n---\nb", categories: "[]", createdAt: new Date(),
      },
    });

    const kpis = await getKpis();
    expect(kpis.skills.skillsDistilledThisMonth).toBe(1);
  });

  it("coverage: enabled skills' claimed categories over the seven; [] claims all", async () => {
    await db.skill.create({
      data: {
        slug: "net", name: "Net", description: "x", body: "b",
        markdown: "---\nname: Net\n---\nb", categories: '["NETWORK"]', enabled: true,
      },
    });
    await db.skill.create({
      data: {
        slug: "soft", name: "Soft", description: "x", body: "b",
        markdown: "---\nname: Soft\n---\nb", categories: '["SOFTWARE"]', enabled: true,
      },
    });
    // DISABLED skills claim nothing:
    await db.skill.create({
      data: {
        slug: "disabled", name: "Off", description: "x", body: "b",
        markdown: "---\nname: Off\n---\nb", categories: '["DATABASE"]', enabled: false,
      },
    });

    const kpis = await getKpis();
    expect(kpis.skills.skillCoverage).toBeCloseTo(2 / 7);
  });

  it("a zero-run, zero-skill install renders nulls — never NaN", async () => {
    const kpis = await getKpis();
    expect(kpis.skills.skillInformedRunRate).toBeNull();
    expect(kpis.skills.skillCoverage).toBeNull();
    expect(kpis.skills.skillsDistilledThisMonth).toBe(0);
    // The shared formatter is the discipline: null renders a word, never NaN.
    const { shareAsPct } = await import("@/lib/labels");
    expect(shareAsPct(kpis.skills.skillInformedRunRate)).toBe("n/a");
    expect(shareAsPct(kpis.skills.skillCoverage)).toBe("n/a");
    expect(shareAsPct(1 / 3)).toBe("33%");
  });

  it("a SENT draft with a null decider (kb-14) crashes nothing and double counts nothing", async () => {
    const ticket = await db.ticket.create({
      data: { number: 3001, title: "t", description: "d", requesterId: requester.id },
    });
    await db.replyDraft.create({
      data: {
        ticketId: ticket.id,
        body: "sent by auto-delivery",
        status: "SENT",
        agentName: "Servo Resolver",
        emailed: true,
        edited: false,
        decidedAt: new Date(),
        deciderId: null, // auto-delivered: no human decider
        autoDelivered: true,
      },
    });
    const kpis = await getKpis();
    expect(kpis.draftStats.sentAsIs).toBe(1);
    expect(kpis.draftStats.edited).toBe(0);
  });

  it("the route serves all three behind kpi.view", async () => {
    await seedRun({ completed: true, readSkillSteps: 1 });
    const res = await getKpisRoute();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.skills).toHaveProperty("skillInformedRunRate");
    expect(body.skills).toHaveProperty("skillsDistilledThisMonth");
    expect(body.skills).toHaveProperty("skillCoverage");
  });
});
