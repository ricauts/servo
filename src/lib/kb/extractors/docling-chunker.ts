// The structure-aware chunker over DoclingDocument (dcl-04). It walks the
// document's item tree IN NODE — no Docling chunking endpoint is called;
// whether docling-serve exposes one is UNVERIFIED and deliberately not
// adopted here, so a later item can take it on purpose rather than by
// accident.
//
// Structure rules:
//   - HEADING PATH: a section's heading path (H1 › H2 › H3) is prefixed
//     into every chunk beneath it, mirroring §5's header-row-repetition
//     rule for spreadsheets. Consecutive headings with no text between
//     them nest (chapter › section); a heading after body content starts a
//     new path at depth 1. The path joins with " › " and caps at three
//     levels.
//   - TABLES: whole up to DOC_TABLE_CELL_CAP cells; over the cap they
//     split by row groups WITH THE HEADER ROW REPEATED, each piece
//     carrying its own {page, bbox, label:"table"} locator.
//   - PAGE FURNITURE: a short text that appears identically on every page
//     (a running footer) is furniture and produces NO chunk.
//   - READING ORDER: chunks follow the item order; indexes are monotonic.
//
// Keyword de-weighting: each emitted chunk carries the additive locator
// key `headingPrefixEnd` — the number of leading characters that are the
// heading prefix, not the body. keywordPass(text, topN, { prefixEnd })
// counts keyword frequency only past that boundary, so a term appearing
// ONLY in the prefix never enters the chunk's keywords. The key is
// machine-only like bbox: formatLocator never renders it (dcl-02's
// passthrough contract).

import type { ExtractedChunk } from "./index";
import type { TableItemT, DoclingDocumentT } from "./docling-schema";

/** Cells per chunk before a table splits into row groups. */
export const DOC_TABLE_CELL_CAP = 600;
/** A repeated text longer than this is real content, not furniture. */
export const DOC_FURNITURE_MAX_CHARS = 120;
/** The heading-path separator, promised by the acceptance's "H1 › H2 › H3". */
export const HEADING_SEP = " › ";
/** Heading paths cap at three levels. */
export const MAX_HEADING_DEPTH = 3;

/** The additive locator key naming the prefix boundary. */
export const HEADING_PREFIX_END_KEY = "headingPrefixEnd";

function pageSizes(doc: DoclingDocumentT): Map<number, { width: number; height: number } | undefined> {
  return new Map(doc.pages.map((p) => [p.page_no, p.size]));
}

