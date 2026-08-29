// db-06 — Prove the sandbox boundary.
//
// db-05 BUILT the boundary; this file proves it holds, and proves WHICH
// gate holds each probe. A test that only asserts "the write was refused"
// is satisfied by a keyword filter in a tool wrapper, by a typo in a table
// name, or by a role that lost its grants for an unrelated reason — three
// green outcomes that describe three different systems. So every refusal
// here is attributed to exactly one of the four layers the sandbox is made
// of, and the attribution is checked against that layer's own SQLSTATE and
// wording:
//
//   role grant                      42501 — what the roles were never granted
//   default_transaction_read_only   25006 — the ro ROLE's server-side default
//   read-only transaction           25006 — opsdb.ts's explicit SET wrapper
//   the CONNECT revoke              FATAL — REVOKE CONNECT ON DATABASE
//
// "role grant" covers two different withholdings, and they are not the same
// kind of thing. EXECUTE on pg_read_file is withheld by initdb itself and
// simply never granted to the sandbox roles — Servo ships no REVOKE for it,
// and the honest claim is that the roles never get it, not that Servo takes
// it away. TEMPORARY is the opposite: PUBLIC has it by default and
// scripts/postgres-init.sql revokes it. Both surface as 42501; only the
// second is a gate this repository installs.
//
// The two 25006 layers share a message, so they are separated by CONSTRUCTION
// rather than by text: the role default is probed on a connection that issues
// no SET at all, and the transaction wrapper is probed through the real
// opsSelect() adapter pointed at the *rw* role — the "even if the role
// default were somehow lifted" case src/lib/opsdb.ts claims to cover. If a
// regression removes one of them the other still refuses, and the failure
// message names the one that fell.
//
// Everything runs against the throwaway test cluster (db-02): the sandbox is
// servo_test_ops, and the "desk" is a real tmpDb() clone carrying real
// Ticket rows — because the last criterion is that the desk is UNREACHABLE,
// not merely empty, and only a populated database can tell those apart.

import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { testDatabaseUrl, tmpDb, urlForDatabase, type TmpDb } from "./helpers/tmp-db";
import { pointOpsEnv, OPS_RO_URL, OPS_RW_URL } from "./setup/ops-sandbox";

/** The four gates the sandbox is made of. A refusal belongs to exactly one. */
type Layer =
  | "role grant"
  | "default_transaction_read_only"
  | "read-only transaction"
  | "the CONNECT revoke";

/**
 * What each layer says when it refuses. Keyed on SQLSTATE where there is
 * one — the codes are Postgres's own vocabulary and survive translation and
 * rewording, which the English text does not.
 *
 * `role grant` deliberately excludes the database-level denial: a CONNECT
 * refusal is also "permission denied", and letting it satisfy the role-grant
 * signature would let the wrong gate answer for the right one.
 */
const SIGNATURE: Record<Layer, { must: RegExp[]; mustNot: RegExp[] }> = {
  "role grant": {
    must: [/42501/, /permission denied (for|to)/i],
    mustNot: [/permission denied for database/i],
  },
  default_transaction_read_only: {
    must: [/25006/, /cannot execute .+ in a read-only transaction/i],
    mustNot: [],
  },
  "read-only transaction": {
    must: [/25006/, /cannot execute .+ in a read-only transaction/i],
    mustNot: [],
  },
  "the CONNECT revoke": {
    must: [/permission denied for database/i, /CONNECT privilege/i],
    mustNot: [/does not exist/i],
  },
};

/**
 * Run `attempt`; require that it was refused, and that it was refused BY
 * `layer`. Three distinct failures, each naming the layer:
 *
 *   - it succeeded            → the boundary is open, and this names the gate
 *                               that was supposed to be shut
 *   - it failed for a reason  → the probe never reached the gate (a typo, a
 *     that is not a refusal     missing column); a green here would be a lie
 *   - it was refused by a     → a regression moved the boundary; the message
 *     DIFFERENT layer           prints what the server actually said
 *
 * The last two share a template; what separates them in practice is the
 * server text the message carries.
 */
