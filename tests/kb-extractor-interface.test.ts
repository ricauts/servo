// dcl-01: the pluggable extractor interface. The seam tests: the sniff
// overrides a lying Content-Type, a hung stub extractor dies at the
// kb.extract.workerBudgetMs budget, provenance lands on the Document row,
// the boot reclaim drains stranded EXTRACTING rows, and the version
// strings stay pinned to package.json. LANE 1: no Docling anywhere.

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import type { PrismaClient } from "@prisma/client";
import { tmpDb, type TmpDb } from "./helpers/tmp-db";

type ServoDb = { [key: string]: unknown };
const holder = vi.hoisted(() => ({ db: null as unknown as ServoDb }));
vi.mock("@/lib/db", () => ({ get db() { return holder.db; } }));

import { sniffRoute, reclaimStuckExtractions } from "@/lib/kb/extract";
import { extractDocument } from "@/lib/kb/extractors/run";
import { BASELINE_EXTRACTORS, xlsxExtractor, pdfExtractor, textExtractor } from "@/lib/kb/extractors/baseline";
import { pickExtractor, type Extractor } from "@/lib/kb/extractors";
import { ingestDocument } from "@/lib/kb/ingest";
import { KB_EXTRACT_BUDGET_ENV } from "@/lib/kb/settings";

const handles: TmpDb[] = [];
afterAll(async () => {
  for (const h of handles) await h.dispose();
});

let db: PrismaClient;
let owner: { id: string };

beforeEach(async () => {
  if (handles.length > 1) await handles.shift()?.dispose();
  const a = await tmpDb();
  handles.push(a);
  db = a.client;
  holder.db = db as unknown as ServoDb;
  owner = await db.user.create({ data: { name: "O", email: `o${Date.now()}@x.com`, role: "REQUESTER" } });
});

describe("the sniff — routing on BYTES, not the declared Content-Type", () => {
  it("the route table", () => {
    const xlsx = readFileSync("tests/fixtures/kb/pricing.xlsx");
    const pdf = readFileSync("tests/fixtures/kb/manual.pdf");
    expect(sniffRoute(xlsx, "application/octet-stream")).toBe("xlsx");
    expect(sniffRoute(xlsx, "text/plain")).toBe("xlsx"); // the sniff OVERRIDES a lie
    expect(sniffRoute(pdf, "application/octet-stream")).toBe("pdf");
    expect(sniffRoute(Buffer.from("# hi"), "text/markdown")).toBe("text");
    // Text is the declared-type case it always was: decodability alone
    // cannot make an octet-stream upload a text document (kb-05 relies on it).
    expect(sniffRoute(Buffer.from("x"), "application/octet-stream")).toBe("application/octet-stream");
  });

  it("a declared type that lies about a real xlsx still extracts as xlsx", async () => {
    const bytes = readFileSync("tests/fixtures/kb/pricing.xlsx");
    const ran = await extractDocument(bytes, "application/octet-stream");
    expect(ran.sniffedType).toBe("xlsx");
    expect(ran.extractorId).toBe("baseline-xlsx");
    expect(ran.outcome.status).toBe("EXTRACTED");
    if (ran.outcome.status === "EXTRACTED") {
      expect(ran.outcome.chunks.length).toBeGreaterThan(0);
      expect(ran.outcome.chunks[0].locator).toHaveProperty("sheet");
    }
  }, 30_000);
});

describe("the registry", () => {
  it("pick order is xlsx, pdf, text; unknown routes find nothing", () => {
    expect(pickExtractor("xlsx", BASELINE_EXTRACTORS)).toBe(xlsxExtractor);
    expect(pickExtractor("pdf", BASELINE_EXTRACTORS)).toBe(pdfExtractor);
    expect(pickExtractor("text", BASELINE_EXTRACTORS)).toBe(textExtractor);
    expect(pickExtractor("application/octet-stream", BASELINE_EXTRACTORS)).toBeNull();
  });

  it("the version strings name the exact library versions from package.json", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    const exceljs = pkg.dependencies.exceljs.replace(/^\^/, "");
    const unpdf = pkg.dependencies.unpdf.replace(/^\^/, "");
    expect(xlsxExtractor.version).toContain(`exceljs@${exceljs}`);
    expect(pdfExtractor.version).toContain(`unpdf@${unpdf}`);
    expect(textExtractor.version).toBe("kb-04@1");
  });
});

