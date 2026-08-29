// kb-06: xlsx extraction. The acceptance workbook (two sheets, headers, a
// merged cell) must produce chunks whose {sheet, range} locators map back to
// the exact cells, with the header row repeated into every chunk of its
// region and the per-chunk cell caps holding. The kb-05 zip bomb must still
// land FAILED through the xlsx path, and ingest must persist the structured
// locators.

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { PrismaClient } from "@prisma/client";
import { tmpDb, type TmpDb } from "./helpers/tmp-db";

type ServoDb = { [key: string]: unknown };
const holder = vi.hoisted(() => ({ db: null as unknown as ServoDb }));
vi.mock("@/lib/db", () => ({ get db() { return holder.db; } }));

import {
  chunkSpreadsheetSheets,
  colToA1,
  SPREADSHEET_LIMITS,
  type SheetRows,
} from "@/lib/kb/extract-xlsx";
import { extractHardened } from "@/lib/kb/extract";
import { ingestDocument } from "@/lib/kb/ingest";

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const pricing = () => readFileSync("tests/fixtures/kb/pricing.xlsx");
const zipBomb = () => readFileSync("tests/fixtures/kb/zip-bomb.xlsx");

const handles: TmpDb[] = [];
afterAll(async () => {
  for (const h of handles) await h.dispose();
});

let db: PrismaClient;
let admin: { id: string };

beforeEach(async () => {
  if (handles.length > 1) await handles.shift()?.dispose();
  const a = await tmpDb();
  handles.push(a);
  db = a.client;
  holder.db = db as unknown as ServoDb;
  admin = await db.user.create({ data: { name: "A", email: "a@x.com", role: "ADMIN" } });
});

describe("the pure windowing math", () => {
  it("colToA1 covers the single-letter span and rolls over at 27", () => {
    expect(colToA1(1)).toBe("A");
    expect(colToA1(4)).toBe("D");
    expect(colToA1(26)).toBe("Z");
    expect(colToA1(27)).toBe("AA");
    expect(colToA1(52)).toBe("AZ");
  });

  it("cuts a region into windows and repeats the header into every chunk", () => {
    const sheet: SheetRows = {
      name: "S",
      firstRow: 1,
      firstCol: 1,
      lastCol: 2,
      headerRow: ["code", "qty"],
      rows: Array.from({ length: 7 }, (_, i) => ({ r: i + 2, values: [`C${i}`, String(i)] })),
    };
    const verdict = chunkSpreadsheetSheets([sheet]);
    if (verdict.status !== "EXTRACTED") throw new Error("expected EXTRACTED");
    // floor(200 / (2+1)) = 66 → clamped to the 30-row window cap.
    expect(verdict.chunks).toHaveLength(1);
    expect(verdict.chunks[0].locator).toEqual({ sheet: "S", range: "A2:B8" });
    expect(verdict.chunks[0].text).toContain("code");
    expect(verdict.chunks[0].text).toContain("C6");
  });

  it("keeps every chunk inside the cell cap even on wide sheets", () => {
    // 40 columns → floor(200/41) = 4 rows per window; 10 rows → 3 windows.
    const wide: SheetRows = {
      name: "W",
      firstRow: 1,
      firstCol: 1,
      lastCol: 40,
      headerRow: Array.from({ length: 40 }, (_, i) => `h${i}`),
      rows: Array.from({ length: 10 }, (_, i) => ({
        r: i + 2,
        values: Array.from({ length: 40 }, (_, j) => `v${i}-${j}`),
      })),
    };
    const verdict = chunkSpreadsheetSheets([wide]);
    if (verdict.status !== "EXTRACTED") throw new Error("expected EXTRACTED");
    expect(verdict.chunks.length).toBe(3);
    for (const chunk of verdict.chunks) {
      const dataRows = chunk.text.split("\n").filter((l) => l.startsWith("| v")).length;
      expect((dataRows + 1) * 40).toBeLessThanOrEqual(SPREADSHEET_LIMITS.chunkCellCap);
    }
  });

  it("lands UNSUPPORTED, never EXTRACTED-with-nothing, on an empty workbook", () => {
    expect(chunkSpreadsheetSheets([])).toEqual({
      status: "UNSUPPORTED",
      error: "The workbook contains no data rows.",
    });
  });
});