async function refusedBy(layer: Layer, what: string, attempt: () => Promise<unknown>): Promise<string> {
  let caught: unknown;
  try {
    await attempt();
  } catch (err) {
    caught = err;
  }
  if (caught === undefined) {
    throw new Error(
      `SANDBOX BOUNDARY OPEN — ${what} SUCCEEDED. It should have been refused by ${layer}.`,
    );
  }
  const message = (caught instanceof Error ? caught.message : String(caught)).replace(/\s+/g, " ");
  const sig = SIGNATURE[layer];
  for (const rx of sig.must) {
    if (!rx.test(message)) {
      throw new Error(
        `${what} was refused, but NOT by ${layer} — that gate did not answer.\n` +
          `  expected the ${layer} signature ${rx}\n  server said: ${message}`,
      );
    }
  }
  for (const rx of sig.mustNot) {
    if (rx.test(message)) {
      throw new Error(
        `${what} was refused, but the refusal is not ${layer}'s — it matched ${rx}.\n` +
          `  server said: ${message}`,
      );
    }
  }
  return message;
}

/** A client on the sandbox as one of the two roles. */
function opsClient(url: string): PrismaClient {
  return new PrismaClient({
    datasourceUrl: url.includes("connection_limit") ? url : `${url}&connection_limit=1`,
  });
}

/** The maintenance connection on the test cluster's `postgres` database. */
function adminClient(): PrismaClient {
  const url = new URL(testDatabaseUrl());
  url.searchParams.set("connection_limit", "2");
  return new PrismaClient({ datasourceUrl: url.toString() });
}

/** The same URL, re-credentialled as `role`. */
function asRole(url: string, role: string): string {
  const u = new URL(url);
  u.username = role;
  u.password = role;
  u.searchParams.set("connection_limit", "1");
  return u.toString();
}

const READ_PATH_PROBES = {
  insert: `INSERT INTO employees (name, email, department, title) VALUES ('probe','probe@example.test','probe','probe')`,
  // The shape a keyword filter has to get right and a read-only transaction
  // does not have to think about: the statement OPENS with a harmless WITH.
  cteDelete: `WITH x AS (SELECT 1) DELETE FROM employees WHERE name = 'no-such-row-db-06'`,
  createTemp: `CREATE TEMP TABLE db06_probe (a int)`,
  // Server-side file read: the agent's route out of the database entirely.
  readFile: `SELECT * FROM pg_read_file('postgresql.conf')`,
} as const;

let ro: PrismaClient;
let rw: PrismaClient;

beforeAll(async () => {
  await pointOpsEnv();
  const { opsDisconnect } = await import("@/lib/opsdb");
  await opsDisconnect();
  const { ensureOpsSchema } = await import("@/lib/bootstrap");
  try {
    await ensureOpsSchema();
  } catch {
    // servo_test_ops is shared by the whole run, so two files can race the
    // same CREATE TABLE IF NOT EXISTS. One retry settles it; a second
    // failure is real and this rethrows it.
    await new Promise((r) => setTimeout(r, 500));
    await ensureOpsSchema();
  }
  ro = opsClient(OPS_RO_URL);
  rw = opsClient(OPS_RW_URL);
}, 120_000);

afterAll(async () => {
  const { opsDisconnect } = await import("@/lib/opsdb");
  await opsDisconnect();
  await ro?.$disconnect();
  await rw?.$disconnect();
});

