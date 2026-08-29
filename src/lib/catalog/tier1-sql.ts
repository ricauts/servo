// Tier-1 catalog introspection (cat-03): the STRUCTURE of a source, read
// from the catalog only — zero table scans. Pure mappers over RECORDED
// catalog rows (testable from fixtures, no container, no network), plus the
// SQL the live path runs.
//
// THE N_DISTINCT TRAP, recorded here because it is silent: pg_stats'
// n_distinct is > 0 as an ABSOLUTE count, but < 0 as the NEGATED RATIO of
// distinct values to rows (-1 means "unique", not "one distinct value").
// A column with n_distinct = -1 on a 1 000-row table has ~1 000 distinct
// values; reading it as 1 collapses a unique key into a constant. Both
// branches are resolved in resolveNDistinct() and pinned by fixtures.
//
// Estimates and counts are NEVER conflated: every distinct figure carries
// exact: boolean — an n_distinct estimate from pg_stats is exact:false; a
// count(DISTINCT) over a sample (tier 2, cat-04) is a different fact with
// its own flag. reltuples/relpages are read to resolve ratios and to size
// the table, and are deliberately NOT part of the Profile: they drift with
// every ANALYZE, and the Profile must be reproducible from fixtures.

import { createHash } from "node:crypto";

/** One column's declared shape + the stats tier 1 could see. */
export interface ColumnProfile {
  name: string;
  /** format_type output, e.g. "numeric(12,2)" / "text" / "integer". */
  declaredType: string;
  nullable: boolean;
  isPrimaryKey: boolean;
  /** "table.column" when the column declares an FK; null otherwise. */
  references: string | null;
  isUnique: boolean;
  /** The source's own COMMENT text, when it left one. */
  comment: string | null;
  stats: ColumnStats;
}

export interface ColumnStats {
  nullFraction: number | null;
  avgWidth: number | null;
  /** Resolved distinct estimate (see resolveNDistinct). */
  distinct: number | null;
  /** ALWAYS false for tier-1 pg_stats figures — they are estimates. */
  exact: boolean;
  mostCommonVals: string[];
  mostCommonFreqs: number[];
  histogramBounds: string[];
  correlation: number | null;
}

/** The tier-1 Profile of one dataset: structure + catalog stats. */
export interface Profile {
  level: "SOURCE" | "DATASET" | "FIELD";
  fqn: string;
  displayName: string;
  /** The source's own description (COMMENT ON TABLE), when present. */
  description: string | null;
  columns: ColumnProfile[];
  primaryKey: string[];
}

/** Postgres: resolve pg_stats.n_distinct — the trap lives here. Inputs
 *  accept BigInt (reltuples::bigint) and narrow once, at the edge. */
export function resolveNDistinct(nDistinct: number | bigint, reltuples: number | bigint): number | null {
  const n = Number(nDistinct);
  const rows = Number(reltuples);
  if (n > 0) return Math.round(n);
  if (n < 0) return Math.round(rows * -n);
  return null;
}

/** The row shape the Postgres SQL below returns: one row per column, with
 *  table-level facts repeated on each (join projection). Recorded verbatim
 *  into tests/fixtures/catalog/. */
export interface PgCatalogRow {
  schema_name: string;
  table_name: string;
  obj_description: string | null;
  reltuples: number;
  relpages: number;
  column_name: string;
  format_type: string;
  is_nullable: string; // YES | NO
  column_default: string | null;
  pk_ordinal: number | null;
  fk_ref: string | null;
  unique_indexed: boolean;
  col_description: string | null;
  null_frac: number | null;
  avg_width: number | null;
  n_distinct: number | null;
  // The cast most_common_vals::text::text[] makes the driver's job
  // possible; the naive anyarray select fails at the driver (arrays of
  // mixed element types cannot cross the wire) — pinned by the test that
  // references this comment, so the cast is never removed.
  most_common_vals: string[] | null;
  most_common_freqs: number[] | null;
  histogram_bounds: string[] | null;
  correlation: number | null;
}

