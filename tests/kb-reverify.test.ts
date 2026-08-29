// kb-13: send-time re-verification on EVERY send. A draft built while A∩B
// held and approved a week later, after a grant was revoked, must not ship.
// Re-verification runs INSIDE approveDraft, BEFORE the atomic claim — the
// human path and (later, kb-14) the automatic path identically.

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { tmpDb, type TmpDb } from "./helpers/tmp-db";

type ServoDb = { [key: string]: unknown };
const holder = vi.hoisted(() => ({ db: null as unknown as ServoDb }));
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

import { approveDraft, draftReply, rejectDraft } from "@/lib/ai/draft";
import { ingestDocument } from "@/lib/kb/ingest";

const handles: TmpDb[] = [];
afterAll(async () => {
  for (const h of handles) await h.dispose();
});

let db: PrismaClient;
let admin: { id: string; name: string; email: string };
let requester: { id: string; name: string; email: string };

beforeEach(async () => {
  if (handles.length > 1) await handles.shift()?.dispose();
  const a = await tmpDb();
  handles.push(a);
  db = a.client;
  holder.db = db as unknown as ServoDb;
  admin = await db.user.create({ data: { name: "Admin", email: "a@x.com", role: "ADMIN" } });
  requester = await db.user.create({ data: { name: "R", email: "r@x.com", role: "REQUESTER" } });
});

describe("send-time re-verification", () => {
  it("revoking one cited grant after drafting BLOCKS a human approval with a specific error", async () => {
    const doc = await ingestDocument({
      name: "pricing.md", contentType: "text/markdown", ownerId: admin.id, visibility: "PUBLIC",
      bytes: Buffer.from("# Pricing\n\nThe renewal window for pricing is March."),
    });
    const grant = await db.kbGrant.create({
      data: { documentId: doc.documentId, subjectType: "AGENT", subjectId: "builtin:drafter", grantedById: admin.id },
    });
    const t = await db.ticket.create({
      data: { number: 3001, title: "Pricing renewal window", description: "When is the renewal window?", requesterId: requester.id },
    });
    const draft = await draftReply(t.id);
    const sources = draft.sources as unknown[];
    expect(sources.length).toBeGreaterThan(0);

    // A week later: the grant is revoked.
    await db.kbGrant.delete({ where: { id: grant.id } });

    await expect(approveDraft(draft.id, admin as never)).rejects.toThrow(/no longer readable|went dark/i);

    // The atomic claim is UNTOUCHED on refusal: still PENDING, no comment,
    // no firstResponseAt, no email (sendMail is mocked but the row says).
    const after = await db.replyDraft.findUniqueOrThrow({ where: { id: draft.id } });
    expect(after.status).toBe("PENDING");
    expect(await db.comment.count({ where: { ticketId: t.id } })).toBe(0);
    const ticket = await db.ticket.findUniqueOrThrow({ where: { id: t.id } });
    expect(ticket.firstResponseAt).toBeNull();
  });

  it("with grants intact the send proceeds unchanged", async () => {
    const doc = await ingestDocument({
      name: "stable.md", contentType: "text/markdown", ownerId: admin.id, visibility: "PUBLIC",
      bytes: Buffer.from("# Stable\n\nThe renewal window is March."),
    });
    await db.kbGrant.create({
      data: { documentId: doc.documentId, subjectType: "AGENT", subjectId: "builtin:drafter", grantedById: admin.id },
    });
    const t = await db.ticket.create({
      data: { number: 3002, title: "Stable renewal window", description: "When is the renewal window?", requesterId: requester.id },
    });
    const draft = await draftReply(t.id);
    const sent = await approveDraft(draft.id, admin as never);
    expect(sent.status).toBe("SENT");
    expect(await db.comment.count({ where: { ticketId: t.id } })).toBe(1);
  });

  it("a zero-citation draft sends without re-verification trouble", async () => {
    const t = await db.ticket.create({
      data: { number: 3003, title: "Greeting", description: "Say hello.", requesterId: requester.id },
    });
    const draft = await draftReply(t.id);
    expect(draft.sources).toEqual([]);
    const sent = await approveDraft(draft.id, admin as never);
    expect(sent.status).toBe("SENT");
  });

  it("rejectDraft is unaffected (no re-verification on a refusal)", async () => {
    const t = await db.ticket.create({
      data: { number: 3004, title: "Whatever", description: "x", requesterId: requester.id },
    });
    const draft = await draftReply(t.id);
    const rejected = await rejectDraft(draft.id, admin as never);
    expect(rejected.status).toBe("REJECTED");
  });
});
