-- 0012_datasource — the connection layer's schema (spec xds-01).
--
-- TIER C. TWO statements here are not additive, and both are DROPs on a
-- security surface:
--
--   1. DROP CONSTRAINT "KbGrant_one_target", re-added widened to three target
--      columns. "Exactly one target per grant row" is precisely the kind of
--      constraint that must not be relaxed by a machine on its own.
--   2. DROP POLICY kb_grant_floor, re-created (see the RLS section at the
--      foot of this file).
--
-- scripts/migration-guard.mjs reports FIVE reasons, and this is the exact
-- list, because a header a reviewer reads to approve a Tier-C change to a
-- security surface has to be checkable against the tool:
--
--   ADD CONSTRAINT on pre-existing table "document"  (Document_sourceId_fkey)
--   ADD CONSTRAINT on pre-existing table "kbgrant"   (KbGrant_sourceId_fkey)
--   unique index on pre-existing table "kbgrant"     (KbGrant_source_subject_key)
--   ALTER (not a plain ADD COLUMN)                   (DROP CONSTRAINT KbGrant_one_target)
--   DROP statement                                   (DROP POLICY kb_grant_floor)
--
-- The first three are additions the guard treats as non-additive because they
-- land on a table that already had rows — correctly, since a new FK and a new
-- unique index can both fail against existing data. DataSource_createdById_fkey
-- is on the table this migration creates and is not flagged. Everything not in
-- that list is a plain CREATE TABLE, ADD COLUMN nullable, or ADD CONSTRAINT on
-- the new table. The guard rejects this migration, which is the correct
-- outcome and the reason the item is Tier C.
--
-- The two EXISTING partial unique indexes, "KbGrant_doc_subject_key" and
-- "KbGrant_coll_subject_key", are UNTOUCHED — asserted byte-for-byte against
-- pg_indexes in tests/kb-source-schema.test.ts.
--
-- The number is 0012 because 0000-0011 are already assigned; spec.md's item
-- block still says 0010_datasource, written before 0010_origin and
-- 0011_document_fact were assigned. Sorting after the facts migration is the
-- property the spec actually states, and 0012 has it.
--
-- Names: spec.md spells the new index and the widened constraint in lower
-- case ("kbgrant_source_subject", "kbgrant_one_target"). This file uses the
-- repository's existing quoted spelling for the same two objects —
-- "KbGrant_source_subject_key" beside its two siblings, and
-- "KbGrant_one_target" for the constraint that is actually in the catalog and
-- can therefore be dropped by name.
--
-- THE RULES ARE IN THE CATALOG, not only in JavaScript. Every union below is
-- a CHECK, and the scope allowlist carries a JSONB CHECK, because a row
-- written by a seed, a migration or a direct write must be exactly as
-- constrained as one written by the route. src/lib/kb/sources.ts validates the
-- same things earlier and with better messages; it is not the enforcement.

-- The connection layer's row. INDEX is the only mode in v1 and it is pinned
-- here rather than in a validator: FEDERATE cannot be written at all.
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

CREATE UNIQUE INDEX "DataSource_name_key" ON "DataSource"("name");

ALTER TABLE "DataSource" ADD CONSTRAINT "DataSource_mode_index_only"
  CHECK ("mode" = 'INDEX');
ALTER TABLE "DataSource" ADD CONSTRAINT "DataSource_kind_known"
  CHECK ("kind" IN ('S3', 'POSTGRES'));
ALTER TABLE "DataSource" ADD CONSTRAINT "DataSource_status_known"
  CHECK ("status" IN ('DISABLED', 'READY', 'SYNCING', 'ERROR', 'UNREACHABLE', 'PURGED'));

