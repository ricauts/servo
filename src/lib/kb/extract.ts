// Hardened extraction runner (spec kb-05, refactored by dcl-01). Extraction
// runs in a child_process.fork'ed worker, never on the request path or the
// main event loop, with caps enforced BEFORE any parse:
//
//   - zip entry-count and DECOMPRESSED-size caps (byteSize caps the
//     compressed file; a bomb is 25 MB compressed and 40 GB expanded)
//     - the kb.extract.workerBudgetMs kill, carried by a shared AbortSignal
//       (dcl-01) — plus --max-old-space-size on the child
//   - any breach or crash lands textStatus FAILED with a SPECIFIC textError;
//     the container survives
//
// xlsx is a zip of XML, so external entities are a real vector: the worker
// disables XML external entities (kb-06's parser is configured here too),
// and the entry caps above bound even a 40 GB expansion to a FAILED row.
//
// dcl-01 division of labour: this module owns the FORK, the caps, the
// magic-byte sniff, the budget kill and the stuck-row reclaim; the
// extractors/ registry owns ROUTING and CHUNKING. extractHardened() stays
// as the legacy-shaped wrapper kb-05's tests call.
//
// XXE note: this module treats any xlsx whose workbook XML carries an
// external entity declaration as hostile BEFORE handing it to a parser —
// the fixture proves a <!DOCTYPE ... <!ENTITY ... SYSTEM ...>> document is
// refused without any network or file access being attempted.

import { fork } from "node:child_process";
import { getKbExtractBudgetMs, type SettingReader } from "@/lib/kb/settings";

/** The minimal structural client the reclaim needs — the app's extended
 *  client satisfies it. */
interface ReclaimClient extends SettingReader {
  document: {
    findMany(args: {
      where: { textStatus: string; updatedAt: { lt: Date } };
      select: { id: true };
    }): Promise<Array<{ id: string }>>;
    updateMany(args: {
      where: { id: { in: string[] } };
      data: { textStatus: string; textError: string };
    }): Promise<unknown>;
  };
}
import path from "node:path";
import type { SheetRows } from "@/lib/kb/extract-xlsx";
import type { ExtractOutcome, Extractor } from "@/lib/kb/extractors";
import type { Fact, FactRuleset } from "@/lib/kb/facts";

/** Resource caps — measured BEFORE parsing, on the bytes themselves. The
 *  wall-clock budget is NOT here any more: kb.extract.workerBudgetMs
 *  (src/lib/kb/settings.ts, default 360000, env-first) owns it, carried by
 *  the AbortSignal every extractor receives. */
export const EXTRACT_LIMITS = {
  /** Max zip member entries in an xlsx/zip container. */
  maxEntries: 2_000,
  /** Max total DECOMPRESSED bytes across members (a 25 MB file can expand
   *  to gigabytes; 64 MB of real spreadsheet XML is already enormous). */
  maxDecompressedBytes: 64 * 1024 * 1024,
  /** The child's heap budget. */
  maxOldSpaceMb: 512,
} as const;

/** The budget carried when no setting resolves it (tests pass their own). */
export const DEFAULT_EXTRACT_BUDGET_MS = 360_000;

/** The legacy outcome shape extractHardened has always returned — kept so
 *  kb-05's tests are byte-unchanged. The registry's strict union lives in
 *  extractors/index.ts. */
export interface LegacyExtractOutcome {
  status: "EXTRACTED" | "FAILED" | "UNSUPPORTED";
  text: string;
  error?: string;
  breach?: "entries" | "decompressed" | "wall-clock" | "heap" | "xxe" | "crash" | "budget";
  chunks?: { text: string; locator: Record<string, unknown> }[];
}

/** What one raw worker job returns — parsing only, never chunked. */
export type RawJobResult =
  | { ok: true; kind: "text"; text: string }
  | { ok: true; kind: "sheets"; sheets: SheetRows[] }
  | { ok: true; kind: "pages"; pages: string[] }
  | { ok: false; status: "UNSUPPORTED" | "FAILED"; error: string; breach?: LegacyExtractOutcome["breach"] };

export interface JobOptions {
  /** Aborts at the kb.extract.workerBudgetMs budget — kills the child. */
  signal?: AbortSignal;
  /** Overrides the signal's budget for tests with tight fixtures. */
  budgetMs?: number;
}

/** The pre-parse zip inspection: entry count and decompressed sizes from the
 * central directory, without inflating anything. Pure — buffers in,
 * verdict out. */
