// ux-05: the runs console's API. The list and detail routes are
// agents.view-gated, the detail returns the step timeline ordered by index
// with decider names, and AgentRun.conversation — engine-resume state, not
// the audit trail — never appears in either response (key absence, not UI
// hiding). The list query is the SAME listRuns the /runs page renders from.

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

import { GET as listRuns } from "@/app/api/runs/route";
import { GET as getRun } from "@/app/api/runs/[id]/route";
import { listRuns as listRunsQuery } from "@/lib/runs-views";

const handles: TmpDb[] = [];
afterAll(async () => {
  for (const h of handles) await h.dispose();
});

let db: PrismaClient;
let admin: { id: string; role: string };
let agentUser: { id: string; role: string };
let requester: { id: string; role: string };
let aiAgent: { id: string };
let runId: string;

beforeEach(async () => {
  if (handles.length > 1) await handles.shift()?.dispose();
  const a = await tmpDb();
  handles.push(a);
  db = a.client;
  holder.db = db as unknown as ServoDb;
  admin = { ...(await db.user.create({ data: { name: "Ad", email: "ad@x.com", role: "ADMIN" } })), role: "ADMIN" };
  agentUser = { ...(await db.user.create({ data: { name: "Ag", email: "ag@x.com", role: "AGENT" } })), role: "AGENT" };
  requester = { ...(await db.user.create({ data: { name: "Req", email: "rq@x.com", role: "REQUESTER" } })), role: "REQUESTER" };
  aiAgent = await db.user.create({
    data: { name: "Servo Resolver", email: "resolver@servo.ai", role: "AI_AGENT", aiKind: "RESOLVER" },
  });

  const ticket = await db.ticket.create({
    data: { number: 1001, title: "Drill overheats under load", description: "Stops after 2 minutes.", requesterId: requester.id, status: "OPEN" },
  });
  const run = await db.agentRun.create({
    data: {
      ticketId: ticket.id,
      agentUserId: aiAgent.id,
      kind: "RESOLVE",
      status: "COMPLETED",
      summary: "Checked the motor and ordered a replacement bearing.",
      qaVerdict: "PASS",
      conversation: JSON.stringify([{ role: "assistant", content: "SECRET-CONVERSATION-STATE" }]),
      completedAt: new Date(),
    },
  });
  runId = run.id;
  await db.agentStep.createMany({
    data: [
      { runId: run.id, index: 0, type: "TEXT", content: "Starting diagnosis." },
      { runId: run.id, index: 1, type: "TOOL_CALL", toolName: "device_inventory_lookup", content: '{"sku":"M-12"}', riskLevel: "LOW" },
      { runId: run.id, index: 2, type: "TOOL_RESULT", toolName: "device_inventory_lookup", content: '{"stock":4}' },
    ],
  });
  await db.approval.create({
    data: {
      runId: run.id,
      ticketId: ticket.id,
      toolName: "password_reset",
      toolInput: "{}",
      toolUseId: "tu_1",
      riskLevel: "HIGH",
      status: "APPROVED",
      decidedAt: new Date(),
      deciderId: admin.id,
    },
  });
});

describe("GET /api/runs — the console list", () => {
  it("serves admins and agents, refuses requesters", async () => {
    holder.user = admin;
    const ok = await listRuns(new Request("http://x/api/runs") as never);
    expect(ok.status).toBe(200);

    holder.user = agentUser;
    const alsoOk = await listRuns(new Request("http://x/api/runs") as never);
    expect(alsoOk.status).toBe(200);

    holder.user = requester;
    const denied = await listRuns(new Request("http://x/api/runs") as never);
    expect(denied.status).toBe(403);
  });

  it("lists the run with agent name, ticket, counts — and no conversation key", async () => {
    holder.user = admin;
    const res = await listRuns(new Request("http://x/api/runs") as never);
    const body = await res.json();
    expect(body.runs).toHaveLength(1);
    const run = body.runs[0];
    expect(run.agent.name).toBe("Servo Resolver");
    expect(run.ticket.number).toBe(1001);
    expect(run.ticket.title).toContain("Drill");
    expect(run.steps).toBe(3);
    expect(run.approvals).toBe(1);
    expect(run.qaVerdict).toBe("PASS");
    // Engine-resume state is not the audit trail — the key is absent.
    expect("conversation" in run).toBe(false);
    expect(JSON.stringify(body)).not.toContain("SECRET-CONVERSATION-STATE");
  });

  it("filters by status and kind server-side", async () => {
    holder.user = admin;
    const none = await listRuns(new Request("http://x/api/runs?status=RUNNING") as never);
    expect((await none.json()).runs).toHaveLength(0);
    const some = await listRuns(new Request("http://x/api/runs?kind=RESOLVE&status=COMPLETED") as never);
    expect((await some.json()).runs).toHaveLength(1);
  });
});

describe("GET /api/runs/:id — the run trace", () => {
  it("returns steps ordered by index with the decider named, gated to desk roles", async () => {
    holder.user = agentUser;
    const res = await getRun(new Request("http://x/api/runs/x") as never, {
      params: Promise.resolve({ id: runId }),
    });
    expect(res.status).toBe(200);
    const { run } = await res.json();
    expect(run.steps.map((s: { index: number }) => s.index)).toEqual([0, 1, 2]);
    expect(run.steps[1].toolName).toBe("device_inventory_lookup");
    expect(run.steps[1].riskLevel).toBe("LOW");
    expect(run.approvals).toHaveLength(1);
    expect(run.approvals[0].decider.name).toBe("Ad");
    expect(run.agent.name).toBe("Servo Resolver");

    holder.user = requester;
    const denied = await getRun(new Request("http://x/api/runs/x") as never, {
      params: Promise.resolve({ id: runId }),
    });
    expect(denied.status).toBe(403);
  });

  it("never serializes the conversation, and 404s an unknown run", async () => {
    holder.user = admin;
    const res = await getRun(new Request("http://x/api/runs/x") as never, {
      params: Promise.resolve({ id: runId }),
    });
    const text = await res.text();
    expect(text).not.toContain("SECRET-CONVERSATION-STATE");
    expect("conversation" in (JSON.parse(text).run)).toBe(false);

    const missing = await getRun(new Request("http://x/api/runs/x") as never, {
      params: Promise.resolve({ id: "does-not-exist" }),
    });
    expect(missing.status).toBe(404);
  });
});

describe("listRuns — the shared query", () => {
  it("is pure over its db handle: the same rows for the page and the route", async () => {
    const runs = await listRunsQuery();
    expect(runs).toHaveLength(1);
    expect(runs[0].agent.aiKind).toBe("RESOLVER");
    expect(runs[0].completedAt).not.toBeNull(); // createdAt/completedAt — the real columns
  });
});
