// db-05: the ops sandbox on PostgreSQL, behind a read-only role.
//
// Four things are proved here, and the fourth is the item's named offline
// check:
//
//  1. scripts/postgres-init.sql really builds what it claims — the database,
//     the two login roles, `default_transaction_read_only` on the read role
//     and all four revokes. The file is APPLIED to the test container with its
//     identifiers renamed to throwaways, not string-matched: a typo in the SQL
//     is a failing test rather than a passing grep.
//  2. opsSelect() runs inside a read-only transaction, so a CTE-smuggled
//     DELETE is refused by the SERVER (SQLSTATE 25006) even on an install that
//     configured only the read-write URL. This is the layer that replaced
//     `PRAGMA query_only`, and it is asserted on the rw endpoint precisely
//     because the ro role would hide it.
//  3. get_device_info binds $1 instead of interpolating, and ensureOpsSchema()
//     emits portable DDL.
//  4. A full mock-provider resolver run on a database ticket: the canned
//     schema query returns real rows out of the sandbox, and execute_ops_sql
//     still pauses on its approval gate — then, once approved, its canned DDL
//     actually applies to PostgreSQL.
//
// Every database here is a servo_test_* throwaway on the test container, and
// the sandbox roles carry this worker's pid. One role is the exception and is
// deliberate: the grants branch in ensureOpsSchema() tests for the LITERAL
// name `servo_ops_ro`, so proving that branch needs a role by that name. It is
// cluster-global, created and dropped around the one test that needs it, and
// it means two concurrent full test runs against ONE container would race —
// which is not how the harness is run (one container per run, tmpfs data).

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import {
  assertThrowawayUrl,
  seedCore,
  testDatabaseUrl,
  tmpDb,
  urlForDatabase,
  type TmpDb,
} from "./helpers/tmp-db";

type ServoDb = { [key: string]: unknown };

const holder = vi.hoisted(() => ({ db: null as unknown as ServoDb }));
vi.mock("@/lib/db", () => ({
  get db() {
    return holder.db;
  },
}));

import { ensureOpsSchema } from "@/lib/bootstrap";
import { ensureToolPolicies } from "@/lib/ai/custom-tools";
import { resumeAfterApproval, runResolver } from "@/lib/ai/engine";
import { OPS_SCHEMA_QUERY, opsDisconnect, opsExecute, opsSelect } from "@/lib/opsdb";
import { opsDbTools } from "@/lib/ai/tools/ops-db";
import type { ToolContext } from "@/lib/ai/tools/types";

/** The ops tools read nothing off the context; this satisfies the signature. */
const NO_CTX = {} as ToolContext;

const REPO_ROOT = path.resolve(__dirname, "..");
const INIT_SQL = path.join(REPO_ROOT, "scripts", "postgres-init.sql");

/** Throwaway names for this worker. Databases carry the servo_test_ prefix so
 *  tmp-db's rails accept them and its sweeper collects them. */
const SUFFIX = `${process.pid}`;
const OPS_DB = `servo_test_ops_${SUFFIX}`;
const DESK_DB = `servo_test_desk_${SUFFIX}`;
const RW_ROLE = `servo_test_ops_rw_${SUFFIX}`;
const RO_ROLE = `servo_test_ops_ro_${SUFFIX}`;
const ROLE_PASSWORD = "servo_ops";

const OPS_URL = credentialled(urlForDatabase(OPS_DB), RW_ROLE);
const OPS_RO_URL = credentialled(urlForDatabase(OPS_DB), RO_ROLE);

/**
 * A second sandbox database that postgres-init.sql never touched — the
 * upgraded-volume case ensureOpsSchema()'s privileges half exists for. Owned
 * by this worker's rw role so the DO block runs as the database owner, which
 * is the shipped configuration.
 */
const BARE_DB = `servo_test_bare_${SUFFIX}`;
const BARE_URL = credentialled(urlForDatabase(BARE_DB), RW_ROLE);

/**
 * The DO block in src/lib/bootstrap.ts tests for a role named LITERALLY
 * `servo_ops_ro` — the name scripts/postgres-init.sql creates. A test using
 * this worker's renamed role would never enter that branch, so the branch
 * would be uncovered and the assertions would pass with the code deleted.
 * The role is cluster-global, so it is created and dropped around one test
 * and never left behind.
 */
const REAL_RO = "servo_ops_ro";

/** How many database-level grants name the read role explicitly, PUBLIC's
 *  defaults excluded. Zero on a database nothing has configured. */
const EXPLICIT_GRANTS_TO_READ_ROLE = `SELECT count(*) FROM pg_database d, aclexplode(d.datacl) a
   WHERE d.datname = current_database() AND a.grantee = '${REAL_RO}'::regrole`;

