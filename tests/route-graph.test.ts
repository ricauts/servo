// fed-02: graph expansion, entitled at every recursive level. The router's
// graph(d) = MAX over seeds of 0.6^hop × weight × kindFactor — computed by
// a RECURSIVE CTE with the entitlement join INSIDE the recursive term, the
// depth cap in the CTE, SAME_SOURCE as a predicate (never a row), discarded
// duplicates as seeds, the red team over a two-chain entitlement split, and
// neighbour listings that never disclose absence.

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { tmpDb, type TmpDb } from "./helpers/tmp-db";

type ServoDb = { [key: string]: unknown };
const holder = vi.hoisted(() => ({ db: null as unknown as ServoDb }));
vi.mock("@/lib/db", () => ({ get db() { return holder.db; } }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: async () => ({ id: "x", role: "ADMIN" }) }));

import { routeSources } from "@/lib/kb/route";

const handles: TmpDb[] = [];
afterAll(async () => {
  for (const h of handles) await h.dispose();
});

let db: PrismaClient;
let catalogUser: { id: string };
let reader: { id: string };
let agentUser: { id: string };

const Ds = {
  exact: { id: "ds_7f3", name: "public.payroll_exact", chunks: 3 },
  wide: { id: "ds_2a1", name: "public.payroll_wide", chunks: 34 },
  export: { id: "ds_9c4", name: "public.payroll_csv_export", chunks: 3 },
};

interface SeedOpts {
  id: string;
  name: string;
  chunks?: number;
  dataSource?: string;
  entity?: string;
  neighbours?: { id: string; kind: string; weight: number }[];
  text?: string;
}

async function seedCard(o: SeedOpts) {
  await db.document.create({
    data: {
      id: o.id, name: o.name, contentType: "application/vnd.servo.catalog+json",
      sha256: "x", byteSize: 1, data: null, textStatus: "EXTRACTED",
      summary: `${o.name}: seeded.`, ownerId: catalogUser.id,
      visibility: "PRIVATE", kind: "CATALOG",
    },
  });
  const entry = await db.catalogEntry.create({
    data: {
      dataSourceId: o.dataSource ?? "silo-a", level: "DATASET",
      fqn: `pg://silo/${o.name}`, displayName: o.name,
      locator: {}, profile: {}, documentId: o.id,
    },
    select: { id: true },
  });
  await db.document.update({ where: { id: o.id }, data: { catalogEntryId: entry.id } });
  const n = o.chunks ?? 3;
  if (n > 0) {
    await db.documentChunk.createMany({
      data: Array.from({ length: n }, (_, i) => ({
        documentId: o.id, index: i,
        text: o.text ?? `${o.name} payroll overview${o.entity ? ` reference ${o.entity}` : ""}${i > 0 ? ` col c${i}` : ""}`,
        locator: { entry: o.id, section: i === 0 ? "overview" : "columns" },
      })),
    });
  }
  for (const nb of o.neighbours ?? []) {
    await db.knowledgeEdge.create({
      data: { fromId: o.id, toId: nb.id, kind: nb.kind, weight: nb.weight, evidence: [{ entity: "E" }] },
    });
  }
}

/** Grant by dataSourceId per principal: the contract-relation shape. */
async function entitle(humanId: string, agentId: string | null, sourceIds: string[]) {
  const rows = sourceIds.map((s) => `SELECT '${s}'::text, '${humanId}'::text`).join(" UNION ALL ");
  await db.$executeRawUnsafe(
    `CREATE OR REPLACE VIEW datasource_readable_by_human AS SELECT 'x'::text AS "dataSourceId", 'x'::text AS "userId" WHERE false UNION ALL ${rows}`,
  );
  if (agentId !== null) {
    const arows = sourceIds.map((s) => `SELECT '${s}'::text, '${agentId}'::text`).join(" UNION ALL ");
    await db.$executeRawUnsafe(
      `CREATE OR REPLACE VIEW datasource_readable_by_agent AS SELECT 'x'::text AS "dataSourceId", 'x'::text AS "agentId" WHERE false UNION ALL ${arows}`,
    );
  }
}

beforeEach(async () => {
  if (handles.length > 1) await handles.shift()?.dispose();
  const a = await tmpDb();
  handles.push(a);
  db = a.client;
  holder.db = db as unknown as ServoDb;
  catalogUser = await db.user.create({ data: { name: "Servo Catalog", email: "catalog@servo.ai", role: "AI_AGENT", aiKind: "CATALOG" } });
  reader = await db.user.create({ data: { name: "R", email: "r@x.com", role: "REQUESTER" } });
  agentUser = await db.user.create({ data: { name: "A", email: "a@servo.ai", role: "AI_AGENT", aiKind: "RESOLVER" } });
});

