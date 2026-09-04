import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { forbid } from "@/lib/permissions";
import { entitledDocumentIds } from "@/lib/kb/entitlement";
import { stringList } from "@/lib/kb/library";
import type { GraphEdge, GraphNode, GraphView } from "@/lib/kb/graph-view";

export const dynamic = "force-dynamic";

/**
 * GET /api/kb/graph (kb-lib-3) — the knowledge graph as the CURRENT human
 * may see it: document nodes for every entitled document, a node per
 * collection that holds at least one of them, MEMBER edges for filing, and
 * the knowledge-graph edges whose BOTH ends are entitled. An edge with one
 * unreadable end is not returned at all — the same rule relatedDocuments
 * applies (kb-08) — so neither the far document's name nor the evidence
 * that links to it is disclosed. Human chain only: browsing is a person's
 * act, and agent chains arrive with the tools.
 */
export async function GET() {
  const user = await getCurrentUser();
  const denied = forbid(user, "kb.view");
  if (denied) return denied;

  const ids = await entitledDocumentIds(db, { humanId: user.id, agentId: null });
  if (ids.length === 0) return Response.json({ nodes: [], edges: [] } satisfies GraphView);

  const [documents, rawEdges] = await Promise.all([
    db.document.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        name: true,
        visibility: true,
        textStatus: true,
        collectionId: true,
        topics: true,
        keywords: true,
        kind: true,
        sourceId: true,
        collection: { select: { id: true, name: true } },
        // The external store a crawled record or catalog card came from. A
        // source node appears ONLY through an entitled document — a source
        // none of your documents came from is not disclosed.
        source: { select: { id: true, name: true, kind: true, status: true } },
      },
      orderBy: { name: "asc" },
    }),
    db.knowledgeEdge.findMany({
      where: { fromId: { in: ids }, toId: { in: ids } },
      select: { fromId: true, toId: true, kind: true, weight: true, evidence: true },
      orderBy: [{ weight: "desc" }, { id: "asc" }],
    }),
  ]);

  const nodes: GraphNode[] = documents.map((d) => ({
    id: d.id,
    kind: "document",
    name: d.name,
    visibility: d.visibility,
    textStatus: d.textStatus,
    collectionId: d.collectionId,
    topics: stringList(d.topics),
    keywords: stringList(d.keywords).slice(0, 8),
    docKind: d.kind === "CATALOG" ? "CATALOG" : "FILE",
    sourceId: d.sourceId,
  }));
  const shelves = new Map<string, { name: string; size: number }>();
  const sources = new Map<string, { name: string; kind: string; status: string; size: number }>();
  const edges: GraphEdge[] = [];
  for (const d of documents) {
    if (d.collection) {
      const shelf = shelves.get(d.collection.id) ?? { name: d.collection.name, size: 0 };
      shelf.size++;
      shelves.set(d.collection.id, shelf);
      edges.push({ from: d.id, to: `collection:${d.collection.id}`, kind: "MEMBER", weight: 1, evidence: [] });
    }
    if (d.source) {
      const src = sources.get(d.source.id) ?? { name: d.source.name, kind: d.source.kind, status: d.source.status, size: 0 };
      src.size++;
      sources.set(d.source.id, src);
      edges.push({ from: d.id, to: `source:${d.source.id}`, kind: "FROM_SOURCE", weight: 1, evidence: [] });
    }
  }
  for (const [id, shelf] of shelves) {
    nodes.push({ id: `collection:${id}`, kind: "collection", name: shelf.name, size: shelf.size });
  }
  for (const [id, src] of sources) {
    nodes.push({ id: `source:${id}`, kind: "source", name: src.name, sourceKind: src.kind, status: src.status, size: src.size });
  }
  // Both ends entitled by construction (the WHERE above); dedupe the pair
  // (A,B,kind) and (B,A,kind), which rebuildEdgesFor can leave in both
  // directions across two runs.
  const seen = new Set<string>();
  for (const e of rawEdges) {
    const key = [e.fromId, e.toId].sort().join("|") + "|" + e.kind;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ from: e.fromId, to: e.toId, kind: e.kind, weight: Number(e.weight), evidence: stringList(e.evidence) });
  }

  return Response.json({ nodes, edges } satisfies GraphView);
}
