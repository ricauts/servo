<!-- Design rationale for spec.md. spec.md remains the work order:
     the backlog, the tick protocol and the claims ledger live there. -->

# External data sources in the knowledge graph

Section 5 built a knowledge base Servo **owns**: bytes in `bytea`, chunks in `DocumentChunk`, one entitlement CTE that every read path composes. This section connects that graph to stores Servo **does not own** — S3-compatible object storage and external SQL servers — so an uploaded contract can be related to the invoice row that lives in the ERP.

This is the most dangerous addition in the file, and the danger is not the network. Every property §5 paid for is a property of *one Postgres statement*: the filter is structural because the entitled set is a CTE in the same `FROM` clause. Reach outside that statement and the filter becomes procedural again — the exact regression the access-control review of §5 was written to end.

So the design goal is not "add federation". It is **add external sources without adding a second retrieval path.**

### The two modes, and why only one ships

| | **INDEX** — crawl into `Document`/`DocumentChunk` | **FEDERATE** — query the remote store at request time |
|---|---|---|
| Entitlement | The existing CTE, unchanged. A crawled row is a `Document` like any other | The CTE cannot join across the wire. Either candidates come back and are filtered locally — **post-filtering, forbidden** — or the entitlement predicate is pushed into the remote statement, which needs a principal mapping that does not exist |
| Ranking | `tsvector` + GIN and HNSW in the same statement as the gate | Per-source and incomparable. Blending a remote `LIKE` score with `ts_rank_cd` is a number with no meaning |
| Citations | `{sheet,range}` / `{page}` / row locators, stable, already rendered | A locator whose target may have changed between retrieval and send |
| Provenance | kb-12's "`sources` **is** the injected set" holds by construction | Holds only if the remote query is deterministic, which nothing guarantees |
| Send-time re-verification (kb-13) | Re-runs the same CTE. Cheap, offline, already written | A second round trip to a system that may be down at approval time |
| Failure | A source outage makes the index stale. Answers still work | A source outage makes answers *worse without saying so* |
| **Honest cost** | **Content is copied into Servo's Postgres.** Upstream ACLs are not consulted at read time; Servo's grants are the ACL. Deletion must be propagated by us, not inherited | Nothing is copied. That is its only advantage, and it is a real one |

**INDEX ships, and it is the only mode in v1.** `DataSource.mode` exists as a column with the value `"INDEX"` so the roadmap is data rather than a migration — and it is pinned by a `CHECK` constraint in the migration, not by a JavaScript validator. A row created by a seed, a future route, a migration or a direct write cannot carry `FEDERATE`.

**The pre-committed rule for FEDERATE, written now so it cannot be got wrong later:** a federated query is permitted only when (a) the entitlement predicate is pushed *into* the remote statement, composed by Servo, never by a model; (b) the source declares a per-row subject column mapped to Servo principals; and (c) the result set is proven non-empty-or-denied before any row is formatted. Anything else is post-filtering and is refused. A chunk that transited the context has already leaked.

**And the argument that decides it:** under INDEX, relating a document to a database row is *nothing to build* — a crawled row **is** a `Document`, so `KnowledgeEdge` needs no new kind, no polymorphic endpoint and no second traversal, and kb-08's "both endpoints entitled or no edge" rule already covers the crossing. Under FEDERATE the graph would need an edge type whose far end cannot be entitlement-checked in the same statement as the near end.

### The DataSource model

```prisma
model DataSource {
  id           String   @id @default(cuid())
  name         String   @unique
  kind         String                        // S3 | POSTGRES        (CHECK-pinned)
  mode         String   @default("INDEX")    // INDEX only in v1     (CHECK-pinned)
  configJson   Json     @default("{}")       // NON-SECRET only: endpoint, region, host, port, database, ssl
  secretRef    String                        // Setting key, e.g. "datasource.<id>.secret". Never the credential
  scopeJson    Json     @default("[]")       // the allowlist. EMPTY = nothing reachable
  status       String   @default("DISABLED") // DISABLED | READY | SYNCING | ERROR | UNREACHABLE | PURGED
  statusError  String?
  lastSyncAt   DateTime?
  lastCompleteSyncAt DateTime?               // only a COMPLETE crawl may propagate deletions
  cursorJson   Json     @default("{}")
  syncEveryMin Int      @default(0)          // a HINT for the external caller. Servo has no scheduler
  maxRows      Int      @default(20000)
  createdById  String
  createdBy    User     @relation(fields: [createdById], references: [id])
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  documents Document[]
}
```

