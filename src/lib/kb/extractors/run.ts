// The registry runner (dcl-01, selection added by dcl-05): sniff, pick,
// extract — plus the provenance the Document row records. Lives here,
// beside the interface, so the low-level fork module (../extract.ts) stays
// free of registry imports except through this module's lazy use.

import { runExtractionJob, sniffRoute, DEFAULT_EXTRACT_BUDGET_MS } from "@/lib/kb/extract";
import { BASELINE_EXTRACTORS } from "./baseline";
import { pickExtractor, resolveExtractor, type ExtractOutcome, type Extractor } from "./index";
import type { DoclingConfig } from "@/lib/kb/settings";

export interface ExtractDocumentOptions {
  /** Overrides the shipped registry — tests stub hung extractors here. */
  registry?: readonly Extractor[];
  /** Carries kb.extract.workerBudgetMs; created when the caller has none. */
  signal?: AbortSignal;
  budgetMs?: number;
  /** The resolved Docling lane configuration (dcl-05). Null or an empty
   *  url keeps selection on baseline and the docling module unconstructed. */
  docling?: DoclingConfig | null;
}

export interface RanExtraction {
  outcome: ExtractOutcome;
  /** Which extractor ran — "" when nothing supports the sniffed route. */
  extractorId: string;
  extractorVersion: string;
  sniffedType: string;
  /** The fallback reason when the preferred lane failed and BASELINE
   *  answered (dcl-05) — one of the eight-reason taxonomy, recorded in
   *  Document.extractorFallback. */
  extractorFallback?: string;
}

/** Sniff, pick and run. The budget signal is created HERE when the caller
 *  did not bring one, so even a registry-stubbed extractor that never
 *  returns dies at the budget. */
export async function extractDocument(
  bytes: Buffer,
  declaredType: string,
  opts: ExtractDocumentOptions = {},
): Promise<RanExtraction> {
  const registry = opts.registry ?? BASELINE_EXTRACTORS;
  const sniffedType = sniffRoute(bytes, declaredType);
  const extractor = await resolveExtractor(sniffedType, opts.docling ?? null, registry);
  if (!extractor) {
    return {
      outcome: { status: "UNSUPPORTED", error: `No extractor for ${declaredType} yet.` },
      extractorId: "",
      extractorVersion: "",
      sniffedType,
    };
  }
  const budgetMs = opts.budgetMs ?? DEFAULT_EXTRACT_BUDGET_MS;
  const signal = opts.signal ?? AbortSignal.timeout(budgetMs);
  // A hung extractor is KILLED by the budget: the extractor's promise is
  // raced against the signal, so one that never returns is abandoned at
  // the budget rather than awaited forever — kb-05's criterion, through
  // the new seam.
  const raced = await Promise.race([
    extractor.extract({ bytes, sniffedType, declaredType, signal }),
    new Promise<ExtractOutcome>((resolve) => {
      signal.addEventListener(
        "abort",
        () =>
          resolve({
            status: "FAILED",
            error: `Extraction exceeded ${budgetMs} ms and was killed.`,
            breach: "budget",
          }),
        { once: true },
      );
    }),
  ]);
  const fallbackOf = (raced as { fallbackOf?: string }).fallbackOf;
  return {
    outcome: raced,
    extractorId: extractor.id,
    extractorVersion: extractor.version,
    sniffedType,
    ...(fallbackOf ? { extractorFallback: fallbackOf } : {}),
  };
}

export { DEFAULT_EXTRACT_BUDGET_MS, pickExtractor };
