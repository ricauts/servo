// The ONE definition of "may this principal read this document" (spec §5,
// kb-02). Every KB read path composes this fragment: search, read_document,
// list_collections, related files, the effective-readers preview and
// send-time re-verification. Adding a read path that does not use it is a
// review failure — the invariant is STRUCTURAL, so it lives as a CTE joined
// in the same statement, never as an id list that crosses the wire.
//
// Two chains, and only two (spec §5 "Principal chains"):
//   agent chain   — every tool call and the drafter: human ∩ agent. The human
//                   is the ticket requester; if they cannot be resolved, the
//                   call is DENIED — there is no fallback and no code path
//                   that invents one.
//   human chain   — a person browsing the Knowledge area: the human alone.

/** Structural: accepts both the raw client and the $extends-wrapped one. */
export interface RawQueryClient {
  $queryRawUnsafe<T>(query: string): Promise<T>;
}

/**
 * The entitlement CTE for the AGENT chain: effective = human ∩ agent.
 * `$1` is the human principal, `$2` the agent principal. Compose it as the
 * prefix of a statement whose FROM clause joins `entitled`.
 */
export function agentChainCte(humanId: string, agentId: string): string {
  return entitledCteSql("$1", "$2", humanId, agentId, true);
}

/**
 * The entitlement CTE for the HUMAN chain: the human's own set, no
 * intersection — the shape a browsing person or the readers preview uses.
 */
export function humanChainCte(humanId: string): string {
  return entitledCteSql("$1", null, humanId, null, false);
}

function entitledCteSql(
  _humanParam: string,
  _agentParam: string | null,
  humanId: string,
  agentId: string | null,
  intersect: boolean,
): string {
  // Parameters are interpolated as safe literals (they are cuids / builtin:
  // principals resolved server-side, never caller text), keeping the CTE a
  // plain composable string for kb-10's search statement.
  const lit = (v: string) => `'${v.replace(/'/g, "''")}'`;
  return `WITH human_docs AS (
    SELECT d.id FROM "Document" d WHERE d."ownerId" = ${lit(humanId)}
    UNION
    SELECT d.id FROM "Document" d JOIN "User" u ON u.id = ${lit(humanId)}
     WHERE d.visibility = 'PUBLIC' OR (d.visibility = 'STAFF' AND u.role IN ('ADMIN','AGENT'))
    UNION
    SELECT COALESCE(g."documentId", d.id) AS id FROM "KbGrant" g
      LEFT JOIN "Document" d ON d."collectionId" = g."collectionId"
     WHERE (g."subjectType" = 'USER' AND g."subjectId" = ${lit(humanId)})
        OR (g."subjectType" = 'GROUP' AND g."subjectId" IN
              (SELECT "groupId" FROM "GroupMember" WHERE "userId" = ${lit(humanId)}))
  )
${
  intersect && agentId
    ? `, agent_docs AS (
    SELECT COALESCE(g."documentId", d.id) AS id FROM "KbGrant" g
      LEFT JOIN "Document" d ON d."collectionId" = g."collectionId"
     WHERE g."subjectType" = 'AGENT' AND g."subjectId" = ${lit(agentId)}
  ), entitled AS (
    SELECT id FROM human_docs
    INTERSECT
    SELECT id FROM agent_docs
  )`
    : `, entitled AS (
    SELECT id FROM human_docs
  )`
}`;
}

/** The resolved principal pair every KB read needs. */
export interface EntitlementChain {
  /** The ticket requester (agent chain) or the browsing person (human chain). */
  humanId: string;
  /** The agent principal; null on the human chain. */
  agentId: string | null;
}

/**
 * Resolve the ids a chain may read — also the readers-preview primitive.
 * Composes the CTE and selects from `entitled` in ONE statement.
 */
export async function entitledDocumentIds(
  db: RawQueryClient,
  chain: EntitlementChain,
): Promise<string[]> {
  const cte =
    chain.agentId !== null
      ? agentChainCte(chain.humanId, chain.agentId)
      : humanChainCte(chain.humanId);
  const rows = await db.$queryRawUnsafe<{ id: string }[]>(`${cte} SELECT id FROM entitled`);
  return rows.map((r) => r.id);
}
