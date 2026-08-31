// The retrieval pipeline (spec kb-10). ONE SQL statement: the entitlement
// CTE, tsvector candidates ranked by ts_rank_cd, vector re-rank via
// 1 - (embedding <=> q), blended order, limit. No JS scoring stage, no
// fallback mode — keyword selection is index-backed at every install, and
// the identical code path runs with or without embeddings.
//
// The result cap follows RESULT_LIMIT (src/lib/ai/tools/types.ts): retrieval
// feeds tool results and prompts, so it obeys the same budget rule.
//
// ext-06 adds structured fact filters to the SAME statement: one correlated
// EXISTS over "DocumentFact" per filter, in the WHERE clause. There is no
// post-filter pass over the results and no second query, because either one
// would be a document set assembled outside the entitlement fragment.
// Filters NARROW — they remove rows from an already-entitled candidate set
// and can never add one.

import { agentChainCte, humanChainCte, type EntitlementChain } from "@/lib/kb/entitlement";
import { RESULT_LIMIT } from "@/lib/ai/tools/types";
import type { QueryFilter } from "@/lib/kb/query-filters";

export interface SearchHit {
  documentId: string;
  docName: string;
  chunkId: string;
  text: string;
  locator: unknown;
  kw: number | null;
  vec: number | null;
}

export interface SearchOptions {
  limit?: number;
  /** The embedded query vector, when embeddings are configured. */
  queryVector?: number[];
  /** The embedding model the queryVector was produced by (mismatch ⇒ vec null). */
  embeddingModel?: string;
  /**
   * Structured fact filters (ext-06). Each one compiles to a single EXISTS
   * inside the statement below — never a pass over the results, and never a
   * second query. Filters NARROW an already-entitled candidate set; they
   * can never add a row to it.
   */
  filters?: QueryFilter[];
}

/** Structural: raw and $extends clients both compose. */
interface QueryClient {
  $queryRawUnsafe<T>(query: string): Promise<T>;
}

const lit = (v: string) => `'${v.replace(/'/g, "''")}'`;

/**
 * A number safe to inline. `Number.isFinite` does not coerce, so a
 * non-number arriving from an untyped caller throws here rather than
 * reaching the statement. Magnitudes beyond ~1e21 render in exponent form
 * (`1e+24`), which Postgres accepts as a numeric constant — the persist
 * layer already refuses anything DECIMAL(38,6) cannot hold, so no stored
 * fact is comparable at that scale anyway.
 */
function numLit(value: number): string {
  if (!Number.isFinite(value)) throw new Error("kbSearch: non-finite filter value");
  return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(6);
}

/**
 * ONE filter, as ONE correlated EXISTS over "DocumentFact".
 *
 * The subquery introduces NO document set of its own: it is correlated to
 * `documentIdExpr` — a document the outer query has already constrained
 * through the composed entitlement fragment — and it JOINs that fragment as
 * well.
 *
 * That join is REDUNDANT HERE, and it is kept on purpose. The first
 * fact-only read path anyone writes — a facet count, an aggregate, a
 * "documents mentioning this invoice" panel — will be copied from this
 * block, and the pattern it copies has the gate in it. It also means a
 * later narrowing of the composed fragment (§12's source ceiling) narrows
 * this filter with it, for free, with nothing to remember.
 */
export function filterExistsSql(filter: QueryFilter, alias: string, documentIdExpr: string): string {
  const f = `f_${alias}`;
  const e = `e_${alias}`;
  const preds: string[] = [
    `${f}."documentId" = ${documentIdExpr}`,
    `${f}.kind = ${lit(filter.kind)}`,
  ];

  if (filter.kind === "DATE") {
    // Every date is an interval, so the only date predicate is overlap.
    const start = filter.ts ?? 0;
    const end = filter.tsEnd ?? 0;
    preds.push(`${f}.ts < ${numLit(end)}`, `${f}."tsEnd" > ${numLit(start)}`);
  } else if (filter.num !== undefined) {
    // Units are compared, never converted (design §"Deliberately not
    // extracted": 1.5 GB and 1536 MB stay two facts).
    if (filter.unit !== undefined && filter.unit !== "") preds.push(`${f}.unit = ${lit(filter.unit)}`);
    if (filter.comparator === ">=") preds.push(`${f}.num >= ${numLit(filter.num)}`);
    else if (filter.comparator === "<=") preds.push(`${f}.num <= ${numLit(filter.num)}`);
    else if (filter.comparator === "between") {
      preds.push(`${f}.num >= ${numLit(filter.num)}`, `${f}.num <= ${numLit(filter.num2 ?? filter.num)}`);
    } else preds.push(`${f}.num = ${numLit(filter.num)}`);
  } else if (filter.norm !== undefined) {
    preds.push(`${f}.norm = ${lit(filter.norm)}`);
  }

  return `EXISTS (
         SELECT 1 FROM "DocumentFact" ${f}
           -- Redundant here: the outer query already joined "entitled" for
           -- this document. KEPT so the pattern carries the gate.
           JOIN entitled ${e} ON ${e}.id = ${f}."documentId"
          WHERE ${preds.join("\n            AND ")}
       )`;
}

