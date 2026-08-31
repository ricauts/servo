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
-- `migration-guard` emits FIVE reason lines here — that DROP CONSTRAINT, the
-- `DROP POLICY kb_grant_floor` its replacement needs, the unique index on the
-- pre-existing "KbGrant", and an ADD CONSTRAINT foreign key on each of
-- "Document" and "KbGrant". Three more statements it does not flag are still
-- not additions: ENABLE and FORCE ROW LEVEL SECURITY on the new table, and
-- the re-ADDed `KbGrant_one_target` CHECK, which lands on a PRE-EXISTING
-- table (it is safe — sourceId is NULL on every existing row, so
-- num_nonnulls over three equals num_nonnulls over two, and every existing
-- row revalidates). Everything else IS additive: a CREATE, a nullable ADD
-- COLUMN, or a CHECK on the table this migration itself creates.
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
-- FORCE is here for the same reason it is on the kb tables: an owner bypasses
-- RLS unless the table also carries FORCE. Said honestly, because the
-- distinction matters and 0004_kb_rls leaves it implicit: the configuration
-- THIS REPO SHIPS connects as `servo`, the compose POSTGRES_USER, which is a
-- SUPERUSER — and a superuser bypasses RLS with or without FORCE, so on a
-- default install every one of these policies is inert and the application
-- filter is doing all the work. FORCE earns its place only on a deployment
-- whose application role is a non-superuser owner. On such a deployment note
-- that kb_source_floor's USING doubles as its WITH CHECK and nothing in src/
-- ever sets `app.human_id`, so DataSource writes would be refused outright —
-- the same condition 0004 already creates for "Document" and "KbGrant", and
-- one the owner should settle before any install runs as a non-superuser.
-- The probe in the tests owns its own NOBYPASSRLS role for exactly this
-- reason.

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
-- SHAPE FIRST, THEN THE TWO RULES. A scope entry is FLAT by construction:
-- an object whose values are scalars, or arrays of scalars. Nothing nests.
-- That is not tidiness, it is what makes the two rules below both CHEAP and
-- EXACT, and it is the fix for two defects a narrower spelling had:
--
--   * `$[*].where` alone is LOOSER THAN THE ROUTE — {"WHERE":"1=1"} (jsonpath
--     key matching is exact, so a different case is a different key) and
--     {"filter":{"where":"…"}} (one level of nesting) both committed while
--     src/lib/kb/sources.ts refused them. "A row written by a seed, a
--     migration or a direct write is as constrained as one written by the
--     route" is the whole point of putting the rule in the catalog.
--   * `$.**` with `.keyvalue()` closes that hole and opens a worse one:
--     keyvalue() over the recursive wildcard allocates superlinearly in
--     nesting depth. Measured on PG 16.13 — 8 s of backend CPU at 2,000
--     levels, and at 8,000 levels (48 KB of JSON, well inside any request
--     body) the backend is OOM-killed by signal 9, which takes the WHOLE
--     CLUSTER into crash recovery. A constraint that can be turned into a
--     denial of service by the row it is meant to refuse is worse than the
--     hole it closed.
--
-- Refusing nesting outright makes `$[*]` sufficient: no `$.**`, no recursion,
-- no unbounded cost. `like_regex "where" flag "i"` is CONTAINMENT, not an
-- anchored match with a whitespace class — deliberately, because POSIX
-- `[[:space:]]` and JavaScript's `\s` do not agree on NBSP, the zero-width
-- no-break space or the vertical tab, and six such spellings committed here
-- while the route refused them. Containment is trivially mirrorable.
--
-- The ONE asymmetry, stated rather than glossed: jsonpath's LAX mode unwraps
-- arrays, so a scalar buried in an array-inside-an-array is reached by the
-- filter as a scalar rather than surfacing as a nested array. The two rules
-- the criterion names still hold at every depth — a wildcard one and two
-- array levels down is caught by the string rule, and three or more levels
-- down surfaces as an array and is caught by the nesting rule, as is a
-- `where`-keyed object at any depth — but `{"suffixes": [[".pdf"]]}`, an
-- array of arrays of plain strings, carries neither a wildcard nor a
-- predicate and COMMITS here while src/lib/kb/sources.ts refuses it as a
-- shape error. That direction is the harmless one: the route is stricter, so
-- no route-written row can be one the catalog then rejects.
--
-- An EMPTY list is legal and reaches nothing — the safe default, not an error.
ALTER TABLE "DataSource" ADD CONSTRAINT "DataSource_scope_allowlist" CHECK (
  jsonb_typeof("scopeJson") = 'array'
  -- every entry is an object …
  AND NOT jsonb_path_exists("scopeJson", '$[*] ? (@.type() != "object")')
  -- … whose values are scalars or arrays of scalars, and nothing deeper
  AND NOT jsonb_path_exists("scopeJson", '$[*].* ? (@.type() == "object")')
  AND NOT jsonb_path_exists("scopeJson", '$[*].*[*] ? (@.type() == "object" || @.type() == "array")')
  -- no free-text predicate, in any spelling
  AND NOT jsonb_path_exists("scopeJson", '$[*].keyvalue().key ? (@ like_regex "where" flag "i")')
  -- no wildcard in any string, at either level
  AND NOT jsonb_path_exists("scopeJson", '$[*].* ? (@.type() == "string" && @ like_regex "[*]")')
  AND NOT jsonb_path_exists("scopeJson", '$[*].*[*] ? (@.type() == "string" && @ like_regex "[*]")')
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
