// kb-07: PDF extraction. A 3-page text fixture yields one chunk per page
// with correct {page} locators; oversized pages split by paragraph with an
// ordinal; a corrupt file lands FAILED; a text-layer-free (scanned) file
// lands UNSUPPORTED with the exact OCR message AND stays downloadable —
// silence or a false EXTRACTED are the outcomes this suite exists to make
// impossible.

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { PrismaClient } from "@prisma/client";
import { tmpDb, type TmpDb } from "./helpers/tmp-db";

type ServoDb = { [key: string]: unknown };
const holder = vi.hoisted(() => ({ db: null as unknown as ServoDb }));
vi.mock("@/lib/db", () => ({ get db() { return holder.db; } }));

import { chunkPdfPages, PDF_LIMITS, SCANNED_PDF_ERROR } from "@/lib/kb/extract-pdf";
import { extractHardened } from "@/lib/kb/extract";
import { ingestDocument } from "@/lib/kb/ingest";

const manual = () => readFileSync("tests/fixtures/kb/manual.pdf");
const scanned = () => readFileSync("tests/fixtures/kb/scanned.pdf");
const corrupt = () => readFileSync("tests/fixtures/kb/corrupt.pdf");

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

describe("the pure page chunker", () => {
  it("emits one chunk per page with 1-based {page} locators", () => {
    const verdict = chunkPdfPages(["alpha", "beta", "gamma"]);
    if (verdict.status !== "EXTRACTED") throw new Error("expected EXTRACTED");
    expect(verdict.chunks.map((c) => c.locator)).toEqual([{ page: 1 }, { page: 2 }, { page: 3 }]);
    expect(verdict.chunks[1].text).toBe("beta");
  });

  it("splits an oversized page by paragraph with a 1-based ordinal", () => {
    const para = "word ".repeat(400); // 2000 chars
    const huge = Array.from({ length: 6 }, () => para).join("\n\n"); // > cap
    const verdict = chunkPdfPages(["small", huge]);
    if (verdict.status !== "EXTRACTED") throw new Error("expected EXTRACTED");
    const parts = verdict.chunks.filter((c) => c.locator.page === 2);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.map((c) => c.locator.part)).toEqual(parts.map((_, i) => i + 1));
    for (const part of parts) {
      expect(part.text.length).toBeLessThanOrEqual(PDF_LIMITS.pageCharCap);
    }
    // Nothing dropped: the parts reassemble to the page's paragraphs.
    expect(parts.map((c) => c.text).join("\n\n").replace(/\n\n+/g, "\n\n")).toBe(
      huge.trim().replace(/\n\n+/g, "\n\n"),
    );
  });

  it("lands UNSUPPORTED with the exact scanned-document message when no page carries text", () => {
    expect(chunkPdfPages([])).toEqual({ status: "UNSUPPORTED", error: SCANNED_PDF_ERROR });
    expect(chunkPdfPages(["", "   \n", "\t"])).toEqual({
      status: "UNSUPPORTED",
      error: SCANNED_PDF_ERROR,
    });
  });

  it("keeps a mixed document EXTRACTED — blank pages contribute no chunk", () => {
    const verdict = chunkPdfPages(["", "real text", ""]);
    if (verdict.status !== "EXTRACTED") throw new Error("expected EXTRACTED");
    expect(verdict.chunks).toHaveLength(1);
    expect(verdict.chunks[0].locator).toEqual({ page: 2 });
  });
});

describe("extractHardened over the fixtures", () => {
  it("yields at least 3 chunks with correct page numbers for the 3-page manual", async () => {
    const outcome = await extractHardened(manual(), "application/pdf");
    expect(outcome.status).toBe("EXTRACTED");
    expect(outcome.chunks!.length).toBeGreaterThanOrEqual(3);
    expect(outcome.chunks!.slice(0, 3).map((c) => c.locator)).toEqual([
      { page: 1 },
      { page: 2 },
      { page: 3 },
    ]);
    expect(outcome.chunks![0].text).toContain("page one");
    expect(outcome.chunks![1].text).toContain("90 days");
    expect(outcome.chunks![2].text).toContain("F-01");
  }, 20_000);

  it("lands FAILED, with textError set, on the corrupt fixture", async () => {
    const outcome = await extractHardened(corrupt(), "application/pdf");
    expect(outcome.status).toBe("FAILED");
    expect(outcome.error).toMatch(/PDF could not be parsed/);
    expect(outcome.error).toMatch(/Invalid PDF structure/);
  }, 20_000);

  it("lands UNSUPPORTED with the exact OCR message on the scanned fixture", async () => {
    const outcome = await extractHardened(scanned(), "application/pdf");
    expect(outcome.status).toBe("UNSUPPORTED");
    expect(outcome.error).toBe(SCANNED_PDF_ERROR);
  }, 20_000);
});

describe("ingest keeps a scanned PDF downloadable and shareable", () => {
  it("stores the bytes, marks UNSUPPORTED with the OCR message — never silently indexed", async () => {
    const result = await ingestDocument({
      name: "scanned-manual.pdf",
      contentType: "application/pdf",
      bytes: scanned(),
      ownerId: admin.id,
    });
    expect(result.textStatus).toBe("UNSUPPORTED");
    expect(result.chunks).toBe(0);

    // The file remains downloadable and shareable: bytes intact, id stable.
    const doc = await db.document.findUniqueOrThrow({ where: { id: result.documentId } });
    expect(doc.textError).toBe(SCANNED_PDF_ERROR);
    expect(Buffer.from(doc.data ?? new Uint8Array()).equals(scanned())).toBe(true);
    const grants = await db.kbGrant.create({
      data: { documentId: doc.id, subjectType: "USER", subjectId: admin.id, grantedById: admin.id },
    });
    expect(grants.documentId).toBe(doc.id);
  }, 20_000);

  it("persists {page} locators through a full manual.pdf ingest", async () => {
    const result = await ingestDocument({
      name: "field-manual.pdf",
      contentType: "application/pdf",
      bytes: manual(),
      ownerId: admin.id,
    });
    expect(result.textStatus).toBe("EXTRACTED");
    const stored = await db.documentChunk.findMany({
      where: { documentId: result.documentId },
      orderBy: { index: "asc" },
    });
    expect(stored.map((c) => c.locator)).toEqual([{ page: 1 }, { page: 2 }, { page: 3 }]);
  }, 20_000);
});
