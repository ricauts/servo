// ext-01: the DocumentFact schema, its migration, and the RLS backstop's
// parity with kb-15. All on a tmpDb(); the RLS cases use the same
// non-privileged owner-role probe as tests/kb-rls.test.ts — the compose
// superuser bypasses RLS unconditionally, so the probe must be its own
// NOBYPASSRLS role.

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { tmpDb, type TmpDb } from "./helpers/tmp-db";

type ServoDb = { [key: string]: unknown };
const holder = vi.hoisted(() => ({ db: null as unknown as ServoDb }));
vi.mock("@/lib/db", () => ({ get db() { return holder.db; } }));

const handles: TmpDb[] = [];
afterAll(async () => {
  for (const h of handles) await h.dispose();
});

let db: PrismaClient;
let admin: { id: string };
let requester: { id: string };
let currentRole = "";

beforeEach(async () => {
  if (handles.length > 1) await handles.shift()?.dispose();
  const handle = await tmpDb();
  handles.push(handle);
  db = handle.client;
  holder.db = db as unknown as ServoDb;
  admin = await db.user.create({ data: { name: "A", email: `a${Date.now()}@x.com`, role: "ADMIN" } });
  requester = await db.user.create({ data: { name: "R", email: `r${Date.now()}@x.com`, role: "REQUESTER" } });
});

async function makeDocFacts(visibility: "PRIVATE" | "PUBLIC") {
  const doc = await db.document.create({
    data: { name: `${visibility.toLowerCase()}.md`, contentType: "text/markdown", byteSize: 1, sha256: "1".repeat(64), data: new Uint8Array(1), ownerId: admin.id, visibility },
  });
  const chunk = await db.documentChunk.create({
    data: { documentId: doc.id, index: 0, text: "Invoice INV-2024-113 for 1200 USD.", locator: { lines: "1" } },
  });
  await db.documentFact.create({
    data: { documentId: doc.id, chunkId: chunk.id, kind: "IDENTIFIER", norm: "inv2024113", unit: "", text: "INV-2024-113", offset: 8, length: 12, extractor: "facts@1" },
  });
  return { doc, chunk };
}

/** Policy-only SELECT as the owning role — the kb-15 probe pattern. */
function factQuery(humanId: string | null): Promise<{ norm: string }[]> {
  return db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL ROLE ${currentRole}`);
    if (humanId !== null) {
      await tx.$executeRawUnsafe(`SET LOCAL app.human_id = '${humanId}'`);
    }
    return tx.$queryRawUnsafe<{ norm: string }[]>(`SELECT norm FROM "DocumentFact"`);
  });
}

describe("the schema and its migration", () => {
  it("the columns exist as canonized: Decimal(38,6) num, defaults, string unions", async () => {
    const { doc, chunk } = await makeDocFacts("PUBLIC");
    const fact = await db.documentFact.create({
      data: { documentId: doc.id, chunkId: chunk.id, kind: "MONEY", norm: "USD:120000", num: 120000, unit: "USD", text: "1200 USD", offset: 26, length: 8, extractor: "facts@1" },
      select: { confidence: true, createdAt: true, num: true },
    });
    expect(fact.confidence).toBe("EXACT");
    expect(fact.createdAt).not.toBeNull();
    expect(Number(fact.num)).toBe(120000);
    const cols = await db.$queryRawUnsafe<{ column_name: string; data_type: string; numeric_precision: number; numeric_scale: number }[]>(
      `SELECT column_name, data_type, numeric_precision, numeric_scale FROM information_schema.columns WHERE table_name = 'DocumentFact' AND column_name = 'num'`,
    );
    expect(cols[0]).toMatchObject({ data_type: "numeric", numeric_precision: 38, numeric_scale: 6 });
  });

  it("two facts at the same (chunkId, offset, kind) raise a unique violation", async () => {
    const { doc, chunk } = await makeDocFacts("PUBLIC");
    await expect(
      db.documentFact.create({
        data: { documentId: doc.id, chunkId: chunk.id, kind: "IDENTIFIER", norm: "different", unit: "", text: "dup", offset: 8, length: 3, extractor: "facts@1" },
      }),
    ).rejects.toThrow(/Unique constraint|duplicate key/i);
  });

  it("deleting a chunk cascades its facts; deleting a document cascades both", async () => {
    const { doc, chunk } = await makeDocFacts("PUBLIC");
    expect(await db.documentFact.count({ where: { chunkId: chunk.id } })).toBe(1);
    await db.documentChunk.delete({ where: { id: chunk.id } });
    expect(await db.documentFact.count({ where: { documentId: doc.id } })).toBe(0);
    expect(await db.document.count({ where: { id: doc.id } })).toBe(1); // the doc survives chunk deletion

    const second = await makeDocFacts("PUBLIC");
    await db.document.delete({ where: { id: second.doc.id } });
    expect(await db.documentFact.count({ where: { documentId: second.doc.id } })).toBe(0);
    expect(await db.documentChunk.count({ where: { documentId: second.doc.id } })).toBe(0);
  });
});

describe("RLS parity with kb-15", () => {
  beforeEach(async () => {
    await makeDocFacts("PUBLIC");
    await makeDocFacts("PRIVATE");
    const role = `fact_probe_${Date.now().toString(36)}`;
    await db.$executeRawUnsafe(`CREATE ROLE ${role} NOLOGIN NOBYPASSRLS`);
    currentRole = role;
    for (const t of ["Document", "DocumentChunk", "DocumentFact", "KnowledgeEdge", "KbGrant"]) {
      await db.$executeRawUnsafe(`ALTER TABLE "${t}" OWNER TO ${role}`);
    }
    await db.$executeRawUnsafe(`GRANT SELECT ON "User" TO ${role}`);
  });

  it("a policy-only query returns only facts of entitled documents", async () => {
    const rows = await factQuery(requester.id);
    expect(rows.map((r) => r.norm)).toEqual(["inv2024113"]); // the PUBLIC doc's fact only
  });

  it("a query run OUTSIDE the transaction wrapper returns ZERO rows", async () => {
    const rows = await factQuery(null);
    expect(rows).toEqual([]);
  });

  it("FORCE holds for the owning role — remove it and the trap fires (all rows)", async () => {
    const enforced = await factQuery(requester.id);
    expect(enforced).toHaveLength(1);
    // The trap, demonstrated with the message naming it.
    await db.$executeRawUnsafe(`ALTER TABLE "DocumentFact" NO FORCE ROW LEVEL SECURITY`);
    const bypassed = await factQuery(requester.id);
    expect(
      bypassed.length,
      "the owning role must NOT bypass RLS on DocumentFact — the trap is FORCE ROW LEVEL SECURITY",
    ).toBe(2);
  });

  it("the admin principal passes the floor", async () => {
    const rows = await factQuery(admin.id);
    expect(rows).toHaveLength(2);
  });
});
