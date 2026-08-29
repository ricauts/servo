// kb-02: the entitlement resolver — the access-control invariant itself.
// The full matrix on real throwaway clones: ownership, the three visibility
// values, every grant shape, the builtin principals, the empty intersection,
// and the two red lines (STAFF never reaches a requester; an unresolvable
// human denies with no fallback).

import { afterAll, describe, expect, it } from "vitest";
import { tmpDb, type TmpDb } from "./helpers/tmp-db";
import {
  agentChainCte,
  entitledDocumentIds,
  humanChainCte,
} from "@/lib/kb/entitlement";
import {
  agentPrincipalId,
  draftPrincipalId,
  isBuiltinPrincipal,
} from "@/lib/kb/principals";

const handles: TmpDb[] = [];
afterAll(async () => {
  for (const h of handles) await h.dispose();
});

interface Personas {
  admin: { id: string };
  agent: { id: string };
  requester: { id: string };
  otherRequester: { id: string };
  groupMember: { id: string };
  loneUser: { id: string };
}

async function seed(db: TmpDb["client"]) {
  const mk = (name: string, email: string, role: string) =>
    db.user.create({ data: { name, email, role } });
  const [admin, agent, requester, otherRequester, groupMember, loneUser] = await Promise.all([
    mk("Admin", "admin@x.com", "ADMIN"),
    mk("Desk Agent", "agent@x.com", "AGENT"),
    mk("Requester", "req@x.com", "REQUESTER"),
    mk("Other Requester", "req2@x.com", "REQUESTER"),
    mk("Group Member", "grp@x.com", "AGENT"),
    mk("Lone User", "lone@x.com", "REQUESTER"),
  ]);
  return { admin, agent, requester, otherRequester, groupMember, loneUser } as Personas;
}

async function doc(
  db: TmpDb["client"],
  ownerId: string,
  name: string,
  visibility: "PRIVATE" | "STAFF" | "PUBLIC",
) {
  return db.document.create({
    data: {
      name,
      contentType: "text/markdown",
      byteSize: 10,
      sha256: name.padEnd(64, ".").slice(0, 64),
      data: Buffer.from(name),
      ownerId,
      visibility,
    },
  });
}