Additive on `Document`: `sourceId String?` (→ `DataSource`, `onDelete: Restrict`), `externalLocator Json?`, `externalVersion String?` (S3 ETag, or sha256 of the rendered row text), `externalSeenAt DateTime?` (the generation stamp deletion propagation reads). `Document.textStatus` gains **`GONE`** — indexed once, removed upstream, no longer retrievable.

Additive on `KbGrant`: `sourceId String?`, a third partial unique index, and the CHECK widened to `num_nonnulls("documentId","collectionId","sourceId") = 1`.

**The scope allowlist is the whole security model of the connection.** It is a list, never a wildcard, and an empty list reaches nothing:

```jsonc
// kind: S3
[{ "bucket": "contracts", "prefix": "2026/", "suffixes": [".pdf", ".xlsx", ".md"] }]

// kind: POSTGRES   — "table" may name a VIEW, which is how you get a WHERE clause
[{ "schema": "public", "table": "invoices_indexable",
   "idColumn": "id", "textColumns": ["number","customer","status","notes"],
   "titleColumn": "number", "updatedAtColumn": "updated_at" }]
```

There is no `"bucket": "*"`, no `"table": "*"`, no schema-wide entry, and no free-text `where` — an admin who needs a predicate creates a view upstream. **These rules are a JSONB `CHECK` in the migration as well as a validator in the route**, because a row created by any other path must be just as constrained. **Servo composes every statement itself** from the scope entry, quoting identifiers and binding the cursor as a parameter. No string from a model, a ticket, an admin form or a URL ever reaches a SQL statement. That single rule kills injection and "the whole server" together.

### Credential isolation, and the guard that matters most

- **Credentials live in the existing sealed store.** `src/lib/secret-store.ts` `seal()`/`open()` against a `Setting` row named by `secretRef`. Nothing secret is written to `configJson`, returned by any `/api/kb/sources` response, or logged in `statusError`.
- **The AWS ambient credential chain is disabled.** `@aws-sdk/client-s3` is constructed with explicit `credentials` and a `credentialDefaultProvider` that throws. Left at its default the SDK walks env vars, shared config and finally **the EC2/ECS metadata endpoint** — the exact confused deputy `src/lib/egress.ts` exists to prevent. A source with no stored secret refuses; it never falls back to the host's identity.
- **Only three S3 commands are ever constructed:** `ListObjectsV2`, `HeadObject`, `GetObject`. No code path builds `PutObject`, `DeleteObject` or any multipart command, and a test asserts the import list.
- **Least privilege is a shipped criterion, not a doc line.** The source page renders the exact IAM policy (`s3:GetObject`, `s3:ListBucket`, scoped to `bucket/prefix*`) and the exact `CREATE ROLE … GRANT SELECT` text an operator should use. "Read-only because we only import three commands" is a claim about our code; it says nothing about the key.
- **SQL reads run as a read-only role.** `xds-04` depends on `db-05`, which is the item that establishes the pattern (`ALTER ROLE … SET default_transaction_read_only = on`, plus `BEGIN … SET TRANSACTION READ ONLY` around every statement). Since `db-05` shipped, `src/lib/opsdb.ts` **is** that precedent: `opsSelect()` wraps every statement in `SET TRANSACTION READ ONLY` and prefers the `servo_ops_ro` role. (Before `db-05` it was a SQLite client pinned with `PRAGMA query_only`, which is why earlier drafts of this document said not to cite it.) What it establishes, and what `xds-04` reuses, is the *shape*: a second `PrismaClient` bound by `datasourceUrl` with `$queryRawUnsafe` over Servo-composed SQL, pinned read-only by the server rather than by keyword filtering. **No new SQL driver** — `pg` and `postgres.js` buy nothing here. Be honest about the asymmetry: when MSSQL eventually lands there is no `SET TRANSACTION READ ONLY`, and the guarantee there rests on `db_datareader` plus Servo composing every statement. That is weaker, and it is one reason MSSQL is not v1.
- **Egress gets its own allowlist.** `checkEgress` is HTTP-only, so it covers the S3 endpoint and not the SQL socket. Data sources read **`kb.sources.egress.allowlist`**, a separate setting read only by the crawler — never `integration.egress.allowlist`, which is the one global list `web_fetch` reads (`src/lib/ai/tools/web.ts`). Adding an on-prem MinIO host to the agent-facing list to make a crawl work would re-open the confused deputy that `src/lib/egress.ts` exists to close, and a test asserts a host permitted for sources is still refused by `web_fetch`. `forcePathStyle: true`, region redirects off, redirects not followed. The residual DNS-rebinding risk `egress.ts` already names applies unchanged and is not re-claimed away.
- **The guard that matters most: a DataSource may never point at Servo's own database.** Save and crawl both refuse when the resolved `host:port:database` matches any of `DATABASE_URL`, `OPS_DATABASE_URL` or `OPS_DATABASE_READONLY_URL` — compared on **resolved addresses and the parsed database name**, never on the URL string, so `localhost` / `127.0.0.1` / the container name are all the same target. Without this, one `DataSource` row is a path around every entitlement CTE in §5, and it is one row an admin could create by accident.

