// The ops sandbox (spec db-05): a SEPARATE Postgres database the AI
// agents operate on via the SQL tools, behind two dedicated roles —
// servo_ops_ro for every read (with default_transaction_read_only at the
// server AND an explicit SET TRANSACTION READ ONLY in every read call),
// servo_ops_rw for the gated mutating tool. It is intentionally separate
// from Servo's own database so an agent can run DDL/DML without touching
// ticket data. In a real deployment these URLs point at the customer's
// actual databases.
//
// Read-only is enforced by the ROLE and the TRANSACTION, not just keyword
// filtering: a smuggled mutation (e.g. "WITH x AS (...) DELETE ...") fails
// at the server with "cannot execute DELETE in a read-only transaction"
// no matter how the statement is spelled — the keyword checks in the
// tools remain a first-line courtesy only.

import { PrismaClient } from "@prisma/client";

function withLimit(url: string): string {
  return url.includes("connection_limit") ? url : url + (url.includes("?") ? "&" : "?") + "connection_limit=4";
}

function opsUrl(): string {
  const url = process.env.OPS_DATABASE_URL;
  if (!url) {
    throw new Error(
      "OPS_DATABASE_URL is not set — the ops sandbox is a Postgres database as of db-05 " +
        "(docker compose sets it; see scripts/postgres-init.sql for what creates it).",
    );
  }
  return url;
}

function readOnlyUrl(): string {
  // The ro role is the default read path; OPS_DATABASE_READONLY_URL lets
  // an operator point reads elsewhere (a replica) without moving writes.
  return process.env.OPS_DATABASE_READONLY_URL ?? opsUrl();
}

// Pooled, module-level: the SQLite-era one-connection-at-a-time constraint
// rode PRAGMA query_only, which Postgres does not have. Two clients, one
// per role.
const globalForOps = globalThis as unknown as {
  opsRead?: PrismaClient;
  opsWrite?: PrismaClient;
};

function readClient(): PrismaClient {
  globalForOps.opsRead ??= new PrismaClient({ datasourceUrl: withLimit(readOnlyUrl()) });
  return globalForOps.opsRead;
}

function writeClient(): PrismaClient {
  globalForOps.opsWrite ??= new PrismaClient({ datasourceUrl: withLimit(opsUrl()) });
  return globalForOps.opsWrite;
}

/**
 * One read-only query. The statement runs INSIDE a transaction that is
 * explicitly read-only — belt to the ro role's default_transaction_read_only
 * braces — so a mutation fails at the server even if the role default was
 * somehow lifted.
 */
export async function opsSelect(sql: string, params: unknown[] = []): Promise<unknown[]> {
  const client = readClient();
  return client.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      return ((await tx.$queryRawUnsafe(sql, ...params)) ?? []) as unknown[];
    },
    { timeout: 15_000 },
  );
}

/** Run a mutating statement against the ops database (rw role). Returns
 *  affected rows. */
export async function opsExecute(sql: string, params: unknown[] = []): Promise<number> {
  const client = writeClient();
  return client.$executeRawUnsafe(sql, ...params);
}

/** Disconnect both pooled clients (tests and shutdown). */
export async function opsDisconnect(): Promise<void> {
  if (globalForOps.opsRead) {
    await globalForOps.opsRead.$disconnect();
    delete globalForOps.opsRead;
  }
  if (globalForOps.opsWrite) {
    await globalForOps.opsWrite.$disconnect();
    delete globalForOps.opsWrite;
  }
}