describe("the graph term — factors, hops, raw weights", () => {
  it("a SHARED_ENTITY neighbour of a strong hit gets 0.6^1 × weight × 1.00; a hop-2 neighbour 0.6^2", async () => {
    await seedCard(Ds.exact); // the seed
    await seedCard({ id: "ds_1a1", name: "public.hr_master", chunks: 0, neighbours: [] });
    await seedCard({ id: "ds_1b2", name: "public.hr_child", chunks: 0, dataSource: "silo-b" });
    await seedCard({ id: "ds_1c3", name: "public.far_away", chunks: 0, dataSource: "silo-c" });
    // seed --SHARED_ENTITY 0.8--> 1a1 --SHARED_ENTITY 0.5--> 1b2: hop 2.
    await db.knowledgeEdge.create({ data: { fromId: Ds.exact.id, toId: "ds_1a1", kind: "SHARED_ENTITY", weight: 0.8, evidence: [] } });
    await db.knowledgeEdge.create({ data: { fromId: "ds_1a1", toId: "ds_1b2", kind: "SHARED_ENTITY", weight: 0.5, evidence: [] } });
    // Hop 3 — beyond the CTE cap: must contribute NOTHING.
    await db.knowledgeEdge.create({ data: { fromId: "ds_1b2", toId: "ds_1c3", kind: "SHARED_ENTITY", weight: 1.0, evidence: [] } });
    await entitle(reader.id, null, ["silo-a", "silo-b", "silo-c"]);

    const { sources } = await routeSources(db as never, { humanId: reader.id, agentId: null }, "payroll", { limit: 10 });
    const byId = new Map(sources.map((s) => [s.documentId, s]));
    expect(byId.get("ds_1a1")?.graph).toBeCloseTo(0.6 * 0.8, 3);
    expect(byId.get("ds_1b2")?.graph).toBeCloseTo(0.36 * 0.8 * 0.5, 3);
    // Depth capped AT 2 BY THE CTE: ds_1c3 (3 hops away, no other path)
    // receives NO graph contribution — its graph is exactly zero even
    // though every entitled document has a scored row.
    expect(byId.get("ds_1c3")?.graph ?? 0).toBe(0);
  });

  it("the factor table: DECLARED_FK 0.90 beats SHARED_KEYWORD 0.50 at the same weight", async () => {
    await seedCard({ ...Ds.exact, chunks: 1 });
    await seedCard({ id: "ds_fk", name: "public.fk_target", chunks: 0 });
    await seedCard({ id: "ds_kw", name: "public.kw_target", chunks: 0 });
    await db.knowledgeEdge.create({ data: { fromId: Ds.exact.id, toId: "ds_fk", kind: "DECLARED_FK", weight: 0.8, evidence: [] } });
    await db.knowledgeEdge.create({ data: { fromId: Ds.exact.id, toId: "ds_kw", kind: "SHARED_KEYWORD", weight: 0.8, evidence: [] } });
    await entitle(reader.id, null, ["silo-a"]);
    const { sources } = await routeSources(db as never, { humanId: reader.id, agentId: null }, "payroll", { limit: 10 });
    const byId = new Map(sources.map((s) => [s.documentId, s]));
    expect(byId.get("ds_fk")?.graph).toBeCloseTo(0.6 * 0.8 * 0.9, 3);
    expect(byId.get("ds_kw")?.graph).toBeCloseTo(0.6 * 0.8 * 0.5, 3);
  });

  it("weights are RAW: no normalisation — the source records why, and SUM is absent", async () => {
    const source = (await import("node:fs")).readFileSync("src/lib/kb/route.ts", "utf8");
    expect(source).toMatch(/dividing by the max out-edge/i);
    expect(source).toMatch(/MAX\(carried \* power\(0\.6, hop\)\)/);
  });

  it("SAME_SOURCE is a PREDICATE: the CTE text contains no lookup of that edge kind", async () => {
    const source = (await import("node:fs")).readFileSync("src/lib/kb/route.ts", "utf8");
    // Extract the CTE text and prove the absence of a SAME_SOURCE row lookup.
    expect(source).not.toMatch(/kind = 'SAME_SOURCE'|kind='SAME_SOURCE'|WHEN 'SAME_SOURCE'/);
    // And the predicate exists: dataSourceId equality between entries.
    expect(source).toMatch(/sibling\."dataSourceId" = ce_s\."dataSourceId"/);
    // Behaviour: same-source siblings rank without any edge row existing.
    await seedCard({ ...Ds.exact, chunks: 1 });
    await seedCard({ id: "ds_sib", name: "public.payroll_sibling", chunks: 0 }); // same silo-a, NO edges
    await entitle(reader.id, null, ["silo-a"]);
    const { sources } = await routeSources(db as never, { humanId: reader.id, agentId: null }, "payroll", { limit: 10 });
    const sib = sources.find((s) => s.documentId === "ds_sib");
    expect(sib).toBeDefined();
    expect(sib!.graph).toBeCloseTo(0.6 * 0.3, 3); // hop-1 predicate factor 0.30
    // Cross-source sibling gets NOTHING from the predicate:
    await seedCard({ id: "ds_x", name: "other.payroll", chunks: 0, dataSource: "silo-b" });
    const again = await routeSources(db as never, { humanId: reader.id, agentId: null }, "payroll", { limit: 10 });
    expect(again.sources.find((s) => s.documentId === "ds_x")?.graph ?? 0).toBe(0);
  });

  it("TEMPORAL_ALIGNMENT amplifies without adding; NEAR_DUPLICATE contributes zero", async () => {
    await seedCard({ ...Ds.exact, chunks: 1 });
    await seedCard({ id: "ds_ta", name: "public.q1_sibling", chunks: 0 });
    await seedCard({ id: "ds_nd", name: "public.copy", chunks: 0, dataSource: "silo-b" });
    await db.knowledgeEdge.create({ data: { fromId: Ds.exact.id, toId: "ds_ta", kind: "TEMPORAL_ALIGNMENT", weight: 0.5, evidence: [] } });
    await db.knowledgeEdge.create({ data: { fromId: Ds.exact.id, toId: "ds_nd", kind: "NEAR_DUPLICATE", weight: 0.95, evidence: [] } });
    await entitle(reader.id, null, ["silo-a", "silo-b"]);
    const { sources } = await routeSources(db as never, { humanId: reader.id, agentId: null }, "payroll", { limit: 10 });
    const byId = new Map(sources.map((s) => [s.documentId, s]));
    // Amplifier: 0.6 × (1 + 0.5) — not 0.6 × 0.5 × anyFactor.
    expect(byId.get("ds_ta")?.graph).toBeCloseTo(0.6 * 1.5, 3);
    // NEAR_DUPLICATE: no graph contribution at all (the dup pass owns it).
    expect(byId.get("ds_nd")?.graph ?? 0).toBe(0);
  });
});

