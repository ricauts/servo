// xds-07: cross-boundary graph edges and external citations. kb-08's edge
// builder is used UNCHANGED — the item PROVES the crossing rather than
// building a mechanism: an uploaded PDF and a crawled row sharing the
// entity code get a SHARED_ENTITY edge through the ordinary corpus pass,
// an unrelated third document gets none, and both red teams prove the
// entitlement fragment gates the crossing in each direction.

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { tmpDb, type TmpDb } from "./helpers/tmp-db";

type ServoDb = { [key: string]: unknown };
const holder = vi.hoisted(() => ({ db: null as unknown as ServoDb }));
vi.mock("@/lib/db", () => ({ get db() { return holder.db; } }));

import { rebuildEdgesFor, relatedDocuments } from "@/lib/kb/graph";
import { renderExternalCitation, stalenessAge } from "@/lib/kb/citation";
import { humanChainCte } from "@/lib/kb/entitlement";

const handles: TmpDb[] = [];
afterAll(async () => {
  for (const h of handles) await h.dispose();
});

let db: PrismaClient;
let admin: { id: string };

beforeEach(async () => {
  if (handles.length > 1) await handles.shift()?.dispose();
  const a = await tmpDb();
  handles.push(a);
  db = a.client;
  holder.db = db as unknown as ServoDb;
  admin = await db.user.create({ data: { name: "A", email: `a${Date.now()}@x.com`, role: "ADMIN" } });
  await db.$executeRawUnsafe(
    `CREATE OR REPLACE VIEW datasource_readable_by_human AS SELECT 'none'::text AS "dataSourceId", 'nobody'::text AS "userId"`,
  );
});

async function uploadedPdf(text: string, owner: { id: string }) {
  const doc = await db.document.create({
    data: {
      name: "invoice-scan.pdf", contentType: "application/pdf", byteSize: 1,
      sha256: "1".repeat(64), data: new Uint8Array(1), ownerId: owner.id,
      visibility: "PRIVATE", textStatus: "EXTRACTED",
    },
  });
  await db.documentChunk.create({
    data: { documentId: doc.id, index: 0, text, locator: { page: 3 } },
  });
  return doc;
}

async function crawledRow(sourceId: string, externalId: string, rowText: string, owner: { id: string }) {
  const doc = await db.document.create({
    data: {
      name: externalId, contentType: "text/markdown", byteSize: 1,
      sha256: "2".repeat(64), data: new Uint8Array(0), ownerId: owner.id,
      visibility: "PRIVATE", textStatus: "EXTRACTED", sourceId,
      externalLocator: { kind: "POSTGRES", source: "erp", schema: "public", table: "invoices", idColumn: "inv_id", id: externalId },
      externalVersion: "v1", externalSeenAt: new Date(), runStartedAt: new Date(),
    } as never,
  });
  await db.documentChunk.create({
    data: { documentId: doc.id, index: 0, text: rowText, locator: { lines: "1" } },
  });
  return doc;
}