async function withRealReadRole<T>(fn: () => Promise<T>): Promise<T> {
  await dropRealReadRole();
  await admin.$executeRawUnsafe(`CREATE ROLE ${REAL_RO} LOGIN PASSWORD '${ROLE_PASSWORD}'`);
  try {
    return await fn();
  } finally {
    await dropRealReadRole();
  }
}

async function dropRealReadRole(): Promise<void> {
  const exists = await admin.$queryRawUnsafe<{ n: number }[]>(
    `SELECT count(*)::int AS n FROM pg_roles WHERE rolname = '${REAL_RO}'`,
  );
  if (exists[0].n === 0) return;
  // Grants live in the database that issued them, so they are dropped there.
  for (const database of [BARE_DB, OPS_DB]) {
    try {
      psql([
        "-h", serverParts().host, "-p", serverParts().port, "-U", serverParts().user,
        "-d", database, "-tAc", `DROP OWNED BY ${REAL_RO}`,
      ]);
    } catch {
      // The database may not exist yet; nothing to disown.
    }
  }
  await admin.$executeRawUnsafe(`DROP ROLE IF EXISTS ${REAL_RO}`);
}

/** The same server and database, reached as one of the sandbox roles. */
function credentialled(url: string, role: string): string {
  const parsed = new URL(url);
  parsed.username = role;
  parsed.password = ROLE_PASSWORD;
  return parsed.toString();
}

let admin: PrismaClient;
const handles: TmpDb[] = [];
const opened: PrismaClient[] = [];

/** psql from the host, or from the test container when the host has none.
 *  Only `psql` is used, never pg_dump: psql speaks to any server version. */
function psql(args: string[], opts: { input?: string } = {}): string {
  const env = { ...process.env, PGPASSWORD: "servo" };
  let hostError = "not on PATH";
  try {
    const r = spawnSync("psql", args, { encoding: "utf8", env, input: opts.input });
    if (r.status === 0) return String(r.stdout);
    hostError = `${r.status}: ${String(r.stderr).slice(0, 400)}`;
  } catch (e) {
    hostError = String(e);
  }
  const socketArgs: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "-h" || args[i] === "-p") i++;
    else socketArgs.push(args[i]);
  }
  const viaDocker = spawnSync(
    "docker",
    ["compose", "-f", "docker-compose.test.yml", "-p", "servo-test", "exec", "-T", "db", "psql", ...socketArgs],
    { encoding: "utf8", env, input: opts.input, cwd: REPO_ROOT },
  );
  if (viaDocker.status === 0) return String(viaDocker.stdout);
  throw new Error(
    `psql failed on both the host and the test container.\nhost: ${hostError}\n` +
      `docker: ${viaDocker.status}: ${String(viaDocker.stderr).slice(0, 400)}`,
  );
}

function serverParts() {
  const url = new URL(testDatabaseUrl());
  return { host: url.hostname, port: url.port || "5432", user: decodeURIComponent(url.username) };
}

/** Run a psql script against `database` on the test server. */
function psqlScript(database: string, sql: string): string {
  const { host, port, user } = serverParts();
  return psql(["-h", host, "-p", port, "-U", user, "-d", database, "-v", "ON_ERROR_STOP=1", "-f", "-"], {
    input: sql,
  });
}

/** One scalar, trimmed, out of `database`. */
function scalar(database: string, sql: string): string {
  const { host, port, user } = serverParts();
  return psql([
    "-h", host, "-p", port, "-U", user, "-d", database,
    "-v", "ON_ERROR_STOP=1", "-tAc", sql,
  ]).trim();
}

/**
 * scripts/postgres-init.sql with every identifier it owns renamed to this
 * worker's throwaways. Longest names first so `servo_ops_rw` is not eaten by
 * the `servo_ops` rule, and `servo` last so it cannot eat the others.
 */
function renamedInitSql(): string {
  const raw = fs.readFileSync(INIT_SQL, "utf8");
  return raw
    // The role password is the literal string 'servo_ops' — held out of the
    // identifier renames below, which would otherwise rewrite it too and
    // leave this suite unable to log in.
    .replace(/PASSWORD 'servo_ops'/g, "PASSWORD '<<pw>>'")
    .replace(/\bservo_ops_rw\b/g, RW_ROLE)
    .replace(/\bservo_ops_ro\b/g, RO_ROLE)
    .replace(/\bservo_ops\b/g, OPS_DB)
    .replace(/DATABASE servo\b/g, `DATABASE ${DESK_DB}`)
    .replace(/<<pw>>/g, ROLE_PASSWORD);
}