describe("extractHardened over the acceptance fixture", () => {
  it("windows both sheets with exact A1 locators and repeated headers", async () => {
    const outcome = await extractHardened(pricing(), XLSX_TYPE);
    expect(outcome.status).toBe("EXTRACTED");
    expect(outcome.chunks).toHaveLength(3); // Hardware 30+10, Services 8
    expect(outcome.chunks!.map((c) => c.locator)).toEqual([
      { sheet: "Hardware", range: "A2:D31" },
      { sheet: "Hardware", range: "A32:D41" },
      { sheet: "Services", range: "A2:D9" },
    ]);
    // Header text present in EVERY chunk of its region — the kb-08 rarity
    // weighting counts distinct documents, never occurrences, because of
    // exactly this repetition.
    const hardware = outcome.chunks!.filter((c) => c.locator.sheet === "Hardware");
    expect(hardware).toHaveLength(2);
    for (const chunk of hardware) expect(chunk.text).toContain("SKU");
    expect(outcome.chunks![2].text).toContain("Code");

    // The locator maps back to the exact cells: chunk 2 starts at row 32.
    expect(hardware[1].text).toContain("HW-031"); // row 32
    expect(hardware[1].text).not.toContain("HW-030"); // row 31 lives in chunk 1
    expect(hardware[0].text).toContain("HW-030");

    // The merged cell reports once, at its anchor D2 — row 3 has no value.
    expect(hardware[0].text).toContain("bulk pack");
    expect(hardware[0].text.match(/bulk pack/g)).toHaveLength(1);
  }, 20_000);

  it("still refuses the kb-05 zip bomb through the xlsx path, before any parse", async () => {
    const outcome = await extractHardened(zipBomb(), XLSX_TYPE);
    expect(outcome.status).toBe("FAILED");
    // Whichever cap fires first — 2200 members trip the entry cap, a
    // fewer-members bomb the decompressed cap — the refusal is pre-parse.
    expect(["entries", "decompressed"]).toContain(outcome.breach);
    expect(outcome.error).toMatch(/Refused before parsing/);
  }, 20_000);

  it("says UNSUPPORTED for a zip container that is not a spreadsheet", async () => {
    // Minimal zip-shaped bytes that pass the entry caps but are no workbook:
    // the dispatch must not mistake "zip" for "spreadsheet".
    const notWorkbook = Buffer.from([
      0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x01, 0x00, 0x61, 0x2e, 0x74, 0x78, 0x74,
    ]);
    const outcome = await extractHardened(notWorkbook, "application/octet-stream");
    expect(outcome.status).toBe("UNSUPPORTED");
    expect(outcome.error).toMatch(/No extractor/);
  }, 20_000);

  it("names legacy .xls specifically instead of failing to parse it", async () => {
    const outcome = await extractHardened(Buffer.from("not a biff file"), "application/vnd.ms-excel");
    expect(outcome.status).toBe("UNSUPPORTED");
    expect(outcome.error).toMatch(/Legacy \.xls is not supported/);
  }, 20_000);

  it("lands FAILED, not silence, on a declared workbook that exceljs cannot load", async () => {
    const outcome = await extractHardened(Buffer.from("%PDF-nonsense"), XLSX_TYPE);
    expect(outcome.status).toBe("FAILED");
    expect(outcome.error).toBeTruthy();
  }, 20_000);
});

describe("ingest persists the structured chunks", () => {
  it("stores {sheet, range} locators and computes keywords per chunk", async () => {
    const result = await ingestDocument({
      name: "pricing.xlsx",
      contentType: XLSX_TYPE,
      bytes: pricing(),
      ownerId: admin.id,
    });
    expect(result.textStatus).toBe("EXTRACTED");
    expect(result.chunks).toBe(3);

    const stored = await db.documentChunk.findMany({
      where: { documentId: result.documentId },
      orderBy: { index: "asc" },
    });
    expect(stored).toHaveLength(3);
    expect(stored[0].locator).toEqual({ sheet: "Hardware", range: "A2:D31" });
    expect(stored[1].locator).toEqual({ sheet: "Hardware", range: "A32:D41" });
    expect(stored[2].locator).toEqual({ sheet: "Services", range: "A2:D9" });
    // The deterministic keyword pass rode along per chunk (kb-08): real
    // arrays on every row — silence here would mean ingest dropped them.
    for (const chunk of stored) {
      expect(Array.isArray(chunk.keywords)).toBe(true);
      expect((chunk.keywords as string[]).length).toBeGreaterThan(0);
    }

    const doc = await db.document.findUnique({ where: { id: result.documentId } });
    expect(doc?.summary).toContain("Sheet: Hardware");
  }, 20_000);
});