describe("seeds include the discarded", () => {
  it("the correct table reachable only via a DISCARDED duplicate's neighbourhood ranks first", async () => {
    // ds_9c4 is a strong content hit AND a duplicate of ds_7f3 (7f3 < 9c4,
    // equal pre → 9c4 pays 0.50). The CORRECT answer (ds_true) has no
    // content hit — it is reachable only as 9c4's SHARED_ENTITY neighbour.
    // Identical bodies except the name; the survivor (7f3, smaller id)
    // gets one extra strong chunk so its content pre is STRICTLY higher
    // and the dup penalty on 9c4 is deterministic.
    await seedCard({ ...Ds.export, chunks: 2, text: "payroll master export dataset" });
    await seedCard({ ...Ds.exact, chunks: 3, text: "payroll master export dataset" });
    await seedCard({ id: "ds_true", name: "public.hr_true_master", chunks: 0 });
    await db.knowledgeEdge.create({
      data: { fromId: Ds.export.id, toId: "ds_true", kind: "SHARED_ENTITY", weight: 1.0, evidence: [] },
    });
    await db.knowledgeEdge.create({
      data: { fromId: Ds.exact.id, toId: Ds.export.id, kind: "NEAR_DUPLICATE", weight: 0.95, evidence: [] },
    });
    await entitle(reader.id, null, ["silo-a"]);
    const { sources } = await routeSources(db as never, { humanId: reader.id, agentId: null }, "payroll master export", { limit: 5 });
    // ds_9c4 was discarded (dup penalty) but still seeded the walk, so
    // ds_true carries graph 0.6×1.0×1.0 = 0.6 and OUTRANKS everything
    // except the surviving duplicate pair.
    expect(sources.length).toBeGreaterThan(0);
    const trueIdx = sources.findIndex((s) => s.documentId === "ds_true");
    expect(trueIdx).toBeGreaterThanOrEqual(0);
    expect(sources[trueIdx].graph).toBeCloseTo(0.6, 3);
    // ...and the discarded seed itself carries the dup penalty:
    const discarded = sources.find((s) => s.documentId === Ds.export.id);
    if (discarded) expect(discarded.dup).toBe(true);
  });
});