beforeAll(async () => {
  admin = new PrismaClient({ datasourceUrl: testDatabaseUrl() });
  opened.push(admin);
  await dropSandbox();
  assertThrowawayUrl(urlForDatabase(DESK_DB));
  await admin.$executeRawUnsafe(`CREATE DATABASE ${DESK_DB}`);
  // A desk database has to carry the desk's own tables, or the sandbox probe
  // has nothing to recognise and the refusal tests below prove nothing.
  const desk = new PrismaClient({ datasourceUrl: urlForDatabase(DESK_DB) });
  opened.push(desk);
  await desk.$executeRawUnsafe(`CREATE TABLE "Ticket" (id TEXT PRIMARY KEY, secret TEXT)`);
  await desk.$executeRawUnsafe(`INSERT INTO "Ticket" VALUES ('t1', 'desk-only')`);
  await desk.$disconnect();
  // The file itself builds OPS_DB, the roles and the revokes.
  psqlScript(DESK_DB, renamedInitSql());
  // …and the bare one it never saw.
  assertThrowawayUrl(urlForDatabase(BARE_DB));
  await admin.$executeRawUnsafe(`CREATE DATABASE ${BARE_DB} OWNER ${RW_ROLE}`);
}, 60_000);

async function dropSandbox() {
  // Each drop is independent: one failure must not orphan the rest, or a test
  // that died halfway leaves roles and databases on the container for the
  // next run to trip over. tmp-db's sweeper collects databases only.
  const attempt = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch {
      // best effort — the next run drops it
    }
  };
  await attempt(dropRealReadRole);
  for (const database of [BARE_DB, OPS_DB, DESK_DB]) {
    await attempt(() => admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`));
  }
  for (const role of [RW_ROLE, RO_ROLE]) {
    await attempt(() => admin.$executeRawUnsafe(`DROP ROLE IF EXISTS ${role}`));
  }
}

afterAll(async () => {
  await opsDisconnect();
  for (const handle of handles) await handle.dispose();
  await dropSandbox();
  for (const client of opened) await client.$disconnect().catch(() => undefined);
});

/** Point the ops adapter at this worker's sandbox for the duration of `fn`. */
async function withOpsEnv<T>(
  env: { write?: string; read?: string },
  fn: () => Promise<T>,
): Promise<T> {
  const prev = {
    w: process.env.OPS_DATABASE_URL,
    r: process.env.OPS_DATABASE_READONLY_URL,
  };
  process.env.OPS_DATABASE_URL = env.write ?? OPS_URL;
  if (env.read === undefined) delete process.env.OPS_DATABASE_READONLY_URL;
  else process.env.OPS_DATABASE_READONLY_URL = env.read;
  try {
    return await fn();
  } finally {
    if (prev.w === undefined) delete process.env.OPS_DATABASE_URL;
    else process.env.OPS_DATABASE_URL = prev.w;
    if (prev.r === undefined) delete process.env.OPS_DATABASE_READONLY_URL;
    else process.env.OPS_DATABASE_READONLY_URL = prev.r;
  }
}

describe("db-05 · scripts/postgres-init.sql builds the sandbox", () => {
  it("creates the two login roles and holds the read role read-only", () => {
    expect(scalar(DESK_DB, `SELECT rolcanlogin FROM pg_roles WHERE rolname = '${RW_ROLE}'`)).toBe("t");
    expect(scalar(DESK_DB, `SELECT rolcanlogin FROM pg_roles WHERE rolname = '${RO_ROLE}'`)).toBe("t");
    // ALTER ROLE … SET default_transaction_read_only = on: the session
    // DEFAULT, which a session can clear for itself — a convenience, not the
    // guarantee. What this asserts is only that the default is set.
    expect(
      scalar(
        DESK_DB,
        `SELECT array_to_string(rolconfig, ',') FROM pg_roles WHERE rolname = '${RO_ROLE}'`,
      ),
    ).toContain("default_transaction_read_only=on");
    // The read-write role is NOT held read-only — otherwise execute_ops_sql
    // would be broken and every read assertion below would pass for the wrong
    // reason.
    expect(
      scalar(DESK_DB, `SELECT coalesce(array_to_string(rolconfig, ','), '') FROM pg_roles WHERE rolname = '${RW_ROLE}'`),
    ).not.toContain("default_transaction_read_only");
  });

  it("creates the sandbox database, owned by the read-write role", () => {
    expect(
      scalar(DESK_DB, `SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = '${OPS_DB}'`),
    ).toBe(RW_ROLE);
  });

  it("revoke 1: neither sandbox role — nor PUBLIC — may CONNECT to the desk database", () => {
    // The load-bearing revoke. Postgres has no cross-database query without
    // dblink/postgres_fdw, and this is what stops the sandbox opening a second
    // connection to the desk instead.
    for (const role of [RW_ROLE, RO_ROLE]) {
      expect(
        scalar(DESK_DB, `SELECT has_database_privilege('${role}', '${DESK_DB}', 'CONNECT')`),
        `${role} can still CONNECT to the desk database`,
      ).toBe("f");
    }
    expect(scalar(DESK_DB, `SELECT has_database_privilege('public', '${DESK_DB}', 'CONNECT')`)).toBe("f");
  });

  it("revokes 2-4: PUBLIC has no schema rights, no TEMP and no CONNECT inside the sandbox", () => {
    expect(scalar(OPS_DB, `SELECT has_schema_privilege('public', 'public', 'USAGE')`)).toBe("f");
    expect(scalar(OPS_DB, `SELECT has_schema_privilege('public', 'public', 'CREATE')`)).toBe("f");
    expect(scalar(OPS_DB, `SELECT has_database_privilege('public', '${OPS_DB}', 'TEMP')`)).toBe("f");
    expect(scalar(OPS_DB, `SELECT has_database_privilege('public', '${OPS_DB}', 'CONNECT')`)).toBe("f");
    // …but the two named roles do get in, or the sandbox would be unusable.
    expect(scalar(OPS_DB, `SELECT has_database_privilege('${RW_ROLE}', '${OPS_DB}', 'CONNECT')`)).toBe("t");
    expect(scalar(OPS_DB, `SELECT has_database_privilege('${RO_ROLE}', '${OPS_DB}', 'CONNECT')`)).toBe("t");
  });

  it("is idempotent — applying it twice changes nothing and raises nothing", () => {
    psqlScript(DESK_DB, renamedInitSql());
    expect(scalar(DESK_DB, `SELECT count(*) FROM pg_roles WHERE rolname = '${RO_ROLE}'`)).toBe("1");
  });
});

describe("db-05 · ensureOpsSchema emits portable DDL", () => {
  it("creates the sandbox tables with identity columns, not AUTOINCREMENT", async () => {
    await withOpsEnv({}, async () => {
      await ensureOpsSchema();
      const tables = (await opsSelect(OPS_SCHEMA_QUERY)) as { table_name: string }[];
      expect(tables.map((t) => t.table_name)).toEqual(
        expect.arrayContaining(["devices", "employees", "software_licenses"]),
      );
      // GENERATED BY DEFAULT AS IDENTITY, which is what "BY DEFAULT" means in
      // information_schema. A SQLite AUTOINCREMENT would not have parsed at
      // all, so this asserts the column is genuinely an identity column.
      const identity = (await opsSelect(
        `SELECT is_identity, identity_generation FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
        ["employees", "id"],
      )) as { is_identity: string; identity_generation: string | null }[];
      expect(identity).toHaveLength(1);
      expect(identity[0].is_identity).toBe("YES");
      expect(identity[0].identity_generation).toBe("BY DEFAULT");
    });
  });

  it("re-applies the read role's grants — on a database that never saw postgres-init.sql", async () => {
    // The upgraded-volume case, which is the ONLY reason this half of
    // ensureOpsSchema() exists. A second sandbox database is created bare —
    // no revokes, no grants, no ALTER DEFAULT PRIVILEGES — and a role named
    // exactly `servo_ops_ro` exists, which is the literal the DO block tests
    // for. Delete OPS_PRIVILEGES_SQL / OPS_READ_GRANT_SQL from bootstrap.ts
    // and every assertion below fails; a database that HAD been through
    // postgres-init.sql would pass either way, which is the trap.
    await withRealReadRole(async () => {
      await withOpsEnv({ write: BARE_URL }, async () => {
        // Before: PUBLIC still holds the defaults a fresh database ships with,
        // and the read role holds nothing of its own. (has_*_privilege would
        // answer "yes" for the role purely through PUBLIC, so the explicit
        // grant is counted out of the ACL instead.)
        expect(scalar(BARE_DB, `SELECT has_database_privilege('public', '${BARE_DB}', 'TEMP')`)).toBe("t");
        expect(scalar(BARE_DB, `SELECT has_database_privilege('public', '${BARE_DB}', 'CONNECT')`)).toBe("t");
        expect(scalar(BARE_DB, EXPLICIT_GRANTS_TO_READ_ROLE)).toBe("0");

        // A table that PREDATES the grants — the upgraded-volume shape. ALTER
        // DEFAULT PRIVILEGES cannot reach it (it only covers tables created
        // after it runs), so only OPS_READ_GRANT_SQL can make it readable.
        // Delete that block from bootstrap.ts and the `legacy_rows` assertion
        // below is the one that fails.
        await opsExecute(`CREATE TABLE IF NOT EXISTS legacy_rows (id INTEGER PRIMARY KEY)`);

        await ensureOpsSchema();

        // The three in-sandbox revokes.
        expect(scalar(BARE_DB, `SELECT has_database_privilege('public', '${BARE_DB}', 'TEMP')`)).toBe("f");
        expect(scalar(BARE_DB, `SELECT has_database_privilege('public', '${BARE_DB}', 'CONNECT')`)).toBe("f");
        expect(scalar(BARE_DB, `SELECT has_schema_privilege('public', 'public', 'USAGE')`)).toBe("f");
        // The read role's grants, including SELECT on tables ensureOpsSchema
        // itself had not created when the revokes ran.
        expect(scalar(BARE_DB, EXPLICIT_GRANTS_TO_READ_ROLE)).not.toBe("0");
        expect(scalar(BARE_DB, `SELECT has_database_privilege('${REAL_RO}', '${BARE_DB}', 'CONNECT')`)).toBe("t");
        expect(scalar(BARE_DB, `SELECT has_schema_privilege('${REAL_RO}', 'public', 'USAGE')`)).toBe("t");
        expect(scalar(BARE_DB, `SELECT has_table_privilege('${REAL_RO}', 'devices', 'SELECT')`)).toBe("t");
        expect(scalar(BARE_DB, `SELECT has_table_privilege('${REAL_RO}', 'devices', 'INSERT')`)).toBe("f");
        expect(
          scalar(BARE_DB, `SELECT has_table_privilege('${REAL_RO}', 'legacy_rows', 'SELECT')`),
          "a table older than the grants stayed unreadable — OPS_READ_GRANT_SQL did not run",
        ).toBe("t");
      });
    });
  }, 60_000);

  describe("refuses to touch Servo's own database", () => {
    // The mistake this guard exists for: pasting DATABASE_URL into
    // OPS_DATABASE_URL. Without it, ensureOpsSchema() would GRANT the sandbox
    // read role CONNECT and SELECT on the desk tables — reversing the one
    // revoke the sandbox boundary rests on.
    //
    // Each spelling below is one libpq resolves to the SAME database, and each
    // was a live bypass of a naive string comparison. They are listed
    // individually so a regression names the spelling that got through.
    const deskUrl = () => urlForDatabase(DESK_DB);

    async function withDeskEnv<T>(deskValue: string, fn: () => Promise<T>): Promise<T> {
      const prev = process.env.DATABASE_URL;
      process.env.DATABASE_URL = deskValue;
      try {
        return await fn();
      } finally {
        if (prev === undefined) delete process.env.DATABASE_URL;
        else process.env.DATABASE_URL = prev;
      }
    }

    /** The same URL with its path rewritten — the shape of every bypass. */
    function withPath(url: string, pathname: string): string {
      const parsed = new URL(url);
      parsed.pathname = pathname;
      return parsed.toString();
    }

    const spellings: [name: string, ops: (desk: string) => string][] = [
      ["the literal paste", (desk) => desk],
      ["a trailing slash", (desk) => withPath(desk, `/${DESK_DB}/`)],
      ["a doubled leading slash", (desk) => withPath(desk, `//${DESK_DB}`)],
      ["127.0.0.1 for localhost", (desk) => desk.replace("localhost", "127.0.0.1")],
      // `postgres:` is not a WHATWG "special" scheme, so new URL() leaves
      // these exactly as typed while libpq resolves every one to 127.0.0.1.
      ["127.1, the short form", (desk) => desk.replace("localhost", "127.1")],
      ["a decimal address", (desk) => desk.replace("localhost", "2130706433")],
      ["a hex address", (desk) => desk.replace("localhost", "0x7f.0.0.1")],
      ["another address in 127/8", (desk) => desk.replace("localhost", "127.0.0.2")],
      // libpq's own connection parameters: the host actually dialled is the
      // one in the query string, not the one in the authority.
      [
        "a ?host= override on an unrelated authority",
        (desk) => `${desk}${desk.includes("?") ? "&" : "?"}host=localhost`.replace("@localhost:", "@example.invalid:"),
      ],
      // A decoy: the driver has no `port` connection parameter, so this
      // changes nothing about where the query lands.
      ["a ?port= decoy the driver ignores", (desk) => `${desk}${desk.includes("?") ? "&" : "?"}port=1`],
      [
        "a ?host= override plus a ?port= decoy",
        (desk) => `${desk}${desk.includes("?") ? "&" : "?"}host=localhost&port=1`.replace("@localhost:", "@example.invalid:"),
      ],
      // From here down, the string comparison provably CANNOT see through the
      // spelling — URLSearchParams.get() returns the first `?host=` while the
      // driver honours the last, `0.0.0.0` is a different string that dials
      // loopback anyway, and a socket path is not a host name at all. These
      // are the cases the catalog probe exists for: it asks the database the
      // driver actually reached instead of parsing the string that was meant
      // to reach it.
      [
        "a repeated ?host= — first for the parser, last for the driver",
        (desk) => `${desk}${desk.includes("?") ? "&" : "?"}host=nowhere.invalid&host=localhost`.replace("@localhost:", "@example.invalid:"),
      ],
      [
        "a valueless first ?host=",
        (desk) => `${desk}${desk.includes("?") ? "&" : "?"}host&host=localhost`.replace("@localhost:", "@example.invalid:"),
      ],
      ["0.0.0.0, which dials loopback", (desk) => desk.replace("localhost", "0.0.0.0")],
      ["0, the same address written short", (desk) => desk.replace("localhost", "0")],
      // Sandbox credentials on the desk database: it is the target that
      // decides, not the connection string.
      ["a sandbox role's credentials", (desk) => credentialled(desk, RW_ROLE)],
    ];

    it.each(spellings)("%s", async (_name, spell) => {
      const desk = deskUrl();
      await withDeskEnv(desk, async () => {
        await withOpsEnv({ write: spell(desk) }, async () => {
          await expect(opsExecute("SELECT 1")).rejects.toThrow(/must be a separate database/);
          await expect(opsSelect("SELECT 1")).rejects.toThrow(/must be a separate database/);
        });
      });
    });

    it("compares the desk URL through the same spellings", async () => {
      // The guard reads BOTH sides, so a desk URL written loosely must not
      // disarm it either.
      const desk = deskUrl();
      for (const deskSpelling of [
        withPath(desk, `/${DESK_DB}/`),
        withPath(desk, `//${DESK_DB}`),
        desk.replace("localhost", "127.0.0.1"),
        desk.replace("localhost", "2130706433"),
        desk.replace("localhost", "127.1"),
        `${desk}${desk.includes("?") ? "&" : "?"}host=localhost`.replace("@localhost:", "@example.invalid:"),
        `${desk}${desk.includes("?") ? "&" : "?"}port=1`,
      ]) {
        await withDeskEnv(deskSpelling, async () => {
          await withOpsEnv({ write: desk }, async () => {
            await expect(opsExecute("SELECT 1")).rejects.toThrow(/must be a separate database/);
          });
        });
      }
    });

    it("does not depend on DATABASE_URL being readable at all", async () => {
      // The probe asks the database it reached, so an absent or nonsensical
      // DATABASE_URL neither disarms it nor stops a real sandbox working.
      await withDeskEnv("file:/data/servo.db", async () => {
        await withOpsEnv({ write: urlForDatabase(DESK_DB) }, async () => {
          await expect(opsSelect("SELECT 1")).rejects.toThrow(/must be a separate database/);
        });
        await withOpsEnv({}, async () => {
          await expect(opsSelect("SELECT 1 AS ok")).resolves.toHaveLength(1);
        });
      });
    });

    it("still allows a genuinely separate database", async () => {
      await withDeskEnv(urlForDatabase(DESK_DB), async () => {
        await withOpsEnv({}, async () => {
          await expect(opsSelect("SELECT 1 AS ok")).resolves.toHaveLength(1);
        });
      });
    });
  });
});

