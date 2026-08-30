// DoclingDocument → chunks with dcl-02 locators (dcl-03). The mapper is
// PURE: a validated document in, ExtractedChunk[] out — no transport, no
// clock, no database. Every locator it emits validates against the dcl-02
// schemas; that is asserted per fixture in tests, and it is the property
// that makes a Docling chunk citable by exactly the same renderer as an
// xlsx or PDF chunk.
//
// Mapping decisions, recorded:
//   - page: prov.page_no is already 1-based in the format.
//   - bbox: Docling points (top-left origin, {l,t,r,b}) normalize to 0-1
//     against the page's own size; a page with no declared size yields no
//     bbox rather than a guess.
//   - label: item label ("service-intervals") or the section header's own
//     text — a reader-visible name for the span.
//   - ref: the item's self_ref ("#/tables/0"), the stable pointer back.
//   - tables: one chunk per table, rendered as markdown-ish rows, with
//     {sheet, range, table, cell} — sheet is the label (Docling has no
//     sheet concept; a table in a converted workbook names its sheet),
//     range is the A1 window of the grid, table the label, cell the first
//     data cell.

import type { ExtractedChunk } from "./index";
import { PageLocator, SheetLocator, type BBox } from "@/lib/kb/locator";
import type { DoclingDocumentT, TableItemT } from "./docling-schema";

function normalizedBbox(
  prov: { bbox?: { l: number; t: number; r: number; b: number } },
  pageSize: { width: number; height: number } | undefined,
): BBox | undefined {
  if (!prov.bbox || !pageSize || pageSize.width <= 0 || pageSize.height <= 0) return undefined;
  const { l, t, r, b } = prov.bbox;
  const box: BBox = {
    x: l / pageSize.width,
    y: t / pageSize.height,
    w: (r - l) / pageSize.width,
    h: (b - t) / pageSize.height,
  };
  // Out-of-range after normalization means the source geometry is wrong;
  // the dcl-02 schema would reject it, so do not emit it at all.
  return box.x >= 0 && box.x <= 1 && box.y >= 0 && box.y <= 1 && box.w >= 0 && box.w <= 1 && box.h >= 0 && box.h <= 1
    ? box
    : undefined;
}

function pageSizeFor(doc: DoclingDocumentT, pageNo: number) {
  return doc.pages.find((p) => p.page_no === pageNo)?.size;
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

function tableChunk(item: TableItemT): ExtractedChunk | null {
  const label = item.label ?? "table";
  const rows = item.data.num_rows;
  const cols = item.data.num_cols;
  if (rows < 1 || cols < 1) return null;
  const grid: string[][] = Array.from({ length: rows }, () => Array.from({ length: cols }, () => ""));
  for (const cell of item.data.table_cells) {
    if (cell.row < rows && cell.col < cols) grid[cell.row][cell.col] = cell.text;
  }
  const text = grid.map((r) => `| ${r.join(" | ")} |`).join("\n");
  const range = `A1:${a1Col(cols - 1)}${rows}`;
  const locator = {
    sheet: label,
    range,
    table: label,
    cell: "A1",
    ...(item.self_ref ? { ref: item.self_ref } : {}),
  };
  return { text, locator: locator as Record<string, unknown> };
}

/** Pure map: every text/title/header/table item becomes one chunk whose
 *  locator validates against dcl-02. Pictures carry no text in this
 *  subset and yield nothing. */
export function mapDoclingDocument(doc: DoclingDocumentT): ExtractedChunk[] {
  const chunks: ExtractedChunk[] = [];
  for (const item of doc.items) {
    const prov = item.prov?.[0];
    if (item.item_type === "table" && "data" in item) {
      const c = tableChunk(item as TableItemT);
      if (c) chunks.push(c);
      continue;
    }
    if (item.item_type === "picture") continue;
    if (!("text" in item) || typeof item.text !== "string" || !item.text.trim()) continue;
    if (!prov) continue;
    const label =
      item.item_type === "section-header" ? item.text : "label" in item && typeof item.label === "string" ? item.label : undefined;
    const locator: Record<string, unknown> = { page: prov.page_no };
    const bbox = normalizedBbox(prov, pageSizeFor(doc, prov.page_no));
    if (bbox) locator.bbox = bbox;
    if (label) locator.label = label;
    if (item.self_ref) locator.ref = item.self_ref;
    chunks.push({ text: item.text, locator });
  }
  return chunks;
}

/** Contract check used by tests and by the live lane: every mapped chunk
 *  validates against one of the dcl-02 schemas. */
export function mappedLocatorsValidate(chunks: ExtractedChunk[]): boolean {
  return chunks.every((c) => {
    const l = c.locator as Record<string, unknown>;
    return PageLocator.safeParse(l).success || SheetLocator.safeParse(l).success;
  });
}