-- The scope allowlist, in the catalog. jsonb_path_exists is IMMUTABLE (the
-- _tz variants are not) which is what makes it legal in a CHECK — a CHECK may
-- not contain a subquery, so jsonb_array_elements is unavailable here.
--
--   * a scope is an ARRAY and every element is an OBJECT. `{}`, `["*"]`,
--     `[null]` and `[[…]]` reach nothing and mean nothing; refusing them is
--     cheaper than guessing. It is also the belt to the recursive paths'
--     braces: those DO catch a wildcard at any array depth, and this rule
--     refuses the shape outright so a scope that is not a list of entries
--     never reaches a crawler at all.
--   * no `where` key at ANY DEPTH, via the recursive `$.**` accessor: an
--     admin who needs a predicate names a VIEW upstream. A free-text
--     predicate is a statement Servo did not compose.
--   * no `*` in bucket, schema or table at any depth — anywhere in the value,
--     not merely as the whole value, so "prod-*" and "*" are refused alike.
--     The acceptance names the `"*"` case; refusing the superset can only
--     reject scopes, never widen one.
--   * bucket/schema/table, where present at any depth, must be STRINGS. A
--     `{"table": ["*"]}` carries a wildcard the string tests cannot see.
--
-- src/lib/kb/sources.ts refuses the identical set with a key name in the
-- message, and tests/kb-source-schema.test.ts runs ONE table of payloads
-- through BOTH — the catalog and the validator must agree, or "as constrained
-- as one written by the route" is not true.
--
-- The element test is `strict $[*]` inside a CASE, and both halves are
-- load-bearing. In LAX mode `$[*]` unwraps one array level and then unwraps
-- the result again, so `[[]]` yields no items at all and a lax type test finds
-- nothing to object to. In STRICT mode the wildcard accessor RAISES on input
-- that is not an array, which a bare `{}` is — hence the CASE, which Postgres
-- evaluates in written order where a chain of ANDs is free to be reordered.
ALTER TABLE "DataSource" ADD CONSTRAINT "DataSource_scope_explicit"
  CHECK (
    -- A NESTED CASE, not a chain of ANDs, and that is load-bearing: the
    -- keyvalue() rules below RAISE on an element that is not an object, and a
    -- chain of ANDs is free to be reordered by the planner, so "every element
    -- is an object" has to be established BEFORE anything looks inside one.
    -- A raise would surface as an unhandled error instead of a named
    -- constraint violation.
    CASE
      WHEN jsonb_typeof("scopeJson") <> 'array' THEN false
      -- Every element is an OBJECT. `["*"]`, `[null]`, `[[…]]` and a bare `{}`
      -- reach nothing and mean nothing. STRICT, because in lax mode `$[*]`
      -- unwraps a nested array and then unwraps the result, so `[[]]` yields
      -- no items at all and a lax type test finds nothing to object to.
      WHEN jsonb_path_exists("scopeJson", 'strict $[*] ? (@.type() <> "object")') THEN false
      ELSE
      -- THE KEY ALLOWLIST, per kind, mirroring SCOPE_KEYS in
      -- src/lib/kb/sources.ts. This is what makes "as constrained as one
      -- written by the route" true: `where` is refused because it is not in
      -- the list, and so is every other key a credential could be parked
      -- under. A denylist of credential-looking names cannot be spelled
      -- identically in jsonpath and JavaScript — it was tried, and `pass_word`
      -- walked through the gap.
      CASE "kind"
        WHEN 'S3' THEN
          NOT jsonb_path_exists("scopeJson", 'strict $[*].keyvalue() ? (!(@.key == "bucket" || @.key == "prefix" || @.key == "suffixes"))')
          AND NOT jsonb_path_exists("scopeJson", 'strict $[*].keyvalue() ? ((@.key == "bucket" || @.key == "prefix") && @.value.type() <> "string")')
          AND NOT jsonb_path_exists("scopeJson", 'strict $[*].keyvalue() ? (@.key == "suffixes" && @.value.type() <> "array")')
        WHEN 'POSTGRES' THEN
          NOT jsonb_path_exists("scopeJson", 'strict $[*].keyvalue() ? (!(@.key == "schema" || @.key == "table" || @.key == "idColumn" || @.key == "textColumns" || @.key == "titleColumn" || @.key == "updatedAtColumn"))')
          AND NOT jsonb_path_exists("scopeJson", 'strict $[*].keyvalue() ? ((@.key == "schema" || @.key == "table" || @.key == "idColumn" || @.key == "titleColumn" || @.key == "updatedAtColumn") && @.value.type() <> "string")')
          AND NOT jsonb_path_exists("scopeJson", 'strict $[*].keyvalue() ? (@.key == "textColumns" && @.value.type() <> "array")')
        ELSE true END
      -- The leaf rules. LAX `$.**` here on purpose: it visits every node in
      -- the tree including the members of `suffixes` and `textColumns`, which
      -- is exactly what is wanted, and the lax-unwrapping trap does not apply
      -- to a recursive accessor. Containers are exempted by type because
      -- `.**` yields them too.
      AND NOT jsonb_path_exists("scopeJson", '$.** ? (@.type() <> "string" && @.type() <> "array" && @.type() <> "object")')
      AND NOT jsonb_path_exists("scopeJson", '$.** ? (@.type() == "string" && @ like_regex "[*]")')
      -- The value rules configJson carries, spelled the same way (see
      -- credentialShape in src/lib/kb/sources.ts). No scope field is a URL.
      AND NOT jsonb_path_exists("scopeJson", '$.** ? (@.type() == "string" && @ like_regex "://")')
      AND NOT jsonb_path_exists("scopeJson", '$.** ? (@.type() == "string" && @ like_regex "-{3,}[[:space:]]*BEGIN" flag "i")')
      -- libpq's keyword/value form carries a password with no URL and no "@".
      -- Only the password keywords are refused: an S3 prefix legitimately uses
      -- `k=v` partitioning.
      AND NOT jsonb_path_exists("scopeJson", '$.** ? (@.type() == "string" && @ like_regex "(^|[[:space:];])(password|passwd|pgpassword)[[:space:]]*=" flag "i")')
    END
  );