describe("db-05 · the read path is enforced by the server, not by keywords", () => {
  it("refuses a CTE-smuggled DELETE on the READ-WRITE endpoint — the read-only transaction", async () => {
    // The belt-and-braces layer, asserted where it is the only thing standing:
    // no OPS_DATABASE_READONLY_URL, so the statement runs as servo_ops_rw,
    // which the server does NOT hold read-only. Delete the SET TRANSACTION
    // READ ONLY line in opsdb.ts and this test starts passing the DELETE.
    await withOpsEnv({}, async () => {
      await ensureOpsSchema();
      await opsExecute(`INSERT INTO devices (asset_tag, model, type, status)
        VALUES ('LT-9001', 'Test', 'laptop', 'assigned') ON CONFLICT DO NOTHING`);
      await expect(
        opsSelect(`WITH x AS (DELETE FROM devices RETURNING *) SELECT * FROM x`),
      ).rejects.toThrow(/25006|read-only transaction/i);
      const left = (await opsSelect(`SELECT count(*)::int AS n FROM devices`)) as { n: number }[];
      expect(left[0].n, "the smuggled DELETE removed rows").toBe(1);
    });
  });

  it("reads through OPS_DATABASE_READONLY_URL when it is set", async () => {
    // Proved by the role the connection reports, not by trusting the config:
    // current_user is the server's own answer to "who is asking".
    await withOpsEnv({ read: OPS_RO_URL }, async () => {
      const who = (await opsSelect(`SELECT current_user AS who`)) as { who: string }[];
      expect(who[0].who).toBe(RO_ROLE);
    });
    await withOpsEnv({}, async () => {
      const who = (await opsSelect(`SELECT current_user AS who`)) as { who: string }[];
      expect(who[0].who).toBe(RW_ROLE);
    });
  });

  it("writes still go to the read-write role even when a read URL is configured", async () => {
    await withOpsEnv({ read: OPS_RO_URL }, async () => {
      await opsExecute(`CREATE TABLE IF NOT EXISTS rw_probe (id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY)`);
      const tables = (await opsSelect(OPS_SCHEMA_QUERY)) as { table_name: string }[];
      expect(tables.map((t) => t.table_name)).toContain("rw_probe");
      await opsExecute(`DROP TABLE rw_probe`);
    });
  });

  it("gives a read more than Prisma's 5s transaction default", async () => {
    // The read path had no ceiling before it needed a transaction. Prisma's
    // interactive-transaction default is 5s, so without the explicit options
    // in opsSelect() this query fails on a clock rather than on anything
    // about the query — and the MUTATING tool would then be less constrained
    // than the read-only one.
    await withOpsEnv({ read: OPS_RO_URL }, async () => {
      const rows = (await opsSelect("SELECT pg_sleep(6) IS NULL AS slept")) as {
        slept: boolean;
      }[];
      expect(rows).toHaveLength(1);
    });
  }, 60_000);

  it("refuses a URL that is not PostgreSQL, naming the variable", async () => {
    await withOpsEnv({ write: "file:/data/ops.db" }, async () => {
      await expect(opsSelect("SELECT 1")).rejects.toThrow(/OPS_DATABASE_URL is not a PostgreSQL URL/);
    });
  });

  it("but boot does not fail on an unconfigured sandbox — it warns and carries on", async () => {
    // The sandbox is optional and ensureOpsSchema() runs inside `npm run
    // setup` and the /setup wizard. A missing fixture database must not stop
    // someone standing up a desk; the tools report it per call instead.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      await withOpsEnv({ write: "file:/data/ops.db" }, async () => {
        await expect(ensureOpsSchema()).resolves.toBeUndefined();
      });
      expect(warn).toHaveBeenCalled();
      expect(String(warn.mock.calls.at(-1))).toMatch(/ops sandbox not prepared/);
    } finally {
      warn.mockRestore();
    }
  });
});

