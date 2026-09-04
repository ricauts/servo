// kb-lib-3: the graph view — the seeded layout (same corpus, same picture),
// the search predicate, and the RED TEAM on /api/kb/graph: a reader
// entitled to A but not B gets neither B's node nor the A–B edge nor its
// evidence, the same rule relatedDocuments applies.

import { readFileSync } from "node:fs";
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

import { layoutGraph, matchesDataType, nodeMatches, type GraphView } from "@/lib/kb/graph-view";
import { GET as getGraph } from "@/app/api/kb/graph/route";
import { ingestDocument } from "@/lib/kb/ingest";

describe("layoutGraph (kb-lib-3)", () => {
  const view: GraphView = {
    nodes: [
      { id: "a", kind: "document", name: "A" },
      { id: "b", kind: "document", name: "B" },
      { id: "c", kind: "document", name: "C" },
      { id: "collection:s", kind: "collection", name: "Shelf", size: 2 },
    ],
    edges: [
      { from: "a", to: "b", kind: "SHARED_ENTITY", weight: 0.8, evidence: ["ACME"] },
      { from: "a", to: "collection:s", kind: "MEMBER", weight: 1, evidence: [] },
      { from: "b", to: "collection:s", kind: "MEMBER", weight: 1, evidence: [] },
    ],
  };

  it("is deterministic and keeps every node on the canvas", () => {
    const one = layoutGraph(view, { width: 800, height: 600 });
    const two = layoutGraph(view, { width: 800, height: 600 });
    expect(one).toEqual(two);
    expect(one.length).toBe(4);
    for (const n of one) {
      expect(n.x).toBeGreaterThanOrEqual(24);
      expect(n.x).toBeLessThanOrEqual(776);
      expect(n.y).toBeGreaterThanOrEqual(24);
      expect(n.y).toBeLessThanOrEqual(576);
    }
  });

  it("pulls linked nodes closer than unlinked ones", () => {
    const pos = new Map(layoutGraph(view, { width: 800, height: 600 }).map((n) => [n.id, n]));
    const d = (p: string, q: string) => Math.hypot(pos.get(p)!.x - pos.get(q)!.x, pos.get(p)!.y - pos.get(q)!.y);
    expect(d("a", "b")).toBeLessThan(d("a", "c"));
    expect(d("b", "c")).toBeGreaterThan(d("a", "b"));
  });

  it("handles the degenerate sizes", () => {
    expect(layoutGraph({ nodes: [], edges: [] }, { width: 10, height: 10 })).toEqual([]);
    const single = layoutGraph({ nodes: [{ id: "x", kind: "document", name: "X" }], edges: [] }, { width: 100, height: 100 });
    expect(single.length).toBe(1);
  });

  it("matchesDataType: files, catalog cards, and documents by their source's kind", () => {
    const kindOf = (id: string) => (id === "s1" ? "S3" : undefined);
    const file = { id: "a", kind: "document" as const, name: "a", docKind: "FILE" as const, sourceId: null };
    const card = { id: "b", kind: "document" as const, name: "b", docKind: "CATALOG" as const, sourceId: "s1" };
    const shelf = { id: "collection:x", kind: "collection" as const, name: "x" };
    const src = { id: "source:s1", kind: "source" as const, name: "bucket", sourceKind: "S3" };
    expect(matchesDataType(file, "ALL", kindOf)).toBe(true);
    expect(matchesDataType(file, "FILE", kindOf)).toBe(true);
    expect(matchesDataType(file, "CATALOG", kindOf)).toBe(false);
    expect(matchesDataType(card, "CATALOG", kindOf)).toBe(true);
    expect(matchesDataType(card, "S3", kindOf)).toBe(true);
    expect(matchesDataType(file, "S3", kindOf)).toBe(false);
    expect(matchesDataType(shelf, "POSTGRES", kindOf)).toBe(true);
    expect(matchesDataType(src, "S3", kindOf)).toBe(true);
    expect(matchesDataType(src, "POSTGRES", kindOf)).toBe(false);
  });

  it("nodeMatches searches name, topics and keywords", () => {
    const n = { id: "a", kind: "document" as const, name: "Manual.pdf", topics: ["Data Contracts"], keywords: ["wits"] };
    expect(nodeMatches(n, "")).toBe(true);
    expect(nodeMatches(n, "manual")).toBe(true);
    expect(nodeMatches(n, "contracts")).toBe(true);
    expect(nodeMatches(n, "WITS")).toBe(true);
    expect(nodeMatches(n, "nothing")).toBe(false);
  });
});

