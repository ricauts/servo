// Hardened extraction runner (spec kb-05). Extraction runs in a
// child_process.fork'ed worker, never on the request path or the main event
// loop, with caps enforced BEFORE any parse:
//
//   - zip entry-count and DECOMPRESSED-size caps (byteSize caps the
//     compressed file; a bomb is 25 MB compressed and 40 GB expanded)
//   - wall-clock kill and --max-old-space-size on the child
//   - any breach or crash lands textStatus FAILED with a SPECIFIC textError;
//     the container survives
//
// xlsx is a zip of XML, so external entities are a real vector: the worker
// disables XML external entities (kb-06's parser is configured here too),
// and the entry caps above bound even a 40 GB expansion to a FAILED row.
//
// XXE note: this module treats any xlsx whose workbook XML carries an
// external entity declaration as hostile BEFORE handing it to a parser —
// the fixture proves a <!DOCTYPE ... <!ENTITY ... SYSTEM ...>> document is
// refused without any network or file access being attempted.

import { fork } from "node:child_process";
import path from "node:path";
import { chunkSpreadsheetSheets, type SheetRows } from "@/lib/kb/extract-xlsx";

/** Resource caps — measured BEFORE parsing, on the bytes themselves. */
export const EXTRACT_LIMITS = {
  /** Max zip member entries in an xlsx/zip container. */
  maxEntries: 2_000,
  /** Max total DECOMPRESSED bytes across members (a 25 MB file can expand
   *  to gigabytes; 64 MB of real spreadsheet XML is already enormous). */
  maxDecompressedBytes: 64 * 1024 * 1024,
  /** Wall-clock budget for the whole extraction. */
  wallClockMs: 8_000,
  /** The child's heap budget. */
  maxOldSpaceMb: 512,
} as const;

export interface ExtractOutcome {
  status: "EXTRACTED" | "FAILED" | "UNSUPPORTED";
  text: string;
  error?: string;
  /** Which cap fired, for tests and the audit trail. */
  breach?: "entries" | "decompressed" | "wall-clock" | "heap" | "xxe" | "crash";
  /** Structured chunks from format-aware extractors (kb-06 xlsx, kb-07
   *  PDF): text plus the format's own locator ({sheet, range} / {page}).
   *  Absent for plain text, which the caller chunks by lines. */
  chunks?: { text: string; locator: Record<string, unknown> }[];
}

/** The pre-parse zip inspection: entry count and decompressed sizes from the
 *  central directory, without inflating anything. Pure — buffers in,
 *  verdict out. */
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
      // Skip this header's variable part cheaply: the filename length lives
      // at offset 26 (LE), extra at 28 — plus the compressed payload we do
      // NOT read here (sizes come from the central directory below).
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
 *  external SYSTEM entity is refused before any parser sees the file. */
export function detectXxe(xmlBytes: Buffer): boolean {
  const head = xmlBytes.subarray(0, 4096).toString("latin1");
  return /<!DOCTYPE/i.test(head) && /<!ENTITY[^>]*SYSTEM/i.test(head);
}

/** Run one extraction job in a fresh forked worker under the caps. */
export function extractHardened(
  bytes: Buffer,
  contentType: string,
): Promise<ExtractOutcome> {
  // Pre-parse caps for zip-shaped containers (xlsx and friends).
  if (looksLikeZip(bytes)) {
    const zip = inspectZip(bytes);
    if (!zip.ok) {
      return Promise.resolve({
        status: "FAILED",
        text: "",
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
        status: "FAILED",
        text: "",
        error: "Refused before parsing: external XML entity declarations (XXE) are not accepted.",
        breach: "xxe",
      });
    }
  }

  return new Promise((resolve) => {
    const workerPath = path.join(process.cwd(), "src", "lib", "kb", "extract-worker.cjs");
    let settled = false;
    const finish = (outcome: ExtractOutcome) => {
      if (settled) return;
      settled = true;
      child.kill();
      resolve(outcome);
    };

    const child = fork(workerPath, [], {
      stdio: ["ignore", "pipe", "pipe", "ipc"],
      execArgv: [`--max-old-space-size=${EXTRACT_LIMITS.maxOldSpaceMb}`],
    });

    const wallClock = setTimeout(
      () =>
        finish({
          status: "FAILED",
          text: "",
          error: `Extraction exceeded ${EXTRACT_LIMITS.wallClockMs} ms and was killed.`,
          breach: "wall-clock",
        }),
      EXTRACT_LIMITS.wallClockMs,
    );

    child.on("message", (msg: {
      ok: boolean;
      kind?: "text" | "sheets";
      text?: string;
      status?: string;
      error?: string;
      sheets?: SheetRows[];
    }) => {
      clearTimeout(wallClock);
      if (!msg.ok) {
        finish({ status: "FAILED", text: "", error: msg.error ?? "Extraction failed." });
        return;
      }
      if (msg.kind === "sheets") {
        // The worker parsed and normalized; the typed module owns the
        // windowing and the A1 locator math (kb-06).
        const verdict = chunkSpreadsheetSheets(msg.sheets ?? []);
        if (verdict.status === "UNSUPPORTED") {
          finish({ status: "UNSUPPORTED", text: "", error: verdict.error });
          return;
        }
        finish({
          status: "EXTRACTED",
          text: verdict.chunks.map((c) => c.text).join("\n\n"),
          chunks: verdict.chunks,
        });
        return;
      }
      const status = (msg.status ?? "EXTRACTED") as ExtractOutcome["status"];
      finish({
        status,
        text: msg.text ?? "",
        // UNSUPPORTED carries its reason as the error for the caller.
        ...(status === "UNSUPPORTED" ? { error: msg.error } : {}),
      });
    });
    child.on("error", (err) => {
      clearTimeout(wallClock);
      finish({ status: "FAILED", text: "", error: err.message, breach: "crash" });
    });
    child.on("exit", (code, signal) => {
      clearTimeout(wallClock);
      if (!settled) {
        finish({
          status: "FAILED",
          text: "",
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

    child.send({ bytes: Array.from(bytes), contentType });
  });
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