describe("a hung extractor is killed by the budget", () => {
  it("a stub that never returns resolves FAILED/budget through the seam", async () => {
    const hung: Extractor = {
      id: "stub-hung",
      version: "stub@1",
      supports: () => true,
      extract: () => new Promise(() => {}), // never resolves
    };
    const ran = await extractDocument(Buffer.from("x"), "text/markdown", {
      registry: [hung],
      budgetMs: 250,
    });
    expect(ran.outcome).toMatchObject({
      status: "FAILED",
      breach: "budget",
    });
    expect(ran.outcome.status === "FAILED" && ran.outcome.error).toMatch(/250 ms/);
  }, 5_000);

  it("through ingest: a tiny budget still leaves NO row stuck in EXTRACTING", async () => {
    const prev = process.env[KB_EXTRACT_BUDGET_ENV];
    process.env[KB_EXTRACT_BUDGET_ENV] = "1"; // fires before the worker can answer
    try {
      const result = await ingestDocument({
        name: "d.txt", contentType: "text/plain",
        bytes: Buffer.from("# T\n\nbody"), ownerId: owner.id,
      });
      expect(["FAILED", "UNSUPPORTED", "EXTRACTED"]).toContain(result.textStatus);
      const row = await db.document.findUnique({ where: { id: result.documentId } });
      expect(row?.textStatus).not.toBe("EXTRACTING"); // kb-05's criterion, via the seam
      expect(row?.textError).toMatch(/Exceeded 1 ms|exceeded|worker died|budget/);
    } finally {
      if (prev === undefined) delete process.env[KB_EXTRACT_BUDGET_ENV];
      else process.env[KB_EXTRACT_BUDGET_ENV] = prev;
    }
  }, 30_000);
});

describe("provenance on the Document row", () => {
  it("a text ingest records the extractor, its version, NULL fallback and extractedAt", async () => {
    const result = await ingestDocument({
      name: "note.md", contentType: "text/markdown",
      bytes: Buffer.from("# Title\n\nbody"), ownerId: owner.id,
    });
    const row = await db.document.findUnique({ where: { id: result.documentId } });
    expect(row).toMatchObject({
      extractor: "baseline-text",
      extractorVersion: "kb-04@1",
      extractorFallback: null,
    });
    expect(row?.extractedAt).not.toBeNull();
  }, 30_000);

  it("an xlsx ingest records the xlsx extractor with exceljs in the version", async () => {
    const bytes = readFileSync("tests/fixtures/kb/pricing.xlsx");
    const result = await ingestDocument({
      name: "pricing.xlsx",
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      bytes, ownerId: owner.id,
    });
    const row = await db.document.findUnique({ where: { id: result.documentId } });
    expect(row?.textStatus).toBe("EXTRACTED");
    expect(row?.extractor).toBe("baseline-xlsx");
    expect(row?.extractorVersion).toMatch(/^exceljs@\d+\.\d+\.\d+;kb-06@1$/);
    expect(row?.extractorFallback).toBeNull();
  }, 60_000);
});

describe("the boot reclaim", () => {
  it("drains an EXTRACTING row older than the budget; fresh ones stand", async () => {
    const old = await db.document.create({
      data: {
        name: "old.txt", contentType: "text/plain", byteSize: 1, sha256: "old",
        textStatus: "EXTRACTING", ownerId: owner.id,
        updatedAt: new Date(Date.now() - 3_600_000),
      },
    });
    const fresh = await db.document.create({
      data: {
        name: "fresh.txt", contentType: "text/plain", byteSize: 1, sha256: "fresh",
        textStatus: "EXTRACTING", ownerId: owner.id,
      },
    });
    const prev = process.env[KB_EXTRACT_BUDGET_ENV];
    process.env[KB_EXTRACT_BUDGET_ENV] = "1000"; // the old row is 1h past it
    try {
      const reclaimed = await reclaimStuckExtractions(db);
      expect(reclaimed).toBe(1);
      const oldRow = await db.document.findUnique({ where: { id: old.id } });
      expect(oldRow?.textStatus).toBe("FAILED");
      expect(oldRow?.textError).toMatch(/reclaimed at boot/);
      const freshRow = await db.document.findUnique({ where: { id: fresh.id } });
      expect(freshRow?.textStatus).toBe("EXTRACTING");
    } finally {
      if (prev === undefined) delete process.env[KB_EXTRACT_BUDGET_ENV];
      else process.env[KB_EXTRACT_BUDGET_ENV] = prev;
    }
  });
});

describe("LANE 1 — the fresh-install state", () => {
  // AMENDED BY dcl-03, which legitimately ships the Docling client under
  // src/lib/kb/extractors/: the guarantee this test owns was never the
  // absence of the code — it is that none of it EXECUTES unconfigured. The
  // structural form: the registry carries no docling extractor, and no
  // module on the ingest path (registry, runner, ingest) imports the
  // docling client. dcl-03's own suite additionally asserts the shipped
  // registry ids directly.
  it("no docling module is reachable from the extraction path without configuration", () => {
    expect(BASELINE_EXTRACTORS.map((e) => e.id)).not.toContain(expect.stringMatching(/docling/i));

    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`],
      );
    const onThePath = [
      ...walk("src/lib/kb/extractors").filter((f) => /(?:index|baseline|run)\.ts$/.test(f)),
      "src/lib/kb/extract.ts",
      "src/lib/kb/ingest.ts",
    ];
    expect(onThePath.length).toBeGreaterThan(0);
    for (const f of onThePath) {
      const source = readFileSync(f, "utf8").split(/\r?\n/).map((l) => l.replace(/\/\/.*$/, "")).join("\n");
      expect(source, `${f} reaches the docling client unconfigured`).not.toMatch(/docling-client/);
    }
  });
});

