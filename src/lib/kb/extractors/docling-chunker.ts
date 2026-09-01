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

type PageList = Array<{ page_no: number; size?: { width: number; height: number } }>;
type PageMap = Record<string, { page_no?: number; size?: { width: number; height: number } }>;

/** pages arrives BOTH ways upstream: an array (older builds) and a map
 *  keyed by page NUMBER (1.31.0). Normalize to one Map. */
function pageSizes(doc: DoclingDocumentT): Map<number, { width: number; height: number } | undefined> {
  const out = new Map<number, { width: number; height: number } | undefined>();
  const pages = doc.pages as PageList | PageMap | undefined;
  if (!pages) return out;
  if (Array.isArray(pages)) {
    for (const p of pages) out.set(p.page_no, p.size);
    return out;
  }
  for (const [key, p] of Object.entries(pages)) {
    out.set(p.page_no ?? Number(key), p.size);
  }
  return out;
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
  const totalPages = new Set(pageSizes(doc).keys());
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

  // THE REAL ARRAYS (ratified dcl-06): when upstream's texts/tables carry
  // content, walk those — section_header/document_title labels are the
  // headings (consecutive headings nest, exactly like the synthetic shape),
  // `orig` is the text, and tables split by row groups under the cell cap
  // with the header row repeated. The synthetic-era items array stays the
  // fallback so the golden corpora keep their coverage.
  if ((doc.texts?.length ?? 0) + (doc.tables?.length ?? 0) > 0) {
    for (const t of doc.texts ?? []) {
      const prov = t.prov?.[0];
      if (!prov) continue;
      const text = t.orig?.trim();
      if (!text || furniture.has(text.replace(/\s+/g, " ").trim().toLowerCase())) continue;
      const label =
        t.label === "section_header" || t.label === "document_title" ? t.label
        : t.label === "title" ? "section_header"
        : t.label;
      if (label === "section_header" || label === "document_title") {
        const depth = label === "document_title" ? 1 : lastWasHeading ? Math.min(path.length + 1, MAX_HEADING_DEPTH) : 1;
        path = path.slice(0, depth - 1);
        path[depth - 1] = text;
        path = path.slice(0, depth);
      }
      const prefix = path.join(HEADING_SEP);
      const locator: Record<string, unknown> = { page: prov.page_no };
      const size = sizes.get(prov.page_no);
      if (prov.bbox && size && size.width > 0 && size.height > 0) {
        const box = {
          x: prov.bbox.l / size.width,
          y: 1 - prov.bbox.t / size.height,
          w: (prov.bbox.r - prov.bbox.l) / size.width,
          h: (prov.bbox.t - prov.bbox.b) / size.height,
        };
        if (Object.values(box).every((v) => v >= 0 && v <= 1)) locator.bbox = box;
      }
      if (t.self_ref) locator.ref = t.self_ref;
      if (prefix) locator[HEADING_PREFIX_END_KEY] = prefix.length + HEADING_SEP.length;
      chunks.push({ text: prefix ? `${prefix}${HEADING_SEP}${text}` : text, locator });
      lastWasHeading = label === "section_header" || label === "document_title";
    }
    for (const t of doc.tables ?? []) {
      const grid = (t.data?.grid ?? []).filter((r) => r.some((c) => (c.text ?? "").trim() !== ""));
      const rows = grid.length;
      const cols = t.data?.num_cols ?? (grid[0]?.length ?? 0);
      if (rows < 1 || cols < 1) continue;
      const prov = t.prov?.[0];
      const locator: Record<string, unknown> = { label: "table" };
      if (prov) locator.page = prov.page_no;
      const label = t.label ?? t.captions?.[0];
      if (label) { locator.sheet = label; locator.table = label; }
      locator.range = `A1:${a1Col(Math.max(0, cols - 1))}${rows}`;
      locator.cell = "A1";
      if (t.self_ref) locator.ref = t.self_ref;
      // Row groups under the cell cap, header row repeated in every piece.
      const per = Math.max(1, Math.floor(DOC_TABLE_CELL_CAP / Math.max(1, cols)) - 1);
      let emitted = false;
      for (let start = 1; start < rows || !emitted; start += per) {
        const group: number[] = [];
        for (let r = start; r < rows && r < start + per; r++) group.push(r);
        const rowText = (r: number) => `| ${grid[r].map((c) => c.text ?? "").join(" | ")} |`;
        chunks.push({ text: [rowText(0), ...group.map(rowText)].join("\n"), locator: { ...locator } });
        emitted = true;
        if (start >= rows) break;
      }
    }
    return chunks;
  }

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
