// vitest globalSetup (spec item db-02): builds servo_test_template ONCE per
// run, then disconnects — CREATE DATABASE ... TEMPLATE fails while any
// connection to the template is open. Tests clone per-run databases from the
// template through tests/helpers/tmp-db.ts.
//
// Offline-checkable by design (§11): a container pulled once is fine,
// external SaaS is not, and this file NEVER falls back to mocks — a green
// tick against a database that was not there is the exact failure this
// harness exists to make impossible.

import { execFileSync } from "node:child_process";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const TEST_URL = process.env.TEST_DATABASE_URL ?? "postgresql://servo:servo@localhost:5433/postgres";
const TEMPLATE_NAME = "servo_test_template";
const TEMPLATE_URL = `postgresql://servo:servo@localhost:5433/${TEMPLATE_NAME}?schema=public`;

async function main() {
  const admin = new PrismaClient({ datasourceUrl: TEST_URL });
  try {
    await admin.$queryRawUnsafe("SELECT 1");
  } catch (err) {
    console.error(
      [
        "",
        "tests/setup/postgres.ts: cannot reach the test PostgreSQL server.",
        `  ${TEST_URL}`,
        `  ${err instanceof Error ? err.message : String(err)}`,
        "",
        "Start it with:",
        "  docker compose -f docker-compose.test.yml up -d",
        "",
        "No mock fallback exists on purpose: a green run against nothing is worse than a red run.",
        "",
      ].join("\n"),
    );
    process.exit(1);
  }

  const existing = await admin.$queryRawUnsafe<{ datname: string }[]>(
    `SELECT datname FROM pg_database WHERE datname = '${TEMPLATE_NAME}'`,
  );
  // A run interrupted between CREATE DATABASE and the schema step leaves a
  // hollow template that later runs would clone forever — completeness is
  // checked, not just existence.
  let complete = false;
  if (existing.length > 0) {
    const probe = new PrismaClient({ datasourceUrl: TEMPLATE_URL });
    try {
      const [tables, exts] = await Promise.all([
        probe.$queryRawUnsafe<{ tablename: string }[]>(
          `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = 'User'`,
        ),
        probe.$queryRawUnsafe<{ extname: string }[]>(
          `SELECT extname FROM pg_extension WHERE extname = 'vector'`,
        ),
      ]);
      complete = (tables as unknown[]).length > 0 && (exts as unknown[]).length > 0;
    } catch {
      complete = false;
    } finally {
      await probe.$disconnect();
    }
  }
  if (!complete) {
    if (existing.length > 0) {
      await admin.$executeRawUnsafe(`DROP DATABASE ${TEMPLATE_NAME} WITH (FORCE)`);
    }
    await admin.$executeRawUnsafe(`CREATE DATABASE ${TEMPLATE_NAME}`);
    // Apply the migrations to the template — `migrate deploy`, never
    // `db push`, since kb-01: tests must run against production's exact
    // indexes, generated columns and CHECK constraints. The CLI is invoked
    // through the node binary because `npx` is npx.cmd on Windows.
    const prismaCli = path.join("node_modules", "prisma", "build", "index.js");
    execFileSync(
      process.execPath,
      [prismaCli, "migrate", "deploy"],
      {
        env: { ...process.env, DATABASE_URL: TEMPLATE_URL },
        stdio: "inherit",
      },
    );
  }
  await admin.$disconnect();
}

export default async function setup() {
  await main();
  // Vitest 4 has no globalTeardown key: a globalSetup's returned function IS
  // the teardown (db-02's leftover sweep).
  return async function teardown() {
    const { sweepLeftovers } = await import("../helpers/tmp-db");
    await sweepLeftovers();
  };
}
