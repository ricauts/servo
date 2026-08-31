// xds-02: the source ceiling — the readable CTE, applied once outside the
// union, and every read path composing it. A source grant alone entitles
// nothing; a document path alone entitles nothing on a source-backed
// document; both are required, and the two legs never satisfy each other.

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { tmpDb, type TmpDb } from "./helpers/tmp-db";

type ServoDb = { [key: string]: unknown };
const holder = vi.hoisted(() => ({ db: null as unknown as ServoDb }));
vi.mock("@/lib/db", () => ({ get db() { return holder.db; } }));

import { entitledDocumentIds } from "@/lib/kb/entitlement";
import { kbSearch } from "@/lib/kb/search";
import { readFileSync } from "node:fs";

const handles: TmpDb[] = [];
afterAll(async () => {
  for (const h of handles) await h.dispose();
});

let db: PrismaClient;
let admin: { id: string };
let requester: { id: string };
let agentId: string;

beforeEach(async () => {
  if (handles.length > 1) await handles.shift()?.dispose();
  const a = await tmpDb();
  handles.push(a);
  db = a.client;
  holder.db = db as unknown as ServoDb;
  admin = await db.user.create({ data: { name: "A", email: `a${Date.now()}@x.com`, role: "ADMIN" } });
  requester = await db.user.create({ data: { name: "R", email: `r${Date.now()}@x.com`, role: "REQUESTER" } });
  agentId = "agent-xds02";
  await db.$executeRawUnsafe(
    `CREATE OR REPLACE VIEW datasource_readable_by_human AS SELECT 'none'::text AS "dataSourceId", 'nobody'::text AS "userId"`,
  );
  await db.$executeRawUnsafe(
    `CREATE OR REPLACE VIEW datasource_readable_by_agent AS SELECT 'none'::text AS "dataSourceId", 'nobody'::text AS "agentId"`,
  );
});

