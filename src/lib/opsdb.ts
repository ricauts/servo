import { DatabaseSync } from "node:sqlite";
import path from "path";

// The "ops" database is a sandboxed SQLite file that AI agents operate on via
// the sql tools. It is intentionally separate from Servo's own database so an
// agent can run DDL/DML without touching ticket data. In a real deployment
// this adapter would point at the customer's actual database.
//
// It stays SQLite through the PostgreSQL cutover (spec §3.3: the sandbox is
// out of scope and may remain SQLite) — which is why it rides Node's built-in
// SQLite driver instead of Prisma: one generated client cannot speak two
// dialects, and the app's client is Postgres now. db-05 replaces this backend
// with dedicated Postgres roles on a separate database.
const opsPath = (
  process.env.OPS_DATABASE_URL ??
  "file:" + path.join(process.cwd(), "prisma", "ops.db").replace(/\\/g, "/")
).replace(/^file:/, "");

function open(): DatabaseSync {
  return new DatabaseSync(opsPath);
}

/**
 * Run a read-only query against the ops database. Reads open their own
 * connection with PRAGMA query_only set at the SQLite level, so a smuggled
 * mutation (e.g. "WITH x AS (...) DELETE ...") fails at the driver with
 * "attempt to write a readonly database" no matter how the statement is
 * spelled — keyword checks in the tools are only a first-line courtesy.
 */
export async function opsSelect(sql: string): Promise<unknown[]> {
  const db = open();
  try {
    db.exec("PRAGMA query_only = ON;");
    return db.prepare(sql).all() as unknown[];
  } finally {
    db.close();
  }
}

/** Run a mutating statement against the ops database. Returns affected rows. */
export async function opsExecute(sql: string): Promise<number> {
  const db = open();
  try {
    return Number(db.prepare(sql).run().changes);
  } finally {
    db.close();
  }
}
