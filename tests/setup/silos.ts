// tests/setup/silos.ts — the two-silo offline fixture world (fed-06).
//
// Silo A is servo_catalog_src on the EXISTING port-5433 container (the
// cat-03 harness — the way db-05 creates the ops sandbox), seeded with
// 400 generated tables of which THREE are payroll-shaped, every card
// carrying a LITERAL primary key, ANALYZEd. Silo B is the cat-05
// in-process HTTP fixture server on 127.0.0.1. No compose diff, no new
// container, no new runtime dependency.
//
// The 400 tables: names are letter-salad (a fixed multiplicative hash),
// so NAME_AFFINITY-similar names do not leak ranking; the three payroll
// tables (a table, its view, its CSV export) are the hard negatives, and
// one PAYROLL-TRUTH table is the intended answer.
//
// CROSS-WORKER RULE: vitest runs each test FILE in its own process, and
// both fed-06 files need this world. The warehouse is ONE database, so
// setup, re-seed and the recall control's deletions all serialise through
// a server-level advisory lock (pg_advisory_lock on the maintenance
// database) held by a dedicated connection_limit=1 client — the lock and
// its unlock are then guaranteed to share one session. World.teardown()
// closes clients but never drops the warehouse: the marker check makes
// the next setup a no-op instead of a 400-card re-seed.

import { PrismaClient } from "@prisma/client";
import { testDatabaseUrl, urlForDatabase } from "../helpers/tmp-db";
import { startObjectFixture, type FixtureServer } from "./object-fixture-server";

export const WAREHOUSE_DB = "servo_catalog_src";
export const PAYROLL_TRUTH = "ds_true_payroll";
export const PAYROLL_TABLE = "ds_payroll_table";
export const PAYROLL_VIEW = "ds_payroll_view";
export const PAYROLL_CSV = "ds_payroll_csv";

/** The server-level advisory-lock key serialising all warehouse access. */
const WAREHOUSE_LOCK_KEY = 0x5106;

export interface SiloWorld {
  db: PrismaClient;
  /** Silo B's server — closed by teardown(). */
  siloB: FixtureServer;
  /**
   * Run fn holding the warehouse lock. Every read or write against
   * servo_catalog_src that a TEST performs goes through here, so two
   * vitest workers can never interleave a control-run deletion with the
   * other file's routing or re-seed.
   */
  withLock<T>(fn: () => Promise<T>): Promise<T>;
  teardown(): Promise<void>;
}

/**
 * Query-level retry for the WAREHOUSE client (fed-06 CI hardening): the
 * suite's other files keep the server busy while this client's pool sits
 * idle, and CI's postgres drops idle connections — the next read then
 * surfaces P1017. Prisma reconnects on the following attempt, so a short
 * retry turns the drop into a delay instead of a red CI run.
 */
export async function warehouseQuery<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= 3 || !/P1017|P1004|P1015/i.test(String(err))) throw err;
      await new Promise((r) => setTimeout(r, attempt * 800));
    }
  }
}

/** Deterministic letter-salad table names: no accidental affinities. */
export function noiseName(i: number): string {
  return `t${((i * 2654435761) % 1679616).toString(36)}z`;
}

/** One connection_limit on a URL, replacing any earlier value. */
function withLimit(url: string, n: number): string {
  const u = new URL(url);
  u.searchParams.set("connection_limit", String(n));
  return u.toString();
}

