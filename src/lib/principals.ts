// The ONE TypeScript place group membership is expanded into a principal
// set (spec rbac-01, §8.1). Grant subjects are three kinds — a user, a
// group, an agent profile — and TS-side code resolves a human to
// "themselves plus their groups" through this helper and nowhere else.
//
// The entitlement CTE (src/lib/kb/entitlement.ts) carries the SAME
// expansion in SQL — it must, because the KB's invariant is that filtering
// happens inside the statement — so the two are twins, not alternatives:
// this helper is the TS twin, that subquery the SQL twin, and neither may
// grow a rule the other lacks (kb-17's readers-preview test proves they
// agree by resolving previews through the CTE itself).
//
// The Role union does not change in v1 and permissions.ts stays FLAT BY
// DESIGN: no hierarchy, no parent walking, no normalizeRole.

import type { User } from "@prisma/client";
import { db } from "@/lib/db";

/** A human's KB principal set: their own id plus each group they belong to. */
export async function principalsForUser(
  user: Pick<User, "id">,
): Promise<string[]> {
  const memberships = await db.groupMember.findMany({
    where: { userId: user.id },
    select: { groupId: true },
  });
  return [user.id, ...memberships.map((m) => m.groupId)];
}
