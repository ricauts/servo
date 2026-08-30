// The registry runner (dcl-01): sniff, pick, extract — plus the provenance
// the Document row records. Lives here, beside the interface, so the
// low-level fork module (../extract.ts) stays free of registry imports
// except through this module's lazy use.

import { runExtractionJob, sniffRoute, DEFAULT_EXTRACT_BUDGET_MS } from "@/lib/kb/extract";
import { BASELINE_EXTRACTORS } from "./baseline";
import { pickExtractor, type ExtractOutcome, type Extractor } from "./index";

export interface ExtractDocumentOptions {
  /** Overrides the shipped registry — tests stub hung extractors here. */
  registry?: readonly Extractor[];
  /** Carries kb.extract.workerBudgetMs; created when the caller has none. */
  signal?: AbortSignal;
  budgetMs?: number;
}

export interface RanExtraction {
  outcome: ExtractOutcome;
  /** Which extractor ran — "" when nothing supports the sniffed route. */
  extractorId: string;
  extractorVersion: string;
  sniffedType: string;
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
  const extractor = pickExtractor(sniffedType, registry);
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
  const outcome = await Promise.race([
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
  return { outcome, extractorId: extractor.id, extractorVersion: extractor.version, sniffedType };
}

export { DEFAULT_EXTRACT_BUDGET_MS };
