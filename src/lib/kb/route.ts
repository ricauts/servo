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

  // RECURSIVE covers the whole WITH list (PostgreSQL places the
  // keyword after WITH); the graph walk below needs it.
  const sql = `
    ${cte.replace(/^WITH /, "WITH RECURSIVE ")}
    -- Content aggregates per Document over its hit chunks. MAX, never SUM:
    -- switching to SUM lets a 34-chunk wide table out-shout a 3-chunk exact
    -- match — the fixture pair pins this.
    , scored AS (
      SELECT
        d.id AS document_id,
        d.name AS doc_name,
        MAX(ts_rank_cd(c.tsv, websearch_to_tsquery('simple', ${q}), 32)) AS lex,
        MAX(CASE WHEN c.embedding IS NULL OR c."embeddingModel" IS DISTINCT FROM ${modelLit}
                 THEN NULL ELSE 1 - (c.embedding <=> ${vecLiteral}) END) AS vec,
        COUNT(DISTINCT (c.locator->>'section')) FILTER (
          WHERE ts_rank_cd(c.tsv, websearch_to_tsquery('simple', ${q}), 32) >= 0.15
        ) AS alt,
        ${entityTs ? `BOOL_OR(c.tsv @@ to_tsquery('simple', ${entityTs}))` : "FALSE"} AS entity_hit
      FROM "Document" d
      JOIN readable e ON e.id = d.id
      LEFT JOIN "DocumentChunk" c ON c."documentId" = d.id
        AND (c.tsv @@ websearch_to_tsquery('simple', ${q})
             ${entityTs ? `OR c.tsv @@ to_tsquery('simple', ${entityTs})` : ""})
      WHERE d.kind = 'CATALOG'
      GROUP BY d.id, d.name
    )
    , pre_scored AS (
      -- The CONTENT pre (graph arrives after the dup pass, below).
      SELECT *,
        0.5 * COALESCE(vec, 0) + 0.5 * COALESCE(lex, 0) + 0.05 * LEAST(alt, 3) AS pre0
      FROM scored
    )
    -- The duplicate SECOND PASS: a NEAR_DUPLICATE peer with a strictly
    -- higher content pre costs 0.50; ties broken on id (the peer's id must
    -- be strictly smaller). Ordered AFTER pre is computed — a window, not a
    -- term of it.
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
             AND (peer.pre0 > p.pre0 OR (peer.pre0 = p.pre0 AND peer.document_id < p.document_id))
        ) AS dup
      FROM pre_scored p
    )
    -- Seeds for graph expansion: every dataset with a content signal, PLUS
    -- every dataset this run DISCARDED (dup-suppressed) — a rejected
    -- duplicate still points at its neighbourhood.
    , seeds AS (
      SELECT document_id AS id FROM dup_applied
       WHERE COALESCE(lex, 0) > 0 OR entity_hit OR dup
    )
    -- graph(d) = MAX over seeds of 0.6^hop * carried, where carried
    -- accumulates weight × kindFactor per hop. Weights are used RAW — no
    -- normalisation: dividing by the max out-edge would make every node's
    -- best edge exactly 1.0 and inflate weak neighbourhoods.
    , graph_cte(seed_id, doc_id, hop, carried) AS (
        -- Same-source siblings: evaluated as a PREDICATE (equality of the
        -- entries' dataSourceId), never read from an edge row — a hop-1
        -- contribution with factor 0.30.
        SELECT s.id, sibling."documentId", 1, 0.30::float
          FROM seeds s
          JOIN "CatalogEntry" ce_s ON ce_s."documentId" = s.id
          JOIN "CatalogEntry" sibling
            ON sibling."dataSourceId" = ce_s."dataSourceId"
           AND sibling."documentId" IS NOT NULL
           AND sibling."documentId" <> s.id
          JOIN readable e2 ON e2.id = sibling."documentId"
        UNION ALL
        -- Seed anchors (hop 0, carried 1) so edge walks have a base.
        SELECT s.id, s.id, 0, 1.0::float FROM seeds s
        UNION ALL
        SELECT g.seed_id, nxt.id, g.hop + 1,
               g.carried * CASE
                 WHEN k.kind = 'TEMPORAL_ALIGNMENT' THEN (1 + k.weight)  -- amplifier only, never additive
                 ELSE k.weight * CASE k.kind
                   WHEN 'DECLARED_FK' THEN 0.90
                   WHEN 'SHARED_VALUES' THEN 0.80
                   WHEN 'SHARED_ENTITY' THEN 1.00
                   WHEN 'SHARED_KEYWORD' THEN 0.50
                   WHEN 'SAME_COLLECTION' THEN 0.40
                   ELSE 0  -- NEAR_DUPLICATE is a penalty, handled by the dup pass
                 END
               END
          FROM graph_cte g
          JOIN "KnowledgeEdge" k
            ON (k."fromId" = g.doc_id OR k."toId" = g.doc_id)
          JOIN "Document" nxt
            ON nxt.id = CASE WHEN k."fromId" = g.doc_id THEN k."toId" ELSE k."fromId" END
          -- THE ENTITLEMENT JOIN INSIDE THE RECURSIVE TERM. Moving it out to
          -- a post-filter over the final rows makes the fed-02 red-team test
          -- fail: the expansion would traverse B and disclose its id, its
          -- name and the edge evidence to a principal not entitled to B.
          JOIN readable eN ON eN.id = nxt.id
         WHERE g.hop < 2  -- depth capped BY THE CTE, not by a JS slice
           AND k.weight > 0
           AND nxt.id <> g.seed_id
           AND nxt.id <> g.doc_id
    )
    , graph_score AS (
      SELECT doc_id AS document_id, MAX(carried * power(0.6, hop)) AS graph
        FROM graph_cte
       WHERE hop > 0  -- a seed's own anchor contributes nothing
       GROUP BY doc_id
    )
    , final AS (
      SELECT da.*,
        da.pre0 + 0.20 * COALESCE(gs.graph, 0) AS pre,
        COALESCE(gs.graph, 0) AS graph
      FROM dup_applied da
      LEFT JOIN graph_score gs ON gs.document_id = da.document_id
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
      FROM final
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