describe("GET /api/kb/graph — entitlement (kb-lib-3)", () => {
  let handle: TmpDb;
  let db: PrismaClient;
  let admin: { id: string; role: string };
  let loner: { id: string; role: string };

  beforeEach(async () => {
    handle = await tmpDb();
    db = handle.client;
    holder.db = db as unknown as ServoDb;
    const a = await db.user.create({ data: { name: "Admin", email: `a-${Date.now()}@x.com`, role: "ADMIN" } });
    const l = await db.user.create({ data: { name: "Loner", email: `l-${Date.now()}@x.com`, role: "AGENT" } });
    admin = { id: a.id, role: "ADMIN" };
    loner = { id: l.id, role: "AGENT" };
    holder.user = admin;
  });
  afterAll(async () => {
    await handle?.dispose();
  });

  it("returns entitled nodes, shelf nodes with MEMBER edges, and hides the far side of a half-entitled edge", async () => {
    const shelf = await db.collection.create({ data: { name: "Vendors" } });
    const shared = "Contact ops@acme-corp.test about invoice INV-2024-113 from Acme Corp Holdings.";
    const A = await ingestDocument({ name: "a.md", contentType: "text/markdown", ownerId: admin.id, bytes: Buffer.from(`# A\n\n${shared}`) });
    const B = await ingestDocument({ name: "secret.md", contentType: "text/markdown", ownerId: admin.id, bytes: Buffer.from(`# B\n\n${shared}`) });
    await db.document.update({ where: { id: A.documentId }, data: { collectionId: shelf.id } });

    // Admin sees both, the shelf, the membership edge and the shared-entity edge.
    const full = await (await getGraph()).json();
    const ids = new Set(full.nodes.map((n: { id: string }) => n.id));
    expect(ids.has(A.documentId)).toBe(true);
    expect(ids.has(B.documentId)).toBe(true);
    expect(ids.has(`collection:${shelf.id}`)).toBe(true);
    expect(full.edges.some((e: { kind: string; from: string }) => e.kind === "MEMBER" && e.from === A.documentId)).toBe(true);
    expect(full.edges.some((e: { kind: string }) => e.kind === "SHARED_ENTITY")).toBe(true);

    // The loner may read A only.
    await db.kbGrant.create({ data: { documentId: A.documentId, subjectType: "USER", subjectId: loner.id, grantedById: admin.id } });
    holder.user = loner;
    const res = await getGraph();
    expect(res.status).toBe(200);
    const body = await res.json();
    const seen = new Set(body.nodes.map((n: { id: string }) => n.id));
    expect(seen.has(A.documentId)).toBe(true);
    expect(seen.has(B.documentId)).toBe(false);
    expect(body.edges.filter((e: { kind: string }) => e.kind !== "MEMBER")).toEqual([]);
    const text = JSON.stringify(body);
    expect(text).not.toContain("secret.md");
    expect(text).not.toContain("INV-2024-113");
    expect(text).not.toContain(B.documentId);
  });

  it("adds a typed source node with FROM_SOURCE edges only through entitled documents", async () => {
    const source = await db.dataSource.create({
      data: {
        name: "warehouse", kind: "POSTGRES", secretRef: "s", status: "READY", createdById: admin.id,
        configJson: { host: "127.0.0.1", port: 5434, database: "erp" },
      },
    });
    const crawled = await ingestDocument({ name: "payroll.md", contentType: "text/markdown", ownerId: admin.id, bytes: Buffer.from("# payroll\n\nnet pay by month") });
    await db.document.update({ where: { id: crawled.documentId }, data: { sourceId: source.id } });
    // The source CEILING (xds-02): a source-backed document is readable only
    // under a source grant, ownership included — the admin gets one here.
    await db.kbGrant.create({ data: { sourceId: source.id, subjectType: "USER", subjectId: admin.id, grantedById: admin.id } });
    await ingestDocument({ name: "local.md", contentType: "text/markdown", ownerId: admin.id, bytes: Buffer.from("# local\n\nan upload") });

    const body = await (await getGraph()).json();
    const src = body.nodes.find((n: { id: string }) => n.id === `source:${source.id}`);
    expect(src).toMatchObject({ kind: "source", name: "warehouse", sourceKind: "POSTGRES", status: "READY", size: 1 });
    expect(body.edges.some((e: { kind: string; from: string; to: string }) => e.kind === "FROM_SOURCE" && e.from === crawled.documentId && e.to === `source:${source.id}`)).toBe(true);
    const local = body.nodes.find((n: { name: string }) => n.name === "local.md");
    expect(local.docKind).toBe("FILE");
    expect(local.sourceId).toBeNull();

    // A reader entitled only to the local upload never learns the source exists.
    await db.kbGrant.create({ data: { documentId: local.id, subjectType: "USER", subjectId: loner.id, grantedById: admin.id } });
    holder.user = loner;
    const narrow = JSON.stringify(await (await getGraph()).json());
    expect(narrow).not.toContain("warehouse");
    expect(narrow).not.toContain(source.id);
  });

  it("refuses a requester", async () => {
    const r = await db.user.create({ data: { name: "R", email: `r-${Date.now()}@x.com`, role: "REQUESTER" } });
    holder.user = { id: r.id, role: "REQUESTER" };
    expect((await getGraph()).status).toBe(403);
  });
});

describe("kb-lib-3 markup", () => {
  it("the graph page gates on kb.view and the library links to it", () => {
    const page = readFileSync("src/app/kb/graph/page.tsx", "utf8");
    expect(page).toMatch(/can\(user, "kb\.view"\)/);
    const list = readFileSync("src/app/kb/page.tsx", "utf8");
    expect(list).toMatch(/href="\/kb\/graph"/);
    const component = readFileSync("src/components/kb/KbGraph.tsx", "utf8");
    expect(component).toMatch(/fetch\("\/api\/kb\/graph"\)/);
    expect(component).toMatch(/aria-label="Visibility"/);
    expect(component).toMatch(/aria-label="Collection"/);
  });
});
