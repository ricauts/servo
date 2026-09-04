// The Docling extractor (dcl-05): SELECTION, the budget invariant, the
// fallback taxonomy and the circuit breaker, over the dcl-03 client and
// the dcl-04 chunker.
//
// LANE 1: with kb.extract.docling.url empty the docling module is never
// constructed — resolveExtractor() in index.ts returns baseline before
// this file's factory is even called.
//
// THE EGRESS EXEMPTION, stated: the sidecar URL does not pass through
// checkEgress — the same class as kb.embed.baseUrl, an operator-configured
// destination, not an agent-directed one. The bounds of the exemption are
// dcl-05's URL rules (validated at resolution: http/https, no credentials,
// loopback/RFC1918/ULA/compose-service host only) and redirect: "manual"
// on every request the HTTP transport makes.
//
// THE DEADLINE IS OURS, not the server's: docling-serve's
// DOCLING_SERVE_MAX_SYNC_WAIT is 120s, so we poll the async endpoints
// under our own timeoutMs; on deadline we stop polling and attempt the
// dcl-03 best-effort DELETE. Concurrency 1 and the circuit breaker are
// what bound the damage a wedged sidecar can do — one document at a time,
// and after three failures, none for ten minutes.
//
// EVERY failure falls back to BASELINE with a SPECIFIC reason recorded in
// Document.extractorFallback (dcl-01's column), and the upload SUCCEEDS
// on the baseline's own terms.

import { DoclingClient, type DoclingTransport } from "./docling-client";
import { DoclingError } from "./docling-schema";
import { chunkDoclingDocument } from "./docling-chunker";
import { OCR_UNAVAILABLE_ERROR, SCANNED_PDF_ERROR, ocrPageCapError } from "@/lib/kb/extract-pdf";
import {
  allow as circuitAllow,
  initialCircuit,
  isOpen as circuitOpen,
  recordFailure,
  recordSuccess,
  type CircuitState,
} from "./docling-health";
import type { ExtractInput, ExtractOutcome, Extractor } from "./index";
import { BASELINE_EXTRACTORS } from "./baseline";
import type { DoclingConfig } from "@/lib/kb/settings";

/** The fallback taxonomy — every reason the lane ever records. */
export type DoclingFallbackReason =
  | "docling-unreachable"
  | "docling-timeout"
  | "docling-http-5xx"
  | "docling-schema-invalid"
  | "docling-oversize-body"
  | "docling-page-cap"
  | "docling-circuit-open"
  | "docling-task-abandoned";

/** An outcome carrying the fallback reason, when baseline answered. */
export type DoclingExtractOutcome = ExtractOutcome & { fallbackOf?: DoclingFallbackReason };

/** A near-empty conversion is a failed OCR pass, not an indexed blank. */
export const DOCLING_MIN_TEXT_CHARS = 200;

/** Count a PDF's pages from its raw bytes BEFORE sending them: /Type /Page
 *  in the object stream. Uncompressed page trees (every fixture and every
 *  producer default) are counted exactly; a producer that hides them
 *  reads as 0 and the page cap falls to the deadline's backstop. */
export function countPdfPages(bytes: Buffer): number {
  let n = 0;
  const text = bytes.toString("latin1");
  for (const m of text.matchAll(/\/Type\s*\/Page[^s]/g)) {
    void m;
    n++;
  }
  return n;
}

// The process-wide lane state: one conversion at a time, one circuit.
let inFlight: Promise<unknown> | null = null;
let circuit: CircuitState = initialCircuit();
const clock = () => Date.now();

/** Test seam: reset the lane state between cases. */
export function resetDoclingLaneForTests(): void {
  inFlight = null;
  circuit = initialCircuit();
}

/** Serialize conversions — the one-file-at-a-time property of §5's forked
 *  worker, not a new mutex. The queue's depth is bounded by the circuit
 *  breaker and the callers' own budgets. */