### Grants: a source is a ceiling, not a floor

A `DataSource` is a grant subject exactly like a `Collection` — same `KbGrant` model, same `USER | GROUP | AGENT` subjects, same share panel, same effective-readers preview.

**The clause is applied once, outside the union — never AND-ed into the legs.** In §5's CTE the grant branch is `SELECT COALESCE(g."documentId", d.id) … LEFT JOIN "Document" d`, where `d` is all-NULL for a direct document grant. A `d."sourceId" IS NULL` test there is TRUE (ceiling bypassed) and a `d."textStatus" <> 'GONE'` test is NULL (every directly-granted document vanishes). So the fragment gains a wrapper:

```sql
entitled AS (
  SELECT id FROM human_docs
  INTERSECT                      -- omitted entirely on the human chain
  SELECT id FROM agent_docs
),
readable AS (
  SELECT e.id
    FROM entitled e
    JOIN "Document" d ON d.id = e.id
   WHERE d."textStatus" <> 'GONE'
     AND ( d."sourceId" IS NULL OR (
            EXISTS (SELECT 1 FROM "DataSource" s
                     WHERE s.id = d."sourceId"
                       AND s.status NOT IN ('DISABLED','PURGED'))
        AND EXISTS (SELECT 1 FROM "KbGrant" g            -- the HUMAN leg: $1 only
                     WHERE g."sourceId" = d."sourceId"
                       AND ( (g."subjectType" = 'USER'  AND g."subjectId" = $1)
                          OR (g."subjectType" = 'GROUP' AND g."subjectId" IN
                                (SELECT "groupId" FROM "GroupMember" WHERE "userId" = $1)) ))
        AND ( $2 IS NULL                                  -- the AGENT leg: $2 only
              OR EXISTS (SELECT 1 FROM "KbGrant" g
                          WHERE g."sourceId" = d."sourceId"
                            AND g."subjectType" = 'AGENT' AND g."subjectId" = $2) )
     ))
)
```

Every KB read path joins `readable`. **One `OR`-block over all three subject types would destroy the `A ∩ B` intersection on the source dimension** — the agent leg would be satisfied by the requester's grant and vice versa — which is the opposite of what this says, so the two legs are separate `EXISTS` clauses against separate parameters, with a red-team test in each direction.

Consequences, all intended:

- **A source grant alone grants nothing**, and a document grant alone grants nothing on a source-backed document. Both are required, on both legs.
- **Ownership stops being sufficient.** Crawled documents get `ownerId = DataSource.createdById` because `Document.ownerId` is required, but the source clause is applied after the ownership union, so the admin who created the source does not silently own the ERP.
- **Crawled documents are always written `visibility: 'PRIVATE'`.** The crawler cannot mint `STAFF` or `PUBLIC`.
- **`DISABLED` closes the gate; `SYNCING` and `UNREACHABLE` do not.** Disabling a source darkens every document it fed, instantly, without touching a grant row and without deleting anything — that is the kill switch, and it is the same statement that does retrieval, so it cannot drift. Gating on `= 'READY'` instead would darken the whole corpus during every routine crawl and on every outage, and would make kb-13 refuse every pending send mid-sync. **Staleness belongs in the citation, not in the gate.**

Agents still get nothing implicitly (§5). A fresh source is dark to every agent until a human grants it, and the Knowledge UI's "no agent can read this yet" empty state extends to sources.

