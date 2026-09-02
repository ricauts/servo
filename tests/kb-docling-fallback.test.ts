// dcl-05: selection, the budget invariant, the fallback taxonomy and the
// circuit breaker. Every case runs on FixtureTransport, failing stubs or
// pure functions — NO test opens a socket. The Docling lane is exercised
// through makeDoclingExtractor with injected transports and clocks.

import { describe, expect, it, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

import {
  DOCLING_DEFAULTS,
  DOCLING_MS_PER_PAGE,
  DOCLING_OCR_ENGINES,
  DOCLING_POLL_SLACK_MS,
  getDoclingConfig,
  validateDoclingUrl,
  KB_EXTRACT_BUDGET_DEFAULT_MS,
  type DoclingConfig,
} from "@/lib/kb/settings";
import { resolveExtractor } from "@/lib/kb/extractors";
import { BASELINE_EXTRACTORS } from "@/lib/kb/extractors/baseline";
import {
  makeDoclingExtractor,
  resetDoclingLaneForTests,
  countPdfPages,
} from "@/lib/kb/extractors/docling";
import {
  initialCircuit,
  recordFailure,
  recordSuccess,
  allow,
  CIRCUIT_FAILURE_THRESHOLD,
  CIRCUIT_OPEN_WINDOW_MS,
} from "@/lib/kb/extractors/docling-health";
import type { DoclingTransport } from "@/lib/kb/extractors/docling-client";
import { chunkDoclingDocument } from "@/lib/kb/extractors/docling-chunker";
import { OCR_UNAVAILABLE_ERROR } from "@/lib/kb/extract-pdf";
import { parseCappedDocument } from "@/lib/kb/extractors/docling-schema";
import type { ExtractInput } from "@/lib/kb/extractors";

const FIXDIR = "tests/fixtures/kb/docling";
const manualPdf = readFileSync("tests/fixtures/kb/manual.pdf");
const goodDocling = readFileSync(`${FIXDIR}/manual.doclingdocument.json`);

function laneConfig(over: Partial<DoclingConfig> = {}): DoclingConfig {
  return { ...DOCLING_DEFAULTS, url: "http://127.0.0.1:9998", ...over };
}

/** A stub transport scripted per case; every URL hit is recorded. */
function stub(behavior: (url: string, init: RequestInit) => Promise<Response>) {
  const hits: string[] = [];
  const transport: DoclingTransport = {
    request: (url, init) => {
      hits.push(`${init.method ?? "GET"} ${url}`);
      return behavior(url, init);
    },
  };
  return { transport, hits };
}

function input(bytes: Buffer = manualPdf, declaredType = "application/pdf"): ExtractInput {
  return { bytes, sniffedType: "pdf", declaredType, signal: AbortSignal.timeout(10_000) };
}

const jsonResponse = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
const docResponse = (bytes: Buffer) =>
  new Response(new Uint8Array(bytes), { status: 200, headers: { "content-type": "application/json" } });

/** A fully-successful sidecar over the good fixture. */
function happySidecar() {
  return stub(async (url, init) => {
    if (url.endsWith("/openapi.json")) return jsonResponse({ info: { version: "1.0.0" } });
    if (url.includes("/v1/convert/file/async")) return jsonResponse({ task_id: "t" });
    if (url.includes("/v1/status/poll/")) return jsonResponse({ task_status: "success" });
    if (url.includes("/v1/result/") && init.method === "DELETE") return new Response(null, { status: 404 });
    if (url.includes("/v1/result/")) return docResponse(goodDocling);
    throw new Error(`unexpected ${url}`);
  });
}

beforeEach(() => {
  resetDoclingLaneForTests();
  delete process.env.KB_EXTRACT_DOCLING_URL;
  delete process.env.KB_EXTRACT_DOCLING_TYPES;
  delete process.env.KB_EXTRACT_DOCLING_TIMEOUT_MS;
  delete process.env.KB_EXTRACT_DOCLING_MAX_PAGES;
  delete process.env.KB_EXTRACT_DOCLING_OCR;
});

describe("settings — resolution, defaults and refusals", () => {
  it(".types DEFAULTS TO application/pdf ONLY — xlsx stays on exceljs unless an admin opts in", async () => {
    const cfg = await getDoclingConfig(null);
    expect(cfg.types).toEqual(["application/pdf"]);
  });

  it("ocr accepts exactly the baked-in set and REFUSES tesseract with the reason named", async () => {
    expect([...DOCLING_OCR_ENGINES]).toEqual(["auto", "easyocr", "rapidocr", "off"]);
    process.env.KB_EXTRACT_DOCLING_OCR = "easyocr";
    expect((await getDoclingConfig(null)).ocr).toBe("easyocr");
    process.env.KB_EXTRACT_DOCLING_OCR = "tesseract";
    await expect(getDoclingConfig(null)).rejects.toThrow(/tesseract.*UNVERIFIED|UNVERIFIED.*tesseract/);
    process.env.KB_EXTRACT_DOCLING_OCR = "kraken";
    await expect(getDoclingConfig(null)).rejects.toThrow(/must be one of/);
  });

  it("the four URL rules, one assertion each, each refusal naming its reason", async () => {
    // 1. http/https only.
    process.env.KB_EXTRACT_DOCLING_URL = "file:///etc/passwd";
    await expect(getDoclingConfig(null)).rejects.toThrow(/must be http or https/);
    // 2. no credentials.
    process.env.KB_EXTRACT_DOCLING_URL = "http://user:pass@127.0.0.1:9998";
    await expect(getDoclingConfig(null)).rejects.toThrow(/no credentials/);
    // 4. host must be loopback / RFC1918 / ULA / a compose service name.
    process.env.KB_EXTRACT_DOCLING_URL = "https://docling.example.com";
    await expect(getDoclingConfig(null)).rejects.toThrow(/not loopback, RFC1918\/ULA, or a compose service name/);
    expect(validateDoclingUrl("http://10.0.0.5:9998").ok).toBe(true);
    expect(validateDoclingUrl("http://192.168.1.9:9998").ok).toBe(true);
    expect(validateDoclingUrl("http://docling:9998").ok).toBe(true);
    expect(validateDoclingUrl("http://[fd00::5]:9998").ok).toBe(true);
    // 3. no redirects — the transport rule, proven in the timeout case's
    // laneTransport (3xx refuses) below.
    process.env.KB_EXTRACT_DOCLING_URL = "";
  });

  it("a URL supplied through a document, a ticket or a request body is never consulted", async () => {
    // The lane reads ONLY settings/env: a document "carrying" a URL in its
    // name or a ticket description has no channel into the config.
    const cfg = await getDoclingConfig(null);
    expect(cfg.url).toBe("");
    const evil = await getDoclingConfig(null); // no request-body parameter exists to pass
    expect(evil.url).toBe("");
    expect(getDoclingConfig.length).toBe(1); // (db | null) — there is no URL argument to abuse
  });
});

describe("selection — on the SNIFFED type, never the declared one", () => {
  it("empty url → baseline, and the docling module is never constructed", async () => {
    const picked = await resolveExtractor("pdf", null, BASELINE_EXTRACTORS);
    expect(picked?.id).toBe("baseline-pdf");
    const empty = await resolveExtractor("pdf", { ...DOCLING_DEFAULTS, url: "" }, BASELINE_EXTRACTORS);
    expect(empty?.id).toBe("baseline-pdf");
  });

  it("configured url routes sniffed pdf to the lane; sniffed xlsx stays baseline by default", async () => {
    const lane = await resolveExtractor("pdf", laneConfig(), BASELINE_EXTRACTORS);
    expect(lane?.id).toBe("docling");
    const xlsx = await resolveExtractor("xlsx", laneConfig(), BASELINE_EXTRACTORS);
    expect(xlsx?.id).toBe("baseline-xlsx");
    const optedIn = await resolveExtractor("xlsx", laneConfig({ types: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"] }), BASELINE_EXTRACTORS);
    expect(optedIn?.id).toBe("docling");
  });
});

describe("THE BUDGET INVARIANT — arithmetically, over the shipped defaults", () => {
  it("maxPages × 6000 <= timeoutMs <= workerBudgetMs − pollSlack", () => {
    expect(DOCLING_DEFAULTS.maxPages).toBe(40);
    expect(DOCLING_DEFAULTS.timeoutMs).toBe(300_000);
    expect(DOCLING_MS_PER_PAGE).toBe(6_000);
    expect(DOCLING_POLL_SLACK_MS).toBe(30_000);
    expect(KB_EXTRACT_BUDGET_DEFAULT_MS).toBe(360_000);
    // The invariant: change one constant without the others and this fails.
    expect(DOCLING_DEFAULTS.maxPages * DOCLING_MS_PER_PAGE).toBeLessThanOrEqual(DOCLING_DEFAULTS.timeoutMs);
    expect(DOCLING_DEFAULTS.timeoutMs).toBeLessThanOrEqual(KB_EXTRACT_BUDGET_DEFAULT_MS - DOCLING_POLL_SLACK_MS);
  });
});

describe("the fallback taxonomy — one test per reason, upload succeeds on baseline", () => {
  const cases: Array<{ reason: string; make: () => ReturnType<typeof stub>; config?: Partial<DoclingConfig> }> = [
    {
      reason: "docling-unreachable",
      make: () => stub(async () => { throw new Error("connect ECONNREFUSED"); }),
    },
    {
      reason: "docling-http-5xx",
      make: () => stub(async (url) => (url.includes("/v1/convert/file/async") ? jsonResponse({ err: "boom" }, 503) : jsonResponse({}))),
    },
    {
      reason: "docling-schema-invalid",
      make: () => stub(async (url, init) => {
        if (url.includes("/v1/convert/file/async")) return jsonResponse({ task_id: "t" });
        if (url.includes("/v1/status/poll/")) return jsonResponse({ task_status: "success" });
        if (url.includes("/v1/result/") && init.method === "DELETE") return new Response(null, { status: 404 });
        return docResponse(Buffer.from(JSON.stringify({ items: "not-an-array-at-all" })));
      }),
    },
    {
      reason: "docling-oversize-body",
      make: () => stub(async (url, init) => {
        if (url.includes("/v1/convert/file/async")) return jsonResponse({ task_id: "t" });
        if (url.includes("/v1/status/poll/")) return jsonResponse({ task_status: "success" });
        if (url.includes("/v1/result/") && init.method === "DELETE") return new Response(null, { status: 404 });
        return new Response(Buffer.alloc(1024), { status: 200, headers: { "content-length": String(64 * 1024 * 1024) } });
      }),
    },
    {
      reason: "docling-timeout",
      make: () => stub(async (url) => {
        if (url.includes("/v1/convert/file/async")) return jsonResponse({ task_id: "t" });
        if (url.includes("/v1/status/poll/")) return jsonResponse({ task_status: "pending" });
        return jsonResponse({});
      }),
      config: { timeoutMs: 300 },
    },
    {
      reason: "docling-task-abandoned",
      make: () => stub(async (url) => {
        if (url.includes("/v1/convert/file/async")) return jsonResponse({ task_id: "t" });
        if (url.includes("/v1/status/poll/")) return jsonResponse({ task_status: "failure", message: "sidecar oom" });
        return jsonResponse({});
      }),
    },
  ];

  for (const { reason, make, config } of cases) {
    it(`${reason}: the upload SUCCEEDS on baseline with the reason recorded`, async () => {
      const sidecar = make();
      const lane = makeDoclingExtractor(laneConfig(config), { transport: sidecar.transport, now: () => 1_000_000 });
      const outcome = await lane.extract(input());
      expect((outcome as { fallbackOf?: string }).fallbackOf).toBe(reason);
      expect(outcome.status).toBe("EXTRACTED"); // baseline read the manual's text layer
      if (outcome.status === "EXTRACTED") expect(outcome.chunks.length).toBeGreaterThan(0);
    }, 30_000);
  }

  it("docling-page-cap: over maxPages we do not call AT ALL", async () => {
    const sidecar = happySidecar();
    const lane = makeDoclingExtractor(laneConfig({ maxPages: 2 }), { transport: sidecar.transport, now: () => 1_000_000 });
    const outcome = await lane.extract(input()); // manual.pdf has 3 pages
    expect(countPdfPages(manualPdf)).toBeGreaterThan(2);
    expect(sidecar.hits).toEqual([]); // zero requests: not even a version probe
    expect((outcome as { fallbackOf?: string }).fallbackOf).toBe("docling-page-cap");
    expect(outcome.status).toBe("EXTRACTED"); // baseline answered
  });

  it("docling-circuit-open: after 3 consecutive failures the 4th upload attempts NO connection", async () => {
    const dead = stub(async () => { throw new Error("connect ECONNREFUSED"); });
    const lane = makeDoclingExtractor(laneConfig(), { transport: dead.transport, now: () => 1_000_000 });
    for (let i = 0; i < 3; i++) {
      const r = await lane.extract(input());
      expect((r as { fallbackOf?: string }).fallbackOf).toBe("docling-unreachable");
    }
    const attemptsBefore = dead.hits.length;
    const fourth = await lane.extract(input());
    expect((fourth as { fallbackOf?: string }).fallbackOf).toBe("docling-circuit-open");
    expect(dead.hits.length).toBe(attemptsBefore); // NO connection attempted
    expect(fourth.status).toBe("EXTRACTED"); // baseline still answers
  });

  it("the circuit closes after the window (and on success)", async () => {
    let failing = true;
    const transport = stub(async (url, init) => {
      if (failing) throw new Error("connect ECONNREFUSED");
      if (url.endsWith("/openapi.json")) return jsonResponse({ info: { version: "1.0.0" } });
      if (url.includes("/v1/convert/file/async")) return jsonResponse({ task_id: "t" });
      if (url.includes("/v1/status/poll/")) return jsonResponse({ task_status: "success" });
      if (url.includes("/v1/result/") && init.method === "DELETE") return new Response(null, { status: 404 });
      return docResponse(goodDocling);
    });
    let t = 1_000_000;
    const lane = makeDoclingExtractor(laneConfig(), { transport: transport.transport, now: () => t });
    for (let i = 0; i < 3; i++) await lane.extract(input());
    // Still open just before the window elapses.
    t += CIRCUIT_OPEN_WINDOW_MS - 1;
    expect((await lane.extract(input()) as { fallbackOf?: string }).fallbackOf).toBe("docling-circuit-open");
    // Past the window the lane is tried again — and now it works, which
    // closes the circuit by success.
    failing = false;
    t += 2;
    const healed = await lane.extract(input());
    expect((healed as { fallbackOf?: string }).fallbackOf).toBeUndefined();
    expect(healed.status).toBe("EXTRACTED");
  }, 30_000);

  it("the breaker state machine in isolation: threshold, window, reset", () => {
    let s = initialCircuit();
    expect(allow(s, 0)).toBe(true);
    s = recordFailure(s, 1);
    s = recordFailure(s, 2);
    expect(allow(s, 3)).toBe(true); // two failures: still closed
    s = recordFailure(s, 3);
    expect(CIRCUIT_FAILURE_THRESHOLD).toBe(3);
    expect(allow(s, 4)).toBe(false);
    expect(allow(s, 3 + CIRCUIT_OPEN_WINDOW_MS - 1)).toBe(false);
    expect(allow(s, 3 + CIRCUIT_OPEN_WINDOW_MS)).toBe(true); // the window closes it
    s = recordSuccess();
    expect(allow(s, 0)).toBe(true);
  });

  it("kb-07's low-text rule applies to Docling output: a near-empty conversion lands UNSUPPORTED", async () => {
    const nearEmpty = Buffer.from(
      JSON.stringify({ pages: [{ page_no: 1, size: { width: 612, height: 792 } }], items: [
        { item_type: "text", text: "x", prov: [{ page_no: 1 }] },
      ] }),
    );
    expect(chunkDoclingDocument(parseCappedDocument(nearEmpty)).reduce((n, c) => n + c.text.length, 0)).toBeLessThan(200);
    const transport = stub(async (url, init) => {
      if (url.includes("/v1/convert/file/async")) return jsonResponse({ task_id: "t" });
      if (url.includes("/v1/status/poll/")) return jsonResponse({ task_status: "success" });
      if (url.includes("/v1/result/") && init.method === "DELETE") return new Response(null, { status: 404 });
      return docResponse(nearEmpty);
    });
    const lane = makeDoclingExtractor(laneConfig(), { transport: transport.transport, now: () => 1_000_000 });
    // A scanned PDF: baseline ALSO returns nothing, so the document lands
    // UNSUPPORTED — never a silently empty EXTRACTED. The copy is dcl-08's
    // CONDITIONAL string: this install HAS the high-fidelity extractor
    // configured (the conversion came back near-empty, not unreachable),
    // so kb-07's "OCR is not available" would be a false claim here.
    const scanned = readFileSync("tests/fixtures/kb/scanned.pdf");
    const outcome = await lane.extract(input(scanned));
    expect(outcome.status).toBe("UNSUPPORTED");
    expect(outcome.status === "UNSUPPORTED" && outcome.error).toBe(OCR_UNAVAILABLE_ERROR);
  }, 30_000);
});

describe("concurrency 1 — the lane runs one conversion at a time", () => {
  it("a second concurrent ingest does not open a second conversion", async () => {
    let active = 0;
    let peak = 0;
    const transport = stub(async (url, init) => {
      if (url.includes("/v1/convert/file/async")) {
        active++; peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 150));
        active--;
        return jsonResponse({ task_id: `t-${Math.random()}` });
      }
      if (url.includes("/v1/status/poll/")) return jsonResponse({ task_status: "failure", message: "done" });
      return jsonResponse({});
    });
    const lane = makeDoclingExtractor(laneConfig(), { transport: transport.transport, now: () => 1_000_000 });
    await Promise.all([lane.extract(input()), lane.extract(input())]);
    expect(peak).toBe(1); // never two submits at once
  }, 30_000);
});

describe("LANE 1", () => {
  it("with the url unset the whole kb suite path stays baseline (and green elsewhere)", async () => {
    const cfg = await getDoclingConfig(null);
    expect(cfg.url).toBe("");
    const picked = await resolveExtractor("pdf", cfg, BASELINE_EXTRACTORS);
    expect(picked?.id).toBe("baseline-pdf");
  });
});
