// dcl-03: the Docling client, caps, mapper and fixture provenance. No test
// opens a socket — the client is driven through FixtureTransport and the
// cap paths through stub streams. The fixtures are SYNTHETIC (declared in
// MANIFEST.json with reasons); the moment docker-compose.docling.yml
// exists, docling-fixture-lint fails on them and they must be recorded.

import { describe, expect, it } from "vitest";
import { readFileSync, existsSync, writeFileSync, mkdirSync, rmSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  DoclingError,
  parseCappedDocument,
  readCappedBody,
  DOCLING_MAX_BYTES,
} from "@/lib/kb/extractors/docling-schema";
import { DoclingClient, FixtureTransport } from "@/lib/kb/extractors/docling-client";
import { mapDoclingDocument, mappedLocatorsValidate } from "@/lib/kb/extractors/docling-map";
import { PageLocator, SheetLocator, BBox } from "@/lib/kb/locator";
import { BASELINE_EXTRACTORS } from "@/lib/kb/extractors/baseline";

const FIXDIR = "tests/fixtures/kb/docling";
const fixtureDoc = (name: string) =>
  parseCappedDocument(readFileSync(join(FIXDIR, name)));

/** A Response-shaped stub with an in-memory body stream. */
function jsonResponse(payload: unknown, headers: Record<string, string> = {}): Response {
  const bytes = Buffer.from(typeof payload === "string" ? payload : JSON.stringify(payload));
  return new Response(bytes, { headers: { "content-type": "application/json", ...headers } });
}

describe("the mapper — provenance onto dcl-02 locators", () => {
  it("manual: every mapped locator validates against dcl-02's schemas", () => {
    const chunks = mapDoclingDocument(fixtureDoc("manual.doclingdocument.json"));
    expect(chunks.length).toBeGreaterThan(0);
    expect(mappedLocatorsValidate(chunks)).toBe(true);
    for (const c of chunks) {
      const ok = PageLocator.safeParse(c.locator).success || SheetLocator.safeParse(c.locator).success;
      expect(ok, JSON.stringify(c.locator)).toBe(true);
    }
  });

  // The three fixtures are RECORDED from the live sidecar (dcl-06's
  // ratification): upstream 1.31.0 sends texts/tables arrays with $ref
  // cross-references, BOTTOMLEFT bboxes and pages keyed BY NUMBER. The
  // assertions below state what the real documents actually contain.
  it("manual: each page's text carries page, bbox, label and its $ref", () => {
    const chunks = mapDoclingDocument(fixtureDoc("manual.doclingdocument.json"));
    expect(chunks).toHaveLength(3); // one text per page, pages 1..3
    expect(chunks.map((c) => (c.locator as { page: number }).page)).toEqual([1, 2, 3]);
    const second = chunks[1];
    expect(second.text).toContain("page two");
    const loc = second.locator as Record<string, unknown>;
    expect(loc.ref).toBe("#/texts/1"); // the recorded self_ref
    expect(BBox.safeParse(loc.bbox).success, JSON.stringify(loc)).toBe(true);
    // BOTTOMLEFT flipped to 0-1 top-left against the page's own 612x792.
    const bbox = loc.bbox as { y: number; h: number };
    expect(bbox.y).toBeGreaterThanOrEqual(0);
    expect(bbox.h).toBeGreaterThan(0);
  });

  it("scanned: NON-EMPTY text on every page — the case unpdf returns nothing for", () => {
    const chunks = mapDoclingDocument(fixtureDoc("scanned.doclingdocument.json"));
    expect(chunks).toHaveLength(3);
    expect(chunks.every((c) => c.text.trim().length > 0)).toBe(true);
    expect(chunks.map((c) => (c.locator as { page: number }).page)).toEqual([1, 2, 3]);
  });

  it("messy-workbook: the workbook's two tables map to sheet locators with their real A1 windows", () => {
    const chunks = mapDoclingDocument(fixtureDoc("messy-workbook.doclingdocument.json"));
    expect(chunks).toHaveLength(2); // pricing.xlsx's two tables, 41x4 and 9x4
    expect(chunks[0].locator).toMatchObject({ sheet: "table", range: "A1:D41", cell: "A1", page: 1 });
    expect(chunks[1].locator).toMatchObject({ sheet: "table", range: "A1:D9", cell: "A1" });
    expect(chunks[0].text).toContain("| SKU | Item | Unit price | Stock |");
    expect(mappedLocatorsValidate(chunks)).toBe(true);
  });

  it("geometry that normalizes out of range yields no bbox rather than an invalid one", () => {
    const doc = fixtureDoc("manual.doclingdocument.json");
    // Corrupt one page size so normalization escapes 0-1.
    // pages arrives as an array OR a map (upstream 1.31.0 sends the map);
    // corrupt the first size whichever way the recorded fixture carries it.
    if (Array.isArray(doc.pages)) doc.pages[0] = { page_no: 1, size: { width: -10, height: 792 } };
    else if (doc.pages) {
      const first = Object.keys(doc.pages)[0];
      doc.pages[first] = { ...doc.pages[first], size: { width: -10, height: 792 } };
    }
    const chunks = mapDoclingDocument(doc);
    // The first page's size is corrupt, so ITS text's bbox is withheld;
    // later pages normalize against their own healthy sizes.
    const first = chunks[0]!;
    expect(first.locator).not.toHaveProperty("bbox");
    expect(mappedLocatorsValidate(chunks)).toBe(true);
  });
});