**RLS: the floor is amended, and stays coarser.** `xds-01` depends on `kb-15` and lands `ENABLE`/`FORCE ROW LEVEL SECURITY` on `DataSource` plus the amended `KbGrant` policy in the same migration. Stated plainly so nobody mistakes the two: the RLS floor knows nothing about `sourceId` or `GONE` — the source ceiling lives only in `entitlement.ts`, and the floor remains what §5 says it is, a catch for a forgotten `WHERE`.

### The pointer shape

`DocumentChunk.locator` is unchanged — an S3 `.xlsx` goes through the same `exceljs` path as an uploaded one and gets the same `{sheet, range}`. What is new is a **document-level `externalLocator`**: stable, human-readable, and never a URL carrying credentials.

```jsonc
{ "kind": "S3",       "bucket": "contracts", "key": "2026/q1/INV-2024-113.pdf",
  "etag": "\"9f8c…\"", "versionId": null }

{ "kind": "POSTGRES", "source": "erp", "schema": "public", "table": "invoices",
  "idColumn": "id",   "id": "INV-2024-113" }
```

Rendered as a citation line: *"per erp · public.invoices · row INV-2024-113"*, or *"per contracts/2026/q1/INV-2024-113.pdf · page 3"*. v1 renders text only; a `browseUrlTemplate` that turns a locator into a link is roadmap, because a template is a place to leak a token.

**Granularity: one `Document` per row**, because the point is relating to a *record* — a stable id, a stable citation, and deletion propagation that means something. The blast radius is bounded by `maxRows` (default 20,000), enforced by **refusal, not truncation**: a scope entry over the cap lands `ERROR` with "narrow the scope with a view, or raise maxRows", never a silently half-indexed table. The honest cost: 20,000 rows is 20,000 `Document` rows, which grows `pg_dump` time and HNSW build memory — the two things §5 already names as biting first.

### Sync

**Servo has no scheduler, and this section does not invent one.** §16 is explicit: no queue, no worker, no scheduler; `POST /api/sla/scan` needs an external caller. Sync follows that shape exactly — `POST /api/kb/sources/:id/sync` for cron or a human, plus a "Sync now" button. `syncEveryMin` is a **hint recorded for whoever calls**, and the UI says so rather than implying Servo wakes up.

- **One crawl at a time**, claimed atomically the way `approveDraft` claims a draft: `updateMany({ where: { id, status: 'READY' }, data: { status: 'SYNCING' } })` — rowcount 1 wins. A crashed crawl leaves `SYNCING`; a boot sweep and a wall-clock lease return it to `ERROR`, never to `READY`.
- **Incremental.** S3: `ListObjectsV2` paginated by continuation token, and an object whose `ETag` equals `externalVersion` skips download and extraction entirely. SQL: with `updatedAtColumn` declared, only rows past the cursor are re-rendered; otherwise a rendered-text sha256 decides. Either way the **id sweep is always full** over the whole scope, because an `updated_at` cursor can never see a deletion.
- **Crawled bytes are untrusted uploads that arrived by a different door.** Extraction runs inside kb-05's forked worker with its existing entry-count, decompressed-size, wall-clock and heap caps. `xds-03` depends on `kb-05` for exactly this reason, and its fixtures include a zip bomb and an XXE file served from the mock bucket. The 25 MB cap is checked against `HeadObject` *and* enforced on the `GetObject` stream, because the remote store controls the header.
- **Deletion propagation is generation-based, and non-destructive on failure.** Every crawl stamps `externalSeenAt` on what it saw, including objects it skipped as unchanged. When and *only* when a crawl completes every scope entry without error, documents of that source with `externalSeenAt < runStartedAt` go `textStatus: 'GONE'`, and their **searchable surface is erased**: `DocumentChunk` rows deleted, `DocumentFact` rows deleted, `KnowledgeEdge` rows touching the document deleted, `summary` and `keywords` zeroed. Deleting chunks does not cascade edges, and `summary` is a deterministic extract of the upstream text — leaving either behind keeps a searchable residue of a record that was revoked upstream.
- **The original bytes survive until a human purges them.** `Document.data` is *not* zeroed by an automated crawl. `GONE` is excluded from every read path including download, so the content is unreachable; irreversible destruction of stored bytes is an explicit admin **Purge** action, never a machine's decision on a crawl it may have gotten wrong. **Purge refuses while any `ReplyDraft.sources` entry or approval-audit row still cites the document** — otherwise the tidy-up erases the audit trail the `GONE` design exists to preserve.
- **An incomplete crawl deletes nothing.** A transport error, an auth error, or a scope entry whose bucket or table has vanished makes the crawl incomplete; `lastCompleteSyncAt` does not move and no document is touched. "The table returned zero rows, so remove everything" is the classic full-sync disaster and it is named here so nobody rediscovers it.
- **When a source goes away.** Transport failure → `UNREACHABLE`; auth failure → `ERROR`. Both are non-destructive: the indexed copies keep answering, and the UI puts the staleness age on the source and on every citation from it. Deliberately **not** chosen: a `staleAfterMin` that silently stops serving. Silent darkness is worse than visible staleness, and this is the one place a reasonable person would disagree — see §17.
- **Deleting the source row** is refused while documents reference it (`onDelete: Restrict`). Purge first, deliberately; disable is the reversible action.

