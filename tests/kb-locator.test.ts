// dcl-02: the locator contract. One schema family (additive keys only, all
// .passthrough()), one renderer (formatLocator owns every citation
// string), and the RECORDED strings kb-11's tools and kb-12's markers
// produced before this module existed — pinned byte-for-byte, not by
// inspection.

import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { readFileSync } from "node:fs";
import {
  BBox,
  LineLocator,
  PageLocator,
  SheetLocator,
  formatLocator,
} from "@/lib/kb/locator";
import { locatorContractOk, xlsxExtractor } from "@/lib/kb/extractors/baseline";

describe("the rule, verbatim and mechanical", () => {
  it("the module header states the additive-keys rule word for word", () => {
    const header = readFileSync("src/lib/kb/locator.ts", "utf8")
      .slice(0, 1400)
      .replace(/\s*\/\/\s*/g, " ")
      .replace(/\s+/g, " ");
    expect(header).toContain(
      "existing keys keep their meaning forever, new keys are additive, no consumer may require a key it did not previously require",
    );
  });

  it("a locator carrying EVERY optional key validates against the SAME schema as a bare one", () => {
    const bare = { sheet: "2026", range: "B4:D9" };
    const full = {
      sheet: "2026",
      range: "B4:D9",
      pageEnd: 14, // passthrough: tolerated on a sheet locator too
      label: "pricing table",
      ref: "'2026'!B4:D9",
      table: "Table1",
      cell: "B4",
      bbox: { x: 0.1, y: 0.2, w: 0.5, h: 0.3 },
      futureKeyNoOneKnows: { anything: true }, // passthrough, not stripped
    };
    expect(SheetLocator.safeParse(bare).success).toBe(true);
    expect(SheetLocator.safeParse(full).success).toBe(true);
    expect(PageLocator.safeParse({ page: 12 }).success).toBe(true);
    expect(PageLocator.safeParse({ page: 12, pageEnd: 14, label: "table", bbox: { x: 0, y: 0, w: 1, h: 1 } }).success).toBe(true);
    expect(LineLocator.safeParse({ lines: "120-180" }).success).toBe(true);
    expect(LineLocator.safeParse({ lines: "120-180", label: "intro" }).success).toBe(true);
  });

  it("a locator missing a REQUIRED key fails validation, and the error names the key", () => {
    const missingRange = SheetLocator.safeParse({ sheet: "2026" });
    expect(missingRange.success).toBe(false);
    expect((missingRange.error as z.ZodError).issues[0].path).toContain("range");

    const missingPage = PageLocator.safeParse({ label: "table" });
    expect(missingPage.success).toBe(false);
    expect((missingPage.error as z.ZodError).issues[0].path).toContain("page");
  });

  it("bbox is 0-1 with a TOP-LEFT origin — out-of-range is rejected, the boundary is not", () => {
    expect(BBox.safeParse({ x: 0, y: 0, w: 1, h: 1 }).success).toBe(true);
    expect(BBox.safeParse({ x: 0.5, y: 0.5, w: 0.25, h: 0.25 }).success).toBe(true);
    expect(BBox.safeParse({ x: 1.5, y: 0, w: 0.1, h: 0.1 }).success).toBe(false);
    expect(BBox.safeParse({ x: -0.1, y: 0, w: 0.1, h: 0.1 }).success).toBe(false);
    expect(BBox.safeParse({ x: 0, y: 0, w: 1.2, h: 0.1 }).success).toBe(false);
  });

  it("page numbers are 1-BASED — asserted against the shipped PDF fixture, not assumed", async () => {
    // The real kb-07 fixture: manual.pdf's first chunk carries {page: 1},
    // never {page: 0}. Drive the shipped extractor so the assertion is
    // over what the pipeline emits, not over a hand-written literal.
    const bytes = readFileSync("tests/fixtures/kb/manual.pdf");
    const { extractDocument } = await import("@/lib/kb/extractors/run");
    const ran = await extractDocument(bytes, "application/pdf");
    expect(ran.outcome.status).toBe("EXTRACTED");
    if (ran.outcome.status !== "EXTRACTED") throw new Error("unreachable");
    const pages = ran.outcome.chunks.map((c) => c.locator).map((l) => PageLocator.parse(l));
    expect(pages.length).toBeGreaterThan(0);
    expect(pages[0].page).toBe(1);
    expect(pages.every((p) => p.page >= 1)).toBe(true);
    expect(locatorContractOk(ran.outcome.chunks, "page")).toBe(true);
  }, 60_000);

  it("the xlsx extractor's chunks satisfy the sheet contract at the emission site", async () => {
    const bytes = readFileSync("tests/fixtures/kb/pricing.xlsx");
    const outcome = await xlsxExtractor.extract({
      bytes,
      sniffedType: "xlsx",
      declaredType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      signal: AbortSignal.timeout(30_000),
    });
    expect(outcome.status).toBe("EXTRACTED");
    if (outcome.status !== "EXTRACTED") throw new Error("unreachable");
    expect(locatorContractOk(outcome.chunks, "sheet")).toBe(true);
  }, 60_000);
});

describe("formatLocator — the single owner of citation strings", () => {
  it("the RECORDED strings: byte-identical to what shipped before this module", () => {
    // Recorded from the kb-11 tool surface and kb-12's markers on the
    // fixtures, before dcl-02 existed:
    expect(formatLocator({ sheet: "2026", range: "B4:D9" })).toBe("sheet 2026 B4:D9");
    expect(formatLocator({ page: 12 })).toBe("page 12");
    expect(formatLocator({ lines: "120-180" })).toBe("lines 120-180");
    expect(formatLocator({ page: 3 })).toBe("page 3"); // manual.pdf's first page
    expect(formatLocator(null)).toBe("location unknown");
    expect(formatLocator("nonsense")).toBe("location unknown");
    expect(formatLocator({})).toBe("location unknown");
  });

  it("the acceptance's three pinned strings, including the label join", () => {
    expect(formatLocator({ sheet: "2026", range: "B4:D9" })).toBe("sheet 2026 B4:D9");
    expect(formatLocator({ page: 12 })).toBe("page 12");
    expect(formatLocator({ page: 12, label: "table" })).toBe("page 12 · table");
  });

  it("the additive keys render additively, never destructively", () => {
    expect(formatLocator({ page: 12, pageEnd: 14 })).toBe("page 12-14");
    expect(formatLocator({ page: 12, pageEnd: 12 })).toBe("page 12"); // a no-op span renders bare
    expect(formatLocator({ sheet: "2026", range: "B4:D9", label: "pricing" })).toBe("sheet 2026 B4:D9 · pricing");
    expect(formatLocator({ lines: "120-180", label: "intro" })).toBe("lines 120-180 · intro");
    // bbox/ref/table/cell are for machines: they never render.
    expect(formatLocator({ page: 12, bbox: { x: 0, y: 0, w: 1, h: 1 }, ref: "x", table: "t", cell: "B4" })).toBe("page 12");
  });
});
