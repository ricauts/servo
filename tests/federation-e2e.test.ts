// fed-06, part 1: the two-silo e2e. The HEADLINE run probes the 400-table
// warehouse, rejects it at source scope, hops to the payroll silo and
// answers under 4000 characters with sourcesProbed === 2 and
// datasetsOpened === 0. Adversarial paging cannot breach the per-dataset
// or per-run caps. Rebuild determinism. Zero-entitlement refusal.

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { tmpDb, type TmpDb } from "./helpers/tmp-db";
import { silos, PAYROLL_TRUTH, WAREHOUSE_DB } from "./setup/silos";
import { federationTools } from "@/lib/ai/tools/federation";
import { readLedger, FED_CONTEXT_BUDGET, MAX_CHARS_PER_DATASET, MAX_PAGES_PER_DATASET, MAX_SOURCES_PROBED } from "@/lib/ai/retrieval-budget";

type ServoDb = { [key: string]: unknown };
const holder = vi.hoisted(() => ({ db: null as unknown as ServoDb }));
vi.mock("@/lib/db", () => ({ get db() { return holder.db; } }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: async () => ({ id: "x", role: "ADMIN" }) }));

const handles: TmpDb[] = [];
let world: Awaited<ReturnType<typeof silos>> | null = null;
/** The shared two-silo world: created by the first test that needs it. */
async function theWorld() {
  world ??= await silos();
  return world;
}
afterAll(async () => {
  // The world is shared by every test in this file (silos() caches per
  // process); torn down once at the end — the warehouse is never dropped,
  // so the recall worker and later runs re-find the seeded shape.
  if (world) await world.teardown();
  for (const h of handles) await h.dispose();
});

let db: PrismaClient;
let requester: { id: string };
let resolver: { id: string };
let runId: string;

function ctx() {
  return {
    ticketId: "t",
    runId,
    agentUser: resolver as never,
    principals: { agentId: "agent-x", humanId: requester.id },
  };
}

async function entitle(humanId: string, sourceIds: string[]) {
  const rows = sourceIds.map((s) => `SELECT '${s}'::text AS "dataSourceId", '${humanId}'::text AS "userId"`).join(" UNION ALL ");
  await db.$executeRawUnsafe(
    `CREATE OR REPLACE VIEW datasource_readable_by_human AS ${rows.length > 0 ? rows : `SELECT ''::text AS "dataSourceId", ''::text AS "userId" WHERE false`}`,
  );
  const arows = sourceIds.map((s) => `SELECT '${s}'::text AS "dataSourceId", 'agent-x'::text AS "agentId"`).join(" UNION ALL ");
  await db.$executeRawUnsafe(
    `CREATE OR REPLACE VIEW datasource_readable_by_agent AS ${arows.length > 0 ? arows : `SELECT ''::text AS "dataSourceId", ''::text AS "agentId" WHERE false`}`,
  );
}

async function freshRun() {
  const ticket = await db.ticket.create({ data: { number: 9800 + Math.floor(Math.random() * 100), title: "payroll totals", description: "d", requesterId: requester.id } });
  const run = await db.agentRun.create({ data: { ticketId: ticket.id, agentUserId: resolver.id, kind: "RESOLVE", status: "RUNNING" } });
  runId = run.id;
}

beforeEach(async () => {
  if (handles.length > 1) await handles.shift()?.dispose();
  const a = await tmpDb();
  handles.push(a);
  db = a.client;
  holder.db = db as unknown as ServoDb;
  requester = await db.user.create({ data: { name: "R", email: `r${Date.now()}@x.com`, role: "REQUESTER" } });
  resolver = await db.user.create({ data: { name: "S", email: `s${Date.now()}@servo.ai`, role: "AI_AGENT", aiKind: "RESOLVER" } });
});