### kb-13 inherits the boundary

Send-time re-verification already refuses when a cited grant was revoked between drafting and approval. It gains two refusal reasons at no structural cost: a cited document whose `textStatus` is `GONE`, and a cited document whose source is `DISABLED` or `PURGED`. The approval UI already names the citation that went dark; it now says whether the grant changed or the record was removed upstream. This is the entire reason deletion propagation soft-deletes — a hard delete would make a stale draft's citation unresolvable rather than explainable.

### Offline testability

`docker-compose.test.yml` gains two services and no cloud account is ever required:

| service | image | port | role |
|---|---|---|---|
| `s3` | `adobe/s3mock` (Apache-2.0) | 9090 | the "external" object store |
| `extdb` | `postgres:17-alpine` | **5434** | the "external" SQL server — deliberately a *different* instance from the 5433 test Postgres, so "never point at Servo's own database" is provable against two real endpoints |

**On MinIO.** It works and operators who already run it should point at it — but its server is **AGPL-3.0**, and while a test container is not adopted code, there is a zero-cost Apache-2.0 alternative, so the test compose ships the Apache-2.0 one. `chrislusf/seaweedfs` (Apache-2.0) is the fallback if `adobe/s3mock`'s `ListObjectsV2` pagination proves too thin for the cursor tests. Both licences are re-recorded by the tick's step 0, not assumed from this paragraph.

Because both containers sit on private addresses, the S3 tests necessarily exercise the **literal allowlist path in `kb.sources.egress.allowlist`** — which is exactly what an operator with an on-prem MinIO does, so the test and the deployment agree.

### Adopt-first (§0.4) for this area

| Candidate | Licence | Verdict |
|---|---|---|
| `@aws-sdk/client-s3` (v3, modular) | Apache-2.0 | **ADOPT** — one client, three commands. No `s3-request-presigner`, no `lib-storage` |
| second `PrismaClient` for external Postgres | already in tree | **ADOPT** — no new SQL driver |
| `adobe/s3mock` | Apache-2.0 | **ADOPT (test only)** |
| `chrislusf/seaweedfs` | Apache-2.0 | **FALLBACK (test only)** |
| MinIO server | AGPL-3.0 | **NOT SHIPPED in the test compose.** Pointing a `DataSource` at an operator's MinIO is fine — that is a network endpoint, not adopted code |
| `mssql` / `tedious` | MIT / MIT | **ROADMAP** — the blocker is not the licence; the only realistic test container is `mcr.microsoft.com/mssql/server` under an EULA at ~2 GB RAM, a poor trade against §14's offline rule |
| DuckDB + `@duckdb/node-api` | MIT | **REFUSED for v1** — see below. This is the one place the DuckDB verdict is written; §11 cites it |

**DuckDB, dispatched explicitly** because it will otherwise be re-proposed every few months. It is genuinely attractive: MIT, in-process, no second container, and it reads xlsx, parquet, `s3://` and (via the MIT `mssql` community extension) SQL Server through one engine. Three things disqualify it here, each independently:

1. Its `postgres` extension `ATTACH`es **read-write by default**, so a DuckDB connection that can reach Servo's own database is a one-line path around every entitlement CTE in §5.
2. Its xlsx reader is native C++ **inside the Node process**, where a crafted-file crash or native OOM takes the container down and `--max-old-space-size` does not bound it. Adopting it deletes kb-05's hardened-worker invariant, which is the whole reason untrusted uploads are safe.
3. Its extensions are fetched from `extensions.duckdb.org` at runtime; offline operation means pre-baking version-matched binaries into the image — a real cost paid for a capability `@aws-sdk/client-s3` already covers.

