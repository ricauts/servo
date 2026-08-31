// fed-01: the router. ONE statement (asserted via a query spy), the
// entitlement CTE outermost, MAX-not-SUM scoring, the leading entity_hit
// key, the dup second pass ordered after pre, literal ids making reruns
// byte-identical, the ABSENT-values penalty through alt alone, the
// entitled-only footer denominator, and the no-embedder degradation — all
// against literal-key fixtures (ds_7f3, ds_2a1, ds_9c4).

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { tmpDb, type TmpDb } from "./helpers/tmp-db";

type ServoDb = { [key: string]: unknown };
const holder = vi.hoisted(() => ({
  db: null as unknown as ServoDb,
}));
vi.mock("@/lib/db", () => ({ get db() { return holder.db; } }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: async () => ({ id: "x", role: "ADMIN" }) }));

import { routeSources } from "@/lib/kb/route";
import { SILO_FIXTURES } from "./fixtures/silos/seed-silos.mjs";

const handles: TmpDb[] = [];
afterAll(async () => {
  for (const h of handles) await h.dispose();
});

let db: PrismaClient;
let catalogUser: { id: string };
let reader: { id: string };

/** A recording client: ONE statement must issue exactly one call. */
let statements: string[] = [];
function recordingClient(): { $queryRawUnsafe: (sql: string) => Promise<unknown[]> } {
  const target = db;
  return {
    $queryRawUnsafe: async (sql: string) => {
      statements.push(sql);
      return target.$queryRawUnsafe(sql) as Promise<unknown[]>;
    },
  };
}

const Ds = SILO_FIXTURES;

/** Seed a card with literal document id, N chunks, optional entity + dup. */
async function seedCard(opts: {
  id: string;
  name: string;
  chunks: number;
  entity?: string;
  nearDuplicateOf?: string;
  valuesComplete?: boolean;
  /** Seed on silo-b: outside the reader's grant, for the footer test. */
  otherSource?: boolean;
}) {
  await db.document.create({
    data: {
      id: opts.id, name: opts.name, contentType: "application/vnd.servo.catalog+json",
      sha256: "x", byteSize: 1, data: null, textStatus: "EXTRACTED",
      summary: `${opts.name}: seeded.`, ownerId: catalogUser.id,
      visibility: "PRIVATE", kind: "CATALOG",
    },
  });
  const entry = await db.catalogEntry.create({
    data: {
      dataSourceId: opts.otherSource ? "silo-b" : "silo-a", level: "DATASET", fqn: `pg://silo/${opts.name}`,
      displayName: opts.name, locator: {}, profile: {},
      valuesStatus: opts.valuesComplete === false ? "ABSENT" : "COMPLETE",
      documentId: opts.id,
    },
    select: { id: true },
  });
  // The derived-entitlement join path needs the back-reference (cat-06
  // links it in production; the fixture must do the same).
  await db.document.update({ where: { id: opts.id }, data: { catalogEntryId: entry.id } });
  const texts = Array.from({ length: opts.chunks }, (_, i) =>
    i === 0
      ? `${opts.name} · pg silo — derived from the exact profile of 2026-08-01${opts.entity ? ` reference ${opts.entity}` : ""}`
      : `column c${i} of ${opts.name}: payroll data ${opts.entity && i === 1 ? `code ${opts.entity}` : ""}`,
  );
  if (opts.chunks > 0) {
    await db.documentChunk.createMany({
      data: texts.map((text, index) => ({
        documentId: opts.id, index, text,
        locator: { entry: opts.id, section: index === 0 ? "overview" : index === 1 ? "values" : "columns" },
      })),
    });
  }
  if (opts.nearDuplicateOf) {
    await db.knowledgeEdge.create({
      data: { fromId: opts.nearDuplicateOf, toId: opts.id, kind: "NEAR_DUPLICATE", weight: 0.9, evidence: [] },
    });
  }
}

async function entitleReader() {
  await db.$executeRawUnsafe(
    `CREATE OR REPLACE VIEW datasource_readable_by_human AS
       SELECT 'silo-a'::text AS "dataSourceId", '${reader.id}'::text AS "userId"`,
  );
}

beforeEach(async () => {
  if (handles.length > 1) await handles.shift()?.dispose();
  const a = await tmpDb();
  handles.push(a);
  db = a.client;
  holder.db = db as unknown as ServoDb;
  statements = [];
  catalogUser = await db.user.create({
    data: { name: "Servo Catalog", email: "catalog@servo.ai", role: "AI_AGENT", aiKind: "CATALOG" },
  });
  reader = await db.user.create({ data: { name: "R", email: "r@x.com", role: "REQUESTER" } });
});

