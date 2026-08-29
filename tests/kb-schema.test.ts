// kb-01: the KB schema and its hand-written migration, proven on a real
// throwaway clone. The constraints that Prisma cannot express are the ones
// this file exists to prove: the partial uniques, the num_nonnulls CHECK,
// the generated tsvector column and the three special indexes.

import { afterAll, describe, expect, it } from "vitest";
import { tmpDb, type TmpDb } from "./helpers/tmp-db";

const handles: TmpDb[] = [];
afterAll(async () => {
  for (const h of handles) await h.dispose();
});

async function user(db: TmpDb["client"], email = "kb@example.com") {
  return db.user.create({
    data: { name: "KB Owner", email, role: "AGENT" },
  });
}

async function document(db: TmpDb["client"], ownerId: string, name = "Pricing.xlsx") {
  return db.document.create({
    data: {
      name,
      contentType: "text/markdown",
      byteSize: 42,
      sha256: "aa".repeat(32),
      data: Buffer.from("# Pricing\nthe body"),
      ownerId,
    },
  });
}

describe("KbGrant — the constraints Prisma cannot express", () => {
  it("rejects a duplicate (document, subject) grant via the partial unique index", async () => {
    const a = await tmpDb();
    handles.push(a);
    const u = await user(a.client);
    const d = await document(a.client, u.id);
    const row = {
      documentId: d.id,
      subjectType: "USER",
      subjectId: u.id,
      grantedById: u.id,
    };
    await a.client.kbGrant.create({ data: row });
    await expect(a.client.kbGrant.create({ data: row })).rejects.toThrow(/unique/i);
  });

  it("rejects a grant with BOTH targets and a grant with NEITHER (the CHECK)", async () => {
    const a = await tmpDb();
    handles.push(a);
    const u = await user(a.client, "both@example.com");
    const d = await document(a.client, u.id);
    await expect(
      a.client.kbGrant.create({
        data: {
          documentId: d.id,
          collectionId: null,
          subjectType: "USER",
          subjectId: u.id,
          grantedById: u.id,
        },
      }),
    ).resolves.toBeTruthy();
    const c = await a.client.collection.create({ data: { name: "Finance" } });
    await expect(
      a.client.kbGrant.create({
        data: {
          documentId: d.id,
          collectionId: c.id, // BOTH — violates KbGrant_one_target
          subjectType: "USER",
          subjectId: u.id,
          grantedById: u.id,
        },
      }),
    ).rejects.toThrow(/KbGrant_one_target|check/i);
    await expect(
      a.client.kbGrant.create({
        data: {
          subjectType: "USER", // NEITHER — also violates the CHECK
          subjectId: u.id,
          grantedById: u.id,
        },
      }),
    ).rejects.toThrow(/KbGrant_one_target|check/i);
  });
});

describe("DocumentChunk — the generated column and the special indexes", () => {
  it("carries the STORED tsv column, maintained by Postgres itself", async () => {
    const a = await tmpDb();
    handles.push(a);
    const u = await user(a.client, "tsv@example.com");
    const d = await document(a.client, u.id);
    await a.client.documentChunk.create({
      data: { documentId: d.id, index: 0, text: "renewal invoice pricing", locator: { lines: "1-2" } },
    });
    const rows = await a.client.$queryRawUnsafe<{ tsv: string }[]>(
      `SELECT tsv::text FROM "DocumentChunk" WHERE "documentId" = $1`,
      d.id,
    );
    expect(rows[0]?.tsv).toContain("'renewal'");
    expect(rows[0]?.tsv).toContain("'pricing'");
  });

  it("has the GIN (tsv), GIN (keywords jsonb_path_ops) and HNSW indexes in the catalog", async () => {
    const a = await tmpDb();
    handles.push(a);
    const idx = await a.client.$queryRawUnsafe<{ indexname: string; indexdef: string }[]>(
      `SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'DocumentChunk'`,
    );
    const byName = new Map(idx.map((r) => [r.indexname, r.indexdef]));
    expect(byName.get("DocumentChunk_tsv_idx")).toMatch(/USING gin.*tsv/i);
    expect(byName.get("DocumentChunk_keywords_idx")).toMatch(/jsonb_path_ops/);
    expect(byName.get("DocumentChunk_embedding_hnsw_idx")).toMatch(/USING hnsw.*vector_cosine_ops/i);
    // And the grant-side partial uniques:
    const grants = await a.client.$queryRawUnsafe<{ indexdef: string }[]>(
      `SELECT indexdef FROM pg_indexes WHERE tablename = 'KbGrant' AND indexdef LIKE '%WHERE%'`,
    );
    expect(grants.map((g) => g.indexdef).join("\n")).toMatch(/"documentId" IS NOT NULL/);
    expect(grants.map((g) => g.indexdef).join("\n")).toMatch(/"collectionId" IS NOT NULL/);
  });

  it("keyword-only is a normal state: chunks live with embedding null", async () => {
    const a = await tmpDb();
    handles.push(a);
    const u = await user(a.client, "null-embed@example.com");
    const d = await document(a.client, u.id);
    const chunk = await a.client.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*) AS n FROM "DocumentChunk" WHERE "embedding" IS NULL AND "documentId" = $1`,
      d.id,
    );
    expect(Number(chunk[0]?.n ?? 0)).toBe(0); // none yet —
    await a.client.documentChunk.create({
      data: { documentId: d.id, index: 0, text: "body", locator: {} },
    });
    const after = await a.client.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*) AS n FROM "DocumentChunk" WHERE "embedding" IS NULL AND "documentId" = $1`,
      d.id,
    );
    expect(Number(after[0]?.n ?? 0)).toBe(1); // …and a null embedding is fine
  });
});

describe("ReplyDraft additions", () => {
  it("carries sources (jsonb) and autoDelivered with their defaults", async () => {
    const a = await tmpDb();
    handles.push(a);
    const u = await user(a.client, "draft@example.com");
    const requester = await user(a.client, "req@example.com");
    const t = await a.client.ticket.create({
      data: {
        number: 2001,
        title: "T",
        description: "D",
        requesterId: requester.id,
      },
    });
    const draft = await a.client.replyDraft.create({
      data: { ticketId: t.id, body: "answer", agentName: "Servo Drafter" },
    });
    expect(draft.sources).toEqual([]);
    expect(draft.autoDelivered).toBe(false);
  });
});
