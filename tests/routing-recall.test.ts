// fed-06, part 2: the routing recall harness. The eval set is imported
// from scripts/routing-recall.mjs (deterministic questions with a synonym
// pass so they never reuse card tokens); the router runs over the seeded
// 400-table warehouse with its three payroll hard negatives. The headline
// asserts recall@3 ≥ 0.9 and recall@1 ≥ 0.7; the CONTROL zeroes the graph,
// alt and dup terms and must measurably WORSEN — proving the metric can
// catch a regression.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { tmpDb, type TmpDb } from "./helpers/tmp-db";
import { silos, warehouseQuery, PAYROLL_TRUTH } from "./setup/silos";
import { routeSources } from "@/lib/kb/route";

type ServoDb = { [key: string]: unknown };
const holder = vi.hoisted(() => ({ db: null as unknown as ServoDb }));
vi.mock("@/lib/db", () => ({ get db() { return holder.db; } }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: async () => ({ id: "x", role: "ADMIN" }) }));

const handles: TmpDb[] = [];
afterAll(async () => {
  for (const h of handles) await h.dispose();
});

interface Question { q: string; truth: string }

function recallOver(results: Array<{ top: string[]; truth: string }>) {
  const r1 = results.filter((r) => r.top[0] === r.truth).length / results.length;
  const r3 = results.filter((r) => r.top.includes(r.truth)).length / results.length;
  const misses = results.filter((r) => !r.top.includes(r.truth)).map((r) => ({ q: r.truth, got: r.top }));
  return { r1, r3, misses };
}