-- configJson is NON-SECRET, and that rule belongs in the catalog too. Without
-- it a seed or a raw INSERT could store a live credential that
-- GET /api/kb/sources then serves verbatim to every AGENT.
--
-- THE KEY RULE IS AN ALLOWLIST, NOT A DENYLIST OF CREDENTIAL NAMES, for the
-- reason the scope block gives: a name denylist has to be spelled identically
-- in two languages and it was not. The allowlist mirrors CONFIG_KEYS in
-- src/lib/kb/sources.ts exactly, per kind, with the same declared scalar TYPE
-- for each key, and CONFIG_REQUIRED for POSTGRES.
--
-- `strict` everywhere: lax mode unwraps an array before the filter sees it, so
-- a lax `@.type() == "array"` test never fires and a key blob stored as an
-- array of strings walks through.
ALTER TABLE "DataSource" ADD CONSTRAINT "DataSource_config_nonsecret"
  CHECK (
    CASE WHEN jsonb_typeof("configJson") <> 'object' OR jsonb_typeof("cursorJson") <> 'object'
         THEN false ELSE
    -- Flat scalars only: no object, no array, at any level.
    NOT jsonb_path_exists("configJson", 'strict $.* ? (@.type() == "object" || @.type() == "array")')
    -- Every clause goes through keyvalue(), which yields only the keys that
    -- are PRESENT. A direct `strict $.endpoint ? (…)` RAISES 2203A on a config
    -- that simply does not carry that key, which is most of them.
    AND CASE "kind"
      WHEN 'S3' THEN
        NOT jsonb_path_exists("configJson", 'strict $.keyvalue() ? (!(@.key == "endpoint" || @.key == "region" || @.key == "forcePathStyle"))')
        AND NOT jsonb_path_exists("configJson", 'strict $.keyvalue() ? ((@.key == "endpoint" || @.key == "region") && @.value.type() <> "string")')
        AND NOT jsonb_path_exists("configJson", 'strict $.keyvalue() ? (@.key == "forcePathStyle" && @.value.type() <> "boolean")')
        -- `endpoint` is the one field whose value IS a URL, so it is exempt
        -- from the `://` rule below and carries this one instead: an S3
        -- endpoint has no userinfo, and a userinfo is a credential.
        AND NOT jsonb_path_exists("configJson", 'strict $.keyvalue() ? (@.key == "endpoint" && @.value like_regex "@")')
      WHEN 'POSTGRES' THEN
        NOT jsonb_path_exists("configJson", 'strict $.keyvalue() ? (!(@.key == "host" || @.key == "port" || @.key == "database" || @.key == "ssl"))')
        AND NOT jsonb_path_exists("configJson", 'strict $.keyvalue() ? ((@.key == "host" || @.key == "database") && @.value.type() <> "string")')
        AND NOT jsonb_path_exists("configJson", 'strict $.keyvalue() ? (@.key == "port" && @.value.type() <> "number")')
        AND NOT jsonb_path_exists("configJson", 'strict $.keyvalue() ? (@.key == "ssl" && @.value.type() <> "boolean")')
        -- Both fields assertNotServoDatabase compares must exist AND be
        -- non-blank, or that guard has nothing to compare and a host-less
        -- config — which reaches the LOCAL machine over a unix socket —
        -- becomes storable by a seed.
        AND "configJson" ? 'host' AND "configJson" ? 'database'
        AND NOT jsonb_path_exists("configJson", 'strict $.keyvalue() ? ((@.key == "host" || @.key == "database") && @.value like_regex "^[[:space:]]*$")')
      ELSE true END
    -- No value except an S3 endpoint may be a URL, and no value anywhere may
    -- be a PEM block. Both are also credentialShape() in
    -- src/lib/kb/sources.ts, character for character in intent, and one table
    -- of payloads is run through both layers by the tests.
    AND NOT jsonb_path_exists("configJson", 'strict $.keyvalue() ? (@.key <> "endpoint" && @.value.type() == "string" && @.value like_regex "://")')
    AND NOT jsonb_path_exists("configJson", 'strict $.** ? (@.type() == "string" && @ like_regex "-{3,}[[:space:]]*BEGIN" flag "i")')
    AND NOT jsonb_path_exists("configJson", 'strict $.** ? (@.type() == "string" && @ like_regex "(^|[[:space:];])(password|passwd|pgpassword)[[:space:]]*=" flag "i")')
    END
  );

