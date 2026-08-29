// Tier-2 bounded sampling (cat-04): the VALUE statistics tier. Every
// per-column profiling statement is an AGGREGATE query — the only one that
// may return non-aggregated values is the top-K frequency query, and it
// applies the k-anonymity floor IN THE SOURCE (GROUP BY … HAVING
// count(*) >= kFloor), so a value below the floor never crosses the wire.
//
// Sampling runs TABLESAMPLE inside SET TRANSACTION READ ONLY with
// statement_timeout and idle_in_transaction_session_timeout per session;
// provenance records {tier, method, sampledRows, sampleKind, exact:false}.
//
// SQL GENERATION IS PURE AND CAPTURED: the test inspects the exact strings
// this module emits (tier2ColumnStatements), so the aggregate-only and
// HAVING-present properties are asserted on the SQL itself, not on
// behaviour alone.

export interface Tier2ColumnInput {
  schema: string;
  table: string;
  column: string;
  declaredType: string;
  /** Rows/sample the planner may touch; bounds the aggregate work. */
  samplePercent: number; // e.g. 1 = TABLESAMPLE SYSTEM (1)
  repeatable: number; // seed for TABLESAMPLE REPEATABLE — deterministic
}

export interface Tier2Statement {
  /** For the test's aggregate-only inspector: which shape this is. */
  kind: "shape" | "topk";
  sql: string;
}

const NUMERIC = /numeric|decimal|integer|int\b|bigint|real|double|float|money/i;
const TEMPORAL = /date|timestamp|time\b/i;

/**
 * The statements for ONE column. The shape query returns exactly one row of
 * aggregates (null fraction, avg width, min/max as STRINGS for temporal
 * and INTERNAL numerics — bounds are values, and cat-02's gate decides at
 * write time whether they may be stored; here we only observe). The top-K
 * query is the ONE non-aggregate statement, and it carries the HAVING
 * floor in the source.
 */
export function tier2ColumnStatements(input: Tier2ColumnInput): Tier2Statement[] {
  const q = (id: string) => `"${id.replace(/"/g, '""')}"`;
  const target = `${q(input.schema)}.${q(input.table)}`;
  const col = q(input.column);
  const sample = `TABLESAMPLE SYSTEM (${input.samplePercent}) REPEATABLE (${input.repeatable})`;

  const shapeSql = `
    SELECT
      count(*)::bigint AS sampled_rows,
      count(${col})::bigint AS non_null,
      round(avg(length(${col}::text)))::int AS avg_width,
      min(length(${col}::text))::int AS min_len,
      max(length(${col}::text))::int AS max_len,
      ${NUMERIC.test(input.declaredType) ? `min(${col}::text) AS min_val, max(${col}::text) AS max_val,` : ""}
      ${TEMPORAL.test(input.declaredType) ? `min(${col}::text) AS min_val, max(${col}::text) AS max_val,` : ""}
      count(DISTINCT ${col})::bigint AS distinct_in_sample
    FROM ${target} ${sample}
    WHERE ${col} IS NOT NULL OR true
  `.trim();

  const kFloor = "$1";
  const topK = "$2";
  const topkSql = `
    SELECT ${col}::text AS value, count(*)::int AS n
      FROM ${target} ${sample}
     WHERE ${col} IS NOT NULL
     GROUP BY ${col}
    HAVING count(*) >= ${kFloor}
     ORDER BY n DESC
     LIMIT ${topK}
  `.trim();

  return [
    { kind: "shape", sql: shapeSql },
    { kind: "topk", sql: topkSql },
  ];
}

/** The session preamble every tier-2 executor runs before its statements. */
export function tier2SessionPreamble(): string[] {
  return [
    "SET TRANSACTION READ ONLY",
    "SET LOCAL statement_timeout = '60s'",
    "SET LOCAL idle_in_transaction_session_timeout = '30s'",
  ];
}

/** Provenance for a tier-2 profile, exactly the canonized shape. */
export function tier2Provenance(sampledRows: number, method: string, sampleKind: string) {
  return {
    tier: "TIER2",
    method,
    sampledRows,
    sampleKind,
    exact: false,
  };
}