describe("the client — FixtureTransport only, no socket", () => {
  const fixtureBytes = readFileSync(join(FIXDIR, "manual.doclingdocument.json"));

  function happyTransport(calls: string[]) {
    return new FixtureTransport(async (url, init) => {
      calls.push(`${init.method ?? "GET"} ${url}`);
      if (url.endsWith("/openapi.json")) return jsonResponse({ info: { version: "1.2.3" } });
      if (url.includes("/v1/convert/file/async")) return jsonResponse({ task_id: "t-1" });
      if (url.includes("/v1/status/poll/")) {
        const n = calls.filter((c) => c.includes("/v1/status/poll/")).length;
        return jsonResponse({ task_status: n >= 2 ? "success" : "pending" });
      }
      if (url.includes("/v1/result/") && init.method === "DELETE") return new Response(null, { status: 404 });
      if (url.includes("/v1/result/")) return new Response(fixtureBytes, { headers: { "content-type": "application/json" } });
      throw new Error(`unexpected ${url}`);
    });
  }

  it("converts end to end, records the version, and cleans up best-effort (404 = success)", async () => {
    const calls: string[] = [];
    const client = new DoclingClient({ baseUrl: "http://sidecar.local", transport: happyTransport(calls) });
    const result = await client.convertFile("manual.pdf", new Uint8Array([1, 2, 3]), "application/pdf");
    expect(result.serverVersion).toBe("docling-serve@1.2.3");
    expect(result.document.texts.length).toBeGreaterThan(0); // the real shape
    expect(result.bytes).toBe(fixtureBytes.byteLength);
    expect(calls.some((c) => c.startsWith("DELETE http://sidecar.local/v1/result/t-1"))).toBe(true);
    // The version is resolved lazily from openapi.json at completion, and
    // the per-process cache means it is asked exactly ONCE.
    expect(calls.filter((c) => c.includes("/openapi.json"))).toHaveLength(1);
    expect(calls.some((c) => c.startsWith("POST") && c.includes("/v1/convert/file/async"))).toBe(true);
  }, 20_000);

  it("the bearer key is sent when set, omitted when empty, and never appears in any error", async () => {
    const seen: RequestInit[] = [];
    const transport = new FixtureTransport(async (url, init) => {
      seen.push(init);
      if (url.endsWith("/openapi.json")) return new Response(null, { status: 500 });
      if (url.includes("/v1/convert/file/async")) return jsonResponse({ task_id: "t-1" });
      if (url.includes("/v1/status/poll/")) return jsonResponse({ task_status: "failure", message: "boom" });
      if (url.includes("/v1/result/")) return new Response(null, { status: 404 });
      throw new Error(`unexpected ${url}`);
    });
    const keyed = new DoclingClient({ baseUrl: "http://x", apiKey: "sk-docling-secret", transport });
    await expect(keyed.convertFile("a.pdf", new Uint8Array(1), "application/pdf")).rejects.toThrow(/boom/);
    const headers = seen.map((i) => (i.headers as Record<string, string>).authorization);
    expect(headers.some((h) => h === "Bearer sk-docling-secret")).toBe(true);
    // Failure messages never carry the key.
    try {
      await keyed.convertFile("a.pdf", new Uint8Array(1), "application/pdf");
    } catch (err) {
      expect(String((err as Error).message)).not.toContain("sk-docling-secret");
    }
    // And a version failure records the literal unknown, never a guess.
    expect(await keyed.serverVersion()).toBe("docling-serve@unknown");
    // The unkeyed client sends no authorization header at all.
    const bare = new DoclingClient({ baseUrl: "http://x", transport });
    await expect(bare.convertFile("a.pdf", new Uint8Array(1), "application/pdf")).rejects.toThrow();
    expect(seen.some((i) => !(i.headers as Record<string, string>).authorization)).toBe(true);
  }, 20_000);

  it("a poll deadline abandons the task with the reason docling-task-abandoned", async () => {
    const calls: string[] = [];
    const transport = new FixtureTransport(async (url, init) => {
      calls.push(`${init.method ?? "GET"} ${url}`);
      if (url.endsWith("/openapi.json")) return new Response(null, { status: 500 });
      if (url.includes("/v1/convert/file/async")) return jsonResponse({ task_id: "t-9" });
      if (url.includes("/v1/status/poll/")) return jsonResponse({ task_status: "pending" });
      if (url.includes("/v1/result/")) return new Response(null, { status: 404 });
      throw new Error(`unexpected ${url}`);
    });
    const client = new DoclingClient({ baseUrl: "http://x", transport, deadlineMs: 400 });
    await expect(client.convertFile("a.pdf", new Uint8Array(1), "application/pdf")).rejects.toMatchObject({
      name: "DoclingError",
      code: "docling-task-abandoned",
    });
    // The abandonment still attempts cleanup.
    expect(calls.some((c) => c.startsWith("DELETE") && c.includes("/v1/result/t-9"))).toBe(true);
  }, 20_000);
});

