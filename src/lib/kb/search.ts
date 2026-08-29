// The retrieval pipeline (spec kb-10). ONE SQL statement: the entitlement
// CTE, tsvector candidates ranked by ts_rank_cd, vector re-rank via
// 1 - (embedding <=> q), blended order, limit. No JS scoring stage, no
// fallback mode — keyword selection is index-backed at every install, and
// the identical code path runs with or without embeddings.
//
// The result cap follows RESULT_LIMIT (src/lib/ai/tools/types.ts): retrieval
// feeds tool results and prompts, so it obeys the same budget rule.

import { agentChainCte, humanChainCte, type EntitlementChain } from "@/lib/kb/entitlement";
import { RESULT_LIMIT } from "@/lib/ai/tools/types";

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
}

/** Structural: raw and $extends clients both compose. */
interface QueryClient {
  $queryRawUnsafe<T>(query: string): Promise<T>;
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

  const lit = (v: string) => `'${v.replace(/'/g, "''")}'`;
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
        WHERE c.tsv @@ websearch_to_tsquery('simple', ${q})
           OR (${vecLiteral} IS NOT NULL AND c.embedding IS NOT NULL AND c."embeddingModel" = ${modelLit})
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

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