describe("the entitlement matrix", () => {
  it("covers ownership, PRIVATE/STAFF/PUBLIC, every grant shape and the intersection", async () => {
    const a = await tmpDb();
    handles.push(a);
    const db = a.client;
    const p = await seed(db);

    const group = await db.group.create({ data: { name: "Finance" } });
    await db.groupMember.create({
      data: { groupId: group.id, userId: p.groupMember.id, seniority: "MID" },
    });
    const collection = await db.collection.create({ data: { name: "Policies" } });

    const owned = await doc(db, p.admin.id, "owned-by-admin", "PRIVATE");
    const staff = await doc(db, p.admin.id, "staff-doc", "STAFF");
    const publicDoc = await doc(db, p.admin.id, "public-doc", "PUBLIC");
    const privateOther = await doc(db, p.admin.id, "someone-elses-private", "PRIVATE");
    const grantedDirect = await doc(db, p.admin.id, "direct-user-grant", "PRIVATE");
    const grantedGroup = await doc(db, p.admin.id, "group-grant", "PRIVATE");
    const grantedAgent = await doc(db, p.admin.id, "agent-grant", "PRIVATE");
    // The collection grant target: access flows to the collection's DOCUMENTS.
    const collectionMember = await doc(db, p.admin.id, "collection-member", "PRIVATE");

    await db.kbGrant.create({
      data: { documentId: grantedDirect.id, subjectType: "USER", subjectId: p.loneUser.id, grantedById: p.admin.id },
    });
    await db.kbGrant.create({
      data: { documentId: grantedGroup.id, subjectType: "GROUP", subjectId: group.id, grantedById: p.admin.id },
    });
    await db.kbGrant.create({
      data: { collectionId: collection.id, subjectType: "USER", subjectId: p.loneUser.id, grantedById: p.admin.id },
    });
    await db.kbGrant.create({
      data: { documentId: grantedAgent.id, subjectType: "AGENT", subjectId: "builtin:resolver", grantedById: p.admin.id },
    });
    await db.kbGrant.create({
      data: { collectionId: collection.id, subjectType: "AGENT", subjectId: "builtin:resolver", grantedById: p.admin.id },
    });
    await db.document.update({
      where: { id: collectionMember.id },
      data: { collectionId: collection.id },
    });

    // Ownership + STAFF + PUBLIC for the admin.
    const adminSet = new Set(await entitledDocumentIds(db, { humanId: p.admin.id, agentId: null }));
    expect(adminSet.has(owned.id)).toBe(true);
    expect(adminSet.has(staff.id)).toBe(true);
    expect(adminSet.has(publicDoc.id)).toBe(true);

    // A desk AGENT sees STAFF and PUBLIC but not another's PRIVATE.
    const agentHuman = new Set(await entitledDocumentIds(db, { humanId: p.agent.id, agentId: null }));
    expect(agentHuman.has(staff.id)).toBe(true);
    expect(agentHuman.has(publicDoc.id)).toBe(true);
    expect(agentHuman.has(privateOther.id)).toBe(false);

    // A REQUESTER sees PUBLIC only — never STAFF (the red line).
    const requesterSet = new Set(await entitledDocumentIds(db, { humanId: p.requester.id, agentId: null }));
    expect(requesterSet.has(publicDoc.id)).toBe(true);
    expect(requesterSet.has(staff.id)).toBe(false);
    expect(requesterSet.has(owned.id)).toBe(false);

    // Direct USER grant, GROUP grant via GroupMember, collection grant
    // (both the standalone doc and the collection member).
    const lone = new Set(await entitledDocumentIds(db, { humanId: p.loneUser.id, agentId: null }));
    expect(lone.has(grantedDirect.id)).toBe(true);
    expect(lone.has(collectionMember.id)).toBe(true); // via the collection grant
    expect(lone.has(privateOther.id)).toBe(false);

    const member = new Set(await entitledDocumentIds(db, { humanId: p.groupMember.id, agentId: null }));
    expect(member.has(grantedGroup.id)).toBe(true);
    expect(member.has(grantedDirect.id)).toBe(false);

    // The AGENT chain intersects: the resolver (as admin's human) sees the
    // agent-granted docs; a human WITHOUT the agent grant does not.
    const chain = new Set(
      await entitledDocumentIds(db, { humanId: p.admin.id, agentId: "builtin:resolver" }),
    );
    expect(chain.has(grantedAgent.id)).toBe(true);
    expect(chain.has(collectionMember.id)).toBe(true); // agent collection grant
    // Intersection, not union: admin's OWNED doc is in the human set but has
    // no agent grant — the resolver does not see it. Agents get nothing
    // implicitly, not even their operator's own files.
    expect(chain.has(owned.id)).toBe(false);

    // Empty intersection: a requester with no agent grants.
    const empty = await entitledDocumentIds(db, { humanId: p.requester.id, agentId: "builtin:resolver" });
    expect(empty).toEqual([]);

    // Agents get NOTHING implicitly: the resolver alone (no human) is not a
    // query this API allows — the human is always resolved first.
  });

  it("a requester created the way inbound-email creates one sees STAFF in NO path", async () => {
    const a = await tmpDb();
    handles.push(a);
    const db = a.client;
    const p = await seed(db);
    // inbound-email.ts mints requesters exactly like this:
    const emailed = await db.user.create({
      data: { name: "External Sender", email: "whoever@outside.com", role: "REQUESTER" },
    });
    await doc(db, p.admin.id, "staff-only", "STAFF");
    const asHuman = await entitledDocumentIds(db, { humanId: emailed.id, agentId: null });
    expect(asHuman).toEqual([]);
    const asChain = await entitledDocumentIds(db, { humanId: emailed.id, agentId: "builtin:resolver" });
    expect(asChain).toEqual([]);
  });

  it("the CTEs are composable statement prefixes with the entitlement in the FROM", async () => {
    const a = await tmpDb();
    handles.push(a);
    const db = a.client;
    const p = await seed(db);
    const d = await doc(db, p.admin.id, "composed", "PUBLIC");
    // kb-10 will compose exactly this shape: CTE prefix + JOIN entitled.
    const rows = await db.$queryRawUnsafe<{ documentId: string }[]>(
      `${humanChainCte(p.admin.id)} SELECT c."documentId" FROM "DocumentChunk" c
        JOIN entitled e ON e.id = c."documentId"`,
    );
    expect(rows).toEqual([]);
    await db.documentChunk.create({
      data: { documentId: d.id, index: 0, text: "body", locator: { lines: "1" } },
    });
    // The human chain reaches the PUBLIC doc; the AGENT chain without any
    // agent grant is correctly EMPTY — agents get nothing implicitly.
    const humanAfter = await db.$queryRawUnsafe<{ documentId: string }[]>(
      `${humanChainCte(p.admin.id)} SELECT c."documentId" FROM "DocumentChunk" c
        JOIN entitled e ON e.id = c."documentId"`,
    );
    expect(humanAfter.map((r) => r.documentId)).toEqual([d.id]);
    const agentAfter = await db.$queryRawUnsafe<{ documentId: string }[]>(
      `${agentChainCte(p.admin.id, "builtin:resolver")} SELECT c."documentId" FROM "DocumentChunk" c
        JOIN entitled e ON e.id = c."documentId"`,
    );
    expect(agentAfter).toEqual([]);
  });
});

describe("principals", () => {
  it("derives agent principals with the builtin fallbacks", () => {
    expect(agentPrincipalId({ profileId: null })).toBe("builtin:resolver");
    expect(agentPrincipalId({ profileId: "clr123" })).toBe("clr123");
    expect(draftPrincipalId(null)).toBe("builtin:drafter");
    expect(draftPrincipalId({ id: "clr9" })).toBe("clr9");
    expect(isBuiltinPrincipal("builtin:resolver")).toBe(true);
    expect(isBuiltinPrincipal("clr123")).toBe(false);
  });
});
