// The only place an agent principal is derived (spec §5, kb-02).
//
// `AgentRun.profileId` is nullable — null for TRIAGE and default resolver
// runs — so a profile-less run maps to the named builtin principal
// "builtin:resolver". The `builtin:` prefix can never collide with a cuid(),
// and both builtin principals appear as named rows in every share panel.
//
// Agents get NOTHING implicitly: no ownership, no STAFF, no PUBLIC. An agent
// reads only what a subjectType:AGENT grant gives it — a fresh KB is dark to
// automation by design, and the Knowledge UI says so.

import type { AgentProfile, AgentRun } from "@prisma/client";

export const BUILTIN_RESOLVER = "builtin:resolver";
export const BUILTIN_DRAFTER = "builtin:drafter";

/** The agent principal of a resolver run. */
export function agentPrincipalId(run: Pick<AgentRun, "profileId">): string {
  return run.profileId ?? BUILTIN_RESOLVER;
}

/** The agent principal of the reply drafter (profile-picked, usually none). */
export function draftPrincipalId(prof: Pick<AgentProfile, "id"> | null): string {
  return prof?.id ?? BUILTIN_DRAFTER;
}

export function isBuiltinPrincipal(id: string): boolean {
  return id.startsWith("builtin:");
}
