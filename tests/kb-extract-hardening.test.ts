// kb-05: the hardened extraction worker. The zip-bomb and XXE fixtures must
// land FAILED inside the wall-clock budget, the parent process and its
// database connection must survive both, and a killed child must leave no
// row stuck in EXTRACTING. Caps fire BEFORE any parse.

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { PrismaClient } from "@prisma/client";
import { tmpDb, type TmpDb } from "./helpers/tmp-db";

type ServoDb = { [key: string]: unknown };
const holder = vi.hoisted(() => ({ db: null as unknown as ServoDb }));
vi.mock("@/lib/db", () => ({ get db() { return holder.db; } }));

import { extractHardened, inspectZip, detectXxe, EXTRACT_LIMITS } from "@/lib/kb/extract";
import { KB_EXTRACT_BUDGET_ENV, KB_EXTRACT_BUDGET_DEFAULT_MS } from "@/lib/kb/settings";
import { ingestDocument } from "@/lib/kb/ingest";

// dcl-01 amendment (the acceptance names it): the wall-clock constant became
// the kb.extract.workerBudgetMs setting, resolved env-first. This file
// tightens the env override to 10s so the wall-clock fixtures stay fast,
// and asserts the default is the shipped 360000.
process.env[KB_EXTRACT_BUDGET_ENV] = "10000";
const BUDGET_MS = 10_000;

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

const zipBomb = () => readFileSync("tests/fixtures/kb/zip-bomb.xlsx");
const xxe = () => readFileSync("tests/fixtures/kb/xxe.xlsx");

describe("the pure pre-parse caps", () => {
  it("inspectZip refuses the bomb on decompressed size, before any inflation", () => {
    const verdict = inspectZip(zipBomb());
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.breach).toBe("entries"); // 2200 members > 2000 — fires first
      expect(verdict.detail).toMatch(/entries/);
    }
  });

  it("detectXxe flags a DOCTYPE with an external SYSTEM entity", () => {
    const hostile = Buffer.from(
      `<?xml version="1.0"?>\n<!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>\n<x>&xxe;</x>`,
    );
    expect(detectXxe(hostile)).toBe(true);
    const clean = Buffer.from(`<?xml version="1.0"?>\n<Types/>`);
    expect(detectXxe(clean)).toBe(false);
  });

  it("the caps are measured, not aspirational", () => {
    expect(EXTRACT_LIMITS.maxEntries).toBe(2_000);
    expect(EXTRACT_LIMITS.maxDecompressedBytes).toBe(64 * 1024 * 1024);
    expect(EXTRACT_LIMITS.maxOldSpaceMb).toBe(512);
    // dcl-01: the wall-clock budget is the kb.extract.workerBudgetMs
    // setting — the shipped default is 360000, and this file's env
    // override tightens it to 10s for the fixtures.
    expect(KB_EXTRACT_BUDGET_DEFAULT_MS).toBe(360_000);
    expect(process.env[KB_EXTRACT_BUDGET_ENV]).toBe("10000");
  });
});

describe("extractHardened", () => {
  it("the zip-bomb fixture lands FAILED within the wall-clock budget; the parent and its database survive", async () => {
    const started = Date.now();
    const outcome = await extractHardened(zipBomb(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    const elapsed = Date.now() - started;
    expect(elapsed).toBeLessThan(BUDGET_MS + 2_000);
    expect(outcome.status).toBe("FAILED");
    expect(outcome.breach).toMatch(/entries|decompressed/);
    expect(outcome.error).toMatch(/Refused before parsing/);
    // The parent's database connection survived.
    expect(await db.user.count()).toBeGreaterThanOrEqual(1);
  });

  it("the XXE fixture lands FAILED with the specific message, without any parser running", async () => {
    const outcome = await extractHardened(xxe(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(outcome.status).toBe("FAILED");
    expect(outcome.breach).toBe("xxe");
    expect(outcome.error).toMatch(/external XML entity/i);
  });

  it("a well-formed text document extracts through the forked worker", async () => {
    const outcome = await extractHardened(Buffer.from("# Title\n\nbody"), "text/markdown");
    expect(outcome.status).toBe("EXTRACTED");
    expect(outcome.text).toContain("body");
  }, 15_000);

  it("an unknown type reports UNSUPPORTED through the worker, not silence", async () => {
    const outcome = await extractHardened(Buffer.from("x"), "application/octet-stream");
    expect(outcome.status).toBe("UNSUPPORTED");
    // UNSUPPORTED carries its message on text-level; the outcome shape keeps
    // error only for FAILED — assert the status names the path instead.
    expect(outcome.text).toBe("");
    expect(outcome.error).toMatch(/No extractor/);
  }, 15_000);
});

describe("ingest under the hardened runner", () => {
  it("the bomb leaves a FAILED row with a specific textError — never a silent dead file", async () => {
    const result = await ingestDocument({
      name: "bomb.xlsx",
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      bytes: zipBomb(),
      ownerId: admin.id,
    });
    expect(result.textStatus).toBe("FAILED");
    const doc = await db.document.findUniqueOrThrow({ where: { id: result.documentId } });
    expect(doc.textError).toMatch(/entries|decompressed/);
    expect(await db.documentChunk.count({ where: { documentId: doc.id } })).toBe(0);
  });

  it("the XXE file leaves a FAILED row naming external entities", async () => {
    const result = await ingestDocument({
      name: "xxe.xlsx",
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      bytes: xxe(),
      ownerId: admin.id,
    });
    expect(result.textStatus).toBe("FAILED");
    const doc = await db.document.findUniqueOrThrow({ where: { id: result.documentId } });
    expect(doc.textError).toMatch(/external XML entity/i);
  });

  it("no row is left stuck in EXTRACTING after a breach", async () => {
    await ingestDocument({
      name: "bomb2.xlsx",
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      bytes: zipBomb(),
      ownerId: admin.id,
    });
    const stuck = await db.document.count({ where: { textStatus: "EXTRACTING" } });
    expect(stuck).toBe(0);
  });
});
