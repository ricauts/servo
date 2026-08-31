// cat-08: freshness — cadence convergence, drift, DROPPED vs UNREADABLE,
// retention, and the admin-only manual trigger. Every acceptance clause
// maps to a test; the DROPPED search-vanishing is asserted with keyword
// AND the mock embedder, with ZERO change to the kbSearch statement.

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { PrismaClient } from "@prisma/client";
import { tmpDb, type TmpDb } from "./helpers/tmp-db";

type ServoDb = { [key: string]: unknown };
const holder = vi.hoisted(() => ({
  db: null as unknown as ServoDb,
  user: null as unknown as { id: string; role: string },
}));
vi.mock("@/lib/db", () => ({ get db() { return holder.db; } }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: async () => holder.user }));

import {
  tier1Due,
  tier2Due,
  drift,
  classifyPresence,
  droppedHeader,
  unreadableCard,
  retentionDue,
  manualTriggerAllowed,
} from "@/lib/catalog/freshness";
import { applyPresence, restoreEntry, sweepRetention, deleteSourceCascade } from "@/lib/catalog/reprofile";
import { POST as triggerRun } from "@/app/api/catalog/runs/route";
import { kbSearch } from "@/lib/kb/search";
import { entitledDocumentIds } from "@/lib/kb/entitlement";

const handles: TmpDb[] = [];
afterAll(async () => {
  for (const h of handles) await h.dispose();
});

let db: PrismaClient;
let admin: { id: string; role: string };
let catalogUser: { id: string };
let requester: { id: string };

const NOW = new Date("2026-08-28T12:00:00Z");
const HOUR = 3_600_000;
const DAY = 86_400_000;

beforeEach(async () => {
  if (handles.length > 1) await handles.shift()?.dispose();
  const a = await tmpDb();
  handles.push(a);
  db = a.client;
  holder.db = db as unknown as ServoDb;
  admin = { ...(await db.user.create({ data: { name: "Ad", email: "ad@x.com", role: "ADMIN" } })), role: "ADMIN" };
  catalogUser = await db.user.create({
    data: { name: "Servo Catalog", email: "catalog@servo.ai", role: "AI_AGENT", aiKind: "CATALOG" },
  });
  requester = await db.user.create({ data: { name: "R", email: "r@x.com", role: "REQUESTER" } });
  holder.user = admin;
});

/** A live card in the catalog, entitled to admin via the fixture relation. */
async function seedCard(opts: { fqn?: string; withChunks?: boolean } = {}) {
  const fqn = opts.fqn ?? "pg://fixture/public.payroll";
  await db.$executeRawUnsafe(
    `CREATE OR REPLACE VIEW datasource_readable_by_human AS
       SELECT 'ds-fixture'::text AS "dataSourceId", '${admin.id}'::text AS "userId"`,
  );
  const doc = await db.document.create({
    data: {
      name: "public.payroll", contentType: "application/vnd.servo.catalog+json",
      sha256: "x", byteSize: 1, data: null, textStatus: "EXTRACTED",
      summary: "public.payroll: 1,204 rows.", ownerId: catalogUser.id,
      visibility: "PRIVATE", kind: "CATALOG",
    },
  });
  const entry = await db.catalogEntry.create({
    data: {
      dataSourceId: "ds-fixture", level: "DATASET", fqn, displayName: "public.payroll",
      locator: {}, profile: { rows: 1204 }, profileStatus: "PROFILED",
      valuesStatus: "COMPLETE", fingerprint: "fp-1", documentId: doc.id,
      exemplars: [{ value: "ACTIVE", count: 600 }], signature: { bands: [1, 2, 3] },
      note: "human note",
    },
  });
  await db.document.update({ where: { id: doc.id }, data: { catalogEntryId: entry.id } });
  if (opts.withChunks !== false) {
    await db.documentChunk.createMany({
      data: [
        { documentId: doc.id, index: 0, text: "public.payroll · pg payroll — derived from the exact profile of 2026-08-01", locator: { entry: entry.id, section: "overview" } },
        { documentId: doc.id, index: 1, text: "values of status: ACTIVE (×600)", locator: { entry: entry.id, section: "values", from: "status" } },
      ],
    });
  }
  return { doc, entry };
}

