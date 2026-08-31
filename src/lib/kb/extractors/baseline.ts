// The baseline registry (dcl-01): the kb-04/06/07 extraction paths wrapped
// behind the Extractor interface with NO behaviour change. Each extractor
// owns its chunking — the locator math already lives in extract-xlsx.ts
// and extract-pdf.ts, and text chunking in chunk.ts; this file only wires
// them behind supports()/extract().
//
// The versions name the exact libraries that produce the chunks;
// tests/kb-extractor-interface.test.ts pins them against package.json so a
// dependency bump cannot drift the provenance silently.

import { chunkMarkdown } from "@/lib/kb/chunk";
import { chunkSpreadsheetSheets } from "@/lib/kb/extract-xlsx";
import { chunkPdfPages } from "@/lib/kb/extract-pdf";
import { runExtractionJob } from "@/lib/kb/extract";
import { LineLocator, PageLocator, SheetLocator } from "@/lib/kb/locator";
import type { ExtractInput, Extractor, ExtractOutcome } from "./index";

const EXCELJS_VERSION = "4.4.0";
const UNPDF_VERSION = "1.8.1";

/** The route handed to the worker: the sniffed magic-byte route when the
 *  sniff had something to say, the DECLARED type when it did not — the
 *  worker's declared-type branches (the legacy-.xls refusal among them)
 *  still answer exactly as before. */
function routeFor(sniffedType: string, declaredType: string): string {
  return sniffedType === "xlsx" || sniffedType === "pdf" || sniffedType === "text"
    ? sniffedType
    : declaredType;
}

/** xlsx: the Office Open XML family plus the legacy-.xls declared types —
 *  the same set the worker dispatches on, so the worker's specific
 *  "save as .xlsx" refusal still reaches the reader. */
export const xlsxExtractor: Extractor = {
  id: "baseline-xlsx",
  version: `exceljs@${EXCELJS_VERSION};kb-06@1`,
  supports: (sniffedType) =>
    sniffedType === "xlsx" || /spreadsheetml|ms-excel|excel|sheet/.test(sniffedType),
  extract: async (input: ExtractInput): Promise<ExtractOutcome> => {
    // The worker parses and normalizes; this module owns the windowing and
    // the A1 locator math (kb-06).
    const raw = await runExtractionJob(input.bytes, routeFor(input.sniffedType, input.declaredType), { signal: input.signal });
    if (!raw.ok) return { status: raw.status, error: raw.error, ...(raw.breach ? { breach: raw.breach } : {}) };
    const verdict = chunkSpreadsheetSheets(raw.kind === "sheets" ? raw.sheets : []);
    if (verdict.status === "UNSUPPORTED") return { status: "UNSUPPORTED", error: verdict.error };
    return {
      status: "EXTRACTED",
      text: verdict.chunks.map((c) => c.text).join("\n\n"),
      chunks: verdict.chunks,
    };
  },
};

/** PDF: one chunk per page with {page} locators (kb-07). */
export const pdfExtractor: Extractor = {
  id: "baseline-pdf",
  version: `unpdf@${UNPDF_VERSION};kb-07@1`,
  supports: (sniffedType) => sniffedType === "pdf" || sniffedType === "application/pdf",
  extract: async (input: ExtractInput): Promise<ExtractOutcome> => {
    const raw = await runExtractionJob(input.bytes, routeFor(input.sniffedType, input.declaredType), { signal: input.signal });
    if (!raw.ok) return { status: raw.status, error: raw.error, ...(raw.breach ? { breach: raw.breach } : {}) };
    const verdict = chunkPdfPages(raw.kind === "pages" ? raw.pages : []);
    if (verdict.status === "UNSUPPORTED") return { status: "UNSUPPORTED", error: verdict.error };
    return {
      status: "EXTRACTED",
      text: verdict.chunks.map((c) => c.text).join("\n\n"),
      chunks: verdict.chunks,
    };
  },
};

/** Plain text and markdown: line-accurate {lines} chunking (kb-04). */
export const textExtractor: Extractor = {
  id: "baseline-text",
  version: "kb-04@1",
  supports: (sniffedType) =>
    sniffedType === "text" ||
    sniffedType === "text/markdown" ||
    sniffedType === "text/plain" ||
    sniffedType === "application/markdown",
  extract: async (input: ExtractInput): Promise<ExtractOutcome> => {
    const raw = await runExtractionJob(input.bytes, routeFor(input.sniffedType, input.declaredType), { signal: input.signal });
    if (!raw.ok) return { status: raw.status, error: raw.error, ...(raw.breach ? { breach: raw.breach } : {}) };
    const text = raw.kind === "text" ? raw.text : "";
    const chunks = chunkMarkdown(text);
    return {
      status: "EXTRACTED",
      text,
      chunks: chunks.map((c) => ({ text: c.text, locator: c.locator as Record<string, unknown> })),
    };
  },
};

/**
 * The locator contract at the emission site (dcl-02): every chunk a
 * baseline extractor emits must validate against one of the three
 * schemas — a chunk that cannot be cited by contract is a bug here, not
 * a renderer problem later.
 */
export function locatorContractOk(
  chunks: Array<{ locator: Record<string, unknown> }>,
  kind: "sheet" | "page" | "lines",
): boolean {
  const schema = kind === "sheet" ? SheetLocator : kind === "page" ? PageLocator : LineLocator;
  return chunks.every((c) => schema.safeParse(c.locator).success);
}

/** LANE 1: the shipped registry, in pick order. */
export const BASELINE_EXTRACTORS: readonly Extractor[] = [
  xlsxExtractor,
  pdfExtractor,
  textExtractor,
];
