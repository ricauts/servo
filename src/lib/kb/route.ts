// The router (fed-01): dataset-level scoring and the duplicate second
// pass, in exactly ONE SQL statement — the entitlement CTE outermost, JOIN
// entitled in the FROM clause (the kb-02/kb-10 invariant), NO JS scoring
// stage. Scoring is per-Document over its hit chunks using MAX, never SUM:
// a 34-chunk wide table cannot out-shout a 3-chunk exact match.
//
// pre = 0.5*vec + 0.5*lex + 0.20*graph + 0.05*min(alt,3)
//   lex  — ts_rank_cd(c.tsv, q, 32) → [0,1)
//   vec  — 1 - (embedding <=> query), NULL without an embedder
//   graph — MAX weight of an entitled edge touching the dataset
//   alt  — count of DISTINCT card sections whose content score ≥ 0.15
// There is NO cost term, deliberately: its realistic range is ~0.04 and
// estimated_rows is already the ORDER BY tie-break.
//
// dup is a SECOND PASS, not a term of pre: score = pre - 0.50 where a
// NEAR_DUPLICATE peer scored strictly higher (ties broken on id). The pass
// is ordered AFTER pre is computed — a pure SQL window over the same
// statement, so the one-statement rule holds.
//
// entity_hit is the LEADING sort key: a dataset carrying one of the
// question's entities outranks every dataset without one, whatever their
// content scores. The entity pass is keywordPass — kb-08's deterministic
// function — applied in SQL over the question tokens; ZERO provider calls
// happen during routing (the spy proves it).

import { humanChainCte, agentChainCte, type EntitlementChain } from "./entitlement";
import { keywordPass } from "./keywords";

export interface RouteOptions {
  limit?: number;
  queryVector?: number[];
  embeddingModel?: string;
}

export interface RoutedSource {
  documentId: string;
  docName: string;
  score: number;
  pre: number;
  entityHit: boolean;
  graph: number;
  alt: number;
  dup: boolean;
  /** The footer denominator: how many datasets this principal may read. */
}

export interface RouteResult {
  sources: RoutedSource[];
  /** ENTITLED dataset count — never the corpus size. */
  entitledDatasets: number;
  /** How many the router omitted below the cut, as a COUNT. */
  omitted: number;
  /** The number of SQL statements issued: always 1, surfaced for the test. */
  statementsIssued: number;
}

interface QueryClient {
  $queryRawUnsafe<T>(query: string): Promise<T>;
}

export function routeCte(chain: EntitlementChain, question: string): string {
  const lit = (v: string) => `'${v.replace(/'/g, "''")}'`;
  // The entity pass is the SAME deterministic function kb-08 uses, applied
  // to the QUESTION here (pure TS) and matched against chunk entities in
  // SQL via the tsvector/text of the card — entity codes are tokens.
  return chain.agentId !== null
    ? agentChainCte(chain.humanId, chain.agentId)
    : humanChainCte(chain.humanId);
}

/**
 * Route datasets for a question. ONE statement: the CTE composes the
 * entitlement chain, the SELECT scores per-Document over hit chunks (MAX,
 * never SUM), computes alt, graph and entity_hit, then applies the dup
 * second pass in a window — all inside the same statement. The statement
 * count is asserted by the test via a spy on $queryRawUnsafe.
 */
