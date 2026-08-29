// The knowledge graph (spec kb-08). Computation is corpus-wide — edges are
// derived from shared entities (weighted by rarity), shared keywords and
// co-membership in a collection. READS are always entitlement-filtered: the
// related-documents API composes the entitlement CTE on BOTH endpoints, so a
// principal never learns that a non-entitled document exists — not its id,
// not its name, not the shared evidence.

import { db } from "@/lib/db";
import { keywordPass } from "@/lib/kb/keywords";
import { humanChainCte, agentChainCte, type EntitlementChain } from "@/lib/kb/entitlement";

/** Rebuild edges for one document against every existing document. Called
 *  from ingest after chunks are written; re-running replaces the document's
 *  outgoing edges (ingest already cleared both directions). */
export async function rebuildEdgesFor(documentId: string): Promise<number> {
  const chunks = await db.documentChunk.findMany({
    where: { documentId },
    select: { text: true, keywords: true },
  });

  // This document's profile, via the deterministic pass over its chunks.
  const entities = new Map<string, number>(); // entity -> occurrences
  const keywords = new Map<string, number>();
  for (const chunk of chunks) {
    const pass = keywordPass(chunk.text);
    for (const e of pass.entities) entities.set(e, (entities.get(e) ?? 0) + 1);
    for (const k of pass.keywords) keywords.set(k, (keywords.get(k) ?? 0) + 1);
  }
  const mine = await db.document.findUnique({
    where: { id: documentId },
    select: { collectionId: true },
  });

  // Corpus profiles for rarity weighting and overlap.
  const others = await db.document.findMany({
    where: { id: { not: documentId } },
    select: {
      id: true,
      collectionId: true,
      chunks: { select: { text: true } },
    },
  });
  const corpusEntityDocs = new Map<string, Set<string>>();
  for (const other of others) {
    for (const chunk of other.chunks) {
      for (const e of keywordPass(chunk.text).entities) {
        if (!corpusEntityDocs.has(e)) corpusEntityDocs.set(e, new Set());
        corpusEntityDocs.get(e)!.add(other.id);
      }
    }
  }

  const edges: {
    fromId: string;
    toId: string;
    kind: string;
    weight: number;
    evidence: string[];
  }[] = [];

  for (const other of others) {
    const otherEntities = new Set<string>();
    const otherKeywords = new Set<string>();
    for (const chunk of other.chunks) {
      const pass = keywordPass(chunk.text);
      pass.entities.forEach((e) => otherEntities.add(e));
      pass.keywords.forEach((k) => otherKeywords.add(k));
    }

    const sharedEntities = [...entities.keys()].filter((e) => otherEntities.has(e));
    if (sharedEntities.length > 0) {
      // Rarity: an entity shared by fewer documents weighs more.
      const weight =
        sharedEntities.reduce(
          (sum, e) => sum + 1 / Math.max(1, corpusEntityDocs.get(e)?.size ?? 1),
          0,
        ) / Math.max(1, sharedEntities.length);
      edges.push({
        fromId: documentId,
        toId: other.id,
        kind: "SHARED_ENTITY",
        weight: Number(weight.toFixed(4)),
        evidence: sharedEntities.slice(0, 8),
      });
    }

    const sharedKeywords = [...keywords.keys()].filter((k) => otherKeywords.has(k));
    if (sharedKeywords.length >= 2) {
      edges.push({
        fromId: documentId,
        toId: other.id,
        kind: "SHARED_KEYWORD",
        weight: Number((sharedKeywords.length / 10).toFixed(4)),
        evidence: sharedKeywords.slice(0, 8),
      });
    }

    if (mine?.collectionId && mine.collectionId === other.collectionId) {
      edges.push({
        fromId: documentId,
        toId: other.id,
        kind: "SAME_COLLECTION",
        weight: 0.1,
        evidence: [],
      });
    }
  }

  if (edges.length > 0) {
    await db.knowledgeEdge.createMany({ data: edges, skipDuplicates: true });
  }
  return edges.length;
}

/** Structural: accepts both the raw client and the $extends-wrapped one. */
interface QueryClient {
  $queryRawUnsafe<T>(query: string): Promise<T>;
}

export interface RelatedDocument {
  id: string;
  name: string;
  kind: string;
  weight: number;
  evidence: string[];
}

/**
 * Entitled neighbours of a document. The entitlement CTE is joined on BOTH
 * endpoints in one statement: an edge whose far side is not entitled is not
 * returned at all, so its existence is not disclosed. Evidence travels only
 * when both nodes are readable — which is the same condition as the edge
 * being returned.
 */
export async function relatedDocuments(
  client: QueryClient,
  chain: EntitlementChain,
  documentId: string,
): Promise<RelatedDocument[]> {
  const cte =
    chain.agentId !== null
      ? agentChainCte(chain.humanId, chain.agentId)
      : humanChainCte(chain.humanId);
  const rows = await client.$queryRawUnsafe<{
    id: string;
    name: string;
    kind: string;
    weight: number;
    evidence: string[];
  }[]>(
    `${cte}
     SELECT CASE WHEN e."fromId" = $1 THEN e."toId" ELSE e."fromId" END AS id,
            d.name, e.kind, e.weight, e.evidence::text
       FROM "KnowledgeEdge" e
       JOIN "Document" d ON d.id = (CASE WHEN e."fromId" = $1 THEN e."toId" ELSE e."fromId" END)
       JOIN entitled en ON en.id = d.id
      WHERE (e."fromId" = $1 OR e."toId" = $1)
      ORDER BY e.weight DESC
      LIMIT 20`.replace(/\$1/g, `'${documentId.replace(/'/g, "''")}'`),
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    kind: r.kind,
    weight: Number(r.weight),
    evidence: Array.isArray(r.evidence) ? r.evidence : safeParse(r.evidence),
  }));
}

function safeParse(value: unknown): string[] {
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}