async function sourceRow(status = "READY") {
  return db.dataSource.create({
    data: {
      name: `erp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      kind: "POSTGRES", secretRef: "s", status, createdById: admin.id,
      configJson: { host: "127.0.0.1", port: 5434, database: "erp" },
    } as never,
  });
}

describe("the crossing, through kb-08's UNCHANGED builder", () => {
  it("an uploaded PDF and a crawled row sharing INV-2024-113 get a SHARED_ENTITY edge naming the code; an unrelated third gets none", async () => {
    const source = await sourceRow();
    const pdf = await uploadedPdf("Scanned invoice INV-2024-113 total 1200 USD, page 3 of 4.", admin);
    const row = await crawledRow(source.id, "INV-2024-113", "inv_id = INV-2024-113\namount = 1200", admin);
    const bystander = await db.document.create({
      data: {
        name: "unrelated.md", contentType: "text/markdown", byteSize: 1,
        sha256: "3".repeat(64), data: new Uint8Array(0), ownerId: admin.id,
        visibility: "PRIVATE", textStatus: "EXTRACTED",
      },
    });
    await db.documentChunk.create({ data: { documentId: bystander.id, index: 0, text: "onboarding checklist for the support desk", locator: { lines: "1" } } });

    await rebuildEdgesFor(pdf.id);
    const edges = await db.knowledgeEdge.findMany({ where: { fromId: pdf.id } });
    const toRow = edges.find((e) => e.toId === row.id);
    expect(toRow).toBeDefined();
    expect(toRow?.kind).toBe("SHARED_ENTITY");
    expect((toRow?.evidence as string[]) ?? []).toContain("INV-2024-113");
    expect(edges.find((e) => e.toId === bystander.id)?.kind).not.toBe("SHARED_ENTITY");
  });
});

describe("citations as TEXT", () => {
  it("renders the two acceptance strings; no URL, no token, no template", () => {
    expect(renderExternalCitation({ kind: "POSTGRES", source: "erp", schema: "public", table: "invoices", idColumn: "inv_id", id: "INV-2024-113" }))
      .toBe("erp - public.invoices - row INV-2024-113");
    expect(renderExternalCitation({ kind: "S3", bucket: "b", key: "contracts/2026/q1/INV-2024-113.pdf", etag: "e" }, 3))
      .toBe("contracts/2026/q1/INV-2024-113.pdf - page 3");
    const out = renderExternalCitation({ kind: "POSTGRES", id: "X", browseUrlTemplate: "https://evil.example/{{id}}" });
    expect(out).not.toMatch(/https?:|browseUrlTemplate|\{\{/);
  });

  it("staleness: a source behind its last run carries an age; a complete-through source carries none", () => {
    expect(stalenessAge({ name: "s", status: "UNREACHABLE", lastSyncAt: new Date(), lastCompleteSyncAt: new Date() })).toBe("unavailable now");
    expect(stalenessAge({ name: "s", status: "READY", lastSyncAt: new Date(), lastCompleteSyncAt: new Date() })).toBeNull();
    const behind = stalenessAge({ name: "s", status: "READY", lastSyncAt: new Date(), lastCompleteSyncAt: new Date(Date.now() - 3 * 3_600_000) });
    expect(behind).toMatch(/3h ago/);
    const cited = renderExternalCitation({ kind: "POSTGRES", source: "erp", id: "X" }, undefined, { name: "erp", status: "READY", lastSyncAt: new Date(), lastCompleteSyncAt: new Date(Date.now() - 3 * 3_600_000) });
    expect(cited).toMatch(/\(last complete crawl 3h ago\)/);
  });
});

describe("RED TEAM — both directions through the composed fragment", () => {
  it("entitled to the PDF but NOT the source: no edge to the row — no id, name, locator or evidence; INV-2024-113 nowhere in the body", async () => {
    const stranger = await db.user.create({ data: { name: "S", email: `s${Date.now()}@x.com`, role: "REQUESTER" } });
    const source = await sourceRow();
    // The stranger owns the PDF (document path) but holds NO source grant.
    const pdf = await uploadedPdf("Scanned invoice INV-2024-113 total 1200 USD.", stranger);
    const row = await crawledRow(source.id, "INV-2024-113", "inv_id = INV-2024-113\namount = 1200", admin);
    await rebuildEdgesFor(pdf.id);
    expect(await db.knowledgeEdge.count({ where: { fromId: pdf.id, toId: row.id } })).toBe(1); // the edge EXISTS

    const related = await relatedDocuments(db as never, { humanId: stranger.id, agentId: null }, pdf.id);
    const body = JSON.stringify(related);
    expect(related.map((r) => r.id)).not.toContain(row.id);
    expect(body).not.toContain(row.id);
    expect(body).not.toContain(row.name);
    expect(body).not.toContain("externalLocator");
    expect(body).not.toContain("INV-2024-113");
  });

  it("entitled to the SOURCE but not the PDF: no edge in the other direction", async () => {
    const stranger = await db.user.create({ data: { name: "S2", email: `t${Date.now()}@x.com`, role: "REQUESTER" } });
    const source = await sourceRow();
    const pdf = await uploadedPdf("Scanned invoice INV-2024-113 total 1200 USD.", admin);
    const row = await crawledRow(source.id, "INV-2024-113", "inv_id = INV-2024-113\namount = 1200", stranger);
    await rebuildEdgesFor(pdf.id);
    // The stranger's source grant makes the ROW readable to them; the PDF
    // is the admin's PRIVATE upload, so the row's related-files cannot
    // surface the PDF.
    await db.kbGrant.create({ data: { sourceId: source.id, subjectType: "USER", subjectId: stranger.id, grantedById: admin.id } });
    const related = await relatedDocuments(db as never, { humanId: stranger.id, agentId: null }, row.id);
    expect(related.map((r) => r.id)).not.toContain(pdf.id);
    expect(JSON.stringify(related)).not.toContain(pdf.id);
  });

  it("the single-definition assertion from xds-02 still holds: ONE source clause in the tree", () => {
    const files = ["src/lib/kb/entitlement.ts", "src/lib/kb/graph.ts", "src/lib/kb/search.ts", "src/lib/kb/route.ts"];
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    let count = 0;
    for (const f of files) count += (readFileSync(f, "utf8").match(/sg\."sourceId" = d\."sourceId"/g) ?? []).length;
    expect(count).toBe(1);
    void humanChainCte;
  });
});
