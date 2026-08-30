// The pluggable extractor interface (dcl-01). Everything downstream of an
// extractor — ingest, chunks, citations — sees ONLY ExtractedChunk:
// chunking happens INSIDE the extractor, and no downstream code ever sees
// file structure again. LANE 1 is baseline.ts alone (the kb-04/06/07
// paths, no behaviour change); the external-parser lane (dcl-03+) plugs in here
// later, beside it, without touching a caller.

/** One chunk with its format's own locator ({sheet, range} / {page} /
 *  {lines}). Additive keys only — dcl-02 owns that contract. */
export interface ExtractedChunk {
  text: string;
  locator: Record<string, unknown>;
}

/** The one outcome shape every extractor returns. */
export type ExtractOutcome =
  | {
      status: "EXTRACTED";
      /** The whole document's text (chunks joined) — the summary source. */
      text: string;
      chunks: ExtractedChunk[];
    }
  | { status: "UNSUPPORTED"; error: string }
  | {
      status: "FAILED";
      error: string;
      /** Which cap fired, for tests and the audit trail. */
      breach?: "entries" | "decompressed" | "wall-clock" | "heap" | "xxe" | "crash" | "budget";
    };

/** What an extractor receives. sniffedType comes from the MAGIC BYTES,
 *  never from the client-declared multipart Content-Type — a declared type
 *  that lies about a real xlsx still routes to the xlsx path. */
export interface ExtractInput {
  bytes: Buffer;
  /** The magic-byte route: "xlsx" | "pdf" | "text" | the declared type. */
  sniffedType: string;
  /** The client-declared Content-Type — carried for messages, never routing. */
  declaredType: string;
  /** Aborts at kb.extract.workerBudgetMs — a hung extractor is killed. */
  signal: AbortSignal;
}

/** A pluggable extractor. version names the EXACT library versions that
 *  produced the chunks, so a stored chunk set can name its provenance. */
export interface Extractor {
  id: string;
  version: string;
  supports(sniffedType: string): boolean;
  extract(input: ExtractInput): Promise<ExtractOutcome>;
}

/** First extractor whose supports() accepts the sniffed route. The registry
 *  is a parameter so a test can stub a hung extractor without touching the
 *  shipped one. */
export function pickExtractor(
  sniffedType: string,
  registry: readonly Extractor[],
): Extractor | null {
  for (const extractor of registry) {
    if (extractor.supports(sniffedType)) return extractor;
  }
  return null;
}

/**
 * Selection (dcl-05): baseline whenever the Docling lane is unset — with
 * the url empty the docling module is never even IMPORTED (dynamic, below),
 * let alone constructed. When the lane is configured, a sniffed type the
 * admin opted into routes to Docling; everything else stays baseline.
 * Selection is on the SNIFFED type from dcl-01, never the declared one:
 * the config's types list carries declared mimes, and the lane maps the
 * sniffed routes onto them itself.
 */
export async function resolveExtractor(
  sniffedType: string,
  docling: import("@/lib/kb/settings").DoclingConfig | null,
  registry: readonly Extractor[],
): Promise<Extractor | null> {
  const baseline = pickExtractor(sniffedType, registry);
  if (!docling || !docling.url) return baseline;
  const { makeDoclingExtractor } = await import("./docling");
  const lane = makeDoclingExtractor(docling);
  return lane.supports(sniffedType) ? lane : baseline;
}
