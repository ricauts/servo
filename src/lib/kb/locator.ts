// The locator contract (dcl-02): ONE schema family, ONE renderer, additive
// keys only. Every chunk locator ever stored passes one of these schemas,
// and every citation string a reader sees comes out of formatLocator().
//
// THE RULE, VERBATIM: existing keys keep their meaning forever, new keys
// are additive, no consumer may require a key it did not previously
// require. .passthrough() is what makes that mechanical — an old reader
// handed a locator with keys it has never heard of still validates, still
// renders, and still finds the keys it knows.
//
// Rendering note, recorded honestly: the design document's marker example
// shows "sheet 2026 · B4:D9", but the shipped renderer has always joined
// sheet and range with a space ("sheet 2026 B4:D9") and dcl-02's own
// byte-identity clause governs — so the space stays, and the " · " join is
// exactly where the acceptance demands it: the label.

import { z } from "zod";

/**
 * A bounding box normalized 0-1 with a TOP-LEFT origin, so it survives any
 * render scale and any page size. x/y is the box's top-left corner; w/h
 * its extent; all four are fractions of the page (or sheet) — never
 * pixels, never points, never bottom-left.
 */
export const BBox = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().min(0).max(1),
  h: z.number().min(0).max(1),
});

/** kb-06: an xlsx chunk's A1 window. {sheet, range} required forever. */
export const SheetLocator = z
  .object({
    sheet: z.string().min(1),
    range: z.string().min(1),
    label: z.string().min(1).optional(),
    ref: z.string().min(1).optional(),
    table: z.string().min(1).optional(),
    cell: z.string().min(1).optional(),
    bbox: BBox.optional(),
  })
  .passthrough();

/** kb-07: a PDF chunk's page window. Pages are 1-BASED — page 1 is the
 *  first page, page 0 does not exist. pageEnd names the last page of a
 *  multi-page window (inclusive), when a window spans pages. */
export const PageLocator = z
  .object({
    page: z.number().int().min(1),
    pageEnd: z.number().int().min(1).optional(),
    label: z.string().min(1).optional(),
    bbox: BBox.optional(),
  })
  .passthrough();

/** kb-04: a text/markdown chunk's line window, "120-180" or "120". */
export const LineLocator = z
  .object({
    lines: z.string().min(1),
    label: z.string().min(1).optional(),
  })
  .passthrough();

export type SheetLocator = z.infer<typeof SheetLocator>;
export type PageLocator = z.infer<typeof PageLocator>;
export type LineLocator = z.infer<typeof LineLocator>;
export type BBox = z.infer<typeof BBox>;

/**
 * The SINGLE owner of citation strings. Byte-identical to what kb-11's
 * tools and kb-12's markers produced before this module existed — the
 * recorded strings are pinned in tests/kb-locator.test.ts:
 *
 *   {sheet:"2026", range:"B4:D9"}      → "sheet 2026 B4:D9"
 *   {page:12}                          → "page 12"
 *   {page:12, label:"table"}           → "page 12 · table"
 *   {lines:"120-180"}                  → "lines 120-180"
 *   anything else (or not an object)   → "location unknown"
 *
 * pageEnd renders as a span ("page 12-14") when it extends past page;
 * bbox, ref, table and cell are for machines, not readers, and never
 * render.
 */
export function formatLocator(locator: unknown): string {
  if (typeof locator !== "object" || locator === null) return "location unknown";
  const l = locator as Record<string, unknown>;
  const label = typeof l.label === "string" && l.label ? ` · ${l.label}` : "";
  if (typeof l.sheet === "string" && l.sheet) {
    const range = typeof l.range === "string" && l.range ? ` ${l.range}` : "";
    return `sheet ${l.sheet}${range}${label}`;
  }
  if (typeof l.page === "number" && Number.isInteger(l.page) && l.page >= 1) {
    const end = typeof l.pageEnd === "number" && l.pageEnd > l.page ? `-${l.pageEnd}` : "";
    return `page ${l.page}${end}${label}`;
  }
  if (typeof l.lines === "string" && l.lines) return `lines ${l.lines}${label}`;
  return "location unknown";
}