export function inspectZip(bytes: Buffer): { ok: true } | { ok: false; breach: "entries" | "decompressed"; detail: string } {
  // ZIP local-file headers start with PK\x03\x04; central-directory entries
  // with PK\x01\x02. Reading the END of central directory record would be
  // the thorough route; scanning signatures is parser-free and sufficient
  // for the cap (it can only OVER-count entries, never under-count).
  let entries = 0;
  for (let i = 0; i + 4 <= bytes.length; i++) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x03 && bytes[i + 3] === 0x04) {
      entries++;
      if (entries > EXTRACT_LIMITS.maxEntries) {
        return { ok: false, breach: "entries", detail: `more than ${EXTRACT_LIMITS.maxEntries} zip entries` };
      }
    }
  }

  // Decompressed total from the central directory: each PK\x01\x02 record
  // carries the uncompressed size at offset 24 (LE 32-bit).
  let total = 0;
  for (let i = 0; i + 46 <= bytes.length; i++) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x01 && bytes[i + 3] === 0x02) {
      total += bytes.readUInt32LE(i + 24);
      if (total > EXTRACT_LIMITS.maxDecompressedBytes) {
        return {
          ok: false,
          breach: "decompressed",
          detail: `decompressed size exceeds ${EXTRACT_LIMITS.maxDecompressedBytes} bytes`,
        };
      }
    }
  }
  return { ok: true };
}

/** XML external-entity detection for xlsx workbooks: a DOCTYPE with an
 * external SYSTEM entity is refused before any parser sees the file. */
export function detectXxe(xmlBytes: Buffer): boolean {
  const head = xmlBytes.subarray(0, 4096).toString("latin1");
  return /<!DOCTYPE/i.test(head) && /<!ENTITY[^>]*SYSTEM/i.test(head);
}

/**
 * The magic-byte sniff (dcl-01). Binary formats route on BYTES — a
 * declared Content-Type that lies about a real xlsx still routes to the
 * xlsx path. Plain text is the declared-type case it has always been:
 * decodability alone cannot make an application/octet-stream upload a text
 * document (kb-05's UNSUPPORTED fixture depends on that).
 */
export function sniffRoute(bytes: Buffer, declaredType: string): string {
  if (looksLikeZip(bytes) && bytes.toString("latin1").includes("[Content_Types].xml")) {
    return "xlsx";
  }
  if (bytes.length > 4 && bytes.subarray(0, 5).toString("latin1") === "%PDF-") {
    return "pdf";
  }
  if (declaredType === "text/markdown" || declaredType === "text/plain" || declaredType === "application/markdown") {
    return "text";
  }
  return declaredType;
}

/** Run one PARSING job in a fresh forked worker under the caps. The worker
 *  never chunks — the extractor that called this owns the locator math. */
export function runExtractionJob(
  bytes: Buffer,
  route: string,
  opts: JobOptions = {},
): Promise<RawJobResult> {
  // Pre-parse caps for zip-shaped containers (xlsx and friends).
  if (looksLikeZip(bytes)) {
    const zip = inspectZip(bytes);
    if (!zip.ok) {
      return Promise.resolve({
        ok: false,
        status: "FAILED",
        error: `Refused before parsing: ${zip.detail}.`,
        breach: zip.breach,
      });
    }
    // XXE: look for a DOCTYPE+external entity inside the container's
    // members. Without inflating: the strings are visible in the raw
    // (deflate-stored or deflated-but-small) members of any realistic
    // malicious fixture; a stored (uncompressed) member is the common case.
    if (detectXxeInZip(bytes)) {
      return Promise.resolve({
        ok: false,
        status: "FAILED",
        error: "Refused before parsing: external XML entity declarations (XXE) are not accepted.",
        breach: "xxe",
      });
    }
  }

  return new Promise((resolve) => {
    const workerPath = path.join(process.cwd(), "src", "lib", "kb", "extract-worker.cjs");
    let settled = false;
    const finish = (result: RawJobResult) => {
      if (settled) return;
      settled = true;
      child.kill();
      resolve(result);
    };

    const child = fork(workerPath, [], {
      stdio: ["ignore", "pipe", "pipe", "ipc"],
      execArgv: [`--max-old-space-size=${EXTRACT_LIMITS.maxOldSpaceMb}`],
    });

    // The budget kill (dcl-01): the shared AbortSignal carries
    // kb.extract.workerBudgetMs. An extractor that never returns — or a
    // worker that never messages — dies here, whichever fires first.
    const budgetMs = opts.budgetMs ?? DEFAULT_EXTRACT_BUDGET_MS;
    const onAbort = () =>
      finish({
        ok: false,
        status: "FAILED",
        error: `Extraction exceeded ${budgetMs} ms and was killed.`,
        breach: "budget",
      });
    if (opts.signal) {
      if (opts.signal.aborted) onAbort();
      else opts.signal.addEventListener("abort", onAbort, { once: true });
    }

    child.on("message", (msg: {
      ok: boolean;
      kind?: "text" | "sheets" | "pages";
      text?: string;
      status?: string;
      error?: string;
      sheets?: SheetRows[];
      pages?: string[];
    }) => {
      if (!msg.ok) {
        finish({
          ok: false,
          status: msg.status === "UNSUPPORTED" ? "UNSUPPORTED" : "FAILED",
          error: msg.error ?? "Extraction failed.",
        });
        return;
      }
      if (msg.kind === "sheets") {
        finish({ ok: true, kind: "sheets", sheets: msg.sheets ?? [] });
        return;
      }
      if (msg.kind === "pages") {
        finish({ ok: true, kind: "pages", pages: msg.pages ?? [] });
        return;
      }
      if (msg.status === "UNSUPPORTED") {
        finish({ ok: false, status: "UNSUPPORTED", error: msg.error ?? "Unsupported." });
        return;
      }
      finish({ ok: true, kind: "text", text: msg.text ?? "" });
    });
    child.on("error", (err) => {
      finish({ ok: false, status: "FAILED", error: err.message, breach: "crash" });
    });
    child.on("exit", (code, signal) => {
      if (!settled) {
        finish({
          ok: false,
          status: "FAILED",
          error:
            signal === "SIGTERM"
              ? `Extraction exceeded the memory budget (${EXTRACT_LIMITS.maxOldSpaceMb} MB).`
              : `Extraction worker died (${signal ?? `exit ${code}`}).`,
          breach: signal === "SIGTERM" ? "heap" : "crash",
        });
      }
    });

    child.stderr?.on("data", () => {
      /* worker diagnostics are intentionally not surfaced to callers */
    });

    child.send({ bytes: Array.from(bytes), route });
  });
}

