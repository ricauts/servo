// kb-04: upload, storage and text/markdown extraction — with the locator
// round-trip, the lifecycle, the cap, replacement semantics, the no-provider
// guarantee and the data-omission rule, all against real clones.

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { PrismaClient } from "@prisma/client";
import { tmpDb, type TmpDb } from "./helpers/tmp-db";

type ServoDb = { [key: string]: unknown };
const holder = vi.hoisted(() => ({
  db: null as unknown as ServoDb,
  user: null as unknown as { id: string; role: string },
}));
vi.mock("@/lib/db", () => ({ get db() { return holder.db; } }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: async () => holder.user }));

import { POST as postDocuments, GET as getDocuments } from "@/app/api/kb/documents/route";
import { chunkMarkdown } from "@/lib/kb/chunk";
import { ingestDocument } from "@/lib/kb/ingest";

const handles: TmpDb[] = [];
afterAll(async () => {
  for (const h of handles) await h.dispose();
});

let db: PrismaClient;
let uploader: { id: string; name: string; role: string };
let outsider: { id: string; name: string; role: string };

beforeEach(async () => {
  if (handles.length > 2) await handles.shift()?.dispose();
  const a = await tmpDb();
  handles.push(a);
  db = a.client;
  holder.db = db as unknown as ServoDb;
  uploader = { ...(await db.user.create({ data: { name: "Up", email: "up@x.com", role: "AGENT" } })), role: "AGENT" };
  outsider = { ...(await db.user.create({ data: { name: "Out", email: "out@x.com", role: "AGENT" } })), role: "AGENT" };
  holder.user = uploader;
});

const MARKDOWN = [
  "# Pricing",
  "",
  "The 2026 price list applies from January.",
  "Invoice codes start with INV-2026.",
  "",
  "# Renewals",
  "",
  "Renewals are due in March.",
  "Late renewals carry a 5% fee.",
].join("\n");

function mdFile(name: string, text: string) {
  return new File([text], name, { type: "text/markdown" });
}

function req(method: string, body: FormData) {
  return new Request("http://x/api/kb/documents", { method, body }) as never;
}

describe("chunkMarkdown — the locator contract", () => {
  it("round-trips: each locator slices back to exactly its chunk text", () => {
    const chunks = chunkMarkdown(MARKDOWN);
    const lines = MARKDOWN.split("\n");
    for (const c of chunks) {
      const [from, to] = c.locator.lines.split("-").map(Number);
      const sliced = lines.slice(from - 1, to).join("\n").trim();
      expect(sliced, `locator ${c.locator.lines}`).toBe(c.text);
    }
    expect(chunks.length).toBeGreaterThanOrEqual(2); // split on headings
    expect(chunks[0].text).toContain("price list");
    expect(chunks[1].text).toContain("Renewals");
  });

  it("respects fenced code blocks: no split inside a fence, headings inside are inert", () => {
    const fenced = "# T\n\n```md\n# not a heading\n\nstill fenced\n```\n\nafter";
    const chunks = chunkMarkdown(fenced);
    expect(chunks.some((c) => c.text.includes("not a heading") && c.text.includes("still fenced"))).toBe(true);
  });
});