describe("the gates proved below are the gates a real install ships", () => {
  // The tests in this file observe the boundary on the throwaway cluster,
  // where tests/setup/ops-sandbox.ts builds the roles and revokes the way
  // scripts/postgres-init.sql builds them on a fresh volume. That is the
  // right fixture and the wrong proof on its own: it means the file would
  // stay green if a gate were deleted from the SHIPPED install, because the
  // fixture would keep re-creating it. Each behavioural gate below is
  // therefore also pinned to the statement that installs it. These are text
  // assertions over the init file, deliberately — they cover the one thing a
  // probe against the test cluster structurally cannot.
  const initSql = () => readFileSync("scripts/postgres-init.sql", "utf8");

  it("the install sets default_transaction_read_only on the ro role", () => {
    expect(initSql(), "postgres-init.sql carries the ALTER ROLE the ro probes rely on").toMatch(
      /ALTER\s+ROLE\s+servo_ops_ro\s+SET\s+default_transaction_read_only\s*=\s*on\s*;/i,
    );
  });

  it("the install revokes TEMPORARY on the sandbox from PUBLIC", () => {
    expect(initSql(), "postgres-init.sql carries the REVOKE TEMPORARY the temp-table probe relies on").toMatch(
      /REVOKE\s+TEMPORARY\s+ON\s+DATABASE\s+servo_ops\s+FROM\s+PUBLIC\s*;/i,
    );
  });

  it("the install revokes CONNECT on the desk from PUBLIC and from both sandbox roles", () => {
    for (const grantee of ["PUBLIC", "servo_ops_rw", "servo_ops_ro"]) {
      expect(initSql(), `postgres-init.sql revokes CONNECT on the desk from ${grantee}`).toMatch(
        new RegExp(`REVOKE\\s+CONNECT\\s+ON\\s+DATABASE\\s+servo\\s+FROM\\s+${grantee}\\s*;`, "i"),
      );
    }
  });

  it("the install never GRANTs the sandbox roles server-file access", () => {
    // The fourth gate is the one Servo does not install: EXECUTE on
    // pg_read_file is initdb's own default, withheld from PUBLIC. There is
    // no REVOKE to pin, so what is pinned is that nothing hands it over.
    expect(initSql(), "postgres-init.sql grants no file-read privilege to the sandbox roles").not.toMatch(
      /GRANT[\s\S]{0,120}(pg_read_file|pg_read_server_files|pg_execute_server_program)/i,
    );
  });
});

describe("the two read-only layers are distinct, not one layer counted twice", () => {
  it("the ro role carries default_transaction_read_only = on; the rw role does not", async () => {
    const roSetting = (await ro.$queryRawUnsafe(
      `SHOW default_transaction_read_only`,
    )) as { default_transaction_read_only: string }[];
    const rwSetting = (await rw.$queryRawUnsafe(
      `SHOW default_transaction_read_only`,
    )) as { default_transaction_read_only: string }[];

    // This is what makes the attribution below honest: a refusal on the ro
    // connection with no SET issued can only be the ROLE default, and a
    // refusal on the rw connection inside an explicit wrapper can only be
    // the TRANSACTION.
    expect(roSetting[0].default_transaction_read_only, "the ro role's server-side default").toBe("on");
    expect(rwSetting[0].default_transaction_read_only, "the rw role's server-side default").toBe("off");
  }, 30_000);
});

describe("the read path: every mutation and every file read is refused", () => {
  // No BEGIN, no SET TRANSACTION READ ONLY anywhere in this block. Each
  // statement is issued bare on the ro connection, so whatever refuses it
  // is the ROLE's own configuration — the layer that still holds if
  // opsdb.ts's wrapper is ever dropped.

  it("an INSERT is refused by default_transaction_read_only", async () => {
    await refusedBy(
      "default_transaction_read_only",
      "an INSERT on the read path",
      () => ro.$queryRawUnsafe(READ_PATH_PROBES.insert),
    );
  }, 30_000);

  it("a CTE-smuggled DELETE is refused by default_transaction_read_only", async () => {
    const message = await refusedBy(
      "default_transaction_read_only",
      "a CTE-smuggled DELETE on the read path",
      () => ro.$queryRawUnsafe(READ_PATH_PROBES.cteDelete),
    );
    // The server names DELETE even though the statement opens with WITH —
    // the proof that the refusal is semantic, not textual.
    expect(message, "the server refused the DELETE itself, not the word it starts with").toMatch(
      /cannot execute DELETE in a read-only transaction/i,
    );
  }, 30_000);

  it("CREATE TEMP TABLE is refused by default_transaction_read_only", async () => {
    await refusedBy(
      "default_transaction_read_only",
      "CREATE TEMP TABLE on the read path",
      () => ro.$queryRawUnsafe(READ_PATH_PROBES.createTemp),
    );
  }, 30_000);

  it("SELECT ... FROM pg_read_file('...') is refused by the role grant", async () => {
    const message = await refusedBy(
      "role grant",
      "pg_read_file on the read path",
      () => ro.$queryRawUnsafe(READ_PATH_PROBES.readFile),
    );
    expect(message, "the refusal names the function, so the gate is EXECUTE on pg_read_file").toMatch(
      /permission denied for function pg_read_file/i,
    );
  }, 30_000);

  it("the read path still READS — the four refusals are the boundary, not a broken connection", async () => {
    // A row written through the rw path and read back through the ro one.
    // Asserting merely that a count is >= 0 would pass against any database
    // in any state; this passes only if the ro role can actually see data
    // the sandbox holds.
    const { opsExecute } = await import("@/lib/opsdb");
    const marker = `db06-read-${process.pid}@example.test`;
    await opsExecute(`DELETE FROM employees_backup WHERE email = $1`, [marker]);
    await opsExecute(
      `INSERT INTO employees_backup (name, email, department, title) VALUES ($1, $2, $3, $4)`,
      ["db-06 read probe", marker, "probe", "probe"],
    );
    try {
      const rows = (await ro.$queryRawUnsafe(
        `SELECT name FROM employees_backup WHERE email = $1`,
        marker,
      )) as { name: string }[];
      expect(rows.map((r) => r.name), "the ro role reads real rows; only writes and file reads are refused").toEqual([
        "db-06 read probe",
      ]);
    } finally {
      await opsExecute(`DELETE FROM employees_backup WHERE email = $1`, [marker]);
    }
  }, 30_000);

  it("and the same four probes are refused through the REAL read path — opsSelect() on the ro role", async () => {
    // The production combination: src/lib/opsdb.ts's opsSelect() against
    // OPS_DATABASE_READONLY_URL as an operator configures it. Both read-only
    // layers are live here, so the attribution names the wrapper — which is
    // sufficient on its own, as the rw-role block below proves separately.
    const { opsSelect } = await import("@/lib/opsdb");
    for (const [name, sql] of Object.entries(READ_PATH_PROBES)) {
      const layer: Layer = name === "readFile" ? "role grant" : "read-only transaction";
      await refusedBy(layer, `${name} through opsSelect() on the ro role`, () => opsSelect(sql));
    }
  }, 60_000);
});

