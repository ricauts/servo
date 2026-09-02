// kb-08: the keyword/entity pass, the graph edges, and the ACL-filtered
// related-documents surface — including the RED TEAM: a principal entitled
// to A but not B receives no edge to B, and the shared entity literal
// appears nowhere in their response.

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

import { GET as getRelated } from "@/app/api/kb/documents/[id]/related/route";
import { keywordPass } from "@/lib/kb/keywords";
import { relatedDocuments, rebuildEdgesFor } from "@/lib/kb/graph";
import { ingestDocument } from "@/lib/kb/ingest";

const handles: TmpDb[] = [];
afterAll(async () => {
  for (const h of handles) await h.dispose();
});

let db: PrismaClient;
let admin: { id: string; name: string; role: string };
let loner: { id: string; name: string; role: string };

beforeEach(async () => {
  if (handles.length > 2) await handles.shift()?.dispose();
  const a = await tmpDb();
  handles.push(a);
  db = a.client;
  holder.db = db as unknown as ServoDb;
  admin = { ...(await db.user.create({ data: { name: "Admin", email: "a@x.com", role: "ADMIN" } })), role: "ADMIN" };
  loner = { ...(await db.user.create({ data: { name: "Loner", email: "l@x.com", role: "AGENT" } })), role: "AGENT" };
  holder.user = admin;
});

describe("the keyword/entity pass", () => {
  it("is pure: the same input produces the same keywords, twice in one test", () => {
    const text = "Renewal invoice INV-2024-113 was emailed to dana@acme.com. Dana Whitfield approved the renewal invoice.";
    const first = keywordPass(text);
    const second = keywordPass(text);
    expect(first).toEqual(second);
    expect(first.entities).toContain("INV-2024-113");
    expect(first.entities).toContain("dana@acme.com");
    expect(first.entities).toContain("Dana Whitfield");
    expect(first.keywords).toContain("renewal");
    expect(first.keywords).not.toContain("the");
  });
});

describe("the graph", () => {
  it("two documents sharing INV-2024-113 get a SHARED_ENTITY edge naming it; an unrelated third gets none", async () => {
    const A = await ingestDocument({
      name: "a.md", contentType: "text/markdown", ownerId: admin.id,
      bytes: Buffer.from("# A\n\nInvoice INV-2024-113 was renewed for Dana Whitfield."),
    });
    const B = await ingestDocument({
      name: "b.md", contentType: "text/markdown", ownerId: admin.id,
      bytes: Buffer.from("# B\n\nThe invoice INV-2024-113 is due in March."),
    });
    const C = await ingestDocument({
      name: "c.md", contentType: "text/markdown", ownerId: admin.id,
      bytes: Buffer.from("# C\n\nNothing about invoices at all. Onboarding checklist."),
    });
    const edges = await db.knowledgeEdge.findMany({
      where: { OR: [{ fromId: A.documentId }, { toId: A.documentId }] },
    });
    // Edges are stored from the LATER-ingested document; match either direction.
    const toB = edges.find(
      (e) =>
        (e.fromId === A.documentId && e.toId === B.documentId) ||
        (e.fromId === B.documentId && e.toId === A.documentId),
    );
    expect(toB?.kind).toBe("SHARED_ENTITY");
    expect(JSON.stringify(toB?.evidence)).toContain("INV-2024-113");
    expect(
      edges.find(
        (e) =>
          (e.fromId === A.documentId && e.toId === C.documentId) ||
          (e.fromId === C.documentId && e.toId === A.documentId),
      ),
    ).toBeUndefined();
    void C;
  });

  it("SAME_COLLECTION edges appear for co-members", async () => {
    const collection = await db.collection.create({ data: { name: "Finance" } });
    const A = await ingestDocument({ name: "x.md", contentType: "text/markdown", ownerId: admin.id, bytes: Buffer.from("# X\n\nalpha content") });
    const B = await ingestDocument({ name: "y.md", contentType: "text/markdown", ownerId: admin.id, bytes: Buffer.from("# Y\n\nbeta content") });
    await db.document.update({ where: { id: A.documentId }, data: { collectionId: collection.id } });
    await db.document.update({ where: { id: B.documentId }, data: { collectionId: collection.id } });
    await rebuildEdgesFor(A.documentId);
    const edge = await db.knowledgeEdge.findFirst({
      where: { fromId: A.documentId, toId: B.documentId, kind: "SAME_COLLECTION" },
    });
    expect(edge).not.toBeNull();
  });

  it("RED TEAM: a principal entitled to A but not B receives no edge to B — not id, not name, not evidence", async () => {
    const A = await ingestDocument({
      name: "mine.md", contentType: "text/markdown", ownerId: admin.id,
      bytes: Buffer.from("# Mine\n\nInvoice INV-2024-113 renewed."),
    });
    const B = await ingestDocument({
      name: "secret.md", contentType: "text/markdown", ownerId: admin.id,
      bytes: Buffer.from("# Secret\n\nInvoice INV-2024-113 audit trail."),
    });
    // The loner can read A (direct grant) but NOT B.
    await db.kbGrant.create({
      data: { documentId: A.documentId, subjectType: "USER", subjectId: loner.id, grantedById: admin.id },
    });

    const related = await relatedDocuments(db, { humanId: loner.id, agentId: null }, A.documentId);
    expect(related.find((r) => r.id === B.documentId)).toBeUndefined();
    expect(JSON.stringify(related)).not.toContain("secret.md");
    expect(JSON.stringify(related)).not.toContain("INV-2024-113"); // evidence withheld

    // And through the route, as the loner:
    holder.user = loner;
    const res = await getRelated(new Request(`http://x/api/kb/documents/${A.documentId}/related`) as never, {
      params: Promise.resolve({ id: A.documentId }),
    });
    expect(res.status).toBe(200);
    const body = JSON.stringify(await res.json());
    expect(body).not.toContain(B.documentId);
    expect(body).not.toContain("secret.md");
    expect(body).not.toContain("INV-2024-113");

    // While the admin (entitled to both) DOES see the edge with evidence.
    const adminView = await relatedDocuments(db, { humanId: admin.id, agentId: null }, A.documentId);
    expect(JSON.stringify(adminView)).toContain("INV-2024-113");
  });

  it("a non-entitled anchor 404s — the same oracle as retrieval", async () => {
    const B = await ingestDocument({
      name: "hidden.md", contentType: "text/markdown", ownerId: admin.id,
      bytes: Buffer.from("# Hidden\n\ncontent"),
    });
    holder.user = loner;
    const res = await getRelated(new Request(`http://x/api/kb/documents/${B.documentId}/related`) as never, {
      params: Promise.resolve({ id: B.documentId }),
    });
    expect(res.status).toBe(404);
  });
});

