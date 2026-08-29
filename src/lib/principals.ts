// The ONLY place group membership is expanded into a principal set (spec
// rbac-01, §8.1). Grant subjects are three kinds — a user, a group, an agent
// profile — and the knowledge base resolves a human to "themselves plus
// their groups" through this helper and nothing else.
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