/** Seed the 400-table warehouse into servo_catalog_src (idempotent). */
export async function seedWarehouse(db: PrismaClient, catalogUserId: string): Promise<void> {
  // Three payroll-shaped hard negatives + the truth table, then 396 noise.
  // The HARD-NEGATIVE geometry: the three payroll-named decoys (a table,
  // its view, its CSV export) carry the lex token "payroll" the questions
  // use; the TRUTH table deliberately does NOT — it is reachable through
  // the SHARED_ENTITY edge from the table copy and its entity code, not
  // through lexical overlap. A control run with edges deleted therefore
  // loses the truth table: the metric can catch a scoring regression.
  const cards: Array<{ id: string; name: string; summary: string; dataSource: string }> = [
    { id: PAYROLL_TRUTH, name: "hr.comp_ledger", summary: "Compensation ledger for staff, reference code INV-2024-113. 1,204 rows.", dataSource: "silo-payroll" },
    { id: PAYROLL_TABLE, name: "public.payroll", summary: "Payroll table copy from the warehouse. 1,180 rows.", dataSource: "silo-payroll" },
    { id: PAYROLL_VIEW, name: "public.payroll_v", summary: "A view over the payroll table. 1,180 rows.", dataSource: "silo-payroll" },
    { id: PAYROLL_CSV, name: "exports.payroll_csv", summary: "CSV export of the payroll table. 1,180 rows.", dataSource: "silo-payroll" },
  ];
  for (let i = 0; i < 396; i++) {
    cards.push({
      id: `ds_${((i * 40503) % 1679616).toString(36).padStart(4, "0")}`,
      name: `public.${noiseName(i)}`,
      summary: `Generated noise table ${i}: support telemetry. 40 rows.`,
      dataSource: "silo-warehouse",
    });
  }

  for (const card of cards) {
    await db.document.upsert({
      where: { id: card.id },
      create: {
        id: card.id, name: card.name, contentType: "application/vnd.servo.catalog+json",
        sha256: "x", byteSize: 1, data: null, textStatus: "EXTRACTED",
        summary: card.summary, ownerId: catalogUserId, visibility: "PRIVATE", kind: "CATALOG",
      },
      update: { summary: card.summary },
    });
    const entry = await db.catalogEntry.upsert({
      where: { dataSourceId_fqn: { dataSourceId: card.dataSource, fqn: `pg://s/${card.name}` } },
      create: {
        dataSourceId: card.dataSource, level: "DATASET", fqn: `pg://s/${card.name}`,
        displayName: card.name, locator: {}, profile: { rows: 40 }, documentId: card.id,
      },
      update: { documentId: card.id },
      select: { id: true },
    });
    await db.document.update({ where: { id: card.id }, data: { catalogEntryId: entry.id } });
    // Cards are small: one overview + one values chunk each.
    await db.documentChunk.deleteMany({ where: { documentId: card.id } });
    await db.documentChunk.createMany({
      data: [
        {
          documentId: card.id, index: 0,
          text: `${card.name} · ${card.dataSource} — ${card.summary}`,
          locator: { entry: entry.id, section: "overview" },
        },
        {
          documentId: card.id, index: 1,
          text: "values of status: ACTIVE (×30), CLOSED (×10).",
          locator: { entry: entry.id, section: "values", from: "status" },
        },
      ],
    });
  }
  // The hard-negative trio: table ↔ view ↔ csv NEAR_DUPLICATE edges.
  for (const [a, b] of [
    [PAYROLL_TABLE, PAYROLL_VIEW],
    [PAYROLL_TABLE, PAYROLL_CSV],
  ] as const) {
    await db.knowledgeEdge.upsert({
      where: { fromId_toId_kind: { fromId: a, toId: b, kind: "NEAR_DUPLICATE" } },
      create: { fromId: a, toId: b, kind: "NEAR_DUPLICATE", weight: 0.95, evidence: [] },
      update: {},
    });
  }
  // The truth table links to the table copy by a SHARED_ENTITY.
  await db.knowledgeEdge.upsert({
    where: { fromId_toId_kind: { fromId: PAYROLL_TRUTH, toId: PAYROLL_TABLE, kind: "SHARED_ENTITY" } },
    create: { fromId: PAYROLL_TRUTH, toId: PAYROLL_TABLE, kind: "SHARED_ENTITY", weight: 0.9, evidence: [{ entity: "INV-2024-113" }] },
    update: {},
  });
}

/** The seed marker: the warehouse is complete exactly in this shape. */
async function warehouseComplete(db: PrismaClient): Promise<boolean> {
  const rows = await db.$queryRawUnsafe<{ cards: number; chunks: number; edges: number }[]>(
    `SELECT (SELECT COUNT(*) FROM "Document" WHERE "kind" = 'CATALOG')::int AS cards,
            (SELECT COUNT(*) FROM "DocumentChunk")::int AS chunks,
            (SELECT COUNT(*) FROM "KnowledgeEdge")::int AS edges`,
  );
  const { cards, chunks, edges } = rows[0] ?? { cards: -1, chunks: -1, edges: -1 };
  return cards === 400 && chunks === 800 && edges === 3;
}

let world: SiloWorld | null = null;

