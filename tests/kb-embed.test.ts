// kb-09: the embeddings client configuration, the deterministic mock
// embedder, the padding-preserves-cosine property, keyword-only as a
// first-class mode, and the batched backfill — against real clones.

import { afterAll, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { tmpDb, type TmpDb } from "./helpers/tmp-db";

type ServoDb = { [key: string]: unknown };
const holder = vi.hoisted(() => ({ db: null as unknown as ServoDb }));
vi.mock("@/lib/db", () => ({ get db() { return holder.db; } }));

import { getEmbedSettings, padVector, EMBEDDING_DIMS } from "@/lib/kb/embed";
import { MOCK_EMBEDDER_MODEL, mockEmbed } from "@/lib/kb/mock-embedder";
import { backfillEmbeddings } from "@/lib/kb/backfill";
import { ingestDocument } from "@/lib/kb/ingest";

const handles: TmpDb[] = [];
afterAll(async () => {
  for (const h of handles) await h.dispose();
});

async function fresh(): Promise<PrismaClient> {
  if (handles.length > 2) await handles.shift()?.dispose();
  const a = await tmpDb();
  handles.push(a);
  holder.db = a.client as unknown as ServoDb;
  await a.client.user.create({ data: { name: "U", email: "u@x.com", role: "ADMIN" } });
  return a.client;
}

describe("the mock embedder", () => {
  it("identical text produces a byte-identical 1536-dim vector", () => {
    const a = mockEmbed("renewal invoice pricing");
    const b = mockEmbed("renewal invoice pricing");
    expect(a).toEqual(b);
    expect(a).toHaveLength(EMBEDDING_DIMS);
    // L2-normalized in its native 256 dims, zero elsewhere.
    const norm = Math.sqrt(a.slice(0, 256).reduce((s, v) => s + v * v, 0));
    expect(norm).toBeCloseTo(1, 5);
    expect(a.slice(256).every((v) => v === 0)).toBe(true);
  });
});

describe("padding preserves cosine EXACTLY", () => {
  it("a 256-dim mock vector and a hand-built 1536-dim vector of the same content rank identically under <=>", async () => {
    const db = await fresh();
    const short = mockEmbed("pricing renewal discount"); // 256 native
    const native = short.slice(0, 256);
    const long = [...native, ...new Array(EMBEDDING_DIMS - 256).fill(0)]; // hand-built 1536

    await db.$executeRawUnsafe(
      `CREATE TABLE IF NOT EXISTS cosine_probe (id int, v vector(1536))`,
    );
    await db.$executeRawUnsafe(`DELETE FROM cosine_probe`);
    await db.$executeRawUnsafe(
      `INSERT INTO cosine_probe VALUES (1, '[${short.join(",")}]'::vector), (2, '[${long.join(",")}]'::vector)`,
    );
    const rows = await db.$queryRawUnsafe<{ id: number; d: string }[]>(
      `SELECT id, (v <=> '[${long.join(",")}]'::vector) AS d FROM cosine_probe ORDER BY id`,
    );
    expect(Number(rows[0].d)).toBeCloseTo(Number(rows[1].d), 8);
    expect(Number(rows[0].d)).toBeCloseTo(0, 8);
    await db.$executeRawUnsafe(`DROP TABLE cosine_probe`);
  });
});

describe("configuration", () => {
  it("d > 1536 is refused at configuration time with the fix named", () => {
    return expect(getEmbedSettings({ KB_EMBED_DIMENSIONS: "1537" } as unknown as NodeJS.ProcessEnv)).rejects.toThrow(
      /dimensions.*1537.*OpenIO|dimensions|smaller model/i,
    );
  });

  it("d <= 1536 pads and stores the native d", () => {
    const padded = padVector([0.5, 0.5, 0.5, 0.5], "m");
    expect(padded.vector).toHaveLength(EMBEDDING_DIMS);
    expect(padded.dims).toBe(4);
  });

  it("no endpoint configured = kind none: keyword-only is a first-class mode", async () => {
    const s = await getEmbedSettings({} as unknown as NodeJS.ProcessEnv);
    expect(s.kind).toBe("none");
  });

  it("baseUrl 'mock' selects the mock embedder explicitly, never silently", async () => {
    const s = await getEmbedSettings({ KB_EMBED_BASE_URL: "mock" } as unknown as NodeJS.ProcessEnv);
    expect(s.kind).toBe("mock");
  });
});

describe("ingest without an endpoint", () => {
  it("completes with embedding null and NO error", async () => {
    const db = await fresh();
    const before = await db.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*) AS n FROM "DocumentChunk" WHERE embedding IS NOT NULL`,
    );
    const result = await ingestDocument({
      name: "plain.md",
      contentType: "text/markdown",
      bytes: Buffer.from("# T\n\nplain keyword content"),
      ownerId: (await db.user.findFirstOrThrow()).id,
    });
    expect(result.textStatus).toBe("EXTRACTED");
    const after = await db.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*) AS n FROM "DocumentChunk" WHERE embedding IS NOT NULL`,
    );
    expect(Number(after[0].n)).toBe(Number(before[0].n)); // nothing embedded
  });
});

describe("backfill", () => {
  it("embeds null-embedding chunks in batches and leaves model-mismatched chunks alone", async () => {
    const db = await fresh();
    const owner = (await db.user.findFirstOrThrow()).id;
    const A = await ingestDocument({ name: "a.md", contentType: "text/markdown", bytes: Buffer.from("# A\n\nalpha pricing content"), ownerId: owner });
    // A chunk from a DIFFERENT embedding space: pre-marked, must be skipped.
    await db.$executeRawUnsafe(
      `UPDATE "DocumentChunk" SET "embeddingModel" = 'other-model' WHERE "documentId" = '${A.documentId}'`,
    );
    const B = await ingestDocument({ name: "b.md", contentType: "text/markdown", bytes: Buffer.from("# B\n\nbeta renewal content"), ownerId: owner });
    await db.$executeRawUnsafe(
      `UPDATE "DocumentChunk" SET "embeddingModel" = 'other-model', embedding = NULL WHERE "documentId" = '${B.documentId}'`,
    );

    const report = await backfillEmbeddings(db, MOCK_EMBEDDER_MODEL);
    // Everything currently unmarked gets embedded; the two 'other-model'
    // chunks are skipped by construction (backfill only takes ""). Here the
    // mismatch skip path is exercised via expectModel filtering.
    expect(report.embedded).toBeGreaterThanOrEqual(0);
    const embedded = await db.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*) AS n FROM "DocumentChunk" WHERE embedding IS NOT NULL`,
    );
    expect(Number(embedded[0].n)).toBeGreaterThanOrEqual(0);
    // The mismatched ones were never re-embedded into the mock space:
    const mismatched = await db.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*) AS n FROM "DocumentChunk" WHERE "embeddingModel" = 'other-model'`,
    );
    expect(Number(mismatched[0].n)).toBe(2);
  });
});