describe("upload + extraction", () => {
  it("stores bytes with sha256/byteSize and runs the lifecycle to EXTRACTED", async () => {
    const res = await postDocuments(req("POST", (() => { const f = new FormData(); f.set("file", mdFile("pricing.md", MARKDOWN)); return f; })()));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { documentId: string; textStatus: string; chunks: number };
    expect(body.textStatus).toBe("EXTRACTED");
    expect(body.chunks).toBeGreaterThanOrEqual(2);

    const doc = await db.document.findUniqueOrThrow({ where: { id: body.documentId } });
    expect(doc.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(doc.byteSize).toBe(Buffer.byteLength(MARKDOWN));
    expect(doc.textStatus).toBe("EXTRACTED");
    expect(doc.ownerId).toBe(uploader.id);
    // Deterministic summary: first chunk, capped — no provider call.
    expect(doc.summary).toContain("price list");

    const chunks = await db.documentChunk.findMany({
      where: { documentId: doc.id },
      orderBy: { index: "asc" },
    });
    expect(chunks.map((c) => c.index)).toEqual(chunks.map((_, i) => i));
  });

  it("makes NO model call at ingest — zero AiUsage rows and no ai imports in the module", async () => {
    const source = readFileSync("src/lib/kb/ingest.ts", "utf8") + readFileSync("src/lib/kb/chunk.ts", "utf8");
    expect(source).not.toMatch(/from "@\/lib\/ai\//);
    await ingestDocument({ name: "quiet.md", contentType: "text/markdown", bytes: Buffer.from(MARKDOWN), ownerId: uploader.id });
    expect(await db.aiUsage.count()).toBe(0);
  });

  it("rejects an oversized file with a clear message and NO row", async () => {
    const big = new File([new Uint8Array(25 * 1024 * 1024 + 1)], "big.md", { type: "text/markdown" });
    const f = new FormData(); f.set("file", big);
    const res = await postDocuments(req("POST", f));
    expect(res.status).toBe(413);
    const { error } = (await res.json()) as { error: string };
    expect(error).toMatch(/25 MB/);
    expect(await db.document.count()).toBe(0);
  });

  it("re-upload replaces chunks and keeps grants, atomically", async () => {
    const first = await ingestDocument({ name: "doc.md", contentType: "text/markdown", bytes: Buffer.from(MARKDOWN), ownerId: uploader.id });
    await db.kbGrant.create({
      data: { documentId: first.documentId, subjectType: "USER", subjectId: outsider.id, grantedById: uploader.id },
    });
    const second = await ingestDocument({ name: "doc.md", contentType: "text/markdown", bytes: Buffer.from("# Only heading\n\nshort body"), ownerId: uploader.id });
    expect(second.replacedExisting).toBe(true);
    expect(second.documentId).toBe(first.documentId);
    const chunks = await db.documentChunk.findMany({ where: { documentId: first.documentId } });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toContain("short body");
    // Grants survive the content replacement.
    expect(await db.kbGrant.count({ where: { documentId: first.documentId } })).toBe(1);
  });

  it("marks a corrupt declared PDF FAILED with the parser's reason (kb-07 landed)", async () => {
    // kb-04 asserted the transitional "arrives with kb-07" message; the
    // extractor now exists, so a 4-byte garbage file is honestly FAILED,
    // never silently extracted. The scanned-PDF UNSUPPORTED verdict lives
    // in tests/kb-pdf.test.ts.
    const res = await postDocuments(req("POST", (() => { const f = new FormData(); f.set("file", new File([new Uint8Array(4)], "manual.pdf", { type: "application/pdf" })); return f; })()));
    expect(res.status).toBe(201);
    const { documentId } = (await res.json()) as { documentId: string };
    const doc = await db.document.findUniqueOrThrow({ where: { id: documentId } });
    expect(doc.textStatus).toBe("FAILED");
    expect(doc.textError).toMatch(/PDF could not be parsed/);
  });
});

describe("the list route — entitlement-scoped, data-omitted", () => {
  it("lists only entitled documents and the query never selects data", async () => {
    const mine = await ingestDocument({ name: "mine.md", contentType: "text/markdown", bytes: Buffer.from(MARKDOWN), ownerId: uploader.id });
    const theirs = await ingestDocument({ name: "theirs.md", contentType: "text/plain", bytes: Buffer.from("other"), ownerId: outsider.id });

    // Query inspection: spy the document findMany through an extension.
    const selects: unknown[] = [];
    const spy = db.$extends({
      query: {
        document: {
          async findMany({ args, query }) {
            selects.push(args.select);
            return query(args);
          },
        },
      },
    });
    const rows = await spy.document.findMany({
      where: { id: { in: [mine.documentId, theirs.documentId] } },
      select: { id: true, name: true },
    });
    expect(rows).toHaveLength(2);
    expect(selects).toHaveLength(1);

    const res = await getDocuments();
    expect(res.status).toBe(200);
    const { documents } = (await res.json()) as { documents: { id: string; data?: unknown }[] };
    expect(documents.map((d) => d.id)).toEqual([mine.documentId]); // ownership only
    expect(documents[0]).not.toHaveProperty("data");
  });
});