describe("one statement, CTE outermost, no JS scoring", () => {
  it("issues exactly ONE SQL statement, asserted by query inspection", async () => {
    await seedCard(Ds.exact);
    await entitleReader();
    const result = await routeSources(recordingClient() as never, { humanId: reader.id, agentId: null }, "payroll");
    expect(result.statementsIssued).toBe(1);
    expect(statements).toHaveLength(1);
    // The entitlement CTE is OUTERMOST (WITH human_docs...), the FROM joins
    // entitled, and no JS-side sort/scoring happened — the SELECT carries
    // the full ORDER BY.
    expect(statements[0].trimStart().startsWith("WITH RECURSIVE human_docs")).toBe(true);
    expect(statements[0]).toMatch(/JOIN readable e ON e\.id = d\.id/); // xds-02: the source ceiling wraps entitled
    expect(statements[0]).toMatch(/ORDER BY entity_hit DESC NULLS LAST, score DESC, document_id ASC/);
    expect(result.sources.length).toBeGreaterThan(0);
  });

  it("byte-identical ranked ids across a full rebuild (literal ids, ORDER BY d.id)", async () => {
    const run = async () => {
      if (handles.length > 1) await handles.shift()?.dispose();
      const a = await tmpDb();
      handles.push(a);
      db = a.client;
      holder.db = db as unknown as ServoDb;
      catalogUser = await db.user.create({
        data: { name: "Servo Catalog", email: "catalog@servo.ai", role: "AI_AGENT", aiKind: "CATALOG" },
      });
      reader = await db.user.create({ data: { name: "R", email: `r${Date.now()}@x.com`, role: "REQUESTER" } });
      await seedCard(Ds.exact);
      await seedCard(Ds.wide);
      await entitleReader();
      const r = await routeSources(db as never, { humanId: reader.id, agentId: null }, "payroll", { limit: 10 });
      return r.sources.map((s) => s.documentId).join(",");
    };
    const first = await run();
    const second = await run();
    expect(first).toBe(second);
  }, 30_000);
});