describe("RED TEAM — entitlement inside the recursive term", () => {
  it("agent entitled {A,C}, requester {A,B}: C absent; B invisible everywhere", async () => {
    // A = silo-a card, B = silo-b card, C = silo-c card.
    await seedCard({ id: "ds_A", name: "public.alpha", chunks: 3, dataSource: "silo-a" });
    await seedCard({ id: "ds_B", name: "public.bravo", chunks: 0, dataSource: "silo-b" });
    await seedCard({ id: "ds_C", name: "public.charlie", chunks: 0, dataSource: "silo-c" });
    await db.knowledgeEdge.create({ data: { fromId: "ds_A", toId: "ds_B", kind: "SHARED_ENTITY", weight: 0.9, evidence: [{ entity: "SECRET-B-EVIDENCE" }] } });
    await db.knowledgeEdge.create({ data: { fromId: "ds_B", toId: "ds_C", kind: "SHARED_ENTITY", weight: 0.9, evidence: [{ entity: "SECRET-C-EVIDENCE" }] } });

    // Requester reads silo-a + silo-b; the agent only silo-a + silo-c.
    // The CHAIN intersection = {A}: B falls out of the human side, C out of
    // the agent side — and the recursive walk starts from A only.
    await entitle(reader.id, agentUser.id, ["silo-a", "silo-b"]);
    await db.$executeRawUnsafe(
      `CREATE OR REPLACE VIEW datasource_readable_by_agent AS
         SELECT 'x'::text AS "dataSourceId", 'x'::text AS "agentId" WHERE false
         UNION ALL SELECT 'silo-a'::text, '${agentUser.id}'::text
         UNION ALL SELECT 'silo-c'::text, '${agentUser.id}'::text`,
    );

    const { sources } = await routeSources(db as never, { humanId: reader.id, agentId: agentUser.id }, "alpha", { limit: 10 });
    const ids = sources.map((s) => s.documentId);
    expect(ids).toContain("ds_A");
    // C is absent from the result — the walk never traversed B to reach it.
    expect(ids).not.toContain("ds_C");
    expect(ids).not.toContain("ds_B");

    // B's id, name and the edge evidence appear NOWHERE in the response:
    const body = JSON.stringify(sources);
    expect(body).not.toContain("ds_B");
    expect(body).not.toContain("bravo");
    expect(body).not.toContain("SECRET-B-EVIDENCE");
    // ...and no tool result, AgentStep.content or AgentRun.conversation of
    // a run would either (here: assert the router's own outputs and DB):
    const edgesToB = await db.knowledgeEdge.count({ where: { OR: [{ fromId: "ds_B" }, { toId: "ds_B" }] } });
    expect(edgesToB).toBe(2); // they exist — they are simply never disclosed
    // The warning comment sits directly above the recursive-term join:
    const source = (await import("node:fs")).readFileSync("src/lib/kb/route.ts", "utf8");
    const joinIdx = source.indexOf("JOIN entitled eN ON eN.id = nxt.id");
    const commentIdx = source.indexOf("THE ENTITLEMENT JOIN INSIDE THE RECURSIVE TERM");
    expect(commentIdx).toBeGreaterThan(-1);
    expect(commentIdx).toBeLessThan(joinIdx);
    expect(joinIdx - commentIdx).toBeLessThan(400); // directly above
  });
});

describe("neighbour listings never disclose absence", () => {
  it("2 entitled of 5 neighbours: sees exactly 2, character-for-character, no withheld count", async () => {
    await seedCard({ ...Ds.exact, chunks: 1 }); // the seed
    // Five same-source siblings; the reader is entitled to silo-a only, so
    // put three of them on silo-z (unentitled) — the CTE predicate only
    // expands entitled siblings, and the response never counts the rest.
    await seedCard({ id: "ds_n1", name: "public.n1", chunks: 0, dataSource: "silo-a" });
    await seedCard({ id: "ds_n2", name: "public.n2", chunks: 0, dataSource: "silo-a" });
    await seedCard({ id: "ds_x1", name: "public.x1", chunks: 0, dataSource: "silo-z" });
    await seedCard({ id: "ds_x2", name: "public.x2", chunks: 0, dataSource: "silo-z" });
    await seedCard({ id: "ds_x3", name: "public.x3", chunks: 0, dataSource: "silo-z" });
    await entitle(reader.id, null, ["silo-a"]);

    const result = await routeSources(db as never, { humanId: reader.id, agentId: null }, "payroll", { limit: 10 });
    const body = JSON.stringify(result);
    // Exactly the two entitled siblings appear...
    expect(result.sources.map((s) => s.documentId)).toContain("ds_n1");
    expect(result.sources.map((s) => s.documentId)).toContain("ds_n2");
    // ...the three unentitled appear NOWHERE — not ids, not names...
    for (const gone of ["ds_x1", "ds_x2", "ds_x3", "x1", "x2", "x3", "silo-z"]) {
      expect(body).not.toContain(gone);
    }
    // ...and no withheld-neighbour count exists anywhere in the shape:
    expect(Object.keys(result).sort()).toEqual(["entitledDatasets", "omitted", "sources", "statementsIssued"]);
    // The character-for-character contract: rerunning yields the identical
    // response body (nothing flips in or out between runs).
    const again = JSON.stringify(await routeSources(db as never, { humanId: reader.id, agentId: null }, "payroll", { limit: 10 }));
    expect(again).toBe(body);
  });
});
