import { PrismaClient } from "@prisma/client";

// The "ops" database is the sandbox AI agents operate on through the sql
// tools: a SEPARATE PostgreSQL database (`servo_ops`) on the same server as
// the desk, reached through two dedicated login roles. It is deliberately not
// a schema inside the desk database — Postgres has no cross-database query
// without dblink/postgres_fdw, neither of which is installed, so a smuggled
// `SELECT * FROM "Ticket"` on this connection fails at the catalog instead of
// depending on GRANT hygiene staying right forever. scripts/postgres-init.sql
// creates the database, the roles and the revokes, and this module refuses to
// act on a database that turns out to carry Servo's own tables.
//
// It rides @prisma/client rather than a second driver: the query engine
// already speaks Postgres, `datasourceUrl` binds a client to an arbitrary
// connection string, and $queryRawUnsafe/$executeRawUnsafe carry parameterised
// SQL — so the sandbox costs no new runtime dependency (db-05 adopt-first).

/**
 * "What tables exist here?" — the first thing an agent asks the sandbox, and
 * the one statement the mock provider, the demo seed and the written
 * procedures all quote. It lives here so those four copies cannot drift.
 */
export const OPS_SCHEMA_QUERY =
  "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;";

/** The read-write endpoint: DDL and DML from execute_ops_sql. */
function writeUrl(): string {
  return required(process.env.OPS_DATABASE_URL, "OPS_DATABASE_URL");
}

/**
 * The read endpoint. OPS_DATABASE_READONLY_URL is the servo_ops_ro role,
 * which holds SELECT and nothing else and whose sessions start
 * `default_transaction_read_only`. An install that has not configured it
 * falls back to the read-write role and is still protected by the read-only
 * transaction in opsSelect() below — which is the guarantee, because the
 * session default is only a starting value a statement can clear for itself.
 */
function readUrl(): string {
  const readonly = process.env.OPS_DATABASE_READONLY_URL?.trim();
  return readonly ? required(readonly, "OPS_DATABASE_READONLY_URL") : writeUrl();
}

/** Which variable the read endpoint came from, for the refusal message. */
function readUrlName(): string {
  return process.env.OPS_DATABASE_READONLY_URL?.trim()
    ? "OPS_DATABASE_READONLY_URL"
    : "OPS_DATABASE_URL";
}

/**
 * A missing or still-SQLite URL is a configuration error, not a query error:
 * failing here names the variable and the guide, where letting it through
 * would surface as an unreadable driver message inside a tool result.
 */
function required(value: string | undefined, name: string): string {
  const url = value?.trim() ?? "";
  if (url === "") {
    throw new Error(
      `${name} is not set — the ops sandbox needs a PostgreSQL URL (see docs/migrating-to-postgres.md).`,
    );
  }
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(url)?.[1] ?? "";
  // The scheme alone, never a prefix of the URL: a length-based slice of a
  // rejected URL would put part of a password into a tool result.
  if (!/^postgres(ql)?$/i.test(scheme)) {
    throw new Error(
      `${name} is not a PostgreSQL URL (scheme "${scheme || "none"}") — the ops sandbox moved to PostgreSQL (see docs/migrating-to-postgres.md).`,
    );
  }
  if (looksLikeTheDesk(url)) throw deskError(name);
  return url;
}

/**
 * A quick, best-effort look at whether two URLs obviously name one database.
 *
 * It is a FAST FAIL, not the check: it catches the paste this guard exists
 * for before a connection is opened, and it is easy to write a URL it does
 * not see through (a `?host=` parameter, a socket path, two names for one
 * host, `0.0.0.0`). The authoritative check is assertSandbox() below, which
 * asks the database the driver ACTUALLY reached rather than reasoning about
 * the string that was meant to reach it.
 */
function identity(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (!/^postgres(ql)?:$/i.test(parsed.protocol)) return null;
    const database =
      decodeURIComponent(parsed.pathname).replace(/^\/+/, "").replace(/\/+$/, "");
    if (database === "") return null;
    return `${parsed.hostname.toLowerCase()}:${parsed.port || "5432"}/${database}`;
  } catch {
    return null;
  }
}

/**
 * The sandbox may never be Servo's own database.
 *
 * Without this, an install that pastes DATABASE_URL into OPS_DATABASE_URL —
 * an easy mistake now that the Docker image ships no default — hands the
 * agent's SQL tools the ticket tables, and `ensureOpsSchema()` would GRANT
 * the read role CONNECT and SELECT on them, undoing the very revoke
 * scripts/postgres-init.sql exists to make.
 *
 * This half only compares the two strings, so it is a hint. It runs first
 * because refusing before dialling gives a better message than refusing
 * after; being defeated by an unusual spelling costs nothing, because the
 * probe on the connection catches the same case.
 */
