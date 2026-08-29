// Per-test throwaway databases (spec item db-02). tmpDb() clones
// servo_test_template — a ~100–300 ms file copy that carries the schema, the
// vector extension and every index exactly as production has them — and
// returns a PrismaClient bound to the clone. Teardown drops it.
//
// The harness refuses dev/demo names and refuses to run blind: if the
// resolved database is not a servo_test_* throwaway, that is a bug in the
// harness, not a test failure.

import { PrismaClient } from "@prisma/client";

const TEST_URL = process.env.TEST_DATABASE_URL ?? "postgresql://servo:servo@localhost:5433/postgres";
const TEMPLATE_NAME = "servo_test_template";

/** Parse the database NAME out of a Postgres URL (loop-guard rail 1 shape). */
function databaseName(url: string): string {
  try {
    return new URL(url).pathname.replace(/^\/+/, "").split("/")[0] ?? "";
  } catch {
    return "";
  }
}

/**
 * The harness's own rail 1: the maintenance connection may sit on the test
 * server's `postgres` database, but never on an application database — the
 * dev or demo databases are one port-typo away otherwise.
 */
function assertSafeAdminUrl(): void {
  const name = databaseName(TEST_URL);
  if (["servo", "dev", "demo", "servo_dev", "servo_demo"].includes(name)) {
    throw new Error(
      `tmp-db: TEST_DATABASE_URL resolves to "${name}" — the harness never touches an application database (loop-guard rail 1)`,
    );
  }
}
assertSafeAdminUrl();

const admin = new PrismaClient({ datasourceUrl: TEST_URL });
let counter = 0;
const live = new Map<string, PrismaClient>();

export interface TmpDb {
  client: PrismaClient;
  dbName: string;
  url: string;
  /** Disconnect and DROP the throwaway database. */
  dispose(): Promise<void>;
}

/** A throwaway database cloned from the template, dropped on dispose. */
export async function tmpDb(): Promise<TmpDb> {
  const dbName = `servo_test_${process.pid}_${++counter}`;
  await admin.$executeRawUnsafe(`CREATE DATABASE ${dbName} TEMPLATE ${TEMPLATE_NAME}`);
  const url = `postgresql://servo:servo@localhost:5433/${dbName}?schema=public`;
  const client = new PrismaClient({ datasourceUrl: url });
  live.set(dbName, client);
  return {
    client,
    dbName,
    url,
    async dispose() {
      await client.$disconnect();
      await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
      live.delete(dbName);
    },
  };
}

/**
 * The core bootstrap against a throwaway database — the seeding path the app
 * itself runs on first boot (AI agents, default policies, SLA rows).
 *
 * @/lib/db builds its client from DATABASE_URL at import time, so the
 * bootstrap is imported with the throwaway URL set and the global singleton
 * suppressed (NODE_ENV=production keeps db.ts off globalThis), then
 * disconnected and forgotten.
 */
export async function seedCore(url: string): Promise<void> {
  const g = globalThis as { prisma?: unknown };
  const prevUrl = process.env.DATABASE_URL;
  const prevNodeEnv = process.env.NODE_ENV;
  process.env.DATABASE_URL = url;
  Object.assign(process.env, { NODE_ENV: "production" }); // keep the db singleton off globalThis
  try {
    const bootstrap = await import("@/lib/bootstrap");
    const { ensureToolPolicies } = await import("@/lib/ai/custom-tools");
    const { ensureSlaPolicies } = await import("@/lib/sla");
    await bootstrap.ensureAiAgents();
    await ensureToolPolicies();
    await ensureSlaPolicies();
  } finally {
    const dbMod = await import("@/lib/db");
    await dbMod.db.$disconnect().catch(() => undefined);
    g.prisma = undefined;
    process.env.DATABASE_URL = prevUrl;
    Object.assign(process.env, { NODE_ENV: prevNodeEnv });
  }
}

/** vitest globalTeardown: drop anything a crashed worker left behind. */
export async function sweepLeftovers(): Promise<void> {
  for (const [name, client] of live) {
    await client.$disconnect();
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  }
  live.clear();
  const rows = await admin.$queryRawUnsafe<{ datname: string }[]>(
    "SELECT datname FROM pg_database WHERE datname LIKE 'servo_test_%'",
  );
  for (const row of rows) {
    if (row.datname === TEMPLATE_NAME) continue;
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${row.datname} WITH (FORCE)`);
  }
  await admin.$disconnect();
}

/** Whether a database with this name still exists on the test server. */
export async function databaseExists(dbName: string): Promise<boolean> {
  const rows = await admin.$queryRawUnsafe<{ datname: string }[]>(
    `SELECT datname FROM pg_database WHERE datname = '${dbName}'`,
  );
  return rows.length > 0;
}