export async function routeSources(
  client: QueryClient & { __statementLog?: string[] },
  chain: EntitlementChain,
  question: string,
  opts: RouteOptions = {},
): Promise<RouteResult> {
  const limit = Math.min(Math.max(1, opts.limit ?? 10), 25);
  const cte = routeCte(chain, question);
  const lit = (v: string) => `'${v.replace(/'/g, "''")}'`;
  const q = lit(question);

  const entities = keywordPass(question).entities;
  // Entity terms as a tsquery OR-alternation — empty when the question has
  // no entities, which makes entity_hit uniformly false.
  const entityTs =
    entities.length > 0
      ? entities
          .map((e) => e.replace(/[^\w.-]/g, ""))
          .filter((e) => e.length > 1)
          .map((e) => lit(`"${e.replace(/"/g, "")}"`)) // quoted: hyphens are tsquery OPERATORS
          .join(" | ")
      : null;

  const vecLiteral = opts.queryVector
    ? `'[${opts.queryVector.map((v) => v.toFixed(12)).join(",")}]'::vector`
    : "NULL";
  const modelLit = opts.embeddingModel ? lit(opts.embeddingModel) : "NULL";

  const sql = `
    ${cte}
    , scored AS (
      SELECT
        d.id AS document_id,
        d.name AS doc_name,
        e.id IS NOT NULL AS entitled,
        -- MAX, never SUM: per-document aggregation over its hit chunks.
        -- Switching to SUM lets a 34-chunk wide table out-shout a 3-chunk
        -- exact match — the fixture pair pins this.
        MAX(ts_rank_cd(c.tsv, websearch_to_tsquery('simple', ${q}), 32)) AS lex,
        MAX(CASE WHEN c.embedding IS NULL OR c."embeddingModel" IS DISTINCT FROM ${modelLit}
                 THEN NULL ELSE 1 - (c.embedding <=> ${vecLiteral}) END) AS vec,
        COUNT(DISTINCT (c.locator->>'section')) FILTER (
          WHERE ts_rank_cd(c.tsv, websearch_to_tsquery('simple', ${q}), 32) >= 0.15
        ) AS alt,
        ${entityTs ? `BOOL_OR(c.tsv @@ to_tsquery('simple', ${entityTs}))` : "FALSE"} AS entity_hit,
        MAX(COALESCE(g.weight, 0)) AS graph,
        MAX(COALESCE(g.near_dup, 0))::int AS near_dup_of_higher
      FROM "Document" d
      JOIN entitled e ON e.id = d.id
      LEFT JOIN "DocumentChunk" c ON c."documentId" = d.id
        AND (c.tsv @@ websearch_to_tsquery('simple', ${q})
             ${entityTs ? `OR c.tsv @@ to_tsquery('simple', ${entityTs})` : ""})
      LEFT JOIN LATERAL (
        -- graph: MAX weight of an ENTITLED edge touching this document
        -- (both endpoints entitled — the kb-08 rule), plus whether a
        -- NEAR_DUPLICATE edge exists at all (resolved per-peer in the
        -- second pass below).
        SELECT MAX(CASE WHEN p2.id IS NOT NULL THEN k.weight ELSE 0 END) AS weight,
               BOOL_OR(k.kind = 'NEAR_DUPLICATE')::int AS near_dup
          FROM "KnowledgeEdge" k
          JOIN "Document" d2
            ON d2.id = CASE WHEN k."fromId" = d.id THEN k."toId" ELSE k."fromId" END
          JOIN entitled p2 ON p2.id = d2.id
         WHERE (k."fromId" = d.id OR k."toId" = d.id)
           AND k.weight > 0
      ) g ON true
      WHERE d.kind = 'CATALOG'
      GROUP BY d.id, d.name, e.id
    )
    , pre_scored AS (
      SELECT *,
        0.5 * COALESCE(vec, 0) + 0.5 * COALESCE(lex, 0) + 0.20 * COALESCE(graph, 0) + 0.05 * LEAST(alt, 3) AS pre
      FROM scored
    )
    -- The duplicate SECOND PASS: a NEAR_DUPLICATE peer with a strictly
    -- higher pre costs 0.50; ties broken on id (the peer's id must be
    -- strictly smaller). Ordered AFTER pre is computed — a window, not a term.
    , dup_applied AS (
      SELECT p.*,
        EXISTS (
          SELECT 1
            FROM "KnowledgeEdge" k
            JOIN pre_scored peer
              ON peer.document_id = CASE WHEN k."fromId" = p.document_id
                                         THEN k."toId" ELSE k."fromId" END
           WHERE k.kind = 'NEAR_DUPLICATE'
             AND (k."fromId" = p.document_id OR k."toId" = p.document_id)
             AND (peer.pre > p.pre OR (peer.pre = p.pre AND peer.document_id < p.document_id))
        ) AS dup
      FROM pre_scored p
    )
    SELECT
        document_id AS "documentId",
        doc_name AS "docName",
        CASE WHEN dup THEN pre - 0.50 ELSE pre END AS score,
        pre,
        COALESCE(entity_hit, false) AS "entityHit",
        graph,
        alt,
        dup,
        COUNT(*) OVER () AS "entitledDatasets"
      FROM dup_applied
     ORDER BY entity_hit DESC NULLS LAST, score DESC, document_id ASC
     LIMIT ${limit}
  `;

  void client.__statementLog;
  const rows = (await client.$queryRawUnsafe(sql)) as Array<{
    documentId: string;
    docName: string;
    score: string | number;
    pre: string | number;
    entityHit: boolean;
    graph: string | number;
    alt: string | number;
    dup: boolean;
    entitledDatasets: bigint;
  }>;

  const sources = rows.map((r) => ({
    documentId: r.documentId,
    docName: r.docName,
    score: Number(r.score),
    pre: Number(r.pre),
    entityHit: r.entityHit,
    graph: Number(r.graph),
    alt: Number(r.alt),
    dup: r.dup,
  }));
  const entitled = Number(rows[0]?.entitledDatasets ?? 0);
  return {
    sources,
    entitledDatasets: entitled,
    omitted: Math.max(0, entitled - sources.length),
    statementsIssued: 1,
  };
}