/** PURE: recorded Postgres catalog rows → Profile. */
export function mapPgCatalog(rows: PgCatalogRow[]): Profile | null {
  if (rows.length === 0) return null;
  const first = rows[0];
  const columns: ColumnProfile[] = rows.map((r) => ({
    name: r.column_name,
    declaredType: r.format_type,
    nullable: r.is_nullable === "YES",
    isPrimaryKey: r.pk_ordinal !== null,
    references: r.fk_ref,
    isUnique: r.unique_indexed,
    comment: r.col_description,
    stats: {
      nullFraction: r.null_frac,
      avgWidth: r.avg_width,
      distinct: r.n_distinct === null ? null : resolveNDistinct(r.n_distinct, Math.max(Number(first.reltuples), 1)),
      // pg_stats figures are estimates, always.
      exact: false,
      mostCommonVals: r.most_common_vals ?? [],
      mostCommonFreqs: r.most_common_freqs ?? [],
      histogramBounds: r.histogram_bounds ?? [],
      correlation: r.correlation,
    },
  }));
  return {
    level: "DATASET",
    fqn: `pg://${first.schema_name}/${first.table_name}`,
    displayName: `${first.schema_name}.${first.table_name}`,
    description: first.obj_description,
    columns,
    primaryKey: rows
      .filter((r) => r.pk_ordinal !== null)
      .sort((a, b) => (a.pk_ordinal ?? 0) - (b.pk_ordinal ?? 0))
      .map((r) => r.column_name),
  };
}

/**
 * The tier-1 statement. Catalog surfaces ONLY — pg_catalog, pg_constraint,
 * pg_class, pg_stats and the description functions; the test inspects the
 * executed statements and fails if any selects from a user table.
 * most_common_vals::text::text[] (and friends) because the driver cannot
 * cross an anyarray — see the comment on PgCatalogRow.
 */
/**
 * The full statement, with PK/FK/unique resolution folded in after the
 * base catalog read — implemented as SQL in one round trip per table.
 */
export const PG_TIER1_COLUMNS_META_SQL = `
  SELECT
      n.nspname AS schema_name,
      c.relname AS table_name,
      obj_description(c.oid, 'pg_class') AS obj_description,
      GREATEST(c.reltuples, 0)::bigint AS reltuples,
      c.relpages,
      a.attname AS column_name,
      format_type(a.atttypid, a.atttypmod) AS format_type,
      CASE WHEN a.attnotnull THEN 'NO' ELSE 'YES' END AS is_nullable,
      pg_get_expr(ad.adbin, ad.adrelid) AS column_default,
      pk.ord::int AS pk_ordinal,
      fk.ref AS fk_ref,
      (ui.indexrelid IS NOT NULL) AS unique_indexed,
      col_description(c.oid, a.attnum) AS col_description
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
    LEFT JOIN pg_attrdef ad ON ad.adrelid = c.oid AND ad.adnum = a.attnum
    LEFT JOIN LATERAL (
      SELECT unnest(i.indkey) AS attnum, generate_subscripts(i.indkey, 1) AS ord
        FROM pg_index i
       WHERE i.indrelid = c.oid AND i.indisprimary
    ) pk ON pk.attnum = a.attnum
    LEFT JOIN LATERAL (
      SELECT conf.relname || '.' || af.attname AS ref
        FROM pg_constraint con
        JOIN pg_class conf ON conf.oid = con.confrelid
        JOIN pg_attribute af ON af.attrelid = con.confrelid
                       AND af.attnum = ANY (con.confkey)
       WHERE con.conrelid = c.oid AND con.contype = 'f'
         AND a.attnum = ANY (con.conkey)
         AND array_position(con.conkey, a.attnum) = array_position(con.confkey, af.attnum)
    ) fk ON true
    LEFT JOIN LATERAL (
      SELECT i.indexrelid
        FROM pg_index i
       WHERE i.indrelid = c.oid AND i.indisunique AND i.indnatts = 1
         AND i.indkey[0] = a.attnum
    ) ui ON true
   WHERE c.relkind IN ('r', 'p')
     AND n.nspname = $1 AND c.relname = $2
   ORDER BY a.attnum
`;

export const PG_TIER1_STATS_SQL = `
  SELECT
      schemaname, tablename, attname,
      null_frac, avg_width, n_distinct,
      most_common_vals::text::text[] AS most_common_vals,
      most_common_freqs::text::double precision[] AS most_common_freqs,
      histogram_bounds::text::text[] AS histogram_bounds,
      correlation
    FROM pg_stats
   WHERE schemaname = $1 AND tablename = $2
`;

/** Rows the SQL Server path would return — FIXTURE-ONLY in v1 (cat-03):
 *  no live SQL Server test is claimed, and the sys.* object names are not
 *  verified against a live server. */
