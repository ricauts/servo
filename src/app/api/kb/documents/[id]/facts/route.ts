import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { forbid } from "@/lib/permissions";
import { entitledDocumentIds } from "@/lib/kb/entitlement";

export const dynamic = "force-dynamic";

/**
 * The typed facts of ONE document (ext-08), for the chips on its detail page.
 *
 * The gate first, the id second, and in that order on purpose: `kb.view`
 * answers 403 before any id is consulted, and a document outside the
 * entitlement oracle answers the SAME 404 an unknown id answers. Neither
 * branch carries a count, a name or a placeholder — "3 facts you may not see"
 * is the disclosure the oracle exists to prevent, so the non-entitled answer
 * is character-identical to the unknown one.
 */

/** The most facts one document's chip panel renders. A cap on OUR OWN
 *  document's rows — nothing about entitlement — so saying it was reached is
 *  not a disclosure. */
export const FACTS_PAGE_CAP = 500;

export interface FactChipRow {
  id: string;
  kind: string;
  /** The surface form, exactly as the document spells it. */
  text: string;
  norm: string;
  offset: number;
  length: number;
  confidence: string;
  unit: string;
  /** MONEY: minor units. DURATION: seconds. QUANTITY: the value. */
  num: string | null;
  /** DATE only: the half-open interval, epoch ms as strings (BigInt). */
  ts: string | null;
  tsEnd: string | null;
  chunkId: string;
  chunkIndex: number;
}

export interface FactsResponse {
  facts: FactChipRow[];
  truncated: boolean;
  /** The document's own date — the `refDate` its extraction ran against, and
   *  the value an ASSUMED relative date was resolved from. */
  documentDate: string;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  const denied = forbid(user, "kb.view");
  if (denied) return denied;

  const { id } = await params;
  const readable = await entitledDocumentIds(db, { humanId: user.id, agentId: null });
  if (!readable.includes(id)) {
    return Response.json({ error: "Unknown document." }, { status: 404 });
  }

  const document = await db.document.findUnique({ where: { id }, select: { createdAt: true } });
  if (!document) return Response.json({ error: "Unknown document." }, { status: 404 });

  const rows = await db.documentFact.findMany({
    where: { documentId: id },
    // Reading order, and stable: the chips follow the document, and two
    // requests for the same document return the same list in the same order.
    orderBy: [{ chunk: { index: "asc" } }, { offset: "asc" }, { kind: "asc" }],
    take: FACTS_PAGE_CAP + 1,
    select: {
      id: true,
      kind: true,
      text: true,
      norm: true,
      offset: true,
      length: true,
      confidence: true,
      unit: true,
      num: true,
      ts: true,
      tsEnd: true,
      chunkId: true,
      chunk: { select: { index: true } },
    },
  });

  const truncated = rows.length > FACTS_PAGE_CAP;
  const facts: FactChipRow[] = rows.slice(0, FACTS_PAGE_CAP).map((r) => ({
    id: r.id,
    kind: r.kind,
    text: r.text,
    norm: r.norm,
    offset: r.offset,
    length: r.length,
    confidence: r.confidence,
    unit: r.unit,
    // Decimal and BigInt are not JSON values: both cross as strings, and the
    // reader that needs a number parses one rather than receiving a rounded
    // double it cannot tell from an exact one.
    num: r.num === null ? null : r.num.toString(),
    ts: r.ts === null ? null : r.ts.toString(),
    tsEnd: r.tsEnd === null ? null : r.tsEnd.toString(),
    chunkId: r.chunkId,
    chunkIndex: r.chunk.index,
  }));

  const body: FactsResponse = {
    facts,
    truncated,
    documentDate: document.createdAt.toISOString().slice(0, 10),
  };
  return Response.json(body);
}
