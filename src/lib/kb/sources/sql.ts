// The external SQL crawler (xds-04): a second PrismaClient over
// Servo-composed SQL, one Document per row. NO NEW SQL DRIVER —
// package.json gains nothing. The SHAPE precedent is src/lib/opsdb.ts,
// but the situations differ and the comment there deserves the
// correction: today's opsdb is a SQLite-era client pinned with PRAGMA
// query_only (its Postgres role work is db-05's), and it is db-05 that
// establishes the Postgres read-only-ROLE pattern this module reuses —
// default_transaction_read_only on the role, SET TRANSACTION READ ONLY
// on every statement.
//
// THE COMPOSITION RULE, absolute: identifiers come from the SCOPE ENTRY
// and are double-quoted with embedded quotes rejected; columns are
// restricted to the scope's textColumns + idColumn + titleColumn +
// updatedAtColumn; the cursor is a bound parameter, never interpolated.
// No string from a model, a ticket, an admin form or a URL reaches a
// statement — and a `where` key cannot even be expressed, because the
// catalog CHECK (xds-01) refuses it at save; the only supported way to
// express a predicate is a VIEW, which is crawled identically to a table.
//
// assertNotServoDatabase runs again AT CRAWL TIME — a source edited to
// point at DATABASE_URL after creation is refused before it connects.

import { PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import { assertNotServoDatabase, SourceConfigError, type PostgresTarget } from "@/lib/kb/sources";

/** The exact least-privilege text an operator creates the read-only role
 *  with — shipped as a constant because xds-09's source-detail page
 *  renders this verbatim and a hand-typed copy would drift. */
export const READ_ONLY_ROLE_SQL = `CREATE ROLE servo_ext_ro LOGIN PASSWORD '<choose-a-secret>';
ALTER ROLE servo_ext_ro SET default_transaction_read_only = on;
GRANT CONNECT ON DATABASE your_db TO servo_ext_ro;
GRANT USAGE ON SCHEMA your_schema TO servo_ext_ro;
GRANT SELECT ON your_schema.your_table TO servo_ext_ro;`;

/** One scope entry, as the catalog CHECK (xds-01) admits it. */
export interface SqlScopeEntry {
  schema: string;
  table: string;
  idColumn: string;
  textColumns: string[];
  titleColumn: string;
  updatedAtColumn: string;
}

/** An identifier we will double-quote: any embedded quote is refused
 *  outright, because the only way one arrives is a forged scope entry. */
function ident(name: string, where: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || name.includes('"')) {
    throw new SourceConfigError(
      `"${name}" is not a plain identifier (${where}) — identifiers come from the scope entry and are quoted, never interpolated.`,
      where,
    );
  }
  return `"${name}"`;
}

export interface CrawledRow {
  externalId: string;
  name: string;
  /** The rendered "col = value" text, one per line — the chunk body. */
  text: string;
  /** sha256 of the rendered text — the row's version. */
  version: string;
}

/**
 * Compose ONE statement for a scope entry under an exclusive cursor.
 * SELECT-list is exactly the scope's columns; ORDER BY the id column so
 * the cursor pagination is deterministic; the cursor binds as $1.
 */
export function composeStatement(scope: SqlScopeEntry, cursor: string | null, limit: number): { sql: string; params: string[] } {
  const cols = [scope.idColumn, scope.titleColumn, scope.updatedAtColumn, ...scope.textColumns];
  const select = cols.map((c) => ident(c, "scope.textColumns")).join(", ");
  const from = `${ident(scope.schema, "scope.schema")}.${ident(scope.table, "scope.table")}`;
  const idCol = ident(scope.idColumn, "scope.idColumn");
  const where = cursor === null ? "" : `WHERE ${idCol} > $1`;
  const params = cursor === null ? [] : [cursor];
  // The READ-ONLY posture is the ROLE's default_transaction_read_only —
  // a prepared statement cannot carry BEGIN (Postgres refuses multiple
  // commands), and the role-level setting covers every statement the
  // session issues without one. The statement itself stays a single
  // SELECT: identifiers quoted, cursor bound, ORDER BY the id column.
  void select;
  return {
    sql: `SELECT ${select} FROM ${from} ${where} ORDER BY ${idCol} ASC LIMIT ${limit}`,
    params,
  };
}

/** Render one crawled row to its document text + version hash. */
export function renderRow(scope: SqlScopeEntry, row: Record<string, unknown>): CrawledRow {
  const lines: string[] = [];
  for (const col of [scope.titleColumn, ...scope.textColumns, scope.updatedAtColumn]) {
    const value = row[col];
    lines.push(`${col} = ${value === null || value === undefined ? "" : String(value)}`);
  }
  const text = lines.join("\n");
  return {
    externalId: String(row[scope.idColumn]),
    name: String(row[scope.titleColumn] ?? row[scope.idColumn]),
    text,
    version: createHash("sha256").update(text).digest("hex"),
  };
}

export interface SqlCrawlResult {
  rows: CrawledRow[];
  /** True when the count hit maxRows — the caller lands ERROR. */
  overCap: boolean;
}

/**
 * Crawl ONE scope entry of a POSTGRES source: page by the id cursor,
 * render each row, stop at maxRows with the over-cap flag set. The
 * statement is composed here; the caller owns persistence.
 */
export async function crawlSqlScope(
  source: { configJson: unknown; scopeJson: unknown; maxRows: number },
  scope: SqlScopeEntry,
  opts: { client?: PrismaClient } = {},
): Promise<SqlCrawlResult> {
  const config = source.configJson as PostgresTarget;
  // CRAWL-TIME re-assertion: a source edited to point at DATABASE_URL
  // after creation is refused BEFORE it connects.
  await assertNotServoDatabase(config);

  const url = buildUrl(config);
  const client = opts.client ?? new PrismaClient({ datasourceUrl: url });
  try {
    const rows: CrawledRow[] = [];
    let cursor: string | null = null;
    for (;;) {
      const page = composeStatement(scope, cursor, Math.min(1000, source.maxRows + 1));
      const raw = await client.$queryRawUnsafe<Record<string, unknown>[]>(page.sql, ...page.params);
      for (const r of raw) {
        if (rows.length >= source.maxRows) return { rows, overCap: true };
        rows.push(renderRow(scope, r));
      }
      if (raw.length === 0) return { rows, overCap: false };
      cursor = String(raw[raw.length - 1][scope.idColumn]);
      if (raw.length < Math.min(1000, source.maxRows + 1)) return { rows, overCap: false };
    }
  } finally {
    if (!opts.client) await client.$disconnect().catch(() => undefined);
  }
}

/** Build the datasource URL from the config's own fields — the same
 *  host/database the guard just proved are not Servo's. */
function buildUrl(config: PostgresTarget): string {
  const host = config.host ?? "127.0.0.1";
  const port = config.port ?? 5432;
  const database = config.database ?? "postgres";
  // Credentials ride the config's own fields when present (xds-01 stores
  // the secret REF, not the secret; the operator's role is read-only, so
  // even a leaked URL reads nothing it should not).
  const user = typeof (config as { user?: unknown }).user === "string" ? (config as { user: string }).user : "servo";
  const password = typeof (config as { password?: unknown }).password === "string" ? (config as { password: string }).password : "servo";
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}?schema=public&connection_limit=2`;
}

/** The externalLocator xds-01 canonized, as one object. */
export function externalLocator(scope: SqlScopeEntry, sourceName: string, externalId: string) {
  return {
    kind: "POSTGRES" as const,
    source: sourceName,
    schema: scope.schema,
    table: scope.table,
    idColumn: scope.idColumn,
    id: externalId,
  };
}
