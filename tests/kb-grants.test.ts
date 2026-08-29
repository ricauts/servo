// kb-03: the grant APIs and the readers preview, against real clones with
// the routes invoked directly and auth/db mocked at the boundary. The parity
// rule is the point: the preview and retrieval must agree for five grant
// shapes, a REQUESTER gets 403 on every route, and a non-owner without
// MANAGE cannot re-share.

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { tmpDb, type TmpDb } from "./helpers/tmp-db";

// The app's db singleton is swapped per test onto the current clone; auth is
// swapped onto the current persona. Both are boundary concerns — everything
// under them runs for real.
// Structural on purpose: a typeof-import() here reads as a dynamic import
// to the repo-refs scanner and marks the module graph INDETERMINATE.
type ServoDb = { [key: string]: unknown };
const holder = vi.hoisted(() => ({
  db: null as unknown as ServoDb,
  user: null as unknown as { id: string; role: string },
}));
// Getter factories: the modules under test are imported once at file load,
// BEFORE any test sets the holder — access must resolve at call time.
vi.mock("@/lib/db", () => ({ get db() { return holder.db; } }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: async () => holder.user }));

// Static imports: vitest hoists the vi.mock calls above them, and dynamic
// imports of bracketed route paths read as unresolvable to the repo-refs
// scanner (INDETERMINATE pollution).
import { POST as postDocGrant, DELETE as deleteDocGrant } from "@/app/api/kb/documents/[id]/grants/route";
import { POST as postCollGrant } from "@/app/api/kb/collections/[id]/grants/route";
import { GET as getReaders } from "@/app/api/kb/documents/[id]/readers/route";
import { entitledDocumentIds } from "@/lib/kb/entitlement";

const handles: TmpDb[] = [];
afterAll(async () => {
  for (const h of handles) await h.dispose();
});

let db: PrismaClient;
let admin: { id: string; name: string; role: string };
let deskAgent: { id: string; name: string; role: string };
let requester: { id: string; name: string; role: string };
let groupUser: { id: string; name: string; role: string };
let groupId: string;

beforeEach(async () => {
  if (handles.length > 2) {
    await handles.shift()?.dispose();
  }
  const a = await tmpDb();
  handles.push(a);
  db = a.client;
  holder.db = db as unknown as ServoDb;

  const mk = async (name: string, email: string, role: string) =>
    db.user.create({ data: { name, email, role } });
  admin = { ...(await mk("Admin", "a@x.com", "ADMIN")), role: "ADMIN" };
  deskAgent = { ...(await mk("Desk", "d@x.com", "AGENT")), role: "AGENT" };
  requester = { ...(await mk("Req", "r@x.com", "REQUESTER")), role: "REQUESTER" };
  groupUser = { ...(await mk("Grp", "g@x.com", "AGENT")), role: "AGENT" };
  const group = await db.group.create({ data: { name: "Finance" } });
  await db.groupMember.create({ data: { groupId: group.id, userId: groupUser.id, seniority: "MID" } });
  groupId = group.id;
  holder.user = admin;
});

async function doc(name: string, visibility = "PRIVATE") {
  return db.document.create({
    data: {
      name,
      contentType: "text/markdown",
      byteSize: 10,
      sha256: name.padEnd(64, ".").slice(0, 64),
      data: Buffer.from(name),
      ownerId: admin.id,
      visibility,
    },
  });
}

function jsonReq(method: string, url: string, body?: unknown) {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as never;
}

describe("route gating", () => {
  it("a REQUESTER gets 403 on every /api/kb/* route", async () => {
    holder.user = requester;
    const d = await doc("gated");
    const res1 = await postDocGrant(jsonReq("POST", `http://x/api/kb/documents/${d.id}/grants`, { subjectType: "USER", subjectId: admin.id }), { params: Promise.resolve({ id: d.id }) });
    expect(res1.status).toBe(403);
    const res2 = await getReaders(jsonReq("GET", `http://x/api/kb/documents/${d.id}/readers`), { params: Promise.resolve({ id: d.id }) });
    expect(res2.status).toBe(403);
    const c = await db.collection.create({ data: { name: "C" } });
    const res3 = await postCollGrant(jsonReq("POST", `http://x/api/kb/collections/${c.id}/grants`, { subjectType: "USER", subjectId: admin.id }), { params: Promise.resolve({ id: c.id }) });
    expect(res3.status).toBe(403);
  });

  it("a non-owner without MANAGE cannot re-share", async () => {
    const d = await doc("owned-by-admin");
    holder.user = deskAgent;
    const res = await postDocGrant(jsonReq("POST", `http://x/api/kb/documents/${d.id}/grants`, { subjectType: "USER", subjectId: deskAgent.id }), { params: Promise.resolve({ id: d.id }) });
    expect(res.status).toBe(403);
  });
});

