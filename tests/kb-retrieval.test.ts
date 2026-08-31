// kb-10: the retrieval pipeline and its red team. One statement, the CTE in
// the FROM, keyword-first ranking with optional vector re-rank, and the
// invariant: a non-entitled chunk's text appears in no result, with or
// without embeddings — the identical code path.

import { afterAll, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { tmpDb, type TmpDb } from "./helpers/tmp-db";

type ServoDb = { [key: string]: unknown };
const holder = vi.hoisted(() => ({ db: null as unknown as ServoDb }));
vi.mock("@/lib/db", () => ({ get db() { return holder.db; } }));

import { kbSearch } from "@/lib/kb/search";
import { mockEmbed, MOCK_EMBEDDER_MODEL } from "@/lib/kb/mock-embedder";
import { ingestDocument } from "@/lib/kb/ingest";

const handles: TmpDb[] = [];
afterAll(async () => {
  for (const h of handles) await h.dispose();
});

async function fresh() {
  if (handles.length > 1) await handles.shift()?.dispose();
  const a = await tmpDb();
  handles.push(a);
  const db = a.client;
  holder.db = db as unknown as ServoDb;
  return {
    db,
    admin: await db.user.create({ data: { name: "Admin", email: "a@x.com", role: "ADMIN" } }),
    requester: await db.user.create({ data: { name: "Req", email: "r@x.com", role: "REQUESTER" } }),
  };
}

async function embed(db: PrismaClient, documentId: string) {
  const chunks = await db.documentChunk.findMany({ where: { documentId }, select: { id: true, text: true } });
  for (const c of chunks) {
    const v = mockEmbed(c.text);
    await db.$executeRawUnsafe(
      `UPDATE "DocumentChunk" SET embedding = '[${v.join(",")}]'::vector, "embeddingModel" = '${MOCK_EMBEDDER_MODEL}', "embeddingDims" = 256 WHERE id = '${c.id}'`,
    );
  }
}

describe("kbSearch", () => {
  it("returns ranked entitled passages with citations; results come only from the intersection", async () => {
    const { db, admin, requester } = await fresh();
    // B is the overlap: readable by both the admin (owner) and the requester.
    const B = await ingestDocument({
      name: "overlap.md", contentType: "text/markdown", ownerId: admin.id, visibility: "PUBLIC",
      bytes: Buffer.from("# Overlap\n\nThe renewal window for pricing is March."),
    });
    const A = await ingestDocument({
      name: "private-a.md", contentType: "text/markdown", ownerId: admin.id,
      bytes: Buffer.from("# A\n\nPrivate renewal notes only admins should see: SECRET-ALEX-KEY."),
    });
    const C = await ingestDocument({
      name: "public-c.md", contentType: "text/markdown", ownerId: admin.id, visibility: "PUBLIC",
      bytes: Buffer.from("# C\n\nUnrelated onboarding checklist content."),
    });
    void A; void C;

    // Agent chain: human = requester (sees PUBLIC: B, C), agent granted A+B.
    await db.kbGrant.create({
      data: { documentId: A.documentId, subjectType: "AGENT", subjectId: "builtin:resolver", grantedById: admin.id },
    });
    await db.kbGrant.create({
      data: { documentId: B.documentId, subjectType: "AGENT", subjectId: "builtin:resolver", grantedById: admin.id },
    });
    await db.kbGrant.create({
      data: { documentId: C.documentId, subjectType: "AGENT", subjectId: "builtin:resolver", grantedById: admin.id },
    });

    const hits = await kbSearch(db, { humanId: requester.id, agentId: "builtin:resolver" }, "renewal pricing");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.documentId === B.documentId)).toBe(true); // only B
    expect(hits[0].docName).toBe("overlap.md");
    expect(hits[0].locator).toMatchObject({ lines: expect.anything() });
    expect(hits[0].kw).not.toBeNull();
  });

  it("RED TEAM: a non-entitled chunk's text appears in NO response — and the same holds with embeddings", async () => {
    const { db, admin, requester } = await fresh();
    const secret = await ingestDocument({
      name: "secret.md", contentType: "text/markdown", ownerId: admin.id,
      bytes: Buffer.from("# Secret\n\nCONFIDENTIAL-ZEBRA-PLAN renewal terms for internal eyes only."),
    });
    const open = await ingestDocument({
      name: "open.md", contentType: "text/markdown", ownerId: admin.id, visibility: "PUBLIC",
      bytes: Buffer.from("# Open\n\nrenewal terms are published here for everyone."),
    });
    await embed(db, secret.documentId);
    await embed(db, open.documentId);

    for (const withVectors of [false, true]) {
      const hits = await kbSearch(
        db,
        { humanId: requester.id, agentId: null },
        "renewal terms zebra",
        withVectors
          ? { queryVector: mockEmbed("renewal terms zebra"), embeddingModel: MOCK_EMBEDDER_MODEL }
          : {},
      );
      const blob = JSON.stringify(hits);
      expect(blob).not.toContain("CONFIDENTIAL-ZEBRA-PLAN");
      expect(blob).not.toContain("secret.md");
      expect(hits.every((h) => h.documentId === open.documentId || h.documentId !== secret.documentId)).toBe(true);
      if (withVectors) {
        expect(hits.some((h) => h.vec !== null)).toBe(true); // vector path live
      }
    }
  });

  it("an empty intersection returns no hits — never a degraded answer", async () => {
    const { db, admin, requester } = await fresh();
    await ingestDocument({
      name: "locked.md", contentType: "text/markdown", ownerId: admin.id,
      bytes: Buffer.from("# Locked\n\nrenewal pricing secrets"),
    });
    const hits = await kbSearch(db, { humanId: requester.id, agentId: "builtin:resolver" }, "renewal pricing");
    expect(hits).toEqual([]); // callers render "No accessible sources."
  });

  it("blends vector and keyword rank when embeddings exist; keyword-only is the same path", async () => {
    const { db, admin } = await fresh();
    const doc = await ingestDocument({
      name: "blend.md", contentType: "text/markdown", ownerId: admin.id,
      bytes: Buffer.from("# Blend\n\nrenewal pricing discount season"),
    });
    await embed(db, doc.documentId);
    const withVec = await kbSearch(
      db, { humanId: admin.id, agentId: null }, "renewal pricing discount",
      { queryVector: mockEmbed("renewal pricing discount season"), embeddingModel: MOCK_EMBEDDER_MODEL },
    );
    const keywordOnly = await kbSearch(db, { humanId: admin.id, agentId: null }, "renewal pricing discount");
    expect(withVec[0]?.vec).not.toBeNull();
    expect(keywordOnly[0]?.vec).toBeNull();
    expect(keywordOnly[0]?.text).toContain("discount season");
  });

  it("ext-06 changes nothing when no filters are passed: still ONE statement, no fact join", async () => {
    const { db, admin } = await fresh();
    await ingestDocument({
      name: "plain.md", contentType: "text/markdown", ownerId: admin.id,
      bytes: Buffer.from("# Plain\n\nrenewal pricing content"),
    });
    const calls: string[] = [];
    const client = {
      $queryRawUnsafe<T>(sql: string): Promise<T> {
        calls.push(sql);
        return db.$queryRawUnsafe<T>(sql);
      },
    };
    const hits = await kbSearch(client, { humanId: admin.id, agentId: null }, "renewal pricing");
    expect(hits.length).toBeGreaterThan(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]).not.toContain("DocumentFact");
  });

  it("excludes chunks whose embeddingModel differs from the current setting", async () => {
    const { db, admin } = await fresh();
    const doc = await ingestDocument({
      name: "mixed.md", contentType: "text/markdown", ownerId: admin.id,
      bytes: Buffer.from("# Mixed\n\nrenewal pricing content"),
    });
    await embed(db, doc.documentId);
    const stale = await kbSearch(
      db, { humanId: admin.id, agentId: null }, "renewal pricing",
      { queryVector: mockEmbed("renewal pricing"), embeddingModel: "text-embedding-3-small" },
    );
    expect(stale[0]?.vec).toBeNull(); // model mismatch ⇒ no vector score
    expect(stale[0]?.kw).not.toBeNull(); // still competes on keyword rank
  });
});
