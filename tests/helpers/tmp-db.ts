// Per-test throwaway databases (spec item db-02). tmpDb() clones
// servo_test_template — a ~100–300 ms file copy that carries the schema, the
// vector extension and every index exactly as production has them — and
// returns a handle whose .client is a PrismaClient bound to the clone.
// Teardown drops it.
//
// The harness refuses dev/demo names and refuses to run blind: if the
// resolved database is not a servo_test_* throwaway, that is a bug in the
// harness, not a test failure.
//
// EVERY connection this file opens — the maintenance one and every clone —
// is derived from TEST_DATABASE_URL. Hardcoding the clone endpoint while
// reading the env var for the admin endpoint is the shape that lets a
// redirected harness half-move: the guard inspects one server and the writes
// land on another. Because the endpoint is a variable, the guard runs inside
// admin() rather than once at import — every DROP-issuing path (dispose,
// sweepLeftovers, databaseExists) goes through it, so none of them can
// outrun a check made earlier against a different env.

import { PrismaClient } from "@prisma/client";
import { checkDatabase, parseDatabaseName } from "../../scripts/loop-guard.mjs";

const DEFAULT_TEST_URL = "postgresql://servo:servo@localhost:5433/postgres";
const TEMPLATE_NAME = "servo_test_template";

/**
 * The maintenance URL, read at CALL time rather than captured at import time
 * so the refusal below is reachable from a test.
 *
 * `??` does not catch `""`: an empty TEST_DATABASE_URL would otherwise flow
 * into PrismaClient, which resolves an empty datasource by falling back to
 * `env("DATABASE_URL")` from prisma/schema.prisma — the dev database. Empty
 * and unset therefore mean the same thing here.
 */
export function testDatabaseUrl(): string {
  const raw = process.env.TEST_DATABASE_URL;
  return raw === undefined || raw.trim() === "" ? DEFAULT_TEST_URL : raw.trim();
}

/**
 * The database NAME, parsed — never the raw string. This is loop-guard rail
 * 1's own parser, imported rather than copied: two hand-kept copies of a
 * safety parser drift, and `tests/loop-guard.test.ts` already proves a .ts
 * test file can import the .mjs script.
 */
export function databaseName(url: string): string {
  return parseDatabaseName(url) ?? "";
}

/**
 * Application databases the harness must never resolve to. Rail 1 itself
 * owns `dev`/`demo` and deliberately permits `servo`; these are the ones this
 * harness adds, because it CREATEs and DROPs databases on whatever server it
 * is pointed at.
 */
const APPLICATION_DB_STEMS = new Set(["servo", "servo_dev", "servo_demo", "servo_ops"]);

/**
 * The harness's own rail 1: the maintenance connection may sit on the test
 * server's `postgres` database, but never on an application database. An
 * unparseable or nameless URL refuses too — running blind is the failure this
 * exists to stop.
 *
 * This is a name-only check. It cannot see a wrong HOST, so the server itself
 * is checked separately, once, in tests/setup/postgres.ts.
 */
export function assertSafeAdminUrl(url: string = testDatabaseUrl()): void {
  const name = databaseName(url);
  if (name === "") {
    throw new Error(
      "tmp-db: TEST_DATABASE_URL resolves to no database name — the harness never runs blind",
    );
  }
  const rail1 = checkDatabase(url);
  if (!rail1.ok) {
    throw new Error(
      `tmp-db: TEST_DATABASE_URL resolves to the dev or demo database ("${name}") — the harness never touches it`,
    );
  }
  if (APPLICATION_DB_STEMS.has(name.toLowerCase().replace(/\.db$/, ""))) {
    throw new Error(
      `tmp-db: TEST_DATABASE_URL resolves to an application database ("${name}") — the harness never touches it`,
    );
  }
}

/**
 * The rail for a WRITE target, which is an allowlist rather than a denylist:
 * loop-guard rail 1b's shape. A denylist can only refuse the names it was
 * told about; anything that seeds application rows has to name what it will
 * accept instead.
 */
export function assertThrowawayUrl(url: string): void {
  assertSafeAdminUrl(url);
  const name = databaseName(url);
  if (!name.startsWith("servo_test_")) {
    throw new Error(
      `tmp-db: refusing to write to "${name}" — only a servo_test_* throwaway may be seeded (loop-guard rail 1b)`,
    );
  }
}