/** The two-silo world, once per process. */
export async function silos(): Promise<SiloWorld> {
  world ??= await (async () => {
    // The lock session: connection_limit=1 pins pg_advisory_lock and its
    // unlock to ONE backend, which is the only way a pooled client can
    // hold a session-scoped advisory lock correctly.
    const lock = new PrismaClient({ datasourceUrl: withLimit(testDatabaseUrl(), 1) });
    const withLock = async <T>(fn: () => Promise<T>): Promise<T> => {
      await lock.$executeRawUnsafe(`SELECT pg_advisory_lock(${WAREHOUSE_LOCK_KEY})`);
      try {
        return await fn();
      } finally {
        await lock.$executeRawUnsafe(`SELECT pg_advisory_unlock(${WAREHOUSE_LOCK_KEY})`);
      }
    };

    // A FRESH warehouse client per attempt: a dropped connection poisons
    // the pool it lived in, so reusing the client across retries replays
    // the same P1017. Recreating gives the retry a clean pool.
    let db = new PrismaClient({ datasourceUrl: withLimit(urlForDatabase(WAREHOUSE_DB), 4) });
    // The locked setup retries: a dropped lock SESSION (CI runners see
    // P1017-class churn) releases the advisory lock early, letting two
    // workers race CREATE/migrate and one see P2021 (missing table) on the
    // first query. The retry re-enters the lock with a fresh client and
    // repairs — migrate is idempotent and the seed is upserts.
    const lockedSetup = async (): Promise<void> => {
      await withLock(async () => {
        const admin = new PrismaClient({ datasourceUrl: withLimit(testDatabaseUrl(), 2) });
        try {
          await admin.$executeRawUnsafe(`CREATE DATABASE ${WAREHOUSE_DB}`);
        } catch (err) {
          if (!/already exists/i.test(String(err))) throw err;
        } finally {
          await admin.$disconnect();
        }
        // A fresh database needs the app schema before anything can be
        // seeded; an existing one may predate a migration, and deploy is
        // a no-op when current — so it runs on every setup, under lock.
        // Bounded retry: a P1017-class dropped connection (CI runners see
        // them while the server is still warming) is transient, and the
        // advisory lock already serializes every caller.
        const { execSync } = await import("node:child_process");
        const isWin = process.platform === "win32";
        const deploy = () =>
          execSync(`${isWin ? "npx.cmd" : "npx"} prisma migrate deploy`, {
            env: { ...process.env, DATABASE_URL: urlForDatabase(WAREHOUSE_DB) },
            stdio: "pipe",
            timeout: 120_000,
          });
        let deployed = false;
        for (let attempt = 1; attempt <= 3 && !deployed; attempt++) {
          try {
            deploy();
            deployed = true;
          } catch (err) {
            if (attempt === 3) throw err;
            await new Promise((r) => setTimeout(r, attempt * 1_000));
          }
        }
        const catalogUser = await db.user.upsert({
          where: { email: "catalog@servo.ai" },
          create: { name: "Servo Catalog", email: "catalog@servo.ai", role: "AI_AGENT", aiKind: "CATALOG" },
          update: {},
        });
        // The marker check: a complete warehouse skips the 400-card re-seed —
        // the second worker's setup is a read, not a twelve-second rebuild.
        // ANALYZE rides the seed (its pg_stats power tier-1 statistics).
        if (!(await warehouseComplete(db))) {
          await seedWarehouse(db, catalogUser.id);
          await db.$executeRawUnsafe(`ANALYZE`);
        }
      });
    };
    for (let setupAttempt = 1; ; setupAttempt++) {
      try {
        await lockedSetup();
        break;
      } catch (err) {
        if (setupAttempt >= 3 || !/P2021|P1004|P1017|does not exist/i.test(String(err))) throw err;
        await db.$disconnect().catch(() => undefined);
        db = new PrismaClient({ datasourceUrl: withLimit(urlForDatabase(WAREHOUSE_DB), 4) });
        await new Promise((r) => setTimeout(r, setupAttempt * 1_000));
      }
    }
    const siloB = await startObjectFixture({ objects: [] });
    return {
      db,
      siloB,
      withLock,
      teardown: async () => {
        await siloB.close();
        await db.$disconnect();
        await lock.$disconnect();
        world = null;
      },
    };
  })();
  return world;
}
