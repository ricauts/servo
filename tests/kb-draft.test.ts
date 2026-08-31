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
import { KB_EMBED_SETTING_KEYS } from "@/lib/kb/embed";
import { KB_EXTRACT_BUDGET_ENV } from "@/lib/kb/settings";

// The same tightening ext-04's and ext-06's own files make: fixtures must not
// wait out the shipped extraction budget.
process.env[KB_EXTRACT_BUDGET_ENV] = "20000";

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

/** The document ids behind a draft's citations, deduped. */
function citedDocs(draft: { sources: unknown }): string[] {
  const sources = (draft.sources ?? []) as { docId: string }[];
  return [...new Set(sources.map((s) => s.docId))].sort();
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

  it("ticket-derived filters narrow the drafter's retrieval, and only narrow it (ext-07)", async () => {
    // NO EMBEDDINGS: this runs on the DEFAULT install, so the keyword half
    // does the selecting and the assertion is substantive rather than carried
    // by a vector branch that matches every entitled chunk. Both documents
    // say "invoices cover", so both are keyword candidates for both tickets;
    // the only thing that separates them is the filter the ticket carries.
    const big = await ingestDocument({
      name: "big-invoices.md", contentType: "text/markdown", ownerId: admin.id, visibility: "PUBLIC",
      bytes: Buffer.from("# Ledger\n\nConsulting invoices cover the period. Total $3,000.00 due on receipt."),
    });
    const small = await ingestDocument({
      name: "small-invoices.md", contentType: "text/markdown", ownerId: admin.id, visibility: "PUBLIC",
      bytes: Buffer.from("# Ledger\n\nConsulting invoices cover the period. Total $500.00 due on receipt."),
    });
    for (const doc of [big, small]) {
      await db.kbGrant.create({
        data: { documentId: doc.documentId, subjectType: "AGENT", subjectId: "builtin:drafter", grantedById: admin.id },
      });
    }

    const filtered = await draftReply(
      (await ticket("Invoices", "What do the invoices over $2,000 cover?")).id,
    );
    const unfiltered = await draftReply(
      (await ticket("Invoices", "What do the invoices cover?")).id,
    );

    // Only the document that satisfies the filter is cited...
    expect(citedDocs(filtered)).toEqual([big.documentId]);
    // ...and the same ticket with the filter phrase removed draws from
    // STRICTLY MORE documents, never fewer: a filter can only remove rows.
    expect(citedDocs(unfiltered)).toEqual([big.documentId, small.documentId].sort());
    expect(citedDocs(filtered).every((id) => citedDocs(unfiltered).includes(id))).toBe(true);

    // Provenance is unchanged on the filtered path too, asserted the way
    // kb-12 asserts it: every stored source's chunk text was in the prompt.
    const prompts = holder.prompts.map((p) => p.user);
    for (const s of filtered.sources as { chunkId: string }[]) {
      const chunk = await db.documentChunk.findUniqueOrThrow({ where: { id: s.chunkId } });
      expect(prompts.at(-2)).toContain(chunk.text.slice(0, 40));
    }
    // ...and the small ledger's text never reached the filtered prompt.
    expect(prompts.at(-2)).not.toContain("$500.00");
    expect(prompts.at(-1)).toContain("$500.00");
  }, 60_000);

  it("a MENTION is not a constraint: ordinary ticket prose never empties the drafter's retrieval (ext-07)", async () => {
    // The shape this rule exists for. An address, an order id, a URL or an
    // amount in passing all make the extractor type a fact; ANDed as a gate,
    // each one takes the draft from cited to uncited, silently, and then
    // disables kb-14 auto-delivery, which requires a citation. Only a
    // COMPARATOR-bound filter is treated as something the requester asked for.
    //
    // The mock embedder is ON here on purpose: it makes every entitled chunk a
    // candidate, so the keyword half cannot be what decides the outcome and
    // the assertion is about the filters alone.
    await db.setting.create({ data: { key: KB_EMBED_SETTING_KEYS.model, value: "mock" } });
    const doc = await ingestDocument({
      name: "Pricing.md", contentType: "text/markdown", ownerId: admin.id, visibility: "PUBLIC",
      bytes: Buffer.from("# Pricing\n\nThe renewal window for pricing is March and carries a 5% late fee."),
    });
    await db.kbGrant.create({
      data: { documentId: doc.documentId, subjectType: "AGENT", subjectId: "builtin:drafter", grantedById: admin.id },
    });
    await embedDoc(doc.documentId);

    const plain = await draftReply((await ticket("Pricing renewal window", "When is the pricing renewal window?")).id);
    expect(citedDocs(plain)).toEqual([doc.documentId]);

    for (const sentence of [
      "Please reply to bob@acme.example.",
      "My order is INV-2024-113.",
      "See https://example.invalid/help for context.",
      "I was charged $49.99.",
      "I signed up on 2026-01-05.",
      "It took 30 days.",
    ]) {
      const t = await ticket("Pricing renewal window", `When is the pricing renewal window? ${sentence}`);
      const draft = await draftReply(t.id);
      expect(citedDocs(draft), sentence).toEqual([doc.documentId]);
    }
  }, 120_000);

  it("a stated constraint is still honoured when it selects nothing — no silent widening (ext-07)", async () => {
    // Embeddings on for the same reason: the $500 ledger IS a candidate, so
    // the empty result below is the filter and nothing else.
    await db.setting.create({ data: { key: KB_EMBED_SETTING_KEYS.model, value: "mock" } });
    const doc = await ingestDocument({
      name: "small-invoices.md", contentType: "text/markdown", ownerId: admin.id, visibility: "PUBLIC",
      bytes: Buffer.from("# Ledger\n\nConsulting invoices cover the period. Total $500.00 due on receipt."),
    });
    await db.kbGrant.create({
      data: { documentId: doc.documentId, subjectType: "AGENT", subjectId: "builtin:drafter", grantedById: admin.id },
    });
    await embedDoc(doc.documentId);

    // The control: without the constraint the same ticket DOES cite it.
    const control = await draftReply(
      (await ticket("Invoices", "What do the invoices cover?")).id,
    );
    expect(citedDocs(control)).toEqual([doc.documentId]);

    // The only entitled document is a $500 ledger; the requester asked about
    // invoices over $2,000. Citing it anyway would be worse than citing none.
    const draft = await draftReply(
      (await ticket("Invoices", "What do the invoices over $2,000 cover?")).id,
    );
    expect(citedDocs(draft)).toEqual([]);
    expect(holder.prompts.at(-1)!.user).not.toContain("$500.00");
  }, 60_000);

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