function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const run = (inFlight ?? Promise.resolve()).then(job, job);
  inFlight = run.catch(() => undefined);
  return run;
}

/** The transport the lane uses: the dcl-03 HttpTransport with redirects
 *  REFUSED — a sidecar that answers 3xx is a misconfiguration, not a hop. */
function laneTransport(): DoclingTransport {
  return {
    async request(url, init) {
      const res = await fetch(url, { ...init, redirect: "manual" });
      if (res.status >= 300 && res.status < 400) {
        throw new DoclingError("docling-transport", `refused a redirect (${res.status}) from the sidecar`);
      }
      return res;
    },
  };
}

/** Build the Docling extractor for one resolved configuration. */
export function makeDoclingExtractor(
  config: DoclingConfig,
  opts: { transport?: DoclingTransport; now?: () => number } = {},
): Extractor {
  const now = opts.now ?? clock;
  return {
    id: "docling",
    version: "docling-serve@resolved-at-convert;kb-dcl@5",
    supports: (sniffedType) => config.types.includes(sniffedType) || config.types.includes(declaredEquivalent(sniffedType)),
    extract: async (input: ExtractInput): Promise<DoclingExtractOutcome> => {
      // The circuit: while open, NO connection is attempted.
      if (circuitOpen(circuit, now())) {
        return fallback(input, "docling-circuit-open", config.maxPages);
      }
      // The page cap is enforced BEFORE the bytes are sent.
      const pages = countPdfPages(input.bytes);
      if (pages > config.maxPages) {
        return fallback(input, "docling-page-cap", config.maxPages);
      }
      const outcome = await enqueue(async () => {
        // Re-check the circuit inside the queue: earlier failures while we
        // waited may have opened it.
        if (circuitOpen(circuit, now())) return fallback(input, "docling-circuit-open", config.maxPages);
        const client = new DoclingClient({
          baseUrl: config.url,
          apiKey: config.apiKey || undefined,
          transport: opts.transport ?? laneTransport(),
          deadlineMs: config.timeoutMs,
        });
        try {
          const result = await client.convertFile(
            `document-${Date.now()}`,
            input.bytes,
            input.declaredType || "application/octet-stream",
          );
          circuit = recordSuccess();
          const chunks = chunkDoclingDocument(result.document);
          const total = chunks.reduce((n, c) => n + c.text.length, 0);
          if (total < DOCLING_MIN_TEXT_CHARS || chunks.length === 0) {
            // kb-07's low-text rule, applied to Docling output: an empty
            // or near-empty conversion is UNSUPPORTED, never a silently
            // indexed blank manual. The baseline runs first (a text PDF
            // whose conversion came back junk is rescuable), and the
            // near-empty case rides the schema-invalid reason — the
            // taxonomy has exactly the eight members the acceptance names,
            // and a conversion too empty to use is an invalid-for-purpose
            // result. If baseline cannot read it either, the document
            // lands UNSUPPORTED — with the CONDITIONAL OCR copy: this
            // install has the high-fidelity extractor configured, so the
            // "OCR is not available" string would be false. fallback()
            // already rewrote the error for exactly this shape.
            const base = await fallback(input, "docling-schema-invalid", config.maxPages);
            return base;
          }
          return { status: "EXTRACTED" as const, text: chunks.map((c) => c.text).join("\n\n"), chunks };
        } catch (err) {
          circuit = recordFailure(circuit, now());
          return fallback(input, classify(err), config.maxPages);
        }
      });
      return outcome;
    },
  };
}

/**
 * Map a thrown error onto the taxonomy. The timeout/abandoned split, said
 * plainly: docling-timeout is OUR deadline expiring while polling (the
 * client raises its docling-task-abandoned code there, after the dcl-03
 * best-effort DELETE); docling-task-abandoned is the SIDECAR's own report
 * that the task failed or vanished. 5xx submissions are http-5xx;
 * everything else the transport can raise is unreachable.
 */