/** The filter clauses, ANDed, or "" when there are none. */
function filterClauses(filters: QueryFilter[] | undefined, documentIdExpr: string): string {
  if (!filters || filters.length === 0) return "";
  return filters.map((f, i) => `\n       AND ${filterExistsSql(f, String(i), documentIdExpr)}`).join("");
}

/**
 * Ranked, entitled passages. The entitlement CTE is joined IN THE FROM
 * clause — deleting that JOIN is exactly what makes the red-team test fail,
 * which is the point of the comment above it.
 */
export async function kbSearch(
  client: QueryClient,
  chain: EntitlementChain,
  query: string,
  opts: SearchOptions = {},
): Promise<SearchHit[]> {
  const limit = Math.min(Math.max(1, opts.limit ?? 10), RESULT_LIMIT / 400);
  const cte =
    chain.agentId !== null
      ? agentChainCte(chain.humanId, chain.agentId)
      : humanChainCte(chain.humanId);

  const q = lit(query);
  // Fixed decimals in a QUOTED literal: pgvector parses '[0.1,0.2]'::vector,
  // and JS number-to-string uses exponentials for small values which the
  // array grammar rejects.
  const vecLiteral = opts.queryVector
    ? `'[${opts.queryVector.map((v) => v.toFixed(12)).join(",")}]'::vector`
    : "NULL";
  const modelLit = opts.embeddingModel ? lit(opts.embeddingModel) : "NULL";

  const rows = await client.$queryRawUnsafe<{
    documentId: string;
    docName: string;
    chunkId: string;
    text: string;
    locator: string;
    kw: string | number | null;
    vec: string | number | null;
  }[]>(
    `${cte}
     SELECT * FROM (
       SELECT c."documentId", d.name AS "docName", c.id AS "chunkId", c.text,
              c.locator::text AS locator,
              ts_rank_cd(c.tsv, websearch_to_tsquery('simple', ${q})) AS kw,
              CASE WHEN c.embedding IS NULL OR c."embeddingModel" IS DISTINCT FROM ${modelLit}
                   THEN NULL
                   ELSE 1 - (c.embedding <=> ${vecLiteral}) END AS vec
         FROM "DocumentChunk" c
         JOIN "Document" d ON d.id = c."documentId"
         -- The gate, in the FROM clause: deleting this JOIN is what makes the
         -- red-team test fail. A chunk outside "entitled" must never score,
         -- never rank, never reach a prompt.
         JOIN entitled e ON e.id = c."documentId"
        WHERE (c.tsv @@ websearch_to_tsquery('simple', ${q})
           OR (${vecLiteral} IS NOT NULL AND c.embedding IS NOT NULL AND c."embeddingModel" = ${modelLit}))${filterClauses(opts.filters, 'c."documentId"')}
     ) ranked
     ORDER BY (0.5 * COALESCE(ranked.vec, 0) + 0.5 * ranked.kw) DESC, ranked."documentId"
     LIMIT ${limit}`,
  );

  return rows.map((r) => ({
    documentId: r.documentId,
    docName: r.docName,
    chunkId: r.chunkId,
    text: r.text,
    locator: safeJson(r.locator),
    kw: r.kw === null ? null : Number(r.kw),
    vec: r.vec === null ? null : Number(r.vec),
  }));
}

/**
 * How many ENTITLED documents satisfy every filter — the only shape a count
 * over "DocumentFact" may take (ext-06). A count over the raw table is an
 * existence oracle with a nicer UI: it tells a principal that documents they
 * may not read exist, and how many, which is the disclosure the entitlement
 * fragment exists to prevent. The fragment is joined in the FROM, exactly as
 * kbSearch joins it, and the filters reuse the same EXISTS compiler.
 */
export async function countEntitledDocumentsMatching(
  client: QueryClient,
  chain: EntitlementChain,
  filters: QueryFilter[],
): Promise<number> {
  const cte =
    chain.agentId !== null
      ? agentChainCte(chain.humanId, chain.agentId)
      : humanChainCte(chain.humanId);
  const rows = await client.$queryRawUnsafe<{ n: bigint | number | string }[]>(
    `${cte}
     SELECT COUNT(*) AS n
       FROM "Document" d
       JOIN entitled e ON e.id = d.id
      WHERE TRUE${filterClauses(filters, 'd.id')}`,
  );
  return rows.length === 0 ? 0 : Number(rows[0].n);
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