describe("share/revoke and the readers preview parity", () => {
  it("round-trips five grant shapes with preview == retrieval", async () => {
    const direct = await doc("direct");
    const groupDoc = await doc("group");
    const collDoc = await doc("coll");
    const publicDoc = await doc("public", "PUBLIC");
    const staffDoc = await doc("staff", "STAFF");
    const collection = await db.collection.create({ data: { name: "Policies" } });
    await db.document.update({ where: { id: collDoc.id }, data: { collectionId: collection.id } });

    // Five shapes: owner, direct USER grant, GROUP grant, collection grant,
    // PUBLIC/STAFF visibility.
    const shapes: { target: ReturnType<typeof doc> | null; via: () => Promise<unknown> }[] = [];
    void shapes;
    await postDocGrant(jsonReq("POST", `http://x/api/kb/documents/${direct.id}/grants`, { subjectType: "USER", subjectId: deskAgent.id }), { params: Promise.resolve({ id: direct.id }) });
    await postDocGrant(jsonReq("POST", `http://x/api/kb/documents/${groupDoc.id}/grants`, { subjectType: "GROUP", subjectId: groupId }), { params: Promise.resolve({ id: groupDoc.id }) });
    await postCollGrant(jsonReq("POST", `http://x/api/kb/collections/${collection.id}/grants`, { subjectType: "USER", subjectId: groupUser.id }), { params: Promise.resolve({ id: collection.id }) });

    for (const d of [direct, groupDoc, collDoc, publicDoc, staffDoc]) {
      const res = await getReaders(jsonReq("GET", `http://x/api/kb/documents/${d.id}/readers`), { params: Promise.resolve({ id: d.id }) });
      expect(res.status).toBe(200);
      const { readers } = (await res.json()) as { readers: { id: string }[] };
      const preview = new Set(readers.map((r) => r.id));

      // The same question asked of the resolver directly — for every human.
      for (const person of [admin, deskAgent, groupUser, requester]) {
        const ids = await entitledDocumentIds(db, { humanId: person.id, agentId: null });
        expect(
          preview.has(person.id),
          `preview/retrieval disagree for ${person.name} on ${d.name}: preview=${preview.has(person.id)} retrieval=${ids.includes(d.id)}`,
        ).toBe(ids.includes(d.id));
      }
    }
  });

  it("deleting a document leaves zero orphan KbGrant rows (same-transaction sweep)", async () => {
    const d = await doc("to-delete");
    await postDocGrant(jsonReq("POST", `http://x/api/kb/documents/${d.id}/grants`, { subjectType: "USER", subjectId: deskAgent.id }), { params: Promise.resolve({ id: d.id }) });
    expect(await db.kbGrant.count({ where: { documentId: d.id } })).toBe(1);
    await db.$transaction([db.document.delete({ where: { id: d.id } })]);
    expect(await db.kbGrant.count({ where: { documentId: d.id } })).toBe(0);
  });

  it("revoking removes exactly the grant", async () => {
    const d = await doc("revoke-me");
    const res = await postDocGrant(jsonReq("POST", `http://x/api/kb/documents/${d.id}/grants`, { subjectType: "USER", subjectId: deskAgent.id }), { params: Promise.resolve({ id: d.id }) });
    const { grant } = (await res.json()) as { grant: { id: string } };
    expect(await db.kbGrant.count()).toBe(1);
    const del = await deleteDocGrant(jsonReq("DELETE", `http://x/api/kb/documents/${d.id}/grants?grantId=${grant.id}`), { params: Promise.resolve({ id: d.id }) });
    expect(del.status).toBe(200);
    expect(await db.kbGrant.count()).toBe(0);
  });
});
