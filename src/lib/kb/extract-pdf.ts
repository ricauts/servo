// PDF chunking (spec kb-07). Pure: per-page text in, chunks with {page}
// locators out — no unpdf here, no database, no provider. The forked worker
// (kb-05) parses the file and extracts the text layer per page; THIS module
// owns the locator math citations depend on ("per the manual, page 12").
//
// Chunk shape: one chunk per page with a {page} locator. An oversized page
// splits by paragraph, each part carrying a 1-based ordinal ({page, part}).
// A PDF whose text layer is empty on every page is a scanned document: it
// lands UNSUPPORTED with a message that says exactly that — never a silent
// EXTRACTED-with-nothing, and never a FAILED (the file is fine; the text
// layer is absent). OCR is CONDITIONAL (dcl-08): this module owns the three
// exact strings, and WHICH one a document gets depends on the install —
// baseline-only, high-fidelity-configured-but-unreachable, or over the
// sidecar's page cap. The rewrite happens in docling.ts's fallback, where
// the reason is known.

/** Max characters a single page may contribute to one chunk before it
 *  splits by paragraph. */
export const PDF_LIMITS = {
  pageCharCap: 8_000,
} as const;

export interface PdfChunk {
  text: string;
  locator: { page: number; part?: number };
}

/** The exact message for a text-layer-free PDF on an install with NO
 *  high-fidelity extractor configured — pinned by test. */
export const SCANNED_PDF_ERROR =
  "No text layer — this looks like a scanned document. OCR is not available.";

/** The exact message for a text-layer-free PDF on an install where the
 *  high-fidelity extractor IS configured but could not be reached — pinned
 *  by test. Saying "OCR is not available" here would be false claims
 *  discipline: the install has OCR and one retry away from working. */
export const OCR_UNAVAILABLE_ERROR =
  "OCR was unavailable — the high-fidelity extractor could not be reached. Re-extract to try again.";

/** The exact message when the document is over the sidecar's page cap, so
 *  OCR was never attempted — pinned by test. Names the cap AND the setting
 *  an operator raises. */
export function ocrPageCapError(maxPages: number): string {
  return `This document is over the high-fidelity extractor's ${maxPages}-page cap (kb.extract.docling.maxPages). OCR was not attempted; raise the cap or split the document.`;
}

export function chunkPdfPages(
  pages: string[],
): { status: "EXTRACTED"; chunks: PdfChunk[] } | { status: "UNSUPPORTED"; error: string } {
  if (pages.length === 0 || pages.every((p) => !p.trim())) {
    return { status: "UNSUPPORTED", error: SCANNED_PDF_ERROR };
  }

  const chunks: PdfChunk[] = [];
  pages.forEach((page, i) => {
    const text = page.trim();
    if (!text) return; // a mixed document: blank pages contribute nothing
    const pageNo = i + 1;
    if (text.length <= PDF_LIMITS.pageCharCap) {
      chunks.push({ text, locator: { page: pageNo } });
      return;
    }
    // Oversized page: split by paragraph, greedily packed to the cap; a
    // single paragraph longer than the cap hard-splits rather than dropping.
    const parts: string[] = [];
    let buffer = "";
    for (const para of text.split(/\n\s*\n/)) {
      const candidate = buffer ? `${buffer}\n\n${para}` : para;
      if (candidate.length > PDF_LIMITS.pageCharCap && buffer) {
        parts.push(buffer);
        buffer = para;
      } else {
        buffer = candidate;
      }
      while (buffer.length > PDF_LIMITS.pageCharCap) {
        parts.push(buffer.slice(0, PDF_LIMITS.pageCharCap));
        buffer = buffer.slice(PDF_LIMITS.pageCharCap);
      }
    }
    if (buffer) parts.push(buffer);
    parts.forEach((part, j) => chunks.push({ text: part, locator: { page: pageNo, part: j + 1 } }));
  });
  return { status: "EXTRACTED", chunks };
}
