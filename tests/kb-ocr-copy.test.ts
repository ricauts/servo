// dcl-08: the CONDITIONAL OCR copy. A scanned PDF's UNSUPPORTED message must
// tell the truth about THE INSTALL it landed on — three exact strings, no
// fourth. Every case runs on stub transports or pure functions; NO test
// opens a socket. The wrong string on an install that HAS OCR is a
// claims-discipline failure under §0.8.6, not a copy nit.

import { describe, expect, it, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

import {
  OCR_UNAVAILABLE_ERROR,
  SCANNED_PDF_ERROR,
  chunkPdfPages,
  ocrPageCapError,
} from "@/lib/kb/extract-pdf";
import { DOCLING_DEFAULTS, type DoclingConfig } from "@/lib/kb/settings";
import {
  makeDoclingExtractor,
  resetDoclingLaneForTests,
} from "@/lib/kb/extractors/docling";
import type { DoclingTransport } from "@/lib/kb/extractors/docling-client";
import type { ExtractInput } from "@/lib/kb/extractors";

const scannedPdf = readFileSync("tests/fixtures/kb/scanned.pdf");

function laneConfig(over: Partial<DoclingConfig> = {}): DoclingConfig {
  return { ...DOCLING_DEFAULTS, url: "http://127.0.0.1:9998", ...over };
}

function input(bytes: Buffer = scannedPdf): ExtractInput {
  return { bytes, sniffedType: "pdf", declaredType: "application/pdf", signal: AbortSignal.timeout(10_000) };
}

/** A transport that never answers — the unreachable sidecar. */
const deadTransport: DoclingTransport = {
  request: () => Promise.reject(new Error("connect ECONNREFUSED")),
};

beforeEach(() => resetDoclingLaneForTests());

describe("the three exact strings", () => {
  it("string 1 — install with NO high-fidelity extractor: OCR is not available", () => {
    expect(SCANNED_PDF_ERROR).toBe(
      "No text layer — this looks like a scanned document. OCR is not available.",
    );
    // The pure baseline path produces exactly it.
    expect(chunkPdfPages([])).toEqual({ status: "UNSUPPORTED", error: SCANNED_PDF_ERROR });
  });

  it("string 2 — configured but unreachable: OCR was unavailable, re-extract", () => {
    expect(OCR_UNAVAILABLE_ERROR).toBe(
      "OCR was unavailable — the high-fidelity extractor could not be reached. Re-extract to try again.",
    );
  });

  it("string 3 — over the page cap: names the cap AND the setting", () => {
    expect(ocrPageCapError(40)).toBe(
      "This document is over the high-fidelity extractor's 40-page cap (kb.extract.docling.maxPages). OCR was not attempted; raise the cap or split the document.",
    );
  });
});

describe("which string an install gets — the reason drives the rewrite", () => {
  it("dead sidecar + scanned bytes: the UNSUPPORTED error is string 2, never string 1", async () => {
    const lane = makeDoclingExtractor(laneConfig(), { transport: deadTransport });
    const outcome = await lane.extract(input());
    expect(outcome.status).toBe("UNSUPPORTED");
    if (outcome.status !== "UNSUPPORTED") return;
    expect(outcome.error).toBe(OCR_UNAVAILABLE_ERROR);
    expect(outcome.error).not.toBe(SCANNED_PDF_ERROR);
  });

  it("over the page cap: the error names the configured cap and the setting", async () => {
    const scanned3Pages = scannedPdf; // the fixture is three pages
    const hits: string[] = [];
    const never: DoclingTransport = {
      request: (url) => {
        hits.push(url);
        return Promise.reject(new Error("unreachable"));
      },
    };
    const lane = makeDoclingExtractor(laneConfig({ maxPages: 1 }), { transport: never });
    const outcome = await lane.extract(input(scanned3Pages));
    expect(outcome.status).toBe("UNSUPPORTED");
    if (outcome.status !== "UNSUPPORTED") return;
    expect(outcome.error).toBe(ocrPageCapError(1));
    expect(outcome.error).toContain("kb.extract.docling.maxPages");
    // The cap fires BEFORE any bytes are sent — the dead transport proves
    // the negative: zero requests went out.
    expect(hits).toEqual([]);
  });

  it("circuit open produces string 2 as well — the install still has OCR", async () => {
    // Three consecutive failures open the circuit; the fourth upload must
    // not even try, and a scanned document lands on string 2.
    const config = laneConfig();
    const dead = makeDoclingExtractor(config, { transport: deadTransport });
    for (let i = 0; i < 3; i++) await dead.extract(input());
    const outcome = await dead.extract(input());
    expect(outcome.status).toBe("UNSUPPORTED");
    if (outcome.status !== "UNSUPPORTED") return;
    expect(outcome.error).toBe(OCR_UNAVAILABLE_ERROR);
  });
});
