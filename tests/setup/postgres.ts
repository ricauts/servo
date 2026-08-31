// vitest globalSetup (spec item db-02): builds servo_test_template ONCE per
// run, then disconnects — CREATE DATABASE ... TEMPLATE fails while any
// connection to the TEMPLATE is open, which is why the completeness probe
// below closes its own client before anything clones.
//
// Offline-checkable by design (§11): a container pulled once is fine,
// external SaaS is not, and this file NEVER falls back to mocks — a green
// tick against a database that was not there is the exact failure this
// harness exists to make impossible.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { templateUrl, testDatabaseUrl } from "../helpers/tmp-db";

const TEST_URL = testDatabaseUrl();
const TEMPLATE_NAME = "servo_test_template";
// The template lives on whatever server TEST_DATABASE_URL names — deriving it
// is the difference between redirecting the harness and half-redirecting it.
const TEMPLATE_URL = templateUrl(TEST_URL);

// Resolved from this file, not from process.cwd(): a runner invoked from a
// subdirectory would otherwise fail to find the CLI or the migrations.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const MIGRATIONS_DIR = path.join(REPO_ROOT, "prisma", "migrations");

/**
 * The databases whose presence proves this server is an APPLICATION server,
 * not the throwaway test container. tmp-db's rail is name-only and cannot see
 * a wrong host, so a port typo — the very thing that rail exists to defend
 * against — would otherwise land CREATE/DROP DATABASE on the dev server.
 */
const APPLICATION_DATABASES = ["servo", "servo_dev", "servo_demo", "servo_ops"];

/** Migration directory name -> the sha256 of its SQL, which IS Prisma's checksum. */
function expectedMigrations(): Map<string, string> {
  const out = new Map<string, string>();
  if (!fs.existsSync(MIGRATIONS_DIR)) return out;
  for (const entry of fs.readdirSync(MIGRATIONS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const sql = path.join(MIGRATIONS_DIR, entry.name, "migration.sql");
    if (!fs.existsSync(sql)) continue;
    out.set(entry.name, createHash("sha256").update(fs.readFileSync(sql)).digest("hex"));
  }
  return out;
}

/**
 * A template is COMPLETE only if it carries the schema, the vector extension
 * and every migration in the tree AT THE TREE'S CONTENT. Existence is not
 * enough three times over: a run interrupted between CREATE DATABASE and the
 * schema step leaves a hollow template; a long-lived local container leaves a
 * template that predates whatever migration landed since; and a migration
 * edited in place leaves one whose names all match but whose SQL does not.
 * Each of those clones silently, and forever.
 */
async function templateIsComplete(expected: Map<string, string>): Promise<boolean> {
  const probe = new PrismaClient({ datasourceUrl: TEMPLATE_URL });
  try {
    const tables = await probe.$queryRawUnsafe<{ tablename: string }[]>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = 'User'`,
    );
    if (tables.length === 0) return false;
    const exts = await probe.$queryRawUnsafe<{ extname: string }[]>(
      `SELECT extname FROM pg_extension WHERE extname = 'vector'`,
    );
    if (exts.length === 0) return false;
    const applied = await probe.$queryRawUnsafe<{ migration_name: string; checksum: string }[]>(
      `SELECT migration_name, checksum FROM _prisma_migrations WHERE finished_at IS NOT NULL`,
    );
    const have = new Map(applied.map((r) => [r.migration_name, r.checksum]));
    for (const [name, checksum] of expected) {
      if (have.get(name) !== checksum) return false;
    }
    return true;
  } catch {
    return false;
  } finally {
    await probe.$disconnect();
  }
}

function die(lines: string[]): never {
  console.error(["", ...lines, ""].join("\n"));
  process.exit(1);
}

async function main() {
  const expected = expectedMigrations();
  if (expected.size === 0) {
    die([
      `tests/setup/postgres.ts: no migrations found under ${MIGRATIONS_DIR}.`,
      "The template would be built empty and every clone would be hollow.",
    ]);
  }

  const admin = new PrismaClient({ datasourceUrl: TEST_URL });
  try {
    await admin.$queryRawUnsafe("SELECT 1");
  } catch (err) {
    await admin.$disconnect().catch(() => undefined);
    die([
      "tests/setup/postgres.ts: cannot reach the test PostgreSQL server.",
      `  ${TEST_URL}`,
      `  ${err instanceof Error ? err.message : String(err)}`,
      "",
      "Start it with:",
      "  docker compose -f docker-compose.test.yml up -d",
      "",
      "No mock fallback exists on purpose: a green run against nothing is worse than a red run.",
    ]);
  }

  // The admin connection is released whatever happens below, so a throw does
  // not leave a session open against the server for the rest of the run.
  try {
    // The host rail. tmp-db's guard reads the database NAME, which a port typo
    // does not change: `…@localhost:5432/postgres` names a harmless database
    // on the dev server. Refusing a server that hosts an application database
    // is the check that actually catches it.
    const appDbs = await admin.$queryRawUnsafe<{ datname: string }[]>(
      `SELECT datname FROM pg_database WHERE datname IN (${APPLICATION_DATABASES.map((d) => `'${d}'`).join(", ")})`,
    );
    if (appDbs.length > 0) {
      die([
        "tests/setup/postgres.ts: refusing to run — this is an APPLICATION server, not the test container.",
        `  ${TEST_URL}`,
        `  it hosts: ${appDbs.map((r) => r.datname).join(", ")}`,
        "",
        "The harness CREATEs and DROPs databases on whatever server it is pointed at,",
        "so it never runs against a server that carries application data. Check the port:",
        "  docker compose -f docker-compose.test.yml up -d   # the test container listens on 5433",
      ]);
    }

    const existing = await admin.$queryRawUnsafe<{ datname: string }[]>(
      `SELECT datname FROM pg_database WHERE datname = '${TEMPLATE_NAME}'`,
    );
    const complete = existing.length > 0 && (await templateIsComplete(expected));
    if (!complete) {
      if (existing.length > 0) {
        await admin.$executeRawUnsafe(`DROP DATABASE ${TEMPLATE_NAME} WITH (FORCE)`);
      }
      await admin.$executeRawUnsafe(`CREATE DATABASE ${TEMPLATE_NAME}`);
      // Apply the migrations to the template — `migrate deploy`, never
      // `db push`, since kb-01: tests must run against production's exact
      // indexes, generated columns and CHECK constraints. `CREATE EXTENSION
      // vector` rides in migration 0001_pgvector rather than being issued
      // here, so the template and production get the extension the same way.
      // The CLI is invoked through the node binary because `npx` is npx.cmd
      // on Windows.
      const prismaCli = path.join(REPO_ROOT, "node_modules", "prisma", "build", "index.js");
      execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], {
        cwd: REPO_ROOT,
        env: { ...process.env, DATABASE_URL: TEMPLATE_URL },
        stdio: "inherit",
      });
    }
  } finally {
    await admin.$disconnect().catch(() => undefined);
  }
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