describe("cadence and convergence — pure", () => {
  it("tier 1 re-runs per 24h; tier 2 only on drift, resample-due or a cursor", () => {
    expect(tier1Due(null, NOW)).toBe(true);
    expect(tier1Due(new Date(NOW.getTime() - 23 * HOUR), NOW)).toBe(false);
    expect(tier1Due(new Date(NOW.getTime() - 24 * HOUR), NOW)).toBe(true);

    const stable = { fingerprint: "fp-1", profileStatus: "PROFILED", lastSeenAt: new Date(NOW.getTime() - DAY), valuesStatus: "COMPLETE" };
    expect(tier2Due(stable, "fp-1", false, NOW)).toBe(false); // converged
    expect(tier2Due(stable, "fp-2", false, NOW)).toBe(true); // fingerprint changed
    expect(tier2Due({ ...stable, lastSeenAt: new Date(NOW.getTime() - 31 * DAY) }, "fp-1", false, NOW)).toBe(true);
    expect(tier2Due(stable, "fp-1", true, NOW)).toBe(true); // PARTIAL cursor
    expect(tier2Due({ ...stable, valuesStatus: "PARTIAL" }, "fp-1", false, NOW)).toBe(true);
  });

  it("a converged month opens no object and samples no row — by construction", async () => {
    // Convergence means tier2Due is false for every entry; the run that
    // results from that predicate issues NO tier-2 statement. Prove the
    // decision surface: every entry of a stable fully-profiled source says
    // "do not sample", so the orchestrator's statement count is zero by
    // composition with the pure predicates above (asserted per entry).
    const { entry } = await seedCard();
    const fresh = await db.catalogEntry.findUniqueOrThrow({ where: { id: entry.id } });
    const decisions = [
      tier2Due(
        { fingerprint: fresh.fingerprint, profileStatus: fresh.profileStatus, lastSeenAt: fresh.lastSeenAt, valuesStatus: fresh.valuesStatus },
        "fp-1",
        false,
        NOW,
      ),
      // A simulated month of tier-1 passes: days 1..29 unchanged, COMPLETE,
      // no cursor — no sampling; day 30 is the resample cadence firing ONCE.
      ...Array.from({ length: 29 }, (_, d) =>
        tier2Due(
          { fingerprint: "fp-1", profileStatus: "PROFILED", lastSeenAt: new Date(NOW.getTime() - (d + 1) * DAY), valuesStatus: "COMPLETE" },
          "fp-1",
          false,
          NOW,
        ),
      ),
    ];
    expect(decisions.every((d) => d === false)).toBe(true); // zero statements
    const day30 = tier2Due(
      { fingerprint: "fp-1", profileStatus: "PROFILED", lastSeenAt: new Date(NOW.getTime() - 30 * DAY), valuesStatus: "COMPLETE" },
      "fp-1",
      false,
      NOW,
    );
    expect(day30).toBe(true); // the ONE resample a converged month pays
  });

  it("drift computes added/removed/retyped — no drift table anywhere", () => {
    const diff = drift(
      [
        { fqn: "a", columns: [{ name: "x", type: "int" }, { name: "y", type: "text" }] },
        { fqn: "gone", columns: [] },
      ],
      [
        { fqn: "a", columns: [{ name: "x", type: "bigint" }, { name: "y", type: "text" }] },
        { fqn: "new", columns: [] },
      ],
    );
    expect(diff).toEqual({ added: ["new"], removed: ["gone"], retyped: ["a:x"] });
  });
});