function looksLikeTheDesk(url: string): boolean {
  const desk = identity(process.env.DATABASE_URL ?? "");
  return desk !== null && identity(url) === desk;
}

// One pooled client per endpoint, built on demand and re-checked on every
// call so a changed environment yields a client bound to the new URL rather
// than a stale one. Nothing connects at import time: `npm run build` and the
// unit tests must not need a database.
const clients = new Map<string, PrismaClient>();

function clientFor(url: string): PrismaClient {
  const existing = clients.get(url);
  if (existing) return existing;
  const client = new PrismaClient({ datasourceUrl: url });
  clients.set(url, client);
  return client;
}

/** The one refusal, so both halves of the check read the same. */
function deskError(name: string): Error {
  return new Error(
    `${name} points at Servo's own database — the ops sandbox must be a separate database (see docs/migrating-to-postgres.md).`,
  );
}

/** URLs already proven to reach a database that is not the desk. */
const proven = new Set<string>();

/**
 * Ask the database the driver ACTUALLY reached whether it is Servo's own.
 *
 * This is the check the string comparison above only approximates, and it is
 * the one that holds: a connection string can spell the same endpoint a
 * dozen ways — a `?host=` parameter, a repeated `?host=`, `0.0.0.0`, a unix
 * socket path, an omitted database, a second DNS name — and no amount of
 * parsing settles where the driver will land. The catalog does. If the
 * tables Servo's own schema creates are here, this is not a sandbox.
 *
 * Once per URL: the answer cannot change without a migration, and every ops
 * call would otherwise pay a round trip for it.
 */
async function assertSandbox(client: PrismaClient, url: string, name: string): Promise<void> {
  if (proven.has(url)) return;
  const rows = await client.$queryRawUnsafe<{ n: number }[]>(
    `SELECT count(*)::int AS n FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name IN ('Ticket', 'AgentRun', 'Approval')`,
  );
  if (rows[0].n > 0) throw deskError(name);
  proven.add(url);
}

/** The checked client for one endpoint: refused before the query, not after. */
async function opsClient(url: string, name: string): Promise<PrismaClient> {
  const client = clientFor(url);
  await assertSandbox(client, url, name);
  return client;
}

/**
 * Run a read-only query against the ops database.
 *
 * Two layers, both server-side. The connection is the `servo_ops_ro` role
 * when one is configured, whose grants are SELECT and nothing else; and the
 * statement ALWAYS runs inside `BEGIN … SET TRANSACTION READ ONLY`, so a
 * smuggled mutation (`WITH x AS (DELETE …) SELECT …`) is refused with
 * SQLSTATE 25006 even on an install that only configured the read-write URL.
 * SET TRANSACTION is per-transaction and issued first, so it holds whatever a
 * previous statement did to the session's own defaults. The keyword checks in
 * the tools are a courtesy on top of these, not the enforcement.
 *
 * `params` bind as $1…$n; callers never interpolate user input into `sql`.
 */
export async function opsSelect(sql: string, params: unknown[] = []): Promise<unknown[]> {
  const url = readUrl();
  const client = await opsClient(url, readUrlName());
  return client.$transaction(
    async (tx) => {
      // First statement in the transaction: Postgres rejects SET TRANSACTION
      // once the transaction has done any work, and Prisma issues a bare BEGIN
      // when no isolation level is passed.
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      return (await tx.$queryRawUnsafe(sql, ...params)) as unknown[];
    },
    // Stated, not inherited. Prisma's interactive-transaction default is 5s,
    // which the read path never had before it needed a transaction — an
    // aggregate over the sandbox would start failing on a clock rather than
    // on anything about the query. The mutating tool has no such ceiling, so
    // a default here would cap reads more tightly than writes.
    { timeout: OPS_READ_TIMEOUT_MS, maxWait: OPS_READ_MAX_WAIT_MS },
  );
}

/** How long one sandbox read may run, and how long it may wait for a
 *  connection. Generous: the gate on this tool is that it cannot write. */
const OPS_READ_TIMEOUT_MS = 30_000;
const OPS_READ_MAX_WAIT_MS = 10_000;

/** Run a mutating statement against the ops database. Returns affected rows. */
export async function opsExecute(sql: string, params: unknown[] = []): Promise<number> {
  const client = await opsClient(writeUrl(), "OPS_DATABASE_URL");
  return client.$executeRawUnsafe(sql, ...params);
}

/** Release every pooled ops connection. For seeds and tests, not for requests. */
export async function opsDisconnect(): Promise<void> {
  const open = [...clients.values()];
  clients.clear();
  proven.clear();
  await Promise.all(open.map((client) => client.$disconnect()));
}
