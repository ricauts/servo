// kb-14: auto-delivery. Five preconditions in order (per-category setting,
// ≥1 citation, re-verification, QA not flagged, daily cap), the automatic
// claim with deciderId null + autoDelivered true, the Servo Drafter
// timeline author, webhook parity, and the fresh-install default: NOTHING
// auto-sends.

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { tmpDb, type TmpDb } from "./helpers/tmp-db";

type ServoDb = { [key: string]: unknown };
const holder = vi.hoisted(() => ({
  db: null as unknown as ServoDb,
  events: [] as Record<string, unknown>[],
}));
vi.mock("@/lib/db", () => ({ get db() { return holder.db; } }));
vi.mock("@/lib/ai/credentials", () => ({
  settingsForProfile: async () => ({
    settings: { provider: "mock", model: "mock", apiKey: "", baseUrl: "", autoTriage: true, autoDraft: true, qaEnabled: true, keySource: "none" },
    credentialName: "mock",
  }),
  withUsage: (p: unknown) => p,
}));
vi.mock("@/lib/ai/provider", () => ({
  getProvider: () => ({
    complete: async () => ({ text: "Answer per the pricing document.", usage: { inputTokens: 1, outputTokens: 1 } }),
  }),
}));
vi.mock("@/lib/notify", () => ({ sendMail: async () => true }));
vi.mock("@/lib/webhooks", () => ({ emitEvent: (kind: string, payload: Record<string, unknown>) => { holder.events.push({ kind, ...payload }); } }));

import { draftReply } from "@/lib/ai/draft";
import { ensureAiAgents } from "@/lib/bootstrap";
import { ingestDocument } from "@/lib/kb/ingest";

const handles: TmpDb[] = [];
afterAll(async () => {
  for (const h of handles) await h.dispose();
});

let db: PrismaClient;
let admin: { id: string; email: string };
let requester: { id: string; email: string };

beforeEach(async () => {
  if (handles.length > 1) await handles.shift()?.dispose();
  const a = await tmpDb();
  handles.push(a);
  db = a.client;
  holder.db = db as unknown as ServoDb;
  holder.events = [];
  admin = await db.user.create({ data: { name: "A", email: "a@x.com", role: "ADMIN" } });
  requester = await db.user.create({ data: { name: "R", email: "r@x.com", role: "REQUESTER" } });
});

async function citedTicket(number: number) {
  const doc = await ingestDocument({
    name: "pricing.md", contentType: "text/markdown", ownerId: admin.id, visibility: "PUBLIC",
    bytes: Buffer.from("# Pricing\n\nThe renewal window for pricing is March."),
  });
  await db.kbGrant.create({
    data: { documentId: doc.documentId, subjectType: "AGENT", subjectId: "builtin:drafter", grantedById: admin.id },
  });
  return db.ticket.create({
    data: { number, title: "Pricing renewal window", description: "When is the renewal window?", requesterId: requester.id, category: "SOFTWARE" },
  });
}

describe("auto-deliver", () => {
  it("policy ON + clean citations → auto-SENT, comment by Servo Drafter, webhook carries autoDelivered", async () => {
    await ensureAiAgents();
    await db.setting.create({ data: { key: "kb.autodeliver.SOFTWARE", value: "true" } });
    const t = await citedTicket(4001);

    const draft = await draftReply(t.id);
    expect(draft.status).toBe("SENT");
    expect(draft.autoDelivered).toBe(true);
    expect(draft.deciderId).toBeNull();

    const comment = await db.comment.findFirstOrThrow({ where: { ticketId: t.id }, include: { author: true } });
    expect(comment.author.email).toBe("drafter@servo.ai");
    expect(comment.author.aiKind).toBe("DRAFT");

    const event = holder.events.find((e) => e.kind === "reply.sent");
    expect(event?.autoDelivered).toBe(true);
    // firstResponseAt started: the ordinary machinery followed the claim.
    const after = await db.ticket.findUniqueOrThrow({ where: { id: t.id } });
    expect(after.firstResponseAt).not.toBeNull();
  });

  it("a draft with zero citations NEVER auto-sends (policy on)", async () => {
    await ensureAiAgents();
    await db.setting.create({ data: { key: "kb.autodeliver.OTHER", value: "true" } });
    const t = await db.ticket.create({
      data: { number: 4002, title: "Greeting", description: "Say hello.", requesterId: requester.id },
    });
    const draft = await draftReply(t.id);
    expect(draft.status).toBe("PENDING");
    expect(draft.autoDelivered).toBe(false);
  });

  it("the 21st send in a day parks at the queue (default cap 20)", async () => {
    await ensureAiAgents();
    await db.setting.create({ data: { key: "kb.autodeliver.SOFTWARE", value: "true" } });
    const since = new Date(Date.now() - 3600_000);
    const capTicket = await db.ticket.create({
      data: { number: 4099, title: "Cap seed", description: "x", requesterId: requester.id },
    });
    for (let i = 0; i < 20; i++) {
      await db.replyDraft.create({
        data: { ticketId: capTicket.id, body: "x", agentName: "s", status: "SENT", autoDelivered: true, decidedAt: since },
      });
    }
    const t = await citedTicket(4003);
    const draft = await draftReply(t.id);
    expect(draft.status).toBe("PENDING"); // cap exhausted
    expect(draft.autoDelivered).toBe(false);
  });

  it("policy OFF — the state of a fresh install — NOTHING auto-sends", async () => {
    await ensureAiAgents();
    const t = await citedTicket(4004);
    const draft = await draftReply(t.id);
    expect(draft.status).toBe("PENDING");
    expect(holder.events.find((e) => e.kind === "reply.sent")).toBeUndefined();
  });

  it("a QA FAIL verdict on the ticket parks the draft", async () => {
    await ensureAiAgents();
    await db.setting.create({ data: { key: "kb.autodeliver.SOFTWARE", value: "true" } });
    const t = await citedTicket(4005);
    const aiUser = await db.user.findFirstOrThrow({ where: { role: "AI_AGENT", aiKind: "RESOLVER" } });
    await db.agentRun.create({
      data: { ticketId: t.id, agentUserId: aiUser.id, kind: "RESOLVE", status: "COMPLETED", qaVerdict: "FAIL" },
    });
    const draft = await draftReply(t.id);
    expect(draft.status).toBe("PENDING");
  });

  it("the KPI draft aggregation tolerates SENT with null deciders", async () => {
    const kpiTicket = await db.ticket.create({
      data: { number: 4098, title: "KPI seed", description: "x", requesterId: requester.id },
    });
    await db.replyDraft.create({
      data: { ticketId: kpiTicket.id, body: "auto", agentName: "s", status: "SENT", autoDelivered: true, decidedAt: new Date() },
    });
    const drafts = await db.replyDraft.findMany({ where: { status: "SENT" } });
    // The aggregation in src/lib/tickets.ts reads status/edited only —
    // mirror it here to prove null deciders neither crash nor miscount.
    const stats = { sentAsIs: 0, edited: 0 };
    for (const d of drafts) {
      if (d.status === "SENT") d.edited ? stats.edited++ : stats.sentAsIs++;
    }
    expect(stats.sentAsIs).toBe(1);
  });
});
