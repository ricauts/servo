-- 0004_kb_rls — the Row-Level Security backstop (spec kb-15).
--
-- TWO TRAPS, stated in the migration header because each is silent:
--
-- 1. The app connects as the TABLE OWNER, and owners bypass RLS unless the
--    table also carries FORCE ROW LEVEL SECURITY. Without FORCE these
--    policies are decorative — this is the trap the test names.
-- 2. The policy is DELIBERATELY COARSER than the application filter in
--    src/lib/kb/entitlement.ts: it is a floor that catches a forgotten
--    WHERE, not a restatement of the CTE. The application-level ACL filter
--    that runs before anything reaches model context stays the primary gate.
--
-- Failure mode: CLOSED, loudly. If the SET LOCAL app.* settings are absent
-- (a query outside the transaction wrapper), current_setting(..., true)
-- returns NULL and the policies deny everything — zero rows, never all.

ALTER TABLE "Document" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Document" FORCE ROW LEVEL SECURITY;
ALTER TABLE "DocumentChunk" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DocumentChunk" FORCE ROW LEVEL SECURITY;
ALTER TABLE "KnowledgeEdge" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "KnowledgeEdge" FORCE ROW LEVEL SECURITY;
ALTER TABLE "KbGrant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "KbGrant" FORCE ROW LEVEL SECURITY;

-- The floor: a row is visible when a human principal is resolved AND it can
-- plausibly reach it — owner, PUBLIC, STAFF-with-staff-role, or directly
-- granted. The agent intersection is enforced by the application CTE; the
-- backstop only needs to stop the forgotten-WHERE case. Note the principal
-- gate wraps even the PUBLIC arm: an unset principal means ZERO rows, not
-- "everything public".
CREATE POLICY kb_document_floor ON "Document"
  USING (
    current_setting('app.human_id', true) IS NOT NULL
    AND (
      "ownerId" = current_setting('app.human_id', true)
      OR visibility = 'PUBLIC'
      OR (visibility = 'STAFF' AND EXISTS (
            SELECT 1 FROM "User" u
             WHERE u.id = current_setting('app.human_id', true)
               AND u.role IN ('ADMIN','AGENT')))
      OR EXISTS (
            SELECT 1 FROM "KbGrant" g
             WHERE (g."documentId" = "Document"."id"
                    OR g."collectionId" = "Document"."collectionId")
               AND g."subjectType" = 'USER'
               AND g."subjectId" = current_setting('app.human_id', true))
    )
  );

CREATE POLICY kb_chunk_floor ON "DocumentChunk"
  USING (EXISTS (
    SELECT 1 FROM "Document" d WHERE d.id = "DocumentChunk"."documentId"
  ));

CREATE POLICY kb_edge_floor ON "KnowledgeEdge"
  USING (
    EXISTS (SELECT 1 FROM "Document" d WHERE d.id = "KnowledgeEdge"."fromId")
    AND EXISTS (SELECT 1 FROM "Document" d WHERE d.id = "KnowledgeEdge"."toId")
  );

-- Grants are metadata, not content: the floor merely requires a resolved
-- human principal (referencing "Document" here would recurse — its policy
-- references "KbGrant" right back, and Postgres rejects infinite policy
-- recursion). The application CTE remains the real gate for grants.
CREATE POLICY kb_grant_floor ON "KbGrant"
  USING (current_setting('app.human_id', true) IS NOT NULL);