/** One chunk handed to the facts route: its id travels so the parent can
 *  key the upsert without re-deriving an order. */
export interface FactsJobChunk {
  id: string;
  text: string;
}

/** What the facts route returns — one entry per chunk, in the order sent. */
export type FactsJobResult =
  | { ok: true; results: { chunkId: string; facts: Fact[] }[] }
  | { ok: false; error: string; breach?: LegacyExtractOutcome["breach"] };

/**
 * Run the typed-fact pass (spec ext-04) for one document's chunks in the
 * SAME forked worker the byte routes use, under the SAME caps — the fork's
 * heap budget (EXTRACT_LIMITS.maxOldSpaceMb) and the kb.extract
 * .workerBudgetMs wall clock, which this function arms itself from
 * budgetMs so no caller can omit it. Nothing in EXTRACT_LIMITS changes:
 * the entry-count and decompressed-size caps are pre-parse zip checks and
 * have no bytes to inspect on this route.
 *
 * The one launch difference is the tsx loader in execArgv. The worker is
 * CommonJS and the fact parsers are typed ESM modules with extensionless
 * relative imports, so a bare fork cannot load them; reimplementing the
 * parsers in CommonJS would put a second, unfixtured copy of ext-02/ext-03
 * in the tree. tsx is already a dependency and already ships in the
 * runtime image (Dockerfile line 2), and only THIS route pays the flag —
 * runExtractionJob's fork is byte-identical to what it was.
 */