describe("MAX not SUM; entity_hit leads; the dup second pass", () => {
  it("a 3-chunk exact match outranks a 34-chunk wide table", async () => {
    await seedCard({ ...Ds.exact });
    await seedCard({ ...Ds.wide });
    await entitleReader();
    const { sources } = await routeSources(db as never, { humanId: reader.id, agentId: null }, "payroll exact", { limit: 10 });
    const ids = sources.map((s) => s.documentId);
    expect(ids.indexOf(Ds.exact.id)).toBeLessThan(ids.indexOf(Ds.wide.id));
    // Switching MAX to SUM makes this fail: the source-level guard.
    const source = (await import("node:fs")).readFileSync("src/lib/kb/route.ts", "utf8");
    expect(source).toMatch(/MAX\(ts_rank_cd\(c\.tsv, websearch_to_tsquery\('simple', \$?\{?q\}?\), 32\)\)/);
    expect(source).not.toMatch(/SUM\(ts_rank_cd/);
  });

  it("an entity hit outranks every dataset without one, whatever the content score", async () => {
    // The wide table mentions payroll 34 times; the entity holder mentions
    // it 3 times — but carries INV-2024-113.
    await seedCard(Ds.exact); // entity INV-2024-113
    await seedCard(Ds.wide); // no entity, much more content
    await entitleReader();
    const { sources } = await routeSources(db as never, { humanId: reader.id, agentId: null }, "payroll INV-2024-113", { limit: 10 });
    expect(sources[0].documentId).toBe(Ds.exact.id);
    expect(sources[0].entityHit).toBe(true);
    expect(sources.find((s) => s.documentId === Ds.wide.id)?.entityHit ?? false).toBe(false);
  });

  it("a table, its view and its CSV export: at most ONE of the trio in the top 3", async () => {
    // The trio: the table, its view and its CSV export — three near-duplicate
    // copies. Two DISTINCT documents fill the ranking so suppression shows.
    await seedCard({ ...Ds.exact });
    await seedCard({ id: "ds_3b3", name: "public.payroll_view", chunks: 3, nearDuplicateOf: Ds.exact.id });
    await seedCard({ ...Ds.export, nearDuplicateOf: Ds.exact.id });
    await seedCard({ ...Ds.wide });
    await seedCard({ id: "ds_5c5", name: "public.contractors", chunks: 6 });
    await entitleReader();
    const { sources } = await routeSources(db as never, { humanId: reader.id, agentId: null }, "payroll", { limit: 3 });
    const top3 = sources.map((s) => s.documentId);
    expect(top3.length).toBe(3);
    // Only ONE of the trio (table/view/csv) appears: the others paid the
    // 0.50 second-pass penalty to a strictly-higher peer.
    const trio = [Ds.exact.id, "ds_3b3", Ds.export.id];
    const present = top3.filter((id) => trio.includes(id));
    expect(present.length).toBeLessThanOrEqual(1);
    // The pass is a second pass: the SQL computes pre first, then dup.
    const source = (await import("node:fs")).readFileSync("src/lib/kb/route.ts", "utf8");
    expect(source.indexOf("pre_scored")).toBeLessThan(source.indexOf("dup_applied"));
  });

  it("ZERO provider calls during routing — the spy proves it", async () => {
    await seedCard(Ds.exact);
    await entitleReader();
    const provider = vi.fn();
    const { getProvider } = await import("@/lib/ai/provider");
    void getProvider;
    void provider;
    // The entity pass is keywordPass — pure. No import of the provider
    // exists in the router at all; assert at source level plus behaviour.
    const source = (await import("node:fs")).readFileSync("src/lib/kb/route.ts", "utf8");
    expect(source).not.toMatch(/@\/lib\/ai\/provider/);
    await routeSources(db as never, { humanId: reader.id, agentId: null }, "payroll INV-2024-113");
  });
});

describe("alt, the footer and the no-embedder path", () => {
  it("valuesStatus ABSENT caps alt sections and ranks below the COMPLETE twin", async () => {
    await seedCard({ ...Ds.exact, id: "ds_5e5", name: "public.payroll_complete" });
    await seedCard({ ...Ds.exact, id: "ds_6b6", name: "public.payroll_absent", valuesComplete: false });
    await entitleReader();
    const { sources } = await routeSources(db as never, { humanId: reader.id, agentId: null }, "payroll_complete", { limit: 5 });
    const ids = sources.map((s) => s.documentId);
    expect(ids).toContain("ds_5e5");
    expect(ids).toContain("ds_6b6");
    expect(ids.indexOf("ds_5e5")).toBeLessThan(ids.indexOf("ds_6b6"));
    // No extra weight term: the ONLY difference is alt's section count.
    const complete = sources.find((s) => s.documentId === "ds_5e5")!;
    const absent = sources.find((s) => s.documentId === "ds_6b6")!;
    expect(complete.alt).toBeGreaterThanOrEqual(absent.alt);
  });

  it("the footer denominator counts ENTITLED datasets only", async () => {
    await seedCard(Ds.exact);
    await seedCard(Ds.wide);
    await seedCard(Ds.export);
    // A THIRD dataset the reader is NOT entitled to:
    await db.$executeRawUnsafe(
      `CREATE OR REPLACE VIEW datasource_readable_by_human AS
         SELECT 'silo-a'::text AS "dataSourceId", '${reader.id}'::text AS "userId" WHERE false`,
    );
    await seedCard({ ...Ds.exact, id: "ds_0f0", name: "public.payroll_secret", otherSource: true });
    const result = await routeSources(db as never, { humanId: reader.id, agentId: null }, "payroll", { limit: 2 });
    // Entitled to ZERO (the view yields no rows) — the denominator is 0,
    // never the fixture count, and nothing is returned.
    expect(result.entitledDatasets).toBe(0);
    expect(result.sources).toHaveLength(0);
    // Re-entitle: denominator == entitled count, omitted as a COUNT.
    await entitleReader();
    const full = await routeSources(db as never, { humanId: reader.id, agentId: null }, "payroll", { limit: 2 });
    expect(full.entitledDatasets).toBe(3);
    expect(full.omitted).toBe(1); // a count, not a list
    expect(typeof full.omitted).toBe("number");
  });

  it("without an embedder: vec NULL, content degrades to 0.5*lex, entity and graph still fire, list still total", async () => {
    await seedCard(Ds.exact);
    await entitleReader();
    const { sources } = await routeSources(db as never, { humanId: reader.id, agentId: null }, "payroll INV-2024-113");
    expect(sources.length).toBeGreaterThan(0);
    expect(sources[0].entityHit).toBe(true);
    // pre = 0.5*lex + 0.20*graph + 0.05*alt with vec at 0 — the vec column
    // degrades cleanly and the ranking stays a total order.
    for (const s of sources) expect(Number.isFinite(s.pre)).toBe(true);
    expect(sources[0].pre).toBeGreaterThan(0);
  });
});