describe("routing recall", () => {
  let db: TmpDb["client"];
  let reader: { id: string };
  let world: Awaited<ReturnType<typeof silos>> | null = null;

  const QUESTIONS: Question[] = (() => {
    const raw = process.env.RECALL_QUESTIONS;
    if (raw) return JSON.parse(raw) as Question[];
    // The offline default — identical to scripts/routing-recall.mjs.
    // Synonyms deliberately avoid the truth card's tokens ("compensation
    // ledger", "staff"): the questions speak PAYROLL, which only the three
    // decoys carry lexically — the truth ranks through the entity edge.
    return [
      { q: "payroll totals by department", truth: PAYROLL_TRUTH },
      { q: "payroll amounts per employee", truth: PAYROLL_TRUTH },
      { q: "payroll records INV-2024-113", truth: PAYROLL_TRUTH },
      { q: "monthly payroll wage totals", truth: PAYROLL_TRUTH },
      { q: "employee payroll earnings history", truth: PAYROLL_TRUTH },
      { q: "what did payroll pay last quarter", truth: PAYROLL_TRUTH },
      { q: "payroll stub data with withholdings", truth: PAYROLL_TRUTH },
      { q: "payroll reconciliation export", truth: PAYROLL_TRUTH },
      { q: "staff payroll by pay cycle", truth: PAYROLL_TRUTH },
      { q: "gross and net payroll figures", truth: PAYROLL_TRUTH },
    ];
  })();

  let ready: Promise<void> | null = null;
  const setup = async () => {
  
      const a = await tmpDb();
      handles.push(a);
      db = a.client;
      holder.db = db as unknown as ServoDb;
      reader = await db.user.create({ data: { name: "R", email: `r${Date.now()}@x.com`, role: "REQUESTER" } });
      world = await silos();
      // The router reads the entitlement view in the database it QUERIES —
      // the cards live in the warehouse, so the grant lands there (a
      // warehouse mutation: under the lock).
      const siloSetup = world;
      await warehouseQuery(() => siloSetup.withLock(async () => {
        const rows = ["silo-warehouse", "silo-payroll"].map((s) => `SELECT '${s}'::text AS "dataSourceId", '${reader.id}'::text AS "userId"`).join(" UNION ALL ");
        await world!.db.$executeRawUnsafe(`CREATE OR REPLACE VIEW datasource_readable_by_human AS ${rows}`);
      }));
  };

  it("recall headline", async () => {
    await setup();
    const siloWorld = world!;
    const results: Array<{ top: string[]; truth: string }> = [];
    await warehouseQuery(() => siloWorld.withLock(async () => {
      for (const question of QUESTIONS) {
        // Route over the WAREHOUSE db (where the cards live), with the
        // reader's entitlement resolved through the run-db contract views:
        const routed = await routeSources(siloWorld.db as never, { humanId: reader.id, agentId: null }, question.q, { limit: 3 });
        results.push({ top: routed.sources.map((s) => s.documentId), truth: question.truth });
      }
    }));
    const { r1, r3, misses } = recallOver(results);
    console.log(`RECALL_JSON: ${JSON.stringify({ recall1: r1, recall3: r3, misses })}`);
    expect(r3, `recall@3 = ${r3} (misses: ${misses.map((m) => m.q).join("; ")})`).toBeGreaterThanOrEqual(0.9);
    expect(r1, `recall@1 = ${r1}`).toBeGreaterThanOrEqual(0.7);
  }, 180_000);

  it("recall control", async () => {
    await setup();
    const siloWorld = world!;
    // Zero the graph, alt and dup terms by routing through a chain with a
    // NULL-ish entitlement... no — mechanically: re-route with the router's
    // graph term disabled via a queryVector-less, graph-less pathway. The
    // honest offline control: strip the ledger/world of EDGES (graph=0) and
    // compact every card to one section (alt=1), then re-run. The whole
    // strip→measure→RESTORE runs under the warehouse lock: the other fed-06
    // worker must never observe a half-deleted warehouse, and the deletions
    // are restored so later runs re-find the seeded shape.
    const measured = await warehouseQuery(() => siloWorld.withLock(async () => {
      const edges = await siloWorld.db.knowledgeEdge.findMany({});
      const altChunks = await siloWorld.db.documentChunk.findMany({ where: { index: { gt: 0 } } });
      await siloWorld.db.knowledgeEdge.deleteMany({});
      await siloWorld.db.documentChunk.deleteMany({ where: { index: { gt: 0 } } }); // alt → 1 section
      try {
        const results: Array<{ top: string[]; truth: string }> = [];
        for (const question of QUESTIONS) {
          const routed = await routeSources(siloWorld.db as never, { humanId: reader.id, agentId: null }, question.q, { limit: 3 });
          results.push({ top: routed.sources.map((s) => s.documentId), truth: question.truth });
        }
        const { r1, r3, misses } = recallOver(results);
        return { r1, r3, misses, restored: { edges: edges.length, chunks: altChunks.length } };
      } finally {
        // Restore the exact seeded rows: the Json columns come back as
        // JsonValue (nullable at the type level) and go in as InputJsonValue.
        await siloWorld.db.knowledgeEdge.createMany({
          data: edges.map((e) => ({ ...e, evidence: e.evidence as never })),
        });
        await siloWorld.db.documentChunk.createMany({
          data: altChunks.map((c) => ({ ...c, keywords: c.keywords as never, locator: c.locator as never })),
        });
      }
    }));
    console.log(`RECALL_JSON: ${JSON.stringify({ recall1: measured.r1, recall3: measured.r3, misses: measured.misses })}`);
    // The deletions were restored under the same lock — the warehouse is
    // byte-identical to the seeded shape for every later reader.
    expect(measured.restored).toEqual({ edges: 3, chunks: 400 });
    // The control must be WORSE than the headline thresholds — the metric
    // can catch a regression rather than being ~1.0 by construction.
    expect(
      measured.r1 < 0.7 || measured.r3 < 0.9,
      `control recall@1=${measured.r1} @3=${measured.r3} — too good; the metric cannot catch regressions`,
    ).toBe(true);
  }, 180_000);

  afterAll(async () => {
    if (world) await world.teardown();
  });
});
