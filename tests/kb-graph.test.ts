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