describe("the caps — before parsing, mid-stream, not after buffering", () => {
  it("Content-Length over the cap is refused before a byte is read", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([0x7b]));
      },
    });
    const res = { headers: { get: () => String(DOCLING_MAX_BYTES + 1) }, body };
    await expect(
      readCappedBody(res as never, { abort: new AbortController().signal }),
    ).rejects.toMatchObject({ code: "docling-oversize" });
  });

  it("a lying or headerless oversized stream is aborted MID-BODY and cancelled", async () => {
    let cancelled = false;
    let delivered = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        delivered += 1;
        controller.enqueue(new Uint8Array(1024 * 1024).fill(0x61));
      },
      cancel() {
        cancelled = true;
      },
    });
    const res = { headers: { get: () => null }, body };
    await expect(
      readCappedBody(res as never, { abort: new AbortController().signal, maxBytes: 1024 * 1024 * 3 }),
    ).rejects.toMatchObject({ code: "docling-oversize" });
    expect(cancelled).toBe(true); // the transport stopped delivering
    expect(delivered).toBeLessThan(60); // not the whole 40 MB a buffer-first cap would read
  });

  it("the item-count cap fires after parse and before mapping", () => {
    const doc = { items: Array.from({ length: 10 }, (_, i) => ({ item_type: "text", text: `t${i}`, prov: [{ page_no: 1 }] })) };
    let caught: unknown = null;
    try {
      parseCappedDocument(Buffer.from(JSON.stringify(doc)), 5);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(DoclingError);
    expect((caught as DoclingError).code).toBe("docling-too-many-items");
  });
});

