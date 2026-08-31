-- 0012_datasource — external data sources (spec xds-01), canonized in
-- docs/design/external-sources.md.
--
-- NUMBERING. The spec block names this migration `0010_datasource`. 0010 and
-- 0011 were both taken before this item was reached (`0010_origin`,
-- `0011_document_fact` — ext-01 took the same drift, disclosed in its own
-- changelog row), so this is 0012. Nothing else about the item moves.
--
-- WHY THIS ITEM IS TIER C — the line the item's own header names:
--
--     ALTER TABLE "KbGrant" DROP CONSTRAINT "KbGrant_one_target";
--
-- The exactly-one-target CHECK cannot be widened in place, so it is dropped
-- and recreated over three targets instead of two. `scripts/migration-guard.mjs`
-- rejects a DROP, correctly, and §0.6 tier 1 sends the diff to a PR.
--
-- Stated precisely, because "the one non-additive line" would be false:
-- `migration-guard` finds FOUR things here it will not wave through — that
-- DROP CONSTRAINT, the `DROP POLICY kb_grant_floor` that its replacement
-- needs, the unique index on the pre-existing "KbGrant", and the two
-- ADD CONSTRAINT foreign keys on pre-existing tables. Two more statements
-- (ENABLE / FORCE ROW LEVEL SECURITY on the new table) are neither a CREATE
-- nor an ADD COLUMN either. Everything else IS additive: a CREATE, a nullable
-- ADD COLUMN, or a CHECK on a table this migration creates.
--
-- THE TWO EXISTING PARTIAL INDEXES ARE UNTOUCHED. "KbGrant_doc_subject_key"
-- and "KbGrant_coll_subject_key" (0003_kb) are neither dropped nor rebuilt;
-- this migration only adds a THIRD of the same shape for the source target.
-- The spec spells that third index in lowercase (`kbgrant_source_subject`)
-- and it ships under exactly that name; the two older ones keep the CamelCase
-- Prisma gave them. Likewise the CHECK: the spec's `kbgrant_one_target` is the
-- shipped `"KbGrant_one_target"`, replaced under its own name so no
-- deployment ends up carrying both spellings.
--
-- THE RULES ARE IN THE CATALOG, NOT ONLY IN JAVASCRIPT. `mode`, `kind`,
-- `status` and the scope allowlist are CHECK constraints. A row written by a
-- seed, a migration, a psql session or a future route is exactly as
-- constrained as one written by src/lib/kb/sources.ts. FEDERATE is not a
-- value this database can hold.
--
-- RLS, STATED PLAINLY SO THE TWO ARE NOT CONFUSED. This migration puts
-- "DataSource" under ENABLE + FORCE ROW LEVEL SECURITY and amends kb-15's
-- KbGrant policy for the third target type. THE RLS FLOOR KNOWS NOTHING
-- ABOUT WHICH SOURCES A PRINCIPAL MAY READ, nothing about DataSource.status,
-- and nothing about GONE. It stays COARSER than the application filter,
-- exactly as 0004_kb_rls says: it is a catch for a forgotten WHERE, not a
-- restatement of the CTE. (The amended policy does NAME the sourceId column
-- — it has to, to say "exactly one of three targets" — and that is the only
-- thing it knows about it.) The SOURCE CEILING — "a source grant is required
-- on both legs, and DISABLED/PURGED darkens every document the source fed"
-- — lives only in src/lib/kb/entitlement.ts, and xds-02 is the item that
-- puts it there. Reading this file as if it enforced the ceiling is the
-- mistake the paragraph exists to prevent.
--
-- FORCE is not decorative here for the same reason it is not on the kb
-- tables: the application connects as the table OWNER, and an owner bypasses
-- RLS unless the table also carries FORCE. A superuser bypasses either way,
-- which is why the probe in the tests owns its own NOBYPASSRLS role.

-- CreateTable
CREATE TABLE "DataSource" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'INDEX',
    "configJson" JSONB NOT NULL DEFAULT '{}',
    "secretRef" TEXT NOT NULL,
    "scopeJson" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'DISABLED',
    "statusError" TEXT,
    "lastSyncAt" TIMESTAMP(3),
    "lastCompleteSyncAt" TIMESTAMP(3),
    "cursorJson" JSONB NOT NULL DEFAULT '{}',
    "syncEveryMin" INTEGER NOT NULL DEFAULT 0,
    "maxRows" INTEGER NOT NULL DEFAULT 20000,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DataSource_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DataSource_name_key" ON "DataSource"("name");

-- The vocabularies, in the catalog. INDEX is the only mode v1 ships and the
-- column exists so the roadmap is data rather than a migration; the
-- pre-committed rule FEDERATE must satisfy is in
-- docs/design/external-sources.md and nothing here anticipates it.
ALTER TABLE "DataSource" ADD CONSTRAINT "DataSource_mode_check"
  CHECK ("mode" = 'INDEX');
ALTER TABLE "DataSource" ADD CONSTRAINT "DataSource_kind_check"
  CHECK ("kind" IN ('S3', 'POSTGRES'));
ALTER TABLE "DataSource" ADD CONSTRAINT "DataSource_status_check"
  CHECK ("status" IN ('DISABLED', 'READY', 'SYNCING', 'ERROR', 'UNREACHABLE', 'PURGED'));