export interface MssqlCatalogRow {
  schema_name: string;
  table_name: string;
  tbl_description: string | null;
  column_name: string;
  data_type: string; // sys.types.name
  max_length: number;
  is_nullable: number; // sys.columns.is_nullable: 0/1
  is_identity: number;
  is_primary_key: number;
  fk_ref: string | null;
  col_description: string | null;
  distinct_count: number | null;
  null_fraction: number | null;
}

/** PURE: fixture sys.* rows → Profile. The stats shapes are what the
 *  fixture records; nothing here is claimed against a live server. */
export function mapMssqlCatalog(rows: MssqlCatalogRow[]): Profile | null {
  if (rows.length === 0) return null;
  const first = rows[0];
  return {
    level: "DATASET",
    fqn: `mssql://${first.schema_name}/${first.table_name}`,
    displayName: `${first.schema_name}.${first.table_name}`,
    description: first.tbl_description,
    columns: rows.map((r) => ({
      name: r.column_name,
      declaredType: r.max_length === -1 ? `${r.data_type}(max)` : r.data_type,
      nullable: r.is_nullable === 1,
      isPrimaryKey: r.is_primary_key === 1,
      references: r.fk_ref,
      isUnique: r.is_identity === 1 || r.is_primary_key === 1,
      comment: r.col_description,
      stats: {
        nullFraction: r.null_fraction,
        avgWidth: null,
        distinct: r.distinct_count,
        exact: false,
        mostCommonVals: [],
        mostCommonFreqs: [],
        histogramBounds: [],
        correlation: null,
      },
    })),
    primaryKey: rows.filter((r) => r.is_primary_key === 1).map((r) => r.column_name),
  };
}

/** The executor the live tier-1 path runs statements through — injected
 *  so the test can RECORD every statement and prove no user table is read. */
export type SqlExecutor = (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;

/** Live tier-1 for one Postgres table: catalog meta + pg_stats, merged into
 *  the recorded-row shape and mapped. Zero table scans by construction —
 *  the statements touch catalog surfaces only, and the test proves it by
 *  inspecting the statement list this executor sees. */
export async function runPgTier1(
  exec: SqlExecutor,
  schema: string,
  table: string,
): Promise<Profile | null> {
  return mapPgCatalog(await pgTier1Rows(exec, schema, table));
}

/** The merged recorded-row shape, exposed so tests can capture fixtures
 *  of exactly what the live path saw. */
export async function pgTier1Rows(
  exec: SqlExecutor,
  schema: string,
  table: string,
): Promise<PgCatalogRow[]> {
  const meta = (await exec(PG_TIER1_COLUMNS_META_SQL, [schema, table])) as unknown as PgCatalogRow[];
  const stats = (await exec(PG_TIER1_STATS_SQL, [schema, table])) as unknown as Array<{
    attname: string;
    null_frac: number | null;
    avg_width: number | null;
    n_distinct: number | null;
    most_common_vals: string[] | null;
    most_common_freqs: number[] | null;
    histogram_bounds: string[] | null;
    correlation: number | null;
  }>;
  const statsByCol = new Map(stats.map((s) => [s.attname, s]));
  // reltuples::bigint narrows once here so the recorded-row shape — and
  // every fixture captured from it — is plain JSON.

  const merged: PgCatalogRow[] = meta.map((m) => {
    const st = statsByCol.get(m.column_name);
    return {
      ...m,
      reltuples: Number(m.reltuples),
      null_frac: st?.null_frac ?? null,
      avg_width: st?.avg_width ?? null,
      n_distinct: st?.n_distinct ?? null,
      most_common_vals: st?.most_common_vals ?? null,
      most_common_freqs: st?.most_common_freqs ?? null,
      histogram_bounds: st?.histogram_bounds ?? null,
      correlation: st?.correlation ?? null,
    };
  });
  return merged;
}

/** sha256 helper shared with fingerprint.ts consumers. */
export function sha256Canonical(value: unknown): string {
  const canonical = JSON.stringify(value, (_k, v) =>
    v !== null && typeof v === "object" && !Array.isArray(v)
      ? Object.keys(v as Record<string, unknown>)
          .sort()
          .reduce<Record<string, unknown>>((acc, key) => {
            acc[key] = (v as Record<string, unknown>)[key];
            return acc;
          }, {})
      : v,
  );
  return createHash("sha256").update(canonical).digest("hex");
}