describe("db-05 · get_device_info binds $1", () => {
  it("finds a device by asset tag", async () => {
    await withOpsEnv({ read: OPS_RO_URL }, async () => {
      await ensureOpsSchema();
      await opsExecute(
        `INSERT INTO devices (asset_tag, model, type, status) VALUES ($1, $2, $3, $4)
         ON CONFLICT (asset_tag) DO NOTHING`,
        ["LT-2043", "ThinkPad X1 Carbon G11", "laptop", "assigned"],
      );
      const out = await opsDbTools.get_device_info.execute({ assetTag: "LT-2043" }, NO_CTX);
      expect(out).toContain("ThinkPad X1 Carbon G11");
    });
  });

  it("treats a quote-bearing tag as data, not as SQL", async () => {
    // The exact payload the old quote-doubling was the only defence against.
    // With $1 the tag is a value: no row matches it, and nothing errors.
    await withOpsEnv({ read: OPS_RO_URL }, async () => {
      const out = await opsDbTools.get_device_info.execute({ assetTag: "LT-2043' OR '1'='1" }, NO_CTX);
      expect(out).toContain("No device found");
      expect(out).not.toContain("ThinkPad");
    });
  });
});

describe("db-05 · a full mock-provider resolver run on a database ticket", () => {
  it("queries the sandbox for real and still pauses execute_ops_sql on its gate", async () => {
    const handle = await tmpDb();
    handles.push(handle);
    holder.db = handle.client as unknown as ServoDb;
    await seedCore(handle.url);
    await ensureToolPolicies();

    const requester = await handle.client.user.create({
      data: { name: "Rita Requester", email: `rita+${SUFFIX}@example.com`, role: "REQUESTER" },
    });
    const admin = await handle.client.user.create({
      data: { name: "Ada Admin", email: `ada+${SUFFIX}@example.com`, role: "ADMIN" },
    });

    // Wording chosen for the mock's database branch, and for its `create`
    // fork inside it: `query_ops_database` then a gated `execute_ops_sql`.
    const ticket = await handle.client.ticket.create({
      data: {
        number: 9101,
        title: "Add a signups table to the analytics database",
        description: "Please create a table for tracking signups in the analytics database.",
        requesterId: requester.id,
        category: "OTHER",
        status: "TRIAGED",
      },
    });

    await withOpsEnv({ read: OPS_RO_URL }, async () => {
      await ensureOpsSchema();
      const run = await runResolver(ticket.id);
      expect(run.status).toBe("WAITING_APPROVAL");

      // The read really reached PostgreSQL: the canned schema query came back
      // with the sandbox's own table names, not a stub.
      const results = await handle.client.agentStep.findMany({
        where: { runId: run.id, type: "TOOL_RESULT", toolName: "query_ops_database" },
      });
      expect(results).toHaveLength(1);
      expect(results[0].content).toContain("devices");
      expect(results[0].content).toContain("table_name");
      expect(results[0].content).not.toContain("Error:");

      // …and the mutation stopped at the gate, unexecuted.
      const approval = await handle.client.approval.findFirstOrThrow({ where: { runId: run.id } });
      expect(approval.toolName).toBe("execute_ops_sql");
      expect(approval.riskLevel).toBe("HIGH");
      const before = await handle.client.agentStep.findMany({
        where: { runId: run.id, type: "TOOL_CALL", toolName: "execute_ops_sql" },
      });
      expect(before).toHaveLength(0);
      // Asked of the DATABASE, not of the engine's own step rows: "the gate
      // held" means the sandbox does not carry the table yet.
      const pending = JSON.parse(approval.toolInput) as { sql: string };
      const pendingTable = /CREATE TABLE (\w+)/.exec(pending.sql)?.[1];
      expect(pendingTable).toBeTruthy();
      const beforeTables = (await opsSelect(OPS_SCHEMA_QUERY)) as { table_name: string }[];
      expect(beforeTables.map((t) => t.table_name)).not.toContain(pendingTable);

      // Approved, the canned DDL applies to PostgreSQL for real — which is
      // what "portable DDL" means once the mock's own CREATE TABLE has to run
      // against a server that never heard of AUTOINCREMENT.
      await handle.client.approval.update({
        where: { id: approval.id },
        data: { status: "APPROVED", decidedAt: new Date(), deciderId: admin.id },
      });
      const resumed = await resumeAfterApproval(approval.id);
      expect(resumed.status).toBe("COMPLETED");
      expect(resumed.error).toBeNull();

      const executed = await handle.client.agentStep.findMany({
        where: { runId: resumed.id, type: "TOOL_RESULT", toolName: "execute_ops_sql" },
      });
      expect(executed).toHaveLength(1);
      expect(executed[0].content).toContain("Statement executed");
      expect(executed[0].content).not.toContain("SQL error");

      const created = JSON.parse(approval.toolInput) as { sql: string };
      const table = /CREATE TABLE (\w+)/.exec(created.sql)?.[1];
      expect(table).toBeTruthy();
      const tables = (await opsSelect(OPS_SCHEMA_QUERY)) as { table_name: string }[];
      expect(tables.map((t) => t.table_name)).toContain(table);
      await opsExecute(`DROP TABLE ${table}`);
    });
  }, 60_000);
});