-- A crawled record IS a Document. externalLocator is document-level and
-- human-readable; DocumentChunk.locator is unchanged, so an S3 .xlsx cites
-- {sheet,range} exactly like an uploaded one.
ALTER TABLE "Document" ADD COLUMN "sourceId" TEXT;
ALTER TABLE "Document" ADD COLUMN "externalLocator" JSONB;
ALTER TABLE "Document" ADD COLUMN "externalVersion" TEXT;
ALTER TABLE "Document" ADD COLUMN "externalSeenAt" TIMESTAMP(3);

-- The third grant target.
ALTER TABLE "KbGrant" ADD COLUMN "sourceId" TEXT;

-- RESTRICT on Document: deleting a source while its documents remain would
-- orphan every citation naming them. Disable is the reversible kill switch;
-- purge is the deliberate destructive one. CASCADE on KbGrant matches the two
-- existing target types — a grant on a row that no longer exists is noise.
ALTER TABLE "Document" ADD CONSTRAINT "Document_sourceId_fkey"
  FOREIGN KEY ("sourceId") REFERENCES "DataSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "KbGrant" ADD CONSTRAINT "KbGrant_sourceId_fkey"
  FOREIGN KEY ("sourceId") REFERENCES "DataSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DataSource" ADD CONSTRAINT "DataSource_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The third partial unique index, beside 0003_kb's two. Partial because a