describe("the read-only TRANSACTION holds on its own, with the role default lifted", () => {
  // opsdb.ts wraps every read in `SET TRANSACTION READ ONLY` and calls it
  // "belt to the ro role's default_transaction_read_only braces … so a
  // mutation fails at the server even if the role default was somehow
  // lifted". These tests lift it — by running the REAL opsSelect() adapter
  // against the rw role, whose default is off — and hold the claim to it.

  const withReadPathOn = async <T>(url: string, fn: () => Promise<T>): Promise<T> => {
    const { opsDisconnect } = await import("@/lib/opsdb");
    const previous = process.env.OPS_DATABASE_READONLY_URL;
    process.env.OPS_DATABASE_READONLY_URL = url;
    await opsDisconnect();
    try {
      return await fn();
    } finally {
      process.env.OPS_DATABASE_READONLY_URL = previous;
      await opsDisconnect();
    }
  };

  it("the rw role writes when nothing wraps it — so the refusals below are the wrapper's", async () => {
    const { opsExecute } = await import("@/lib/opsdb");
    const marker = `db06-${process.pid}@example.test`;
    await opsExecute(`DELETE FROM employees_backup WHERE email = $1`, [marker]);
    const inserted = await opsExecute(
      `INSERT INTO employees_backup (name, email, department, title) VALUES ($1, $2, $3, $4)`,
      ["db-06 probe", marker, "probe", "probe"],
    );
    expect(inserted, "the rw role is genuinely able to write").toBe(1);
    await opsExecute(`DELETE FROM employees_backup WHERE email = $1`, [marker]);
  }, 30_000);

  it("through the real opsSelect(), an INSERT and a CTE-smuggled DELETE are refused by the read-only transaction", async () => {
    await withReadPathOn(OPS_RW_URL, async () => {
      const { opsSelect } = await import("@/lib/opsdb");
      await refusedBy(
        "read-only transaction",
        "an INSERT through opsSelect() with the role default lifted",
        () => opsSelect(READ_PATH_PROBES.insert),
      );
      await refusedBy(
        "read-only transaction",
        "a CTE-smuggled DELETE through opsSelect() with the role default lifted",
        () => opsSelect(READ_PATH_PROBES.cteDelete),
      );
      await refusedBy(
        "read-only transaction",
        "CREATE TEMP TABLE through opsSelect() with the role default lifted",
        () => opsSelect(READ_PATH_PROBES.createTemp),
      );
    });
  }, 60_000);

  it("through the real opsSelect(), pg_read_file is refused by the role grant on the rw role too", async () => {
    await withReadPathOn(OPS_RW_URL, async () => {
      const { opsSelect } = await import("@/lib/opsdb");
      await refusedBy(
        "role grant",
        "pg_read_file through opsSelect() on the rw role",
        () => opsSelect(READ_PATH_PROBES.readFile),
      );
    });
  }, 60_000);

  it("CREATE TEMP TABLE is refused on the WRITE path too — by the role grant, with no transaction involved", async () => {
    // The REVOKE TEMPORARY layer, isolated: outside any read-only wrapper
    // the rw role may write to its tables and still may not make a scratch
    // one. Inside a read-only transaction the 25006 check fires first, so
    // this is the only place that gate can be seen answering.
    const message = await refusedBy(
      "role grant",
      "CREATE TEMP TABLE on the write path",
      () => rw.$queryRawUnsafe(READ_PATH_PROBES.createTemp),
    );
    expect(message, "the refusal names temporary tables, so the gate is REVOKE TEMPORARY").toMatch(
      /permission denied to create temporary tables/i,
    );
  }, 30_000);
});