If it ever ships it is as a *separate* engine, `READ_ONLY`, autoloading off, extensions pre-baked via `extension_directories`, never pointed at Servo's own database, never on the untrusted-upload path, and recorded in `THIRD_PARTY.md`. Client choice is already settled: `@duckdb/node-api` (`duckdb/duckdb-node-neo`); the legacy `duckdb` package carries its own deprecation notice and `duckdb-async` depends on it.

### Non-goals for v1 — refused, not deferred

- **FEDERATE / query-at-request-time.** INDEX only, pinned by a CHECK. The pre-committed rule above is what it must satisfy to arrive.
- **Any write to any external store.** No `PutObject`, no `INSERT`, no DDL, no "sync back". There is no code path, and a test asserts the S3 import list.
- **Upstream ACL mirroring.** Servo's grants are the ACL for indexed content; the source grant is the ceiling. Reading bucket policies or SQL `GRANT`s and translating them into `KbGrant` rows is a whole trust boundary, not a feature.
- **MSSQL, MySQL, Oracle, Snowflake, BigQuery, Google Drive, SharePoint.** Two kinds in v1; `kind` is a String, so a third is data plus a CHECK edit.
- **IAM instance roles, IRSA, STS assume-role.** Explicit keys in the sealed store only — the ambient chain is the confused-deputy surface, and it is switched off.
- **Streaming, CDC, source webhooks, real-time sync.** A crawl is a crawl, called from outside.
- **Presigned URLs or any link that hands a viewer credentials.** Downloads go through Servo's own route against the stored copy.
- **OCR on crawled PDFs.** Inherits kb-07: `UNSUPPORTED` with the scanned-document message.
- **Objects over the 25 MB cap.** `UNSUPPORTED` with a message naming the cap, never a silent skip.
- **A hosted connector service.** Nothing here may state or imply one; the crawler runs in the same single Node process as everything else.

### Claims discipline

External sources may not be described on any user-visible surface until `xds-09` ships the UI, per §16. Two sentences need care: **"connects to your existing systems"** must never imply a hosted connector, and **"your documents never leave your infrastructure"** — already conditioned on keyword-only mode or a local embedding endpoint by kb-17 — gains a second condition, because INDEX mode means *external* records now arrive *into* your Servo database. The claims-ledger entry ships in `xds-09`, in the same item as the behaviour.

### Risks

1. **A source pointed at Servo's own database.** The one unforgivable configuration. Closed by resolved-address comparison at save *and* at crawl, asserted against two real local Postgres instances.
2. **Ambient cloud credentials.** Closed by explicit credentials and a throwing default provider, asserted with `AWS_*` set in the test environment.
3. **A full-sync wipe on a partial failure.** Closed by `lastCompleteSyncAt`, asserted by mid-crawl fault injection. This is the classic connector disaster and the guard is one boolean away from being wrong.
4. **Copied content outliving its source.** Closed by `GONE` plus erasure of chunks, facts, edges, `summary` and `keywords`, and by kb-13 refusing to send a citation that went dark. The original bytes wait for a human purge, and that purge refuses while an audit row still cites the document.
5. **Grant sprawl across three target types.** The effective-readers preview calls the same resolver retrieval calls; if they disagree one of them is a bug and the test says which.
6. **Index size.** 20,000 rows is 20,000 documents. `maxRows` refuses rather than truncates, and the admin storage meter counts source-backed bytes separately.
7. **Three Tier-C items in one area** (`xds-01`, `xds-03`, `xds-09`) against the "at most one item in `review`" cap. Expect stalls here more than anywhere else; §0.6's skip rule handles them, but the owner should expect three PR waits.

### Decisions that close this area's questions

- **Mode** — INDEX only; FEDERATE is a CHECK-refused column value with a pre-committed rule.
- **Grant semantics** — a source grant is a ceiling applied outside the union, per-leg, never a shortcut that grants its documents.
- **Row granularity** — one document per row, capped by refusal.
- **Predicates** — no free-text `where`. Name a view.
- **Scheduling** — external caller, exactly like `POST /api/sla/scan`.
- **Stale sources** — keep serving, show the age. Not silently darkened.
- **Chunk-level or column-level ACLs on external rows** — refused, same as §5. If one column is secret, the view does not select it.

---