-- The scope allowlist is the whole security model of the connection, so it is
-- constrained by the database and not only by the route: a list of OBJECTS,
-- never a wildcard, and never a free-text predicate. An admin who needs a
-- WHERE clause names a view upstream. An EMPTY list is legal and reaches
-- nothing — that is the safe default, not an error.
--
-- The two refusals are deliberately written at ANY DEPTH and in ANY CASE,
-- rather than as `$[*].where` and `$[*].bucket`, because the narrow spelling
-- makes the CATALOG LOOSER THAN THE ROUTE — and "a row written by a seed, a
-- migration or a direct write is as constrained as one written by the route"
-- is the whole point of putting the rule here. Three payloads the narrow form
-- committed and src/lib/kb/sources.ts refused: {"WHERE": "1=1"} (jsonpath key
-- matching is exact, so a different case is a different key),
-- {"filter": {"where": "…"}} (one level of nesting), and
-- {"bucket": {"n": "*"}} (like_regex only fires on strings). `$.**` closes
-- all three, and src/lib/kb/sources.ts's walkScope() is the same two rules
-- written in TypeScript so neither side is the looser one.
ALTER TABLE "DataSource" ADD CONSTRAINT "DataSource_scope_allowlist" CHECK (
  jsonb_typeof("scopeJson") = 'array'
  AND NOT jsonb_path_exists("scopeJson", '$[*] ? (@.type() != "object")')
  AND NOT jsonb_path_exists(
        "scopeJson",
        '$.** ? (@.type() == "object").keyvalue().key ? (@ like_regex "^ *where *$" flag "i")')
  AND NOT jsonb_path_exists("scopeJson", '$.** ? (@.type() == "string" && @ like_regex "[*]")')
);

-- AlterTable — all four nullable, so every pre-existing Document row keeps
-- behaving exactly as it did: sourceId IS NULL is the uploaded-document case
-- and the source clause xds-02 adds passes it through untouched.
ALTER TABLE "Document" ADD COLUMN "sourceId" TEXT,
ADD COLUMN "externalLocator" JSONB,
ADD COLUMN "externalVersion" TEXT,
ADD COLUMN "externalSeenAt" TIMESTAMP(3);

-- CreateIndex — the FK column carries an index because every source-scoped
-- read (xds-02's clause, the deletion sweep, the source page's document
-- count) filters on it, and an unindexed FK on the largest table in the
-- schema is a defect rather than a saving.
CREATE INDEX "Document_sourceId_idx" ON "Document"("sourceId");

-- AlterTable
ALTER TABLE "KbGrant" ADD COLUMN "sourceId" TEXT;

-- AddForeignKey — RESTRICT: a source row cannot be deleted out from under
-- the documents it fed. Purge is the deliberate, human action; disable is
-- the reversible one.
ALTER TABLE "Document" ADD CONSTRAINT "Document_sourceId_fkey"
  FOREIGN KEY ("sourceId") REFERENCES "DataSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey — CASCADE, matching the other two grant targets: a grant is
-- meaningless once its target is gone.
ALTER TABLE "KbGrant" ADD CONSTRAINT "KbGrant_sourceId_fkey"
  FOREIGN KEY ("sourceId") REFERENCES "DataSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataSource" ADD CONSTRAINT "DataSource_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The THIRD partial unique index — same shape as the document and collection
-- ones, one grant per (source, subject).
CREATE UNIQUE INDEX "kbgrant_source_subject" ON "KbGrant"("sourceId", "subjectType", "subjectId")
  WHERE "sourceId" IS NOT NULL;

-- Exactly one target per row, now over three. THE DROP IS THE TIER-C LINE.
-- IF EXISTS because neither the CHECK nor the policy below is expressible in
-- prisma/schema.prisma: an install whose schema came from `prisma db push`
-- rather than from this migration history has neither object, and a bare DROP
-- would abort the whole migration on it.
ALTER TABLE "KbGrant" DROP CONSTRAINT IF EXISTS "KbGrant_one_target";
ALTER TABLE "KbGrant" ADD CONSTRAINT "KbGrant_one_target"
  CHECK (num_nonnulls("documentId", "collectionId", "sourceId") = 1);

-- RLS on the new table, matching 0004_kb_rls's shape. A DataSource row is
-- METADATA, not content, so the floor is the same one "KbGrant" carries: a
-- resolved human principal, nothing more. Deliberately coarser than
-- entitlement.ts, which is where the ceiling lives.
ALTER TABLE "DataSource" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DataSource" FORCE ROW LEVEL SECURITY;

CREATE POLICY kb_source_floor ON "DataSource"
  USING (current_setting('app.human_id', true) IS NOT NULL);

-- kb-15's grant policy, amended for the third target type. The principal gate
-- is unchanged and the floor gains the read-side twin of the widened CHECK:
-- exactly one of the THREE targets, sourceId now among them. A malformed row
-- — two targets, or none — is not readable through the floor even if some
-- future path manages to write one.
--
-- WHAT THIS DELIBERATELY DOES NOT DO, and why: it does not read "DataSource".
-- A policy that references another table imposes SELECT on that table upon
-- every role that reads THIS one — kb-15's own NOBYPASSRLS probe role proves
-- it, since it owns the four kb tables and is granted "User" only because
-- kb_document_floor reads "User". Adding a fifth table to that chain buys
-- nothing: which sources a principal may read is the SOURCE CEILING, it is
-- strictly finer than a floor, and it lives in src/lib/kb/entitlement.ts.
DROP POLICY IF EXISTS kb_grant_floor ON "KbGrant";
CREATE POLICY kb_grant_floor ON "KbGrant"
  USING (
    current_setting('app.human_id', true) IS NOT NULL
    AND num_nonnulls("documentId", "collectionId", "sourceId") = 1
  );