describe("db-05 · the SQLite-era statements are gone from the surfaces the item names", () => {
  const surfaces = [
    "src/lib/ai/mock.ts",
    "prisma/seed-demo.ts",
    "docs/CONTRACT.md",
    "agents/analytics-agent.md",
    "skills/production-database-change/SKILL.md",
    "src/lib/bootstrap.ts",
    "src/lib/opsdb.ts",
  ];

  it.each(surfaces)("%s names neither sqlite_master nor AUTOINCREMENT", (file) => {
    const text = fs.readFileSync(path.join(REPO_ROOT, file), "utf8");
    expect(text).not.toMatch(/sqlite_master/i);
    expect(text).not.toMatch(/AUTOINCREMENT/i);
  });

  it("the demo seed proves its sandbox reachable BEFORE it wipes the desk", () => {
    // `npm run demo` deletes every ticket, user and setting. An install whose
    // OPS_DATABASE_URL is missing or wrong must be turned away before that,
    // not after — the failure would otherwise be an emptied desk plus an
    // error. Source order is the assertion because the wipe is the thing
    // that must not have happened yet.
    const seed = fs.readFileSync(path.join(REPO_ROOT, "prisma", "seed-demo.ts"), "utf8");
    const preflight = seed.indexOf('await opsExecute("SELECT 1")');
    const firstDelete = seed.indexOf("deleteMany()");
    expect(preflight, "the demo seed no longer proves the sandbox reachable").toBeGreaterThan(-1);
    expect(firstDelete).toBeGreaterThan(-1);
    expect(preflight, "the sandbox preflight moved AFTER the wipe").toBeLessThan(firstDelete);
  });

  it("the mock provider and the demo seed quote the same schema statement", () => {
    expect(OPS_SCHEMA_QUERY).toContain("information_schema.tables");
    for (const file of ["src/lib/ai/mock.ts", "prisma/seed-demo.ts"]) {
      expect(fs.readFileSync(path.join(REPO_ROOT, file), "utf8")).toMatch(/OPS_SCHEMA_QUERY/);
    }
  });

  it("`pragma` has left the mutating-keyword list", async () => {
    // A SQLite-only keyword: keeping it would reject a legitimate Postgres
    // column named `pragma`. The list still catches real mutations.
    await withOpsEnv({ read: OPS_RO_URL }, async () => {
      const smuggled = await opsDbTools.query_ops_database.execute({
        sql: "WITH x AS (INSERT INTO devices VALUES ('X') RETURNING *) SELECT * FROM x",
      }, NO_CTX);
      expect(smuggled).toContain("only read-only SELECT/WITH queries are allowed");

      const legal = await opsDbTools.query_ops_database.execute({
        sql: "SELECT 1 AS pragma",
      }, NO_CTX);
      expect(legal).not.toContain("only read-only SELECT/WITH queries are allowed");
      expect(legal).toContain("pragma");
    });
  });
});