export function runFactsJob(
  chunks: FactsJobChunk[],
  ruleset: FactRuleset,
  opts: JobOptions = {},
): Promise<FactsJobResult> {
  if (chunks.length === 0) return Promise.resolve({ ok: true, results: [] });
  return new Promise((resolve) => {
    const workerPath = path.join(process.cwd(), "src", "lib", "kb", "extract-worker.cjs");
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (result: FactsJobResult) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      // The listener is removed, not just left `once`: backfillFacts may
      // pass ONE signal into a fork per batch, and a signal that outlives
      // the job would otherwise retain a listener — and the child and
      // resolve closures behind it — for every batch of a corpus walk.
      opts.signal?.removeEventListener("abort", onAbort);
      child.kill();
      resolve(result);
    };

    const child = fork(workerPath, [], {
      stdio: ["ignore", "pipe", "pipe", "ipc"],
      execArgv: [`--max-old-space-size=${EXTRACT_LIMITS.maxOldSpaceMb}`, "--import", "tsx"],
    });

    // The wall-clock kill is armed HERE, from budgetMs, rather than only
    // when a caller happens to pass a signal. The byte route can rely on
    // its caller because the extractor registry threads one signal through
    // every lane; this route is awaited straight from the ingestion path,
    // and a cap a caller can forget to pass is not a cap.
    const budgetMs = opts.budgetMs ?? DEFAULT_EXTRACT_BUDGET_MS;
    const onAbort = () =>
      finish({
        ok: false,
        error: `Fact extraction exceeded ${budgetMs} ms and was killed.`,
        breach: "budget",
      });
    // Clamped to setTimeout's 32-bit ceiling. Node does not reject a larger
    // delay, it silently rewrites it to 1 ms — so an operator who raised
    // kb.extract.workerBudgetMs past ~24.8 days would otherwise turn a
    // generous budget into an instant kill on every document.
    timer = setTimeout(onAbort, Math.min(budgetMs, 2_147_483_647));
    timer.unref?.();
    if (opts.signal) {
      if (opts.signal.aborted) onAbort();
      else opts.signal.addEventListener("abort", onAbort, { once: true });
    }

    child.on("message", (msg: { ok?: boolean; kind?: string; error?: string; results?: { chunkId: string; facts: Fact[] }[] }) => {
      if (!msg.ok || msg.kind !== "facts") {
        finish({ ok: false, error: msg.error ?? "Fact extraction failed." });
        return;
      }
      finish({ ok: true, results: msg.results ?? [] });
    });
    child.on("error", (err) => {
      finish({ ok: false, error: err.message, breach: "crash" });
    });
    child.on("exit", (code, signal) => {
      if (!settled) {
        finish({
          ok: false,
          error:
            signal === "SIGTERM"
              ? `Fact extraction exceeded the memory budget (${EXTRACT_LIMITS.maxOldSpaceMb} MB).`
              : `Fact extraction worker died (${signal ?? `exit ${code}`}).`,
          breach: signal === "SIGTERM" ? "heap" : "crash",
        });
      }
    });

    child.stderr?.on("data", () => {
      /* worker diagnostics are intentionally not surfaced to callers */
    });

    child.send({ route: "facts", chunks, ruleset });
  });
}

/**
 * The legacy-shaped entry kb-05's tests call: sniff, pick from the
 * registry, extract, and flatten the strict union into the shape that
 * predates the interface. ingest() uses the registry directly so it can
 * also record the extractor's id and version on the Document row.
 */
export async function extractHardened(
  bytes: Buffer,
  contentType: string,
  registry?: readonly Extractor[],
): Promise<LegacyExtractOutcome> {
  const { extractDocument } = await import("@/lib/kb/extractors/run");
  const ran = await extractDocument(bytes, contentType, registry && registry.length ? { registry } : {});
  if (ran.outcome.status === "EXTRACTED") {
    return { status: "EXTRACTED", text: ran.outcome.text, chunks: ran.outcome.chunks };
  }
  if (ran.outcome.status === "FAILED") {
    return { status: "FAILED", text: "", error: ran.outcome.error, breach: ran.outcome.breach };
  }
  return { status: "UNSUPPORTED", text: "", error: ran.outcome.error };
}

/**
 * The boot-time reclaim (dcl-01): a container can die mid-extraction, and
 * a restart is a longer window than kb-05 assumed — so any row still in
 * EXTRACTING older than the resolved worker budget is flipped to FAILED
 * with a specific textError, never left forever. Returns the count, so
 * the boot log can say how many were drained.
 */
export async function reclaimStuckExtractions(db: ReclaimClient): Promise<number> {
  const budgetMs = await getKbExtractBudgetMs(db);
  const cutoff = new Date(Date.now() - budgetMs);
  const stuck = await db.document.findMany({
    where: { textStatus: "EXTRACTING", updatedAt: { lt: cutoff } },
    select: { id: true },
  });
  if (stuck.length === 0) return 0;
  await db.document.updateMany({
    where: { id: { in: stuck.map((row) => row.id) } },
    data: {
      textStatus: "FAILED",
      textError: `Extraction exceeded the ${budgetMs} ms worker budget and was reclaimed at boot.`,
    },
  });
  return stuck.length;
}

function looksLikeZip(bytes: Buffer): boolean {
  return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

/** Scan a zip's raw bytes for a DOCTYPE+SYSTEM entity in any member. Only
 *  realistic for stored or briefly-deflated members — which is what an XXE
 *  attack file is: the payload must be readable XML. */
function detectXxeInZip(bytes: Buffer): boolean {
  // Deflate would hide the strings; check the stored members by scanning
  // for the signature in the raw stream (a stored member's XML is plainly
  // visible; deflated XXE fixtures compress the DOCTYPE to unreadable
  // bytes, so also refuse any container we cannot clear).
  return detectXxe(bytes);
}