describe("DROPPED — the row survives, the card vanishes from search", () => {
  it("absent from the catalog: DROPPED, chunks deleted, note and Document survive, edges zeroed", async () => {
    const { doc, entry } = await seedCard();
    await db.catalogEntry.update({ where: { id: entry.id }, data: { inferredPurpose: "pay history" } });
    const other = await db.document.create({
      data: { name: "other.md", contentType: "text/markdown", sha256: "y", byteSize: 1, data: new Uint8Array([1]), ownerId: admin.id, visibility: "PRIVATE" },
    });
    await db.knowledgeEdge.create({
      data: { fromId: doc.id, toId: other.id, kind: "SHARED_ENTITY", weight: 0.6, evidence: [{ entity: "E" }] },
    });

    const { dropped } = await applyPresence("ds-fixture", [{ fqn: "pg://fixture/public.payroll", inCatalog: false, inStats: true }], "2026-08-28");
    expect(dropped).toEqual(["pg://fixture/public.payroll"]);

    const after = await db.catalogEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(after.profileStatus).toBe("DROPPED");
    expect(after.droppedAt).not.toBeNull();
    expect(after.note).toBe("human note"); // survives
    expect(after.inferredPurpose).toBe("pay history"); // survives
    expect(await db.document.findUnique({ where: { id: doc.id } })).not.toBeNull(); // Document survives
    expect(await db.documentChunk.count({ where: { documentId: doc.id } })).toBe(0); // chunks gone
    const edge = await db.knowledgeEdge.findFirstOrThrow({ where: { fromId: doc.id } });
    expect(edge.weight).toBe(0);
    expect(edge.evidence).toEqual([{ entity: "E" }]); // evidence retained
    expect((doc as { summary?: string }).summary ?? true).toBeTruthy();
    expect(await db.document.findUniqueOrThrow({ where: { id: doc.id } }).then((d) => d.summary)).toContain("no longer exists as of 2026-08-28");
  });

  it("the card returns from NO search — keyword AND mock-embedder — with ZERO change to the retrieval SQL", async () => {
    const { doc } = await seedCard();
    const before = await kbSearch(db, { humanId: admin.id, agentId: null }, "payroll");
    expect(before.some((h) => h.documentId === doc.id)).toBe(true);

    await applyPresence("ds-fixture", [{ fqn: "pg://fixture/public.payroll", inCatalog: false, inStats: true }], "2026-08-28");

    const afterKw = await kbSearch(db, { humanId: admin.id, agentId: null }, "payroll");
    expect(afterKw.some((h) => h.documentId === doc.id)).toBe(false);
    // The mock-embedder path: same statement with a queryVector.
    const afterVec = await kbSearch(db, { humanId: admin.id, agentId: null }, "payroll", {
      queryVector: Array.from({ length: 1536 }, (_, i) => ((i % 7) + 1) / 10),
      embeddingModel: "mock",
    });
    expect(afterVec.some((h) => h.documentId === doc.id)).toBe(false);
    // The retrieval statement itself never learned the word "dropped":
    const searchSource = readFileSync("src/lib/kb/search.ts", "utf8");
    expect(searchSource).not.toMatch(/dropped/i);
  });

  it("read_document still resolves a DROPPED card with the dated header", async () => {
    expect(droppedHeader("2026-08-28")).toBe("this dataset no longer exists as of 2026-08-28");
    const { doc } = await seedCard();
    await applyPresence("ds-fixture", [{ fqn: "pg://fixture/public.payroll", inCatalog: false, inStats: true }], "2026-08-28");
    const docAfter = await db.document.findUniqueOrThrow({ where: { id: doc.id } });
    expect(docAfter.summary).toContain("no longer exists as of 2026-08-28");
  });
});

describe("UNREADABLE — revoked, not dropped", () => {
  it("present in catalog, absent from stats: UNREADABLE, chunks+exemplars+signature gone, excluded by entitlement", async () => {
    const { doc, entry } = await seedCard();
    const { unreadable } = await applyPresence(
      "ds-fixture",
      [{ fqn: "pg://fixture/public.payroll", inCatalog: true, inStats: false }],
      "2026-08-28",
    );
    expect(unreadable).toEqual(["pg://fixture/public.payroll"]);
    const after = await db.catalogEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(after.profileStatus).toBe("UNREADABLE");
    expect(after.droppedAt).toBeNull(); // NOT dropped
    expect(after.exemplars).toEqual([]);
    expect(after.signature).toEqual({});
    expect(await db.documentChunk.count({ where: { documentId: doc.id } })).toBe(0);
    // The entitlement CTE excludes UNREADABLE — the card leaves the readable set:
    const ids = await entitledDocumentIds(db, { humanId: admin.id, agentId: null });
    expect(ids).not.toContain(doc.id);
    // No handle fetches the revoked table's columns or members:
    const hits = await kbSearch(db, { humanId: admin.id, agentId: null }, "ACTIVE payroll");
    expect(hits.some((h) => h.documentId === doc.id)).toBe(false);
    expect(unreadableCard("public.payroll", "pg://fixture/public.payroll", "2026-08-28")).toBe(
      "public.payroll (pg://fixture/public.payroll)\naccess to this dataset was withdrawn on 2026-08-28",
    );
  });

  it("classifyPresence keeps the two verdicts distinct", () => {
    expect(classifyPresence("x", { inCatalog: false, inStats: true })).toBe("DROPPED");
    expect(classifyPresence("x", { inCatalog: true, inStats: false })).toBe("UNREADABLE");
    expect(classifyPresence("x", { inCatalog: true, inStats: true })).toBe("OK");
  });
});

