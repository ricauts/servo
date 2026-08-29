// kb-15: the RLS backstop. Proofs on a real clone, run through a dedicated
// NON-SUPERUSER owner role — because the compose stack's POSTGRES_USER is a
// superuser and superusers bypass RLS even with FORCE (a finding this test
// exists to keep visible). Inside one Prisma interactive transaction (one
// pooled connection), so SET LOCAL shares the query's scope:
//   1. WITHOUT FORCE the owning role sees every row (the trap, named);
//      WITH it, the policy-only query returns only entitled rows.
//   2. Without the SET LOCAL principal the policy returns ZERO rows —
//      the failure mode is closed, never open.

import { afterAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { tmpDb, type TmpDb } from "./helpers/tmp-db";

const handles: TmpDb[] = [];
afterAll(async () => {
  for (const h of handles) await h.dispose();
});

let db: PrismaClient;
let admin: { id: string };
let requester: { id: string };

// Roles are CLUSTER-wide (they survive database drops), so each clone gets
// its own uniquely-named probe role.
let currentRole = "";
let probeSeq = 0;
const OWNER_ROLE = () => `kb_rls_probe_${process.pid}_${++probeSeq}`;

async function setup() {
  const a = await tmpDb();
  handles.push(a);
  db = a.client;
  admin = await db.user.create({ data: { name: "A", email: "a@x.com", role: "ADMIN" } });
  requester = await db.user.create({ data: { name: "R", email: "r@x.com", role: "REQUESTER" } });
  await db.document.create({
    data: { name: "mine.md", contentType: "text/markdown", byteSize: 1, sha256: "1".repeat(64), data: new Uint8Array(1), ownerId: admin.id, visibility: "PRIVATE" },
  });
  await db.document.create({
    data: { name: "public.md", contentType: "text/markdown", byteSize: 1, sha256: "2".repeat(64), data: new Uint8Array(1), ownerId: admin.id, visibility: "PUBLIC" },
  });
  const mineDoc = await db.document.findFirstOrThrow({ where: { name: "mine.md" } });
  await db.documentChunk.create({
    data: { documentId: mineDoc.id, index: 0, text: "secret body", locator: { lines: "1" } },
  });
  // The probe role: owns the KB tables, cannot bypass RLS. Superusers
  // (the compose POSTGRES_USER) bypass RLS unconditionally — which is why
  // the probe must be a separate, non-privileged role.
  const role = OWNER_ROLE();
  await db.$executeRawUnsafe(`CREATE ROLE ${role} NOLOGIN NOBYPASSRLS`);
  currentRole = role;
  for (const t of ["Document", "DocumentChunk", "KnowledgeEdge", "KbGrant"]) {
    await db.$executeRawUnsafe(`ALTER TABLE "${t}" OWNER TO ${role}`);
  }
  // The Document policy reads "User" (the STAFF path) — read access only.
  await db.$executeRawUnsafe(`GRANT SELECT ON "User" TO ${role}`);
}

/** Policy-only SELECT as the owner role, principal set inside the same tx. */

function rlsQuery(humanId: string | null): Promise<{ name: string }[]> {
  return db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL ROLE ${currentRole}`);
    if (humanId !== null) {
      await tx.$executeRawUnsafe(`SET LOCAL app.human_id = '${humanId}'`);
    }
    return tx.$queryRawUnsafe<{ name: string }[]>(`SELECT name FROM "Document"`);
  });
}

describe("the RLS backstop", () => {
  it("FORCE holds for the owning role — remove it and the trap fires (all rows)", async () => {
    await setup();

    // With FORCE (as the migration ships): only the requester's entitled row.
    const enforced = await rlsQuery(requester.id);
    expect(
      enforced.map((r) => r.name),
      "the owning role must NOT bypass RLS — the trap is FORCE ROW LEVEL SECURITY",
    ).toEqual(["public.md"]);

    // The trap, demonstrated: strip FORCE and the owner sees EVERYTHING.
    await db.$executeRawUnsafe(`ALTER TABLE "Document" NO FORCE ROW LEVEL SECURITY`);
    const bypassed = await rlsQuery(requester.id);
    expect(bypassed.map((r) => r.name).sort()).toEqual(["mine.md", "public.md"]);
  });

  it("without the SET LOCAL principal the policy returns ZERO rows — closed, not open", async () => {
    await setup();
    const rows = await rlsQuery(null); // no app.human_id at all
    expect(rows).toEqual([]);
  });

  it("the admin principal passes the floor (owner + STAFF paths)", async () => {
    await setup();
    const rows = await rlsQuery(admin.id);
    expect(rows.map((r) => r.name).sort()).toEqual(["mine.md", "public.md"]);
  });

  it("chunks follow their document through the floor", async () => {
    await setup();
    const visible = await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL ROLE ${currentRole}`);
      await tx.$executeRawUnsafe(`SET LOCAL app.human_id = '${requester.id}'`);
      return tx.$queryRawUnsafe<{ text: string }[]>(`SELECT c.text FROM "DocumentChunk" c`);
    });
    expect(visible).toEqual([]); // the chunk was created for the PRIVATE doc
    const none = await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL ROLE ${currentRole}`);
      return tx.$queryRawUnsafe<{ text: string }[]>(`SELECT c.text FROM "DocumentChunk" c`);
    });
    expect(none).toEqual([]); // no principal — closed
  });
});