function normalizeFurniture(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/** Items whose identical short text appears on every page (≥2 pages) are
 *  running furniture: they carry no information a citation needs. */
function furnitureTexts(doc: DoclingDocumentT): Set<string> {
  const pagesBy = new Map<string, Set<number>>();
  for (const item of doc.items) {
    if (item.item_type === "table" || item.item_type === "picture") continue;
    if (!("text" in item) || typeof item.text !== "string") continue;
    if (item.text.length > DOC_FURNITURE_MAX_CHARS) continue;
    const key = normalizeFurniture(item.text);
    if (!key) continue;
    const pages = pagesBy.get(key) ?? new Set<number>();
    for (const p of item.prov ?? []) pages.add(p.page_no);
    pagesBy.set(key, pages);
  }
  const totalPages = new Set(doc.pages.map((p) => p.page_no));
  const furniture = new Set<string>();
  for (const [key, pages] of pagesBy) {
    if (pages.size >= 2 && pages.size >= Math.max(2, totalPages.size)) furniture.add(key);
  }
  return furniture;
}

function a1Col(n: number): string {
  let s = "";
  let i = n;
  while (i >= 0) {
    s = String.fromCharCode(65 + (i % 26)) + s;
    i = Math.floor(i / 26) - 1;
  }
  return s;
}

/** One table, split by row groups under the cell cap, header repeated. */
function tableChunks(item: TableItemT, sizes: Map<number, { width: number; height: number } | undefined>): ExtractedChunk[] {
  const prov = item.prov?.[0];
  const rows = item.data.num_rows;
  const cols = item.data.num_cols;
  if (rows < 1 || cols < 1) return [];
  const grid: string[][] = Array.from({ length: rows }, () => Array.from({ length: cols }, () => ""));
  for (const cell of item.data.table_cells) {
    if (cell.row < rows && cell.col < cols) grid[cell.row][cell.col] = cell.text;
  }
  const render = (rowIdxs: number[]) => rowIdxs.map((r) => `| ${grid[r].join(" | ")} |`).join("\n");

  // Row grouping: every piece keeps the header row plus as many body rows
  // as fit under the cap. (rows - 1) body rows exist after the header.
  const bodyRowsPerPiece = Math.max(1, Math.floor((DOC_TABLE_CELL_CAP / cols) - 1));
  const pieces: number[][] = [];
  for (let start = 1; start < rows || pieces.length === 0 && rows === 1; start += bodyRowsPerPiece) {
    const group: number[] = [];
    for (let r = start; r < rows && r < start + bodyRowsPerPiece; r++) group.push(r);
    if (group.length > 0) pieces.push(group);
    if (rows === 1) break;
  }
  if (pieces.length === 0) pieces.push([]);

  const locatorBase: Record<string, unknown> = { label: "table" };
  if (prov) {
    locatorBase.page = prov.page_no;
    const size = sizes.get(prov.page_no);
    if (prov.bbox && size && size.width > 0 && size.height > 0) {
      const { l, t, r, b } = prov.bbox;
      const box = { x: l / size.width, y: t / size.height, w: (r - l) / size.width, h: (b - t) / size.height };
      if ([box.x, box.y, box.w, box.h].every((v) => v >= 0 && v <= 1)) locatorBase.bbox = box;
    }
  }

  return pieces.map((group) => ({
    // The header row repeats in every piece — the spreadsheet rule.
    text: render([0, ...group]),
    locator: { ...locatorBase } as Record<string, unknown>,
  }));
}

/** Walk the item tree in reading order and emit structure-aware chunks. */
export function chunkDoclingDocument(doc: DoclingDocumentT): ExtractedChunk[] {
  const sizes = pageSizes(doc);
  const furniture = furnitureTexts(doc);
  const chunks: ExtractedChunk[] = [];
  let path: string[] = [];
  let lastWasHeading = false;

  for (const item of doc.items) {
    if (item.item_type === "picture") continue;

    if (item.item_type === "table" && "data" in item) {
      // A table's text carries no heading prefix (the header row is its
      // own prefix), so no headingPrefixEnd key rides its locator.
      for (const piece of tableChunks(item as TableItemT, sizes)) chunks.push(piece);
      lastWasHeading = false;
      continue;
    }

    if (!("text" in item) || typeof item.text !== "string" || !item.text.trim()) continue;
    if (furniture.has(normalizeFurniture(item.text))) continue; // page furniture: no chunk
    const prov = item.prov?.[0];
    if (!prov) continue;

    if (item.item_type === "section-header") {
      // Consecutive headings nest; a heading after content restarts.
      const depth = lastWasHeading ? Math.min(path.length + 1, MAX_HEADING_DEPTH) : 1;
      path = path.slice(0, depth - 1);
      path[depth - 1] = item.text.trim();
      path = path.slice(0, depth);
    }

    // A heading's own prefix is its ANCESTORS; body text carries the full
    // path including the heading itself.
    const isHeading = item.item_type === "section-header";
    const prefix = (isHeading ? path.slice(0, -1) : path).join(HEADING_SEP);
    const text = prefix ? `${prefix}${HEADING_SEP}${item.text}` : item.text;
    const locator: Record<string, unknown> = { page: prov.page_no };
    const size = sizes.get(prov.page_no);
    if (prov.bbox && size && size.width > 0 && size.height > 0) {
      const { l, t, r, b } = prov.bbox;
      const box = { x: l / size.width, y: t / size.height, w: (r - l) / size.width, h: (b - t) / size.height };
      if ([box.x, box.y, box.w, box.h].every((v) => v >= 0 && v <= 1)) locator.bbox = box;
    }
    if (item.item_type === "text" && "label" in item && typeof item.label === "string") locator.label = item.label;
    if (item.self_ref) locator.ref = item.self_ref;
    if (prefix) locator[HEADING_PREFIX_END_KEY] = prefix.length + HEADING_SEP.length;

    chunks.push({ text, locator });
    lastWasHeading = item.item_type === "section-header";
  }
  return chunks;
}