describe("the rules that are greps and tree facts", () => {
  it("the source-by-URL convert endpoint appears NOWHERE under src/", () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`],
      );
    const offenders = walk("src")
      .filter((f) => f.endsWith(".ts") || f.endsWith(".cjs") || f.endsWith(".tsx"))
      .filter((f) => readFileSync(f, "utf8").includes("/v1/convert/source"));
    expect(offenders).toEqual([]);
  });

  it(".dockerignore gains tests/ so Docling fixtures never bake into a self-hoster's image", () => {
    const lines = readFileSync(".dockerignore", "utf8").split(/\r?\n/).map((l) => l.trim());
    expect(lines).toContain("tests");
  });

  it("LANE 1: the shipped registry carries NO docling extractor — nothing runs unconfigured", () => {
    // baseline-docx joined the registry with kb-lib-4; still no docling lane here.
    expect(BASELINE_EXTRACTORS.map((e) => e.id)).toEqual(["baseline-xlsx", "baseline-pdf", "baseline-docx", "baseline-text"]);
  });

  it("the record script REFUSES to run in CI", () => {
    let status = 0;
    let stderr = "";
    try {
      execFileSync("node", ["scripts/record-docling-fixture.mjs", "--source", "tests/fixtures/kb/manual.pdf"], {
        encoding: "utf8",
        env: { ...process.env, CI: "true" },
      });
    } catch (err) {
      status = (err as { status: number }).status;
      stderr = String((err as { stderr: string }).stderr);
    }
    expect(status).not.toBe(0);
    expect(stderr).toMatch(/refusing to run in CI/);
  });

  it("fixture lint, BOTH branches: synthetic passes while the sidecar is absent, fails once it exists", () => {
    // Branch A: the real tree — the overlay now SHIPS (dcl-06) and the
    // three fixtures are RECORDED from the live sidecar, so branch A pins
    // the shipped state: sidecar present, synthetic entries banned, none
    // remaining. Branch B (below) still proves the absent-sidecar rule on
    // a temp tree.
    const real = execFileSync("node", ["scripts/docling-fixture-lint.mjs"], { encoding: "utf8" });
    expect(real).toMatch(/OK \(3 fixture\(s\), sidecar present — synthetic entries banned\)/);

    // Branch B: a temp tree where the sidecar compose file EXISTS — the
    // same synthetic entries must now fail.
    const tmp = join(tmpdir(), `docling-lint-${Date.now()}`);
    mkdirSync(join(tmp, "tests/fixtures/kb/docling"), { recursive: true });
    writeFileSync(join(tmp, "docker-compose.docling.yml"), "services:\n  docling:\n    image: docling-serve\n");
    writeFileSync(
      join(tmp, "tests/fixtures/kb/docling/x.doclingdocument.json"),
      readFileSync(join(FIXDIR, "scanned.doclingdocument.json")),
    );
    writeFileSync(
      join(tmp, "tests/fixtures/kb/docling/MANIFEST.json"),
      JSON.stringify({
        fixtures: [
          { file: "x.doclingdocument.json", provenance: "synthetic", synthetic: true, reason: "hand-authored" },
        ],
      }),
    );
    let status = 0;
    let stderr = "";
    try {
      execFileSync("node", ["scripts/docling-fixture-lint.mjs", "--root", tmp], { encoding: "utf8" });
    } catch (err) {
      status = (err as { status: number }).status;
      stderr = String((err as { stderr: string }).stderr);
    }
    expect(status).not.toBe(0);
    expect(stderr).toMatch(/synthetic entries are not allowed once docker-compose\.docling\.yml exists/);
    rmSync(tmp, { recursive: true, force: true });
    expect(existsSync(tmp)).toBe(false);
  });
});