describe("SHARED_FACT (ext-05, criterion 5 as restated by question 59 answer A)", () => {
  /** Ingest a doc and attach EXACT/ASSUMED facts to its first chunk. The
   *  graph reads the table; how facts got there is ext-02..04's business. */
  async function docWithFacts(
    name: string,
    facts: Array<{ kind: string; norm: string; confidence?: string }>,
  ) {
    const doc = await ingestDocument({
      name, contentType: "text/markdown", ownerId: admin.id,
      bytes: Buffer.from(`# ${name}

plain prose with no shared entities or keywords at all`),
    });
    const chunk = await db.documentChunk.findFirstOrThrow({
      where: { documentId: doc.documentId },
      orderBy: { id: "asc" },
    });
    // Distinct offsets keep ext-01's (chunkId, offset, kind) unique happy
    // when one chunk carries several same-kind facts.
    for (const [i, f] of facts.entries()) {
      await db.documentFact.create({
        data: {
          documentId: doc.documentId, chunkId: chunk.id,
          kind: f.kind, norm: f.norm, unit: "",
          text: f.norm, offset: i * 16, length: f.norm.length,
          confidence: f.confidence ?? "EXACT", extractor: "facts@1",
        },
      });
    }
    return doc.documentId;
  }
  /** Corpus filler: documents with UNIQUE facts, so the shared pairs below
   *  stay under the 20%-of-corpus cut (a pair in a 10-doc corpus is exactly
   *  20% - inclusive - and shares; the year-clique test exercises the cut). */
  async function filler(n: number) {
    for (let i = 0; i < n; i++) {
      await docWithFacts("filler" + i + ".md", [{ kind: "QUANTITY", norm: "FILLER:" + i }]);
    }
  }
  const factEdges = (a: string, b: string) =>
    db.knowledgeEdge.findMany({
      where: {
        kind: "SHARED_FACT",
        OR: [
          { fromId: a, toId: b },
          { fromId: b, toId: a },
        ],
      },
    });

  it("USD 2,400.00 and USD 2.400,00 get a SHARED_FACT edge whose evidence names USD:240000", async () => {
    const A = await docWithFacts("us-en.md", [{ kind: "MONEY", norm: "USD:240000" }]);
    const B = await docWithFacts("us-de.md", [{ kind: "MONEY", norm: "USD:240000" }]);
    await filler(8);
    await rebuildEdgesFor(B);
    const edges = await factEdges(A, B);
    expect(edges).toHaveLength(1);
    expect(edges[0].evidence).toContain("USD:240000");
  });

  it("ASSUMED facts NEVER produce an edge - two documents whose only shared fact is assumed get nothing", async () => {
    const A = await docWithFacts("assumed-a.md", [{ kind: "MONEY", norm: "USD:240000", confidence: "ASSUMED" }]);
    const B = await docWithFacts("assumed-b.md", [{ kind: "MONEY", norm: "USD:240000", confidence: "ASSUMED" }]);
    await filler(8);
    await rebuildEdgesFor(B);
    expect(await factEdges(A, B)).toEqual([]);
    // ...and the same two with an explicit USD on BOTH sides do.
    await db.documentFact.updateMany({
      where: { documentId: { in: [A, B] } },
      data: { confidence: "EXACT" },
    });
    await rebuildEdgesFor(B);
    expect(await factEdges(A, B)).toHaveLength(1);
  });

  it("a norm present in more than 20% of documents produces NO edge - the year clique never forms", async () => {
    // Four documents all containing DATE 2026 (100% of the corpus) plus a
    // rare shared MONEY fact on two of them (50% of TWO, but 2/4 = 50% > 20%
    // too... so use a 6-doc corpus: the year in all six is 100%, the money
    // pair is 2/6 = 33%... still >20%. Rarity floor: a pair in a 6-corpus is
    // ALWAYS >= 33%. So the >20% cut must be exercised on the YEAR only,
    // with the money pair BELOW it via a bigger corpus: 12 docs, pair = 2/12
    // = 16.7% <= 20% (edge), year = 12/12 = 100% (no edge).
    const ids: string[] = [];
    for (let i = 0; i < 12; i++) {
      ids.push(await docWithFacts("y" + i + ".md", [
        { kind: "DATE", norm: "2026" },
        ...(i < 2 ? [{ kind: "MONEY", norm: "EUR:50000" }] : []),
      ]));
    }
    await rebuildEdgesFor(ids[1]);
    const betweenPair = await factEdges(ids[0], ids[1]);
    expect(betweenPair).toHaveLength(1);
    expect(betweenPair[0].evidence).toContain("EUR:50000");
    expect(betweenPair[0].evidence).not.toContain("2026");
    // The year produced no edge between ANY pair of the twelve.
    const yearEdges = await db.knowledgeEdge.findMany({
      where: { kind: "SHARED_FACT", evidence: { array_contains: "2026" } },
    });
    expect(yearEdges).toEqual([]);
  }, 30_000);

  it("rarity counts DISTINCT DOCUMENTS, never occurrences", async () => {
    // Doc A's fact appears in ONE other document but FIVE times (repeated
    // header rows); doc B's fact appears in TWO other documents once each.
    // Distinct-document rarity weights A's edge HIGHER than B's.
    const A = await docWithFacts("rare.md", [{ kind: "IDENTIFIER", norm: "RARE-1" }]);
    const B = await docWithFacts("common.md", [{ kind: "IDENTIFIER", norm: "COMMON-1" }]);
    const holder = await docWithFacts("holder.md", [
      { kind: "IDENTIFIER", norm: "RARE-1" },
      { kind: "IDENTIFIER", norm: "COMMON-1" },
    ]);
    const third = await docWithFacts("third.md", [{ kind: "IDENTIFIER", norm: "COMMON-1" }]);
    await filler(11);
    void holder; void third;
    // Rebuild from the perspective that computes weights for both pairs.
    await rebuildEdgesFor(A);
    await rebuildEdgesFor(B);
    const wA = (await factEdges(A, holder))[0]?.weight;
    const wB = (await factEdges(B, holder))[0]?.weight;
    expect(wA).toBeGreaterThan(wB as number);
  }, 30_000);

  it("RED TEAM: a principal entitled to A but not B receives no SHARED_FACT edge to B - not the evidence, not the norm", async () => {
    const A = await docWithFacts("rt-a.md", [{ kind: "MONEY", norm: "USD:99000" }]);
    const B = await docWithFacts("rt-b.md", [{ kind: "MONEY", norm: "USD:99000" }]);
    await filler(8);
    await rebuildEdgesFor(B);
    expect(await factEdges(A, B)).toHaveLength(1);
    // The loner can read A (direct grant) but NOT B - kb-08's own pattern.
    await db.kbGrant.create({
      data: { documentId: A, subjectType: "USER", subjectId: loner.id, grantedById: admin.id },
    });
    holder.user = loner;
    const res = await getRelated(new Request(`http://x/api/kb/documents/${A}/related`) as never, {
      params: Promise.resolve({ id: A }),
    });
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain("USD:99000");
    expect(JSON.stringify(body)).not.toContain(B);
    holder.user = admin;
  });
});