function classify(err: unknown): DoclingFallbackReason {
  if (err instanceof DoclingError) {
    if (err.code === "docling-oversize") return "docling-oversize-body";
    if (err.code === "docling-bad-schema") return "docling-schema-invalid";
    if (err.code === "docling-task-abandoned") return "docling-timeout";
    if (err.code === "docling-task-failed") {
      if (/status 5\d\d/.test(err.message)) return "docling-http-5xx";
      if (/result fetch failed|no task_id/.test(err.message)) return "docling-task-abandoned";
      return "docling-task-abandoned";
    }
    if (err.code === "docling-transport") return "docling-unreachable";
  }
  const msg = err instanceof Error ? err.message : String(err);
  if (/deadline|timeout|abandoned/i.test(msg)) return "docling-timeout";
  return "docling-unreachable";
}

/** Run the BASELINE extractor for this sniffed type and tag the outcome
 *  with the fallback reason. The upload succeeds on baseline's terms.
 *
 *  THE CONDITIONAL OCR COPY (dcl-08): when baseline lands a scanned PDF
 *  UNSUPPORTED, the message must tell the truth about THIS install. An
 *  install with the high-fidelity extractor configured did not fail for
 *  lack of OCR — it failed to reach it (or never tried, over the page
 *  cap) — and kb-07's "OCR is not available" would be a false claim on
 *  such an install. The rewrite is reason-driven, exactly three strings,
 *  all pinned by tests/kb-ocr-copy.test.ts. */
async function fallback(
  input: ExtractInput,
  reason: DoclingFallbackReason,
  maxPages?: number,
): Promise<DoclingExtractOutcome> {
  const base = BASELINE_EXTRACTORS.find((e) => e.supports(input.sniffedType));
  if (!base) {
    return { status: "UNSUPPORTED", error: `No extractor for ${input.declaredType} yet.`, fallbackOf: reason };
  }
  const outcome = await base.extract(input);
  if (outcome.status === "UNSUPPORTED" && outcome.error === SCANNED_PDF_ERROR) {
    const error =
      reason === "docling-page-cap" && typeof maxPages === "number"
        ? ocrPageCapError(maxPages)
        : OCR_UNAVAILABLE_ERROR;
    return { ...outcome, error, fallbackOf: reason };
  }
  return { ...outcome, fallbackOf: reason };
}

/** The sniffed "pdf"/"xlsx"/"text" routes map onto the declared types the
 *  configuration names. */
function declaredEquivalent(sniffedType: string): string {
  if (sniffedType === "pdf") return "application/pdf";
  if (sniffedType === "xlsx") return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (sniffedType === "docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (sniffedType === "text") return "text/plain";
  return sniffedType;
}

export { circuit as doclingCircuitForTests };
export { laneTransport };

/** The extractor health surface (dcl-09): what the KB settings page shows.
 *  LANE 1: with no url configured, nothing is fetched and the version is
 *  the unknown literal — the page can still render the OFF state. */
export async function extractorHealth(
  db: import("@/lib/kb/settings").SettingReader | null,
  opts: { transport?: DoclingTransport } = {},
): Promise<{ configured: boolean; url: string; version: string; circuit: string }> {
  const config = await import("@/lib/kb/settings")
    .then((m) => m.getDoclingConfig(db))
    .catch(() => null);
  const configured = Boolean(config?.url);
  let version = "docling-serve@unknown";
  if (configured && config) {
    const client = new DoclingClient({
      baseUrl: config.url,
      apiKey: config.apiKey || undefined,
      transport: opts.transport ?? laneTransport(),
    });
    version = await client.serverVersion();
  }
  const c = circuit;
  return {
    configured,
    url: config?.url ?? "",
    version,
    circuit: c.status === "open" ? "open" : `closed (${c.consecutiveFailures} consecutive failure${c.consecutiveFailures === 1 ? "" : "s"})`,
  };
}