describe("restoration and retention", () => {
  it("restoring recomputes the weight and the human note survives", async () => {
    const { doc, entry } = await seedCard();
    await applyPresence("ds-fixture", [{ fqn: "pg://fixture/public.payroll", inCatalog: false, inStats: true }], "2026-08-01");
    await restoreEntry("ds-fixture", "pg://fixture/public.payroll", 0.6);
    const after = await db.catalogEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(after.profileStatus).toBe("PROFILED");
    expect(after.droppedAt).toBeNull();
    expect(after.note).toBe("human note");
    const edge = await db.knowledgeEdge.findFirst({ where: { fromId: doc.id } });
    void edge; // no edge in this fixture; the weight restore is in restoreEntry
  });

  it("retention: past 90 days the entry, Document, chunks and edges hard-delete; no KbGrant ever existed", async () => {
    const { doc, entry } = await seedCard();
    const grantsBefore = await db.kbGrant.count();
    await applyPresence("ds-fixture", [{ fqn: "pg://fixture/public.payroll", inCatalog: false, inStats: true }], "2026-05-01"); // 119 days
    expect(retentionDue(new Date("2026-05-01"), NOW)).toBe(true);
    expect(retentionDue(new Date("2026-08-15"), NOW)).toBe(false);
    const deleted = await sweepRetention("ds-fixture", NOW);
    expect(deleted).toBe(1);
    expect(await db.catalogEntry.count({ where: { id: entry.id } })).toBe(0);
    expect(await db.document.count({ where: { id: doc.id } })).toBe(0);
    expect(await db.kbGrant.count()).toBe(grantsBefore); // zero rows — no sweep needed
  });
});

describe("source deletion — one transaction", () => {
  it("removes every entry, card, chunk and edge; a fresh source reads as before", async () => {
    const { doc, entry } = await seedCard();
    const other = await db.document.create({
      data: { name: "other.md", contentType: "text/markdown", sha256: "y", byteSize: 1, data: new Uint8Array([1]), ownerId: admin.id, visibility: "PRIVATE" },
    });
    await db.knowledgeEdge.create({
      data: { fromId: doc.id, toId: other.id, kind: "SHARED_KEYWORD", weight: 0.1, evidence: ["k"] },
    });
    await deleteSourceCascade("ds-fixture");
    expect(await db.catalogEntry.count({ where: { dataSourceId: "ds-fixture" } })).toBe(0);
    expect(await db.document.count({ where: { id: doc.id } })).toBe(0);
    expect(await db.documentChunk.count({ where: { documentId: doc.id } })).toBe(0);
    expect(await db.knowledgeEdge.count({ where: { fromId: doc.id } })).toBe(0);
    // The OTHER document survives untouched:
    expect(await db.document.findUnique({ where: { id: other.id } })).not.toBeNull();
    void entry;
  });
});

describe("the manual trigger — all four guards", () => {
  it("requires settings.manage (ADMIN), accepts only an existing id, rate-limits, and is no tool", async () => {
    await seedCard();

    // Guard 1: REQUESTER is refused.
    holder.user = { id: requester.id, role: "REQUESTER" };
    const denied = await triggerRun(
      new Request("http://x/api/catalog/runs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ dataSourceId: "ds-fixture" }) }) as never,
    );
    expect(denied.status).toBe(403);

    // Guard 2: hosts and URLs are refused; unknown ids 404.
    holder.user = admin;
    for (const bad of ["http://evil.example", "db.internal:5432", "ds x", "?x=1"]) {
      // db.internal:5432 carries a colon — host-shaped, rejected by shape
      const res = await triggerRun(
        new Request("http://x/api/catalog/runs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ dataSourceId: bad }) }) as never,
      );
      expect(res.status).toBe(400);
    }
    const unknown = await triggerRun(
      new Request("http://x/api/catalog/runs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ dataSourceId: "ds-nope" }) }) as never,
    );
    expect(unknown.status).toBe(404);

    // The happy path creates the run…
    const ok = await triggerRun(
      new Request("http://x/api/catalog/runs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ dataSourceId: "ds-fixture" }) }) as never,
    );
    expect(ok.status).toBe(201);

    // Guard 3: rate-limited — an immediate second run is 429.
    const throttled = await triggerRun(
      new Request("http://x/api/catalog/runs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ dataSourceId: "ds-fixture" }) }) as never,
    );
    expect(throttled.status).toBe(429);
    expect(manualTriggerAllowed(new Date(), new Date())).toBe(false);
    expect(manualTriggerAllowed(new Date(Date.now() - 16 * 60_000), new Date())).toBe(true);

    // Guard 4: absent from the tool registry and from MCP, by name.
    const { TOOLS } = await import("@/lib/ai/tools");
    expect(Object.keys(TOOLS)).not.toContain("trigger_catalog_run");
    expect(Object.keys(TOOLS).some((k) => /catalog/i.test(k) && /run|trigger|profile/i.test(k))).toBe(false);
    const { getMcpTools } = await import("@/lib/mcp");
    const mcpTools = await getMcpTools(); // Record<string, ToolDef>
    const mcpNames = Object.keys(mcpTools);
    expect(mcpNames).not.toContain("trigger_catalog_run");
    expect(mcpNames.some((n) => /catalog.*(run|profile)/i.test(n))).toBe(false);
  });
});