describe("the two-silo world", () => {
  it("Silo A exists on the existing container with 400 tables, ANALYZEd; Silo B is in-process 127.0.0.1", async () => {
    const w = await theWorld();
    const { cards, stats } = await w.withLock(async () => ({
      cards: await w.db.document.count({ where: { kind: "CATALOG" } }),
      // The warehouse has live statistics (ANALYZE ran):
      stats: await w.db.$queryRawUnsafe<{ n: number }[]>(
        `SELECT COUNT(*)::int AS n FROM pg_stats WHERE schemaname = 'public'`,
      ),
    }));
    expect(cards).toBe(400);
    expect(stats[0].n).toBeGreaterThan(0);
    expect(w.siloB.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  }, 60_000);
});

describe("the HEADLINE run", () => {
  it("probes warehouse, rejects at source scope, hops to payroll: <4000 chars, probed=2, opened=0", async () => {
    // The federation tools run against the RUN's database (their ledger,
    // their entitlement oracle) — so the 400-table warehouse is seeded
    // INTO the run clone; the standalone servo_catalog_src world serves
    // the recall harness. Literal ids make the two identical in shape.
    const { seedWarehouse } = await import("./setup/silos");
    const catalogUser = await db.user.create({ data: { name: "Servo Catalog", email: `c${Date.now()}@servo.ai`, role: "AI_AGENT", aiKind: "CATALOG" } });
    await seedWarehouse(db, catalogUser.id);
    await entitle(requester.id, ["silo-warehouse", "silo-payroll"]);
    await freshRun();

    // 1. Probe the warehouse (find_sources ranks over 400 tables):
    const find1 = await federationTools.find_sources.execute({ question: "salaries by period" } as never, ctx());
    expect(find1).not.toMatch(/No accessible sources/);
    // 2. Reject the whole source:
    const discard = await federationTools.discard_source.execute(
      { sourceId: "silo-warehouse", scope: "source", reason: "salaries take-home net compensation payroll" } as never,
      ctx(),
    );
    expect(discard).toMatch(/Discarded source/);
    // 3. THE HOP — probe again; only the payroll silo remains:
    const find2 = await federationTools.find_sources.execute({ question: "salaries take-home payroll" } as never, ctx());
    expect(find2).toMatch(/payroll/);
    expect(find2).not.toMatch(/silo-warehouse/);
    // 4. The run's ledger: probed 2, opened 0.
    const ledger = await readLedger(db as never, runId);
    expect(ledger.probed, `probed ${ledger.probed}`).toBe(2);
    expect(ledger.opened).toBe(0);

    // The headline character count: every federation tool's output.
    const total = find1.length + discard.length + find2.length;
    expect(total, `HEADLINE: federation tools admitted ${total} characters (must be < 4000)`).toBeLessThan(4000);
  }, 180_000);
});

describe("adversarial paging", () => {
  it("a greedy cursor-walker cannot breach per-dataset or per-run caps", async () => {
    await theWorld();
    await entitle(requester.id, ["silo-payroll"]);
    await freshRun();

    // The greedy walker: open PAYROLL_TRUTH and request EVERY section
    // repeatedly (the caps must refuse), plus more probes than allowed.
    let maxPageRefusals = 0;
    for (let i = 0; i < 10; i++) {
      const res = await federationTools.open_dataset.execute(
        { datasetId: PAYROLL_TRUTH, section: "values" } as never,
        ctx(),
      );
      if (/pages \(cap 3\)|Budget exhausted/.test(res)) maxPageRefusals++;
    }
    expect(maxPageRefusals).toBeGreaterThan(0);

    let probeRefusals = 0;
    for (let i = 0; i < 12; i++) {
      const res = await federationTools.find_sources.execute({ question: "salaries" } as never, ctx());
      if (/Budget exhausted|probes/.test(res)) probeRefusals++;
    }
    expect(probeRefusals).toBeGreaterThan(0);

    const ledger = await readLedger(db as never, runId);
    expect(ledger.probed).toBeLessThanOrEqual(MAX_SOURCES_PROBED);
    expect(ledger.chars).toBeLessThanOrEqual(FED_CONTEXT_BUDGET);
    const per = ledger.perDataset[PAYROLL_TRUTH];
    if (per) {
      expect(per.pages).toBeLessThanOrEqual(MAX_PAGES_PER_DATASET);
      expect(per.chars).toBeLessThanOrEqual(MAX_CHARS_PER_DATASET);
    }
    console.log("ADVERSARIAL: per-dataset maxima:", JSON.stringify(ledger.perDataset), "chars:", ledger.chars, "probes:", ledger.probed);
  }, 120_000);
});

describe("rebuild determinism", () => {
  it("the same run over a rebuilt database: byte-identical ranked ids and ledger", async () => {
    const w = await theWorld();
    await entitle(requester.id, ["silo-payroll"]);
    const run = async () => {
      await freshRun();
      const r1 = await federationTools.find_sources.execute({ question: "salaries by period" } as never, ctx());
      const ledger = await readLedger(db as never, runId);
      return { text: r1, ledger: JSON.stringify(ledger) };
    };
    const first = await run();
    // "Rebuild": re-seed the warehouse (idempotent upserts — the literal
    // ids make the outcome identical), then rerun on a fresh ledger. The
    // re-seed is a warehouse write: under the lock.
    const { seedWarehouse } = await import("./setup/silos");
    await w.withLock(async () => {
      await seedWarehouse(w.db, (await w.db.user.findUniqueOrThrow({ where: { email: "catalog@servo.ai" } })).id);
    });
    const second = await run();
    expect(second.text).toBe(first.text);
    // Ledgers equal on every counted field (discards differ only by ids):
    const a = JSON.parse(first.ledger) as Record<string, unknown>;
    const b = JSON.parse(second.ledger) as Record<string, unknown>;
    for (const key of ["probed", "opened", "discarded", "chars", "hops", "finds", "compacted"]) {
      expect(b[key]).toBe(a[key]);
    }
  }, 120_000);
});

describe("zero entitlement", () => {
  it("entitled to NOTHING: find_sources returns 'No accessible sources.' and no further call happens", async () => {
    await theWorld();
    await entitle(requester.id, []);
    await freshRun();
    const res = await federationTools.find_sources.execute({ question: "salaries" } as never, ctx());
    expect(res).toBe("No accessible sources.");
    // "No further federation call": the ledger shows exactly one find and
    // one probe charged — the tools cannot proceed past the refusal.
    const ledger = await readLedger(db as never, runId);
    expect(ledger.finds).toBe(1);
    expect(ledger.probed).toBeLessThanOrEqual(1);
    void WAREHOUSE_DB;
  }, 90_000);
});
