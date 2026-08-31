-- 0007_catalog (cat-01, canonized in docs/design/data-fabric.md).
--
-- THE TWO CHECKs ARE THE ONLY THINGS PREVENTING A CATALOG CARD FROM BEING
-- WIDENED OR DOWNLOADED. A card is rendered from CatalogEntry.profile; its
-- rows are entitlement-derived in the SAME statement (no mirror, nothing to
-- forget), which only holds while the card itself cannot carry grants-
-- semantics of its own:
--   CHECK kind <> 'CATALOG' OR visibility = 'PRIVATE' — a card widened to
--     STAFF/PUBLIC would escape the datasource-derived entitlement entirely.
--   CHECK kind <> 'CATALOG' OR data IS NULL — the canonical profile JSON
--     lives in CatalogEntry.profile and every redaction decision made in the
--     renderer would be bypassed by one download of Document.data.
--
-- The two views are the DATASOURCE CONTRACT's fixture implementation (see
-- src/lib/catalog/datasource-contract.ts): empty by construction, so every
-- catalog card is dark until the connection-layer merge swaps them for the
-- real views — fail-closed by default, in one migration, changing nothing
-- else.

CREATE TABLE "CatalogEntry" (
    "id" TEXT NOT NULL,
    "dataSourceId" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "parentId" TEXT,
    "fqn" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "locator" JSONB NOT NULL DEFAULT '{}',
    "physicalType" TEXT NOT NULL DEFAULT '',
    "semanticType" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "semanticScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sensitivity" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "profile" JSONB NOT NULL DEFAULT '{}',
    "exemplars" JSONB NOT NULL DEFAULT '[]',
    "signature" JSONB NOT NULL DEFAULT '{}',
    "provenance" JSONB NOT NULL DEFAULT '{}',
    "fingerprint" TEXT NOT NULL DEFAULT '',
    "valuesStatus" TEXT NOT NULL DEFAULT 'ABSENT',
    "note" TEXT NOT NULL DEFAULT '',
    "noteById" TEXT,
    "inferredPurpose" TEXT NOT NULL DEFAULT '',
    "inferredBy" TEXT NOT NULL DEFAULT '',
    "profileStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "profileError" TEXT,
    "documentId" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "droppedAt" TIMESTAMP(3),

    CONSTRAINT "CatalogEntry_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CatalogEntry_dataSourceId_fqn_key" ON "CatalogEntry"("dataSourceId", "fqn");
CREATE INDEX "CatalogEntry_dataSourceId_level_idx" ON "CatalogEntry"("dataSourceId", "level");
CREATE INDEX "CatalogEntry_parentId_idx" ON "CatalogEntry"("parentId");
CREATE INDEX "CatalogEntry_documentId_idx" ON "CatalogEntry"("documentId");

CREATE TABLE "CatalogRun" (
    "id" TEXT NOT NULL,
    "dataSourceId" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "cursor" JSONB NOT NULL DEFAULT '{}',
    "stats" JSONB NOT NULL DEFAULT '{}',
    "budgetHit" TEXT,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "CatalogRun_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CatalogRun_dataSourceId_startedAt_idx" ON "CatalogRun"("dataSourceId", "startedAt");

ALTER TABLE "Document" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'FILE';
ALTER TABLE "Document" ADD COLUMN "catalogEntryId" TEXT;
CREATE UNIQUE INDEX "Document_catalogEntryId_key" ON "Document"("catalogEntryId");
ALTER TABLE "AgentRun" ADD COLUMN "retrieval" JSONB NOT NULL DEFAULT '{}';
-- The CHECK below requires catalog rows to carry NULL data, which the
-- column's NOT NULL forbids; dropping NOT NULL is a pure LOOSENING — every
-- row that existed remains valid, and the column keeps its meaning for
-- every FILE document.
ALTER TABLE "Document" ALTER COLUMN "data" DROP NOT NULL;
ALTER TABLE "Document"
  ADD CONSTRAINT "document_catalog_private_ck" CHECK ("kind" <> 'CATALOG' OR "visibility" = 'PRIVATE');
ALTER TABLE "Document"
  ADD CONSTRAINT "document_catalog_data_null_ck" CHECK ("kind" <> 'CATALOG' OR "data" IS NULL);

-- The fixture halves of the one coupling point. Empty: a view over nothing.
CREATE VIEW datasource_readable_by_human AS
  SELECT ''::text AS "dataSourceId", ''::text AS "userId" WHERE false;
CREATE VIEW datasource_readable_by_agent AS
  SELECT ''::text AS "dataSourceId", ''::text AS "agentId" WHERE false;

-- kb-15's RLS set grows from four tables to six. Same traps, same shape:
-- the policy derives from the PARENT DOCUMENT's floor, and a query outside
-- the SET LOCAL wrapper sees zero rows, never all.
ALTER TABLE "CatalogEntry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CatalogEntry" FORCE ROW LEVEL SECURITY;
ALTER TABLE "CatalogRun" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CatalogRun" FORCE ROW LEVEL SECURITY;

CREATE POLICY catalog_entry_floor ON "CatalogEntry"
  USING (
    EXISTS (
      SELECT 1 FROM "Document" d
       WHERE d.id = "CatalogEntry"."documentId"
         AND (
           d."ownerId" = current_setting('app.human_id', true)
           OR d.visibility = 'PUBLIC'
           OR (d.visibility = 'STAFF' AND EXISTS (
                 SELECT 1 FROM "User" u
                  WHERE u.id = current_setting('app.human_id', true)
                    AND u.role IN ('ADMIN','AGENT')))
           OR EXISTS (
                 SELECT 1 FROM "KbGrant" g
                  WHERE (g."documentId" = d.id OR g."collectionId" = d."collectionId")
                    AND g."subjectType" = 'USER'
                    AND g."subjectId" = current_setting('app.human_id', true))
         )
    )
  );

CREATE POLICY catalog_run_floor ON "CatalogRun"
  USING (
    current_setting('app.human_id', true) IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM "CatalogEntry" ce
       JOIN "Document" d ON d.id = ce."documentId"
      WHERE ce."dataSourceId" = "CatalogRun"."dataSourceId"
        AND (
          d."ownerId" = current_setting('app.human_id', true)
          OR d.visibility = 'PUBLIC'
          OR (d.visibility = 'STAFF' AND EXISTS (
                SELECT 1 FROM "User" u
                 WHERE u.id = current_setting('app.human_id', true)
                   AND u.role IN ('ADMIN','AGENT')))
          OR EXISTS (
                SELECT 1 FROM "KbGrant" g
                 WHERE (g."documentId" = d.id OR g."collectionId" = d."collectionId")
                   AND g."subjectType" = 'USER'
                   AND g."subjectId" = current_setting('app.human_id', true))
        )
    )
  );