/**
 * A sibling database on the SAME server as TEST_DATABASE_URL: host, port,
 * credentials and any query parameters are carried over and only the database
 * name is swapped. `schema` defaults to public but is left alone when the
 * caller's URL already sets one, so the template and its clones agree.
 */
export function urlForDatabase(name: string, base: string = testDatabaseUrl()): string {
  const url = new URL(base);
  url.pathname = `/${name}`;
  if (!url.searchParams.has("schema")) url.searchParams.set("schema", "public");
  return url.toString();
}

/** The template database's URL, on whichever server TEST_DATABASE_URL names. */
export function templateUrl(base?: string): string {
  return urlForDatabase(TEMPLATE_NAME, base);
}

let adminClient: PrismaClient | null = null;
let adminClientUrl = "";
/**
 * The maintenance client. Built on demand and re-checked on every call: the
 * guard's decision and the connection's target are then the same read of the
 * environment, and no code path can reach a DROP without passing the rail.
 */
function admin(): PrismaClient {
  assertSafeAdminUrl();
  const url = testDatabaseUrl();
  if (adminClient && adminClientUrl === url) return adminClient;
  const stale = adminClient;
  adminClientUrl = url;
  adminClient = new PrismaClient({ datasourceUrl: url });
  if (stale) void stale.$disconnect().catch(() => undefined);
  return adminClient;
}

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
  const url = urlForDatabase(dbName);
  // Both rails before anything is created: the server we are about to write
  // to, and the name we are about to write to.
  assertThrowawayUrl(url);
  await admin().$executeRawUnsafe(`CREATE DATABASE ${dbName} TEMPLATE ${TEMPLATE_NAME}`);
  // 60 parallel test files × the default per-client pool exhausts the
  // server's 100-connection limit; clones never need more than two.
  const pooled = url.includes("connection_limit") ? url : url + (url.includes("?") ? "&" : "?") + "connection_limit=2";
  const client = new PrismaClient({ datasourceUrl: pooled });
  live.set(dbName, client);
  return {
    client,
    dbName,
    url,
    async dispose() {
      await client.$disconnect();
      // WITH (FORCE) because a consumer may still hold an open session on the
      // clone; a plain DROP would fail on it.
      await admin().$executeRawUnsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
      live.delete(dbName);
    },
  };
}

/**
 * The core bootstrap against a throwaway database — the seeding path the app
 * itself runs on first boot (AI agents, default policies, SLA rows).
 *
 * @/lib/db exports a module-scope `db` built once per module registry, and
 * Prisma resolves its datasource when that client first CONNECTS. The
 * bootstrap is therefore imported with the throwaway URL already in the
 * environment and the global singleton suppressed (NODE_ENV=production keeps
 * db.ts off globalThis), then disconnected and forgotten.
 */
export async function seedCore(url: string): Promise<void> {
  // This helper WRITES application rows, so it takes the allowlist rail, not
  // the denylist: it is the last place a non-throwaway URL could get through.
  assertThrowawayUrl(url);
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

/**
 * vitest teardown: drop anything a crashed worker left behind. The underscores
 * in the prefix are escaped — in LIKE they are single-character wildcards, so
 * an unescaped 'servo_test_%' also matches names like `servoXtestY`.
 */
export async function sweepLeftovers(): Promise<void> {
  for (const [name, client] of live) {
    await client.$disconnect();
    await admin().$executeRawUnsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  }
  live.clear();
  const rows = await admin().$queryRawUnsafe<{ datname: string }[]>(
    String.raw`SELECT datname FROM pg_database WHERE datname LIKE 'servo\_test\_%'`,
  );
  for (const row of rows) {
    if (row.datname === TEMPLATE_NAME) continue;
    await admin().$executeRawUnsafe(`DROP DATABASE IF EXISTS ${row.datname} WITH (FORCE)`);
  }
  await admin().$disconnect();
}

/** Whether a database with this name still exists on the test server. */
export async function databaseExists(dbName: string): Promise<boolean> {
  const rows = await admin().$queryRawUnsafe<{ datname: string }[]>(
    `SELECT datname FROM pg_database WHERE datname = '${dbName}'`,
  );
  return rows.length > 0;
}