describe("the desk database is UNREACHABLE from the sandbox, not merely empty", () => {
  let desk: TmpDb;

  beforeAll(async () => {
    desk = await tmpDb();
    // A REAL desk: a requester and a ticket, so "no rows" and "no access"
    // cannot be confused for one another. Without this the whole criterion
    // is satisfied by an empty database, which proves nothing at all.
    const requester = await desk.client.user.create({
      data: { name: "db-06 requester", email: `db06-${Date.now()}@example.test`, role: "REQUESTER" },
    });
    await desk.client.ticket.create({
      data: {
        number: 60_601,
        title: "db-06 — the row that proves the desk is not empty",
        description: "If the sandbox roles could connect, they would see this row.",
        requesterId: requester.id,
        category: "DATABASE",
      },
    });

    // The same revokes scripts/postgres-init.sql issues against `servo`,
    // applied to this clone the way an upgraded install applies them by
    // hand. A fresh database hands PUBLIC its default CONNECT, so the
    // PUBLIC revoke is the one that does the work; the per-role revokes
    // follow the init file literally.
    const admin = adminClient();
    try {
      await admin.$executeRawUnsafe(`REVOKE CONNECT ON DATABASE ${desk.dbName} FROM PUBLIC`);
      await admin.$executeRawUnsafe(`REVOKE CONNECT ON DATABASE ${desk.dbName} FROM servo_ops_rw`);
      await admin.$executeRawUnsafe(`REVOKE CONNECT ON DATABASE ${desk.dbName} FROM servo_ops_ro`);
    } finally {
      await admin.$disconnect();
    }
  }, 120_000);

  afterAll(async () => {
    await desk?.dispose();
  });

  for (const role of ["servo_ops_ro", "servo_ops_rw"] as const) {
    it(`SELECT * FROM "Ticket" as ${role} fails at CONNECT, not at the table`, async () => {
      const client = new PrismaClient({ datasourceUrl: asRole(urlForDatabase(desk.dbName), role) });
      try {
        const message = await refusedBy(
          "the CONNECT revoke",
          `SELECT * FROM "Ticket" as ${role}`,
          () => client.$queryRawUnsafe(`SELECT * FROM "Ticket"`),
        );
        // The distinction the criterion turns on, stated twice: the refusal
        // is about the DATABASE, and it is not about the table.
        expect(message, "refused at the database, before any table was consulted").toMatch(
          /permission denied for database/i,
        );
        expect(message, "NOT the 'relation does not exist' answer an empty database gives").not.toMatch(
          /relation .* does not exist/i,
        );
      } finally {
        await client.$disconnect();
      }
    }, 60_000);
  }

  it("and the Ticket the roles cannot see is still there — 'unreachable', never 'empty'", async () => {
    const rows = (await desk.client.$queryRawUnsafe(
      `SELECT count(*)::int AS n FROM "Ticket"`,
    )) as { n: number }[];
    expect(rows[0].n, "the desk still holds the row both sandbox roles were refused").toBeGreaterThan(0);
  }, 30_000);
});