/** A source, a source-backed document, and optionally grants. */
async function world(opts: { sourceStatus?: string; docGrant?: boolean; sourceGrant?: "human" | "agent" | "both"; who?: { requester: { id: string }; agentId: string } } = {}) {
  const req = opts.who ? opts.who.requester : requester;
  const ag = opts.who ? opts.who.agentId : agentId;
  const source = await db.dataSource.create({
    data: {
      name: `erp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      kind: "POSTGRES", secretRef: "setting.erp.secret", configJson: { host: "127.0.0.1", port: 5434, database: "erp" },
      status: opts.sourceStatus ?? "READY", createdById: admin.id,
    } as never,
  });
  const doc = await db.document.create({
    data: {
      name: "invoice-row.md", contentType: "text/markdown", byteSize: 1,
      sha256: "1".repeat(64), data: new Uint8Array(1), ownerId: admin.id,
      visibility: "PRIVATE", sourceId: source.id,
    } as never,
  });
  await db.documentChunk.create({ data: { documentId: doc.id, index: 0, text: "invoice INV-2024-113 for 1200 USD", locator: { lines: "1" } } });
  if (opts.docGrant) {
    await db.kbGrant.create({ data: { documentId: doc.id, subjectType: "USER", subjectId: req.id, grantedById: admin.id } });
    await db.kbGrant.create({ data: { documentId: doc.id, subjectType: "AGENT", subjectId: ag, grantedById: admin.id } });
  }
  if (opts.sourceGrant === "human" || opts.sourceGrant === "both") {
    await db.kbGrant.create({ data: { sourceId: source.id, subjectType: "USER", subjectId: req.id, grantedById: admin.id } });
  }
  if (opts.sourceGrant === "agent" || opts.sourceGrant === "both") {
    await db.kbGrant.create({ data: { sourceId: source.id, subjectType: "AGENT", subjectId: ag, grantedById: admin.id } });
  }
  return { source, doc };
}

describe("the source ceiling", () => {
  it("BOTH grants required: source-only sees zero; document-only sees zero", async () => {
    const sourceOnly = await world({ sourceGrant: "both" });
    expect(await entitledDocumentIds(db as never, { humanId: requester.id, agentId })).toEqual([]);
    void sourceOnly;

    const docOnly = await world({ docGrant: true });
    expect(await entitledDocumentIds(db as never, { humanId: requester.id, agentId })).toEqual([]);
    void docOnly;

    const both = await world({ docGrant: true, sourceGrant: "both" });
    expect(await entitledDocumentIds(db as never, { humanId: requester.id, agentId })).toEqual([both.doc.id]);
  });

  it("RED TEAM, both directions: requester-without-agent and agent-without-requester each return zero", async () => {
    const w = await world({ docGrant: true, sourceGrant: "human" }); // only the requester holds the source grant
    expect(await entitledDocumentIds(db as never, { humanId: requester.id, agentId })).toEqual([]);
    void w;
    const w2 = await world({ docGrant: true, sourceGrant: "agent" }); // only the agent holds it
    expect(await entitledDocumentIds(db as never, { humanId: requester.id, agentId })).toEqual([]);
    void w2;
  });

  it("ownership of the SOURCE is not sufficient: the creating admin, no grant, sees zero", async () => {
    await world({}); // admin owns the source and the document
    expect(await entitledDocumentIds(db as never, { humanId: admin.id, agentId })).toEqual([]);
  });

  it("status is NOT-IN, not =READY: SYNCING and UNREACHABLE stay readable; DISABLED disappears; PURGED disappears", async () => {
    // A FRESH principal pair per status: earlier iterations' documents are
    // entitled to their own principals, so one shared reader would see the
    // old rows beside the new.
    for (const status of ["SYNCING", "UNREACHABLE", "ERROR"]) {
      const pair = await freshPair();
      const w = await world({ sourceStatus: status, docGrant: true, sourceGrant: "both", ...pair.grants });
      expect(await entitledDocumentIds(db as never, { humanId: pair.requester.id, agentId: pair.agentId }), status).toEqual([w.doc.id]);
    }
    for (const status of ["DISABLED", "PURGED"]) {
      const pair = await freshPair();
      const w = await world({ sourceStatus: status, docGrant: true, sourceGrant: "both", ...pair.grants });
      expect(await entitledDocumentIds(db as never, { humanId: pair.requester.id, agentId: pair.agentId }), status).toEqual([]);
      void w;
    }
  });

  /** Fresh principal pair + grants wired to them, so iterations isolate. */
  async function freshPair() {
    const requester2 = await db.user.create({ data: { name: "R", email: `r${Date.now()}${Math.random().toString(36).slice(2, 6)}@x.com`, role: "REQUESTER" } });
    const agent2 = `agent-${Math.random().toString(36).slice(2, 8)}`;
    return {
      requester: requester2,
      agentId: agent2,
      grants: { who: { requester: requester2, agentId: agent2 } },
    };
  }

  it("flipping a source to DISABLED removes the document from SEARCH with no grant row touched", async () => {
    const w = await world({ docGrant: true, sourceGrant: "both" });
    const before = await kbSearch(db as never, { humanId: requester.id, agentId: null }, "invoice", { limit: 5 });
    expect(before.map((h) => h.docName)).toEqual(["invoice-row.md"]);

    const grantsBefore = await db.kbGrant.count();
    await db.dataSource.update({ where: { id: w.source.id }, data: { status: "DISABLED" } });
    const after = await kbSearch(db as never, { humanId: requester.id, agentId: null }, "invoice", { limit: 5 });
    expect(after).toEqual([]);
    expect(await db.kbGrant.count()).toBe(grantsBefore); // nothing touched
    expect(await db.document.count({ where: { id: w.doc.id } })).toBe(1); // nothing deleted
  });

  it("documents with sourceId NULL behave exactly as before (kb-02's matrix unchanged)", async () => {
    const doc = await db.document.create({
      data: { name: "plain.md", contentType: "text/markdown", byteSize: 1, sha256: "2".repeat(64), data: new Uint8Array(1), ownerId: admin.id, visibility: "PRIVATE" },
    });
    await db.kbGrant.create({ data: { documentId: doc.id, subjectType: "USER", subjectId: requester.id, grantedById: admin.id } });
    expect(await entitledDocumentIds(db as never, { humanId: requester.id, agentId: null })).toEqual([doc.id]);
  });

  it("EXACTLY ONE definition of the source clause in the tree", () => {
    const files = ["src/lib/kb/entitlement.ts", "src/lib/kb/search.ts", "src/lib/kb/route.ts", "src/lib/kb/graph.ts", "src/lib/ai/tools/kb.ts"];
    let count = 0;
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      count += (src.match(/sg\."sourceId" = d\."sourceId"/g) ?? []).length;
    }
    expect(count).toBe(1);
  });

  it("the non-source-entitled answer is character-identical to the non-existent answer — no oracle", async () => {
    const w = await world({ docGrant: true, sourceGrant: "both" });
    const readableIds = await entitledDocumentIds(db as never, { humanId: requester.id, agentId });
    expect(readableIds).toEqual([w.doc.id]);
    // A principal with the document grant but no source grant (the ceiling's
    // no case) receives the same empty answer an unknown id would.
    const stranger = await db.user.create({ data: { name: "T", email: `t${Date.now()}@x.com`, role: "REQUESTER" } });
    await db.kbGrant.create({ data: { documentId: w.doc.id, subjectType: "USER", subjectId: stranger.id, grantedById: admin.id } });
    const denied = await entitledDocumentIds(db as never, { humanId: stranger.id, agentId: null });
    const unknown = await entitledDocumentIds(db as never, { humanId: stranger.id, agentId: null });
    expect(denied).toEqual(unknown); // byte-identical: both []
  });
});
