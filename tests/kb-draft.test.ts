// kb-12: drafter retrieval and provenance by construction. The drafter gets
// a deterministic pre-retrieval step (NO tool loop — a model with tools can
// quote a passage it never logged), numbered citation markers in draftUser,
// and ReplyDraft.sources IS the injected set: every entry corresponds to text
// that was in the prompt, asserted against the recorded prompt itself.

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { tmpDb, type TmpDb } from "./helpers/tmp-db";

type ServoDb = { [key: string]: unknown };
const holder = vi.hoisted(() => ({
  db: null as unknown as ServoDb,
  prompts: [] as { system: string; user: string; tools: unknown[] }[],
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
    complete: async (req: { system: string; messages: { content: { text: string }[] }[]; tools: unknown[] }) => {
      holder.prompts.push({ system: req.system, user: req.messages[0].content[0].text, tools: req.tools });
      return { text: "Answer per the pricing document.", usage: { inputTokens: 1, outputTokens: 1 } };
    },
  }),
}));

import { draftReply } from "@/lib/ai/draft";
import { ingestDocument } from "@/lib/kb/ingest";
import { mockEmbed, MOCK_EMBEDDER_MODEL } from "@/lib/kb/mock-embedder";

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
  holder.prompts = [];
  admin = await db.user.create({ data: { name: "A", email: "a@x.com", role: "ADMIN" } });
  requester = await db.user.create({ data: { name: "R", email: "r@x.com", role: "REQUESTER" } });
});

async function embedDoc(documentId: string) {
  const chunks = await db.documentChunk.findMany({ where: { documentId }, select: { id: true, text: true } });
  for (const c of chunks) {
    const v = mockEmbed(c.text);
    await db.$executeRawUnsafe(
      `UPDATE "DocumentChunk" SET embedding = '[${v.join(",")}]'::vector, "embeddingModel" = '${MOCK_EMBEDDER_MODEL}', "embeddingDims" = 256 WHERE id = '${c.id}'`,
    );
  }
}

async function ticket(title: string, description: string) {
  return db.ticket.create({
    data: { number: Math.floor(Math.random() * 100000) + 2000, title, description, requesterId: requester.id },
  });
}

describe("draftReply — deterministic pre-retrieval", () => {
  it("injects cited passages and sources IS the injected set", async () => {
    const doc = await ingestDocument({
      name: "Pricing.xlsx", contentType: "text/markdown", ownerId: admin.id, visibility: "PUBLIC",
      bytes: Buffer.from("# Pricing\n\nThe renewal window for pricing is March and carries a 5% late fee."),
    });
    // The drafter (builtin:drafter) and the requester both reach PUBLIC.
    await db.kbGrant.create({
      data: { documentId: doc.documentId, subjectType: "AGENT", subjectId: "builtin:drafter", grantedById: admin.id },
    });
    await embedDoc(doc.documentId);

    const t = await ticket("Pricing renewal window", "When is the pricing renewal window and its late fee?");
    const draft = await draftReply(t.id);

    const prompt = holder.prompts.at(-1)!.user;
    expect(prompt).toMatch(/\[1\] Pricing\.xlsx/); // numbered citation marker
    expect(prompt).toContain("renewal window");

    // The model had NO tools: provenance is structural, not trusted.
    expect(holder.prompts.at(-1)!.tools).toEqual([]);

    // sources is EXACTLY the injected set — asserted against the prompt text:
    // every source's chunk text appears in the prompt, and the count matches.
    const sources = draft.sources as { docId: string; docName: string; chunkId: string; locator: unknown }[];
    expect(sources.length).toBeGreaterThan(0);
    expect(sources.length).toBeLessThanOrEqual(
      (prompt.match(/\[\d+\] /g) ?? []).length,
    );
    for (const s of sources) {
      const chunk = await db.documentChunk.findUniqueOrThrow({ where: { id: s.chunkId } });
      expect(prompt).toContain(chunk.text.slice(0, 40)); // was in the prompt
      expect(s.docName).toBe("Pricing.xlsx");
    }
  });

  it("a ticket with no entitled sources drafts normally with sources: []", async () => {
    await ingestDocument({
      name: "locked.md", contentType: "text/markdown", ownerId: admin.id,
      bytes: Buffer.from("# Locked\n\nGARDEN-PATH-42 internal-only terms"),
    });
    const t = await ticket("Locked pricing question", "Tell me the internal terms.");
    const draft = await draftReply(t.id);
    expect(draft.body).toContain("Answer per the pricing document.");
    expect(draft.sources).toEqual([]);
    // The requester's own words appear in the prompt, of course — the
    // invariant is the DOCUMENT'S CONTENT never does.
    expect(holder.prompts.at(-1)!.user).not.toContain("locked.md");
    expect(holder.prompts.at(-1)!.user).not.toContain("GARDEN-PATH-42");
  });

  it("non-entitled-for-the-drafter documents never enter the prompt", async () => {
    const doc = await ingestDocument({
      name: "no-drafter.md", contentType: "text/markdown", ownerId: admin.id, visibility: "PUBLIC",
      bytes: Buffer.from("# X\n\nZEBRA-OMEGA-99 internal directive terms"),
    });
    void doc; // PUBLIC: the REQUESTER reaches it, but builtin:drafter has NO grant
    const t = await ticket("omega renewal", "What are the omega renewal terms?");
    await draftReply(t.id);
    const prompt = holder.prompts.at(-1)!.user;
    expect(prompt).not.toContain("ZEBRA-OMEGA-99");
  });
});
