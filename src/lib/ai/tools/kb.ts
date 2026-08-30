// The knowledge-base tools (spec kb-11). Reads are LOW risk, no approval —
// scoping lives INSIDE execute(), exactly as history.ts withholds other
// requesters' identities: policy gates whether a call RUNS; ENTITLEMENT
// gates what it can see, and no policy edit can widen it.
//
// KB tools are NOT exposed over MCP in v1: src/lib/mcp.ts authenticates one
// shared bearer token with no user identity, so an MCP session has no human
// principal — deny or invent a fallback are the only alternatives, and
// inventing one is the exact leak this area exists to prevent.

import { formatLocator } from "@/lib/kb/locator";
import { db } from "@/lib/db";
import { kbSearch } from "@/lib/kb/search";
import { getEmbedSettings, embedWithEndpoint } from "@/lib/kb/embed";
import { mockEmbed, MOCK_EMBEDDER_MODEL } from "@/lib/kb/mock-embedder";
import type { ToolDef } from "@/lib/ai/tools/types";

const NOT_AUTHENTICATED =
  "Error: knowledge tools require a per-user token; the MCP session has no human principal.";

/** Resolve the chain, or the reason it cannot be resolved. */
function chainFor(ctx: { principals?: { agentId: string; humanId: string | null } }) {
  const principals = ctx.principals;
  if (!principals || principals.humanId === null) return null;
  return { humanId: principals.humanId, agentId: principals.agentId };
}

export const kbTools: Record<string, ToolDef> = {
  search_knowledge: {
    name: "search_knowledge",
    description:
      "Search the company knowledge base for manuals, spreadsheets and procedures. Returns ranked passages with citations (document name + locator). Only sources the requester may read are searched.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", description: "Natural-language search text." } },
      required: ["query"],
    },
    async execute(input, ctx) {
      const chain = chainFor(ctx);
      if (!chain) return NOT_AUTHENTICATED;
      const query = String(input.query ?? "").trim();
      if (!query) return "Error: query is required.";

      let vector: number[] | undefined;
      let model: string | undefined;
      try {
        const settings = await getEmbedSettings();
        if (settings.kind === "mock") {
          vector = mockEmbed(query);
          model = MOCK_EMBEDDER_MODEL;
        } else if (settings.kind === "openai-compatible") {
          const [embedded] = await embedWithEndpoint(settings, [query]);
          vector = embedded.vector;
          model = embedded.model;
        }
      } catch {
        /* embeddings failing degrades to keyword-only — same code path */
      }

      const hits = await kbSearch(db, chain, query, { limit: 8, queryVector: vector, embeddingModel: model });
      if (hits.length === 0) return "No accessible sources.";
      return hits
        .map(
          (h, i) =>
            `[${i + 1}] ${h.docName} · ${formatLocator(h.locator)}\n${h.text}`,
        )
        .join("\n\n")
        .slice(0, 4000);
    },
  },

  read_document: {
    name: "read_document",
    description:
      "Read one knowledge-base document by id, paginated by sheet/page/chunk cursor. The result names the next cursor.",
    inputSchema: {
      type: "object",
      properties: {
        documentId: { type: "string" },
        fromChunk: { type: "integer", description: "Cursor: index of the first chunk to return." },
      },
      required: ["documentId"],
    },
    async execute(input, ctx) {
      const chain = chainFor(ctx);
      if (!chain) return NOT_AUTHENTICATED;
      const documentId = String(input.documentId ?? "");
      const fromChunk = Number(input.fromChunk ?? 0) || 0;

      // The entitlement oracle, not an existence check: non-entitled and
      // non-existent return the IDENTICAL string.
      const { entitledDocumentIds } = await import("@/lib/kb/entitlement");
      const ids = await entitledDocumentIds(db, chain);
      if (!ids.includes(documentId)) {
        return "Error: no accessible document with that id.";
      }

      const PAGE = 3; // chunks per page — a locator-accurate excerpt each
      const rows = await db.$queryRawUnsafe<{ id: string; index: number; text: string; locator: string }[]>(
        `SELECT id, index, text, locator::text AS locator FROM "DocumentChunk"
          WHERE "documentId" = '${documentId.replace(/'/g, "''")}' AND index >= ${fromChunk}
          ORDER BY index LIMIT ${PAGE + 1}`,
      );
      if (rows.length === 0) {
        return fromChunk === 0
          ? "Error: no accessible document with that id."
          : "End of document.";
      }
      const page = rows.slice(0, PAGE);
      const next = rows.length > PAGE ? rows[PAGE].index : null;
      const doc = await db.document.findUnique({
        where: { id: documentId },
        select: { name: true },
      });
      const body = page
        .map((r) => `[chunk ${r.index} · ${formatLocator(safeJson(r.locator))}]\n${r.text}`)
        .join("\n\n");
      return `${doc?.name ?? "Document"}${next !== null ? `\n\nnext cursor: {"fromChunk": ${next}}` : "\n\n(end of document)"}\n\n${body}`.slice(0, 4000);
    },
  },

  list_collections: {
    name: "list_collections",
    description:
      "List knowledge-base collections with counts of documents the requester may read. Collections with zero readable documents are omitted.",
    inputSchema: { type: "object", properties: {} },
    async execute(_input, ctx) {
      const chain = chainFor(ctx);
      if (!chain) return NOT_AUTHENTICATED;
      const { humanChainCte } = await import("@/lib/kb/entitlement");
      const cte = humanChainCte(chain.humanId);
      const agentCte = chain.agentId
        ? (await import("@/lib/kb/entitlement")).agentChainCte(chain.humanId, chain.agentId)
        : cte;
      const rows = await db.$queryRawUnsafe<{ id: string; name: string; n: bigint }[]>(
        `${chain.agentId ? agentCte : cte}
         SELECT c.id, c.name, count(e.id) AS n
           FROM "Collection" c
           JOIN "Document" d ON d."collectionId" = c.id
           JOIN entitled e ON e.id = d.id
          GROUP BY c.id, c.name
          HAVING count(e.id) > 0
          ORDER BY c.name`,
      );
      if (rows.length === 0) return "No accessible collections.";
      return rows.map((r) => `${r.name} (${Number(r.n)} readable document${Number(r.n) === 1 ? "" : "s"})`).join("\n");
    },
  },
};

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