-- plain unique index over three nullable columns would let unlimited rows
-- through on NULLs.
CREATE UNIQUE INDEX "KbGrant_source_subject_key"
  ON "KbGrant"("sourceId", "subjectType", "subjectId") WHERE "sourceId" IS NOT NULL;

-- THE ONE NON-ADDITIVE STATEMENT. 0003_kb pinned "exactly one of two"; three
-- target types need "exactly one of three". Postgres has no ALTER CONSTRAINT
-- for a CHECK expression, so the pair below is a replacement, not a
-- relaxation: num_nonnulls = 1 still refuses a row with two targets and a row
-- with none, which is what the widened form is tested for.
ALTER TABLE "KbGrant" DROP CONSTRAINT "KbGrant_one_target";
ALTER TABLE "KbGrant" ADD CONSTRAINT "KbGrant_one_target"
  CHECK (num_nonnulls("documentId", "collectionId", "sourceId") = 1);

-- RLS (kb-15's floor, extended to the new table). Stated plainly so the two
-- layers are never confused: THE RLS FLOOR KNOWS NOTHING ABOUT "sourceId" OR
-- 'GONE'. It stays COARSER than the application filter, and the source
-- ceiling lives only in src/lib/kb/entitlement.ts — a floor that restated the
-- CTE would be a second gate to keep in sync, which is the failure kb-15's
-- header already names. FORCE because the app connects as the table owner and
-- owners bypass RLS without it.
ALTER TABLE "DataSource" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DataSource" FORCE ROW LEVEL SECURITY;

-- Same shape as kb_grant_floor: a source row is metadata, so the floor asks
-- only for a resolved human principal. Absent, it returns ZERO rows.
--
-- THE PRINCIPAL TEST IS `<> ''`, NOT `IS NOT NULL`, and the difference is not
-- cosmetic. A custom GUC that has been SET LOCAL once in a session does not
-- go back to unset when that transaction ends — it reverts to the SESSION
-- value, which for a placeholder Postgres created on first use is the EMPTY
-- STRING. On a pooled connection, `current_setting('app.human_id', true) IS
-- NOT NULL` is therefore TRUE for every query after the first entitled one,
-- and a floor written that way is OPEN on a reused connection.
--
-- kb-15's three DOCUMENT-side policies (kb_document_floor, kb_chunk_floor,
-- kb_edge_floor) are NOT amended here — kb_document_floor carries the older
-- `IS NOT NULL` principal test and so has the hole described above; the other
-- two carry no principal test at all and reach it through kb_document_floor.
-- They are
-- kb-15's surface, not this item's, and widening onto them is the drive-by
-- §0.2 step 8 forbids. The finding is filed for the owner as question 61 in
-- spec.md §14, in this same commit. The two policies xds-01 writes — the new
-- kb_source_floor and the kb_grant_floor this item is required to amend — are
-- not born with it. THAT HARDENING IS THE AMENDMENT: the floor's TEXT still
-- names no target column, so the sentence above stays literally true.
CREATE POLICY kb_source_floor ON "DataSource"
  USING (coalesce(current_setting('app.human_id', true), '') <> '');

-- kb-15's KbGrant policy, re-issued for the third target type. A source-target
-- grant is admitted on exactly the same terms as a document or collection one,
-- because the floor is target-type AGNOSTIC by construction — it asks only for
-- a resolved human principal, and deliberately does not enumerate the target
-- columns, so nothing here knows what "sourceId" is. Proven, rather than
-- asserted, in tests/kb-source-schema.test.ts: a source-target grant is
-- visible under the policy role, and the same query on the SAME CONNECTION
-- after the principal is gone returns zero rows.
DROP POLICY kb_grant_floor ON "KbGrant";
CREATE POLICY kb_grant_floor ON "KbGrant"
  USING (coalesce(current_setting('app.human_id', true), '') <> '');
