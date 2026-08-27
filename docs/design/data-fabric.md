<!-- Design rationale for spec.md. spec.md remains the work order:
     the backlog, the tick protocol and the claims ledger live there. -->

# The data fabric: the source catalog and context-budgeted retrieval

*Placement: immediately after the DataSource connection layer's section, before §6. Its backlog blocks append to §11 after `loop-07`. This section assumes a `DataSource` row exists, is entitled, carries a read-only credential and exposes a session in which profiling SQL can run. It does not design the connection layer, the credential store, the allowlist, or INDEX-vs-FEDERATE, and it never opens a connection that layer has not already opened.*

A connection is not knowledge. `DataSource { kind: POSTGRES, host: warehouse }` tells an agent nothing except that a warehouse exists, and the only way to learn more is to open it — which is exactly the failure this area exists to prevent. A 400-table warehouse dumped as schema is roughly 400 × 12 columns × ~40 characters ≈ **192,000 characters**, about 48,000 tokens, spent to discover that the warehouse is the wrong warehouse. The agent has then burned its budget and poisoned its own reasoning with noise it cannot unsee.

So the moment a source is connected and entitled, Servo **profiles** it: it walks the schemas or the prefix tree, reads the statistics the source already keeps about itself, opens a small deterministic sample, and reduces all of it to a **card** — a short, citable, ACL-gated description of what the source contains. The card, not the data, is what becomes searchable. Then a router ranks cards, hops between them along a weighted graph, and enforces a per-run character budget inside the tool layer, so the agent **never opens a source to find out whether it should open it.**

Two numbers bound the design and both are asserted in `fed-06`:

- Rejecting a source at overview altitude costs **one brief (≤ 220 chars) + one overview card (≤ 1,500 chars) = ≤ 1,720 characters.**
- No single dataset may admit more than **3,000 characters** into one run, at any altitude, by any tool, however many cursors the model pages. That is the hard ceiling; 1,720 is the ordinary cost.

The design constraint that shapes everything else is one sentence: **a profile of a payroll table is payroll metadata, and metadata about payroll is still payroll.** A catalog that is easier to read than its source is a backdoor. The catalog therefore gets no looser gate than §5 — it gets the *same* gate, in the same SQL fragment, at the same point in the sequence.

### The reuse decision, argued

**A catalog card is a `Document`. Its sections are `DocumentChunk` rows. There is no parallel searchable store, and there is no second definition of "may read".**

The tempting alternative — a `CatalogEntry` table with its own `tsvector` and its own `vector(1536)` — is what most catalogs do, and it is what §5 spent an entire area making impossible. §5's invariant is that retrieval is entitlement-filtered in SQL, before candidate selection, before vector scoring, enforced by **one** CTE fragment in `src/lib/kb/entitlement.ts` that every read path composes, with the review rule attached: *adding a read path that does not use it is a review failure*. A second searchable table means a second `FROM`, a second GIN index, a second HNSW index, a second `embeddingModel` exclusion rule, a second RLS policy set and a second red-team test — and the day the two drift is the day the catalog leaks. The gain would be schema tidiness. The cost is the invariant.

Reusing `Document`/`DocumentChunk` buys, with no new code: the entitlement CTE; `tsvector` + GIN and pgvector HNSW; the `embeddingModel` exclusion rule, keyword-only mode, the mock embedder and the `kb-09` backfill; the `kb-15` RLS floor; `search_knowledge` / `read_document` / `list_collections` with **no new KB tool**; `read_document`'s cursor pagination, which is exactly what a 400-column card needs; and citation shape — *"per `pg://warehouse/public.payroll` · columns 13–24"* is the same shape as *"per Pricing.xlsx · sheet 2026 · B4:D9"*.

What does **not** fit in a Document is the machine-readable half — the per-column statistics an edge builder and a router compute over, in SQL, without parsing prose. That is `CatalogEntry`. The split is DataHub's and it is the right one: **`CatalogEntry` is the structured fact, `Document` is its rendered description, and the two are written in one transaction.**

A catalog `Document` is an ordinary row with five differences, every one a constraint rather than a feature:

- `kind = "CATALOG"` (new column, `@default("FILE")`, additive).
- `catalogEntryId` back-links the entry. There is no `Document.sourceId`; the source is reached through `CatalogEntry`, so there is exactly one join path and one thing to revoke.
- **`data` is NULL.** The canonical profile JSON lives in `CatalogEntry.profile`, never in `Document.data`. `GET /api/kb/documents/:id/download` refuses `kind = 'CATALOG'`. Every redaction decision made in the renderer would otherwise be bypassed by one download, and `CatalogEntry.signature` — a salted MinHash — would be downloadable.
- `textStatus = "EXTRACTED"`, set directly by the renderer. Card text is *generated*, not extracted; the `kb-05` forked worker is not involved for the card itself (it **is** involved for sampled object bytes). Nobody should wire an extraction worker to a string we produced.
- `visibility` is always `PRIVATE`, structurally:
  ```sql
  ALTER TABLE "Document" ADD CONSTRAINT document_catalog_private
    CHECK ("kind" <> 'CATALOG' OR "visibility" = 'PRIVATE');
  ALTER TABLE "Document" ADD CONSTRAINT document_catalog_no_bytes
    CHECK ("kind" <> 'CATALOG' OR "data" IS NULL);
  ```
  There is no admin mis-click that makes the warehouse's shape readable by every agent in the building, and no route that hands out its profile JSON.

**The owner of a catalog card is a system principal, not a person.** `ensureAiAgents()` (`src/lib/bootstrap.ts:16`) gains a fourth row — **Servo Catalog**, `catalog@servo.ai`, `aiKind: "CATALOG"`, `role: "AI_AGENT"` — and `persist.ts` sets it as `ownerId` on every card. The entitlement CTE's first branch is `d."ownerId" = $1`; if a human owned the card, they would keep full access to it after their DataSource grant was revoked and no grant delete could take it away. `AI_AGENT` has no interactive login, so that branch can never fire for a card.

`DocumentChunk.locator` gains its **fourth shape** — in the union, no parallel column, exactly as §5 requires:

```
{"sheet":"2026","range":"B4:D9"} | {"page":12} | {"lines":"120-180"} | {"entry":"<catalogEntryId>","section":"columns","from":13}
```

### The data model

House style unchanged: string unions, no Prisma enums, JSONB from birth.

```prisma
model CatalogEntry {
  id            String   @id @default(cuid())
  dataSourceId  String                        // the connection layer's row; see "The one coupling point"
  level         String                        // SOURCE | DATASET | FIELD
  parentId      String?                       // FIELD -> DATASET -> SOURCE; null at SOURCE
  fqn           String                        // "pg://warehouse/public.payroll#net_pay" | "s3://exports/finance/2026/"
  displayName   String
  locator       Json     @default("{}")       // {schema,table} | {schema,table,column} | {prefix} | {prefix,field}
  physicalType  String   @default("")         // "numeric(12,2)" | "text" | "text/csv" | ""
  semanticType  String   @default("UNKNOWN")  // deterministic classifier — see "What a sample IS"
  semanticScore Float    @default(0)
  sensitivity   String   @default("UNKNOWN")  // SHAPE_ONLY | INTERNAL | UNKNOWN — gates exemplars
  profile       Json     @default("{}")       // shape signals only; never a row, never a rare value
  exemplars     Json     @default("[]")       // [] unless the k-anonymity + INTERNAL gate passed
  signature     Json     @default("{}")       // salted MinHash + LSH bands; read by the edge builder ONLY
  provenance    Json     @default("{}")       // {runId, tier, method, exact, sampledRows, sampleKind, at}
  fingerprint   String   @default("")         // sha256 over the STRUCTURAL part — drift detection
  valuesStatus  String   @default("ABSENT")   // ABSENT | PARTIAL | COMPLETE — did tier 2 reach this entry
  note          String   @default("")         // human-authored; a profile run NEVER overwrites this
  noteById      String?
  inferredPurpose String @default("")         // optional model call; a profile run NEVER overwrites this
  inferredBy    String   @default("")         // "" | "mock" | model id
  profileStatus String   @default("PENDING")  // PENDING | PROFILING | PROFILED | PARTIAL | FAILED | DROPPED | UNREADABLE
  profileError  String?
  documentId    String?                       // the rendered card — SOURCE and DATASET only
  firstSeenAt   DateTime @default(now())
  lastSeenAt    DateTime @default(now())
  droppedAt     DateTime?

  @@unique([dataSourceId, fqn])
  @@index([dataSourceId, level])
  @@index([parentId])
  @@index([documentId])
}

model CatalogRun {
  id           String    @id @default(cuid())
  dataSourceId String
  trigger      String                          // CONNECT | SCHEDULED | MANUAL
  tier         String                          // TIER1 | TIER2 | EDGES
  status       String    @default("RUNNING")   // RUNNING | COMPLETE | PARTIAL | FAILED
  cursor       Json      @default("{}")        // resume point: {lastFqn, pass} — a PARTIAL run says where to restart
  stats        Json      @default("{}")        // {datasets, fields, added[], removed[], retyped[], bytesRead, objectsOpened, rowsSampled, pairsCompared, elapsedMs}
  budgetHit    String?                         // WALL_CLOCK | BYTES | OBJECTS | ROWS | PAIRS | STATEMENT_TIMEOUT
  error        String?
  startedAt    DateTime  @default(now())
  finishedAt   DateTime?

  @@index([dataSourceId, startedAt])
}
```

Additive to `Document`: `kind String @default("FILE")` and `catalogEntryId String? @unique`. Additive to `AgentRun`: `retrieval Json @default("{}")` — the ledger (§ *Per-run budgets*). `KnowledgeEdge` gains only new **values** in its existing `kind` string union — no column, no migration.

**Field entries get no `Document`.** A 400-column table would otherwise mint 400 documents and a quadratic edge surface. Fields are `CatalogEntry` rows so they can carry statistics and appear in edge evidence; they are *rendered* as windows of their dataset's `columns` section and cited by `{entry, section, from}`. This is the call §5 already made when it refused chunk-level grants: **document granularity only.**

**Human edits and machine facts never share a column.** `note` and `inferredPurpose` are written by people and by the optional model step; `profile`, `exemplars`, `signature`, `fingerprint` and `valuesStatus` are written by profile runs. A re-crawl overwrites the second set and never touches the first. This is the detail homegrown catalogs most reliably get wrong, and it costs two columns.

### The one coupling point

`CatalogEntry.dataSourceId` is a **plain string with no foreign key until the merge**, and this is deliberate. The connection layer is a parallel design whose item ids do not exist yet; a forward `depends-on` would either dangle in `spec-lint` or block eight items on work this section does not own. So:

```ts
// src/lib/catalog/datasource-contract.ts — the ONLY shared surface.
// The connection layer provides two SQL fragments naming the DataSources a
// principal may read. This module declares their names, their column shape,
// and a fixture implementation used by every offline test in this section.
export const DS_READABLE_BY_HUMAN = "datasource_readable_by_human"; // (dataSourceId, userId)
export const DS_READABLE_BY_AGENT = "datasource_readable_by_agent"; // (dataSourceId, agentId)
```

Every catalog item runs offline against the fixture implementation. The merge that lands both sections adds the FK and swaps the fixture for the real views in one migration, and changes nothing else. If the connection layer instead expresses DataSource grants as a third nullable target on `KbGrant`, the two fragments are still the only thing that changes.

### Entitlement: derived, never mirrored

The first design of this section mirrored the DataSource's grants into `KbGrant` rows on every card. That is wrong and it fails **open**: if the connection layer revokes a grant and forgets to call the mirror, the copied rows persist and the card stays readable — including through `approveDraft`'s send-time re-verification, which would re-check the copy and never the live source grant. Two sources of truth for "may read" is the exact failure §5 exists to prevent.

So catalog entitlement is **derived, in the same CTE, in the same statement**. `src/lib/kb/entitlement.ts` gains one branch on each side and nothing else:

```sql
-- added to human_docs
UNION
SELECT d.id
  FROM "Document" d
  JOIN "CatalogEntry" ce ON ce.id = d."catalogEntryId"
  JOIN datasource_readable_by_human s ON s."dataSourceId" = ce."dataSourceId" AND s."userId" = $1
 WHERE d.kind = 'CATALOG' AND ce."profileStatus" <> 'UNREADABLE'

-- added to agent_docs, identically, against datasource_readable_by_agent and $2
```

Revoking the DataSource makes every one of its cards dark **in the same statement, with no window, no reconciler, no sweep and nothing to forget**. There is no `mirrorDataSourceGrants`, no `KbGrant` row for a card, and no orphan-grant retention problem. The `A ∩ B` chain, the `builtin:` principals, the existence-oracle rule and the RLS floor all apply verbatim, because it is still one fragment.

The pre-committed personal-agent rule inherits for free: when `AgentProfile` gains an owner, *a personal agent's effective set is explicit grants intersected with its owner's own entitlements* is applied once, inside `datasource_readable_by_agent`, and catalog cards follow without a line of change here. `cat-01` ships a placeholder test that fails loudly the day that column lands.

`CatalogEntry` and `CatalogRun` join `kb-15`'s `ENABLE`/`FORCE ROW LEVEL SECURITY` set — six hardened tables, not four — with a policy deriving from the parent Document's entitlement, and the review rule extends verbatim: **a read path over these tables that does not compose the CTE is a review failure.**

### The ACL sequence, step by step

For any federation call, in this exact order. Nothing later in the list can widen anything earlier.

1. **Resolve the chain.** `A = agentPrincipalId(run)`, `B = ticket requester`. `B` unresolvable ⇒ deny. No fallback.
2. **Open the transaction and `SET LOCAL app.human_id / app.agent_id`**, so the RLS floor is armed on the same pooled connection.
3. **Compose the entitlement CTE**, four branches per side including the derived catalog branch, `INTERSECT`ed on the agent chain.
4. **Candidate selection runs inside the CTE** — `JOIN entitled e ON e.id = c."documentId"` in the `FROM` clause, never a post-filter, never a JS stage.
5. **Graph expansion joins `entitled` at every recursive level**, not once at the end. A two-hop path `A → B → C` through an unentitled `B` must not *reach* `C`, because reachability is information about `B`.
6. **Scoring, aggregation and ordering are in the same statement**, downstream of the join. There is no JS scoring stage that could see an unentitled row.
7. **The budget check runs in `execute()`**, against the persisted ledger, before the return string is built.
8. **Non-entitled and non-existent return the identical string** in all four tools, asserted byte-for-byte: `"No such dataset, or you are not entitled to it."`
9. **`query_dataset` re-verifies at execute time, not plan time** — both the DataSource entitlement and the card entitlement, joined by AND, never OR — because a grant can be revoked mid-run. Same construction as `kb-13`'s send-time re-verification.

Absence must not leak either. `find_sources`' footer denominator counts **entitled** datasets, never the total — reporting "3 of 400" when the principal may read 41 turns the footer into an oracle for how many silos exist. `open_dataset(section:"neighbours")` returns only entitled neighbours and never says "2 withheld". `KnowledgeEdge.evidence` is withheld unless **both** endpoints are entitled, per `kb-08`, which matters more here: an edge saying *"`hr.employee.national_id` overlaps `payroll.tax_id` at containment 0.98"* is a disclosure about **two** sources.

**The rendered card carries no cross-source name.** A card's `columns` section may name a declared foreign key **within the same source only** — the principal is entitled to that source by construction, so no new fact is disclosed. Every cross-source neighbour is served exclusively through the live, both-endpoints-filtered `neighbours` query. Freezing an inferred cross-source edge into chunk text at profile time, with the profiler's view rather than the reader's, would defeat the both-endpoints rule with a copy, and `cat-06` asserts that no foreign FQN and no foreign column name appears in any card's chunk text.

### The profile run

Two tiers, and the tier boundary is the point. **Tier 1 costs zero table scans and zero object bodies.** Tier 2 costs a bounded, declared, resumable budget and is the only thing that ever touches data.

Every run opens a `CatalogRun`, writes `CatalogEntry` rows incrementally, and closes `COMPLETE` or `PARTIAL`. A budget breach is `PARTIAL` with `budgetHit` naming the cap and `cursor` naming where to resume — never a `FAILED` run that leaves an operator with nothing and never a run that restarts from the top. Partial is the normal state for a large warehouse on first connect, and the UI says so.

#### Tier 1 — ask the source what it already knows about itself

The single biggest win available, and the one most profilers skip: the database has already profiled itself and keeps the answer in a catalog table.

**PostgreSQL.** `information_schema` / `pg_catalog` for schemas, tables, views, columns, declared types, nullability and defaults; `pg_constraint` for PK, unique and **FK** (a declared FK is not inference, it is a fact, and the strongest edge we will ever get); `pg_class.reltuples` and `relpages` for O(1) row-count and size estimates; `obj_description()` / `col_description()` for existing `COMMENT`s — free, human-authored descriptions, the highest-value metadata in the building, one query; and `pg_stats` for `null_frac`, `avg_width`, `n_distinct`, `most_common_vals` + `most_common_freqs`, `histogram_bounds`, `correlation`.

Four traps written into the module header so nobody rediscovers them:

- **`n_distinct` is signed.** `> 0` is an absolute estimate; `< 0` is the *negated ratio* of distinct rows to total rows, so `-1` means "unique column". Handling only the positive branch produces a catalog that thinks every primary key has one value.
- **`pg_stats` only returns rows for tables the caller can read.** The read-only role the connection layer provisions therefore governs profiling automatically — the catalog cannot see further than the credential it was given, without a line of application code.
- **`pg_stats` is empty until `ANALYZE` has run.** The seeded fixture database must be `ANALYZE`d by the harness or the live-run-matches-fixtures criterion is unfalsifiable.
- **`most_common_vals` is `anyarray` and is not client-typeable.** It must be read as `most_common_vals::text::text[]`; the naive select fails at the driver, not in review.

`most_common_vals` deserves its own line: it is a free, already-computed top-K list, so a low-cardinality enum column can be fully described to a model **without reading a single row** — and it passes the exemplar gate below like any other value.

**SQL Server.** The same shape from `sys.schemas` / `sys.tables` / `sys.columns` / `sys.types`, `sys.foreign_keys` + `sys.foreign_key_columns`, `sys.extended_properties` (`MS_Description`), `sys.dm_db_partition_stats` for row counts without a `COUNT(*)`, and `sys.dm_db_stats_properties` + `sys.dm_db_stats_histogram`. These object names are **not** audited to the same standard as the Postgres ones; `cat-03` ships the SQL Server path as pure mappers over **recorded fixture rows** and does not claim a live-container test. A live probe is a later item and must not be asserted before it exists.

**Object storage.** A delimiter-walk `LIST` builds the prefix tree; per object, key, size, `lastModified`, ETag and a content type **inferred from the extension** (never from a `GET`). Per prefix: object count, total bytes, extension histogram, oldest and newest `lastModified`, depth. Tier 1 issues **zero** `GET`s. A 40-TB bucket is fully tier-1-profiled for the price of its listing.

Tier 1 is a pure function of catalog rows: `mapPgCatalog(rows)`, `mapMssqlCatalog(rows)`, `mapObjectListing(objects)` → `Profile`. Fixtures in, profile out, no network. That is what makes the pass testable without a container.

#### Tier 2 — bounded sampling, resumable, aggregate-only

Tier 2 is opt-in per DataSource (`catalog.sample.enabled`, default **ON for SQL, OFF for object storage** — listing a bucket is cheap, egressing objects out of it is not) and runs under declared budgets: `catalog.budget.wallClockMs` (120 000 per run), `catalog.budget.rowsSampled` (50 000 per dataset), `catalog.budget.objectsOpened` (25 per prefix), `catalog.budget.bytesRead` (100 MB per run), plus per-session `statement_timeout` and `idle_in_transaction_session_timeout`.

**Tier 2 will not finish a real warehouse in one run, and the spec says so rather than pretending.** 400 tables × ~12 columns is ~9,600 statements against a 120-second wall clock — 12.5 ms each including `TABLESAMPLE`. Every real first run ends `PARTIAL`. Two mechanisms make that correct instead of broken:

- **`CatalogRun.cursor` is a resume point.** The next scheduled run restarts at `lastFqn`, so a warehouse converges over a handful of runs instead of re-profiling its first forty tables forever.
- **`valuesStatus` is on the entry and printed on the card.** A dataset tier 2 has not reached says `values: absent` in its overview, so the router down-weights it *legibly* rather than mis-ranking it silently — and because `alt` scores distinct card sections that matched, an entry with no `values` section can win at most two altitudes instead of four. No extra weight is needed; the existing term already does it.

Datasets are admitted to tier 2 in a corpus-aware order — smallest `relpages` first, then never-sampled before re-sampled — so a single 400-column monster cannot consume a run.

**SQL sampling returns aggregates, not rows.** This is the sentence that makes the catalog safe, and it is an implementation rule:

```sql
-- profiling SQL, per column, inside SET TRANSACTION READ ONLY
SELECT count(*)                     AS rows_seen,
       count("net_pay")             AS non_null,
       count(DISTINCT "net_pay")    AS distinct_seen,
       min(length("net_pay"::text)) AS min_len,
       max(length("net_pay"::text)) AS max_len
  FROM "payroll" TABLESAMPLE SYSTEM (1);
```

No row leaves the source. The only query in the entire pass that returns values is the top-K frequency query, and **it applies the k-anonymity floor inside the source**:

```sql
SELECT "status", count(*) AS n
  FROM "payroll" TABLESAMPLE SYSTEM (1)
 GROUP BY "status" HAVING count(*) >= 20      -- catalog.sample.kFloor
 ORDER BY n DESC LIMIT 24;                    -- catalog.sample.topK
```

A value occurring fewer than `k` times **never crosses the wire**, so it cannot be stored, logged, put in an error message, or recovered from a crash dump of the Servo process. Filtering after the fact would be the §5 mistake: a value that transited has already leaked.

**Object sampling opens bytes, and reuses the hardened worker.** For each `(prefix, extension)` group, the profiler selects the `catalog.budget.objectsOpened` objects with the lexicographically smallest `sha256(key)` — deterministic, stable across runs, independent of listing order and of any RNG seed, and it re-selects the same objects next run unless the object set changed, which is what makes drift detection meaningful rather than noise. Selected objects go through `safeFetch` to the **kb-05 forked worker** with its existing entry-count, decompressed-size, wall-clock and heap caps and its XXE mitigation, parsed by **kb-06 `exceljs`** and **kb-07 `unpdf`**. No new parser, no new dependency, no new adopt-first verdict. A crafted object in a customer's bucket is exactly the crafted-file threat kb-05 already closed.

What comes back is **not** the object's text: xlsx → sheet inventory, used-range dimensions and the **header row** (column names are structure), with cell values passing the exemplar gate column-by-column; PDF → page count and the deterministic `kb-08` keyword/entity set, **never page text**, because a card that quoted a page would be a copy of the document stored under different grants; csv/json → header/key inventory and per-field shape signals.

**The sampled bytes are then discarded.** They are never written to `Document.data` (which is NULL for cards by CHECK), never to `DocumentChunk.text`, never persisted. The one thing a naive design does — quietly copying the datalake into Postgres — is a thing this pass structurally cannot do.

Two egress notes, inherited rather than solved: object `GET`s are `safeFetch` calls and carry the DNS-rebinding gap `src/lib/egress.ts:20-23` states, and **presigned URLs carry credentials in the query string, which the guard does not inspect**. Neither is closed here; both are named so the connection layer's allowlist is understood to be the real control.

**Embedding egress.** `catalog.embed.enabled` gates whether card chunks are sent to the configured embeddings endpoint at all, default **ON only when `kb.embed.baseUrl` is empty or loopback**. Stated plainly, next to the field: with a non-local `kb.embed.baseUrl`, the profile of a restricted table — its column names, its domains, its purpose — is sent to a third party. Keyword-only remains the private default and the router works without vectors.

**The manual trigger is an admin action, not a tool.** `CatalogRun.trigger = MANUAL` requires `settings.manage`, accepts **only an existing `dataSourceId`** and never a host or URL, is rate-limited to one run per source per `catalog.manual.minIntervalMinutes` (default 15), and is **absent from the tool registry and from MCP**. Without those four, a caller-chosen id is a 100 MB, 120-second fetch against a stored host with only `safeFetch` behind it — SSRF by DataSource row.

### What a sample IS, and the redaction rules

Nothing in the catalog is "a few rows". The unit of storage is a **signal**, and signals come in three sensitivity classes the classifier assigns before a value is considered for storage.

**The classifier** is a deterministic recogniser registry, Presidio-shaped and rules-only: each recogniser declares a name, a pattern over the *shape* (not the value), context words matched against the column name and its neighbours, and a confidence. Every recogniser runs; highest confidence wins; ties break on recogniser name — a pure function of its inputs, identical on every run. Inputs are the column name, the declared type, the shape statistics and the k-floored top-K list; **never a rare value**, and the function signature enforces it. `validator` (MIT) and `libphonenumber-js` (MIT) supply the predicates. There is no model call and no ML classifier, and this section says plainly that **no credible off-the-shelf semantic-type inference library exists for Node** rather than pretending one was adopted. Declared constraints beat inference: a column with an FK **is** an identifier, no recogniser needed.

| class | meaning | what is stored |
|---|---|---|
| `SHAPE_ONLY` | is or may be identifying or regulated: person name, email, phone, national id, account or card number, address, date of birth, compensation, health, credential, or unclassified free text | shape signals **only** — zero values, zero exemplars, no `min`/`max`, no keywords |
| `INTERNAL` | ordinary business data, not identifying, not public | shape signals + exemplars, subject to the k-floor |
| `UNKNOWN` | the classifier had no opinion | treated as `SHAPE_ONLY`. **Uncertainty denies.** |

`UNKNOWN` defaulting to the strictest class mirrors `isPrivateAddress()` returning `true` for anything unparseable in `egress.ts` — refuse rather than guess.

**Shape signals — always stored, never a value.** Row/value counts; null fraction; distinct count with an **explicit `exact: boolean`** (an estimate from `n_distinct` and a `count(DISTINCT)` over a 1% sample are different facts and are never conflated); unique and distinct kept separate; min/max **length**; a character-class histogram (digits / letters / punctuation / whitespace proportions — cheap in SQL and startlingly discriminative); a **redacted format signature** (`INV-2024-113` → `AAA-NNNN-NNN`, `ana@servo.ai` → `a{3}@a{5}.a{2}`); the declared type, nullability and constraints.

**Exemplars — conditional, doubly gated.** A value is stored only if **both** hold: its field is `INTERNAL` (never `SHAPE_ONLY`, never `UNKNOWN`), and it survived the in-source `HAVING count(*) >= k` floor — i.e. it is a *domain member*, not a *record*. So a `status` column stores `["ACTIVE","SUSPENDED","CLOSED"]`, precisely what a router needs, and a `net_pay` column stores `numeric(12,2), 1 204 distinct, 4–6 digits, semantic type COMPENSATION, 0.2% null`. **A payroll table's card contains no salary.** It contains the fact that salaries live there, which is the fact an agent needs to decide whether to open it.

`min` and `max` are values. They are stored for temporal fields and for `INTERNAL` numerics; for anything `SHAPE_ONLY` only the **order of magnitude** (digit-count range), because `max(net_pay)` is one identifiable person's salary. Free-text fields are never exemplified; they contribute the deterministic `kb-08` keyword set, each token required in at least `k` sampled rows, so a card can say *"mentions: invoice, shipment, backorder"* without carrying anyone's sentence.

**The approval asymmetry, stated rather than discovered.** `query_dataset` is HIGH and pauses for a named human; the profile run that reads the same table is unapproved and scheduled, and its output is then reachable forever through LOW, no-approval `search_knowledge`. That is a real downgrade and it is deliberate, so it is enumerated: **the catalog makes exactly these derived facts readable without approval — shape signals, declared constraints, source-authored `COMMENT`s, k-floored domain members of `INTERNAL` fields, and generated prose over those — and nothing else.** `cat-06` carries a red-team criterion asserting that no unapproved path yields a value only `query_dataset` could return.

**Auto-deliver gains a sixth precondition:** a draft whose `sources` contain any `kind = 'CATALOG'` citation is refused for automatic delivery and stays `PENDING` in the ordinary queue. Catalog text is machine-derived description of a system nobody proofread; it may inform an agent, and a human presses send.

**The residual risk, named rather than pretended away:** `CatalogEntry.signature` is a salted MinHash, i.e. a membership oracle over a field's value set. It is salted from one install-wide secret in the encrypted secret store, so a database copy without the secret is not an oracle, and it is read by the edge builder alone and by no API route. But **an attacker holding both the database and the salt can test guessed values for membership in a `SHAPE_ONLY` column.** That is strictly smaller than reading the source, smaller than what `most_common_vals` gives any reader of the source, and it is written into the risk list rather than found later. The alternative — no signatures — costs the cross-source join detection that is the point of the graph.

### The card

Rendering is a deterministic template: the same profile produces byte-identical text, therefore identical chunks, therefore identical embeddings, therefore stable tests. **Four section kinds, one chunk each** (`columns` and `values` repeat), locator `{entry, section, from?}`:

| section | content | budget |
|---|---|---|
| `overview` | fqn · kind · purpose (source `COMMENT`, then `note`, then `inferredPurpose`) · row/object estimate · bytes · entity list · column-name digest · `values: absent\|partial\|complete` · freshness line | ≤ 1,500 chars, exactly one |
| `columns` | 12 columns per chunk: name, type, nullability, PK/FK (same-source only), semantic type, sensitivity class, null fraction, distinct + exactness, length range, format signature | ≤ 1,200 chars each |
| `values` | k-floored top-K for one low-cardinality `INTERNAL` column; for object storage the key-shape digest and extension histogram | ≤ 800 chars each |
| `freshness` | last run, fingerprint, drift summary, budget outcome, `PARTIAL` cursor position | ≤ 600 chars, exactly one |

There is **no `sample` section and no row card, at any altitude, ever.** An earlier draft specified a 1,500-char "representative rows captured at profile time" chunk; that is a flat repeal of the exemplar gate — a sample of the payroll table is salary data, indexed, embedded and returned by `search_knowledge` at LOW risk with no approval. `cat-06` asserts that no `DocumentChunk` of a `kind = 'CATALOG'` Document contains a value that did not pass `cat-02`'s gate.

**Provenance on every card, always.** Each section's first line carries how it was derived — `profiled 2026-08-27 · catalog stats, 0 rows scanned` or `profiled 2026-08-26 · 1% sample, distinct counts approximate`. A model that can see a number is a 1%-sample estimate does not launder it into a confident assertion; a model that cannot, does. Cheapest anti-poisoning measure available, one line per card.

The fqn and display name are repeated into **every** chunk, mirroring `kb-06`'s header-repetition rule, so a mid-card chunk retrieved alone still says which table it describes. Oversized `columns` sections split by column window with an ordinal, paged by `read_document`'s **existing** cursor vocabulary extended to `{entry, section, from}` — no second cursor vocabulary is invented, per §5's ruling that *RESULT_LIMIT truncation is not a pagination strategy*.

**The optional model call.** `inferredPurpose` is the one place a model genuinely helps — *"this is the monthly payroll register, one row per employee per period"* is not derivable from column names. It is therefore: default **OFF** (`catalog.infer.enabled`); routed through `withUsage` so it lands in `AiUsage` like every other call (kb-04 refused an ingest-time model call precisely because it bypassed that accounting, and this one does not); written only to `inferredPurpose`/`inferredBy`; never overwritten by a re-crawl. Under the mock provider it returns a deterministic string derived from the card, so tests assert plumbing and persistence, never prose. With it off, every acceptance criterion in this section still passes.

### Edges: one vocabulary, explainable, bounded

The graph is the payoff: an agent that opens the payroll table should be one hop from the payroll workbook somebody uploaded, and an agent that finds nothing in the warehouse should see where else to look **without opening anything**.

Edges stay **`KnowledgeEdge`, Document ↔ Document**. Field-level precision lives in `evidence`, not in a second edge table — a `CatalogEdge` between `CatalogEntry` rows would be a second graph read path the entitlement CTE does not cover. The existing `@@unique([fromId, toId, kind])` means each signal gets its own row for a pair, so signals never overwrite each other.

There is **one** edge vocabulary. An earlier pair of drafts had the builder writing `DECLARED_FK / NEAR_DUPLICATE / SHARED_VALUES / NAME_AFFINITY / TEMPORAL_ALIGNMENT` while the router keyed its factors on `FK_PATH / VALUE_OVERLAP / DUPLICATE_OF / SUBSUMES / SAME_SOURCE` — no builder wrote what the router read, and `graph(d)` would have been identically zero. The builder's names win:

| kind | base | multiplier | max | router factor | evidence payload |
|---|---|---|---|---|---|
| `DECLARED_FK` | 1.00 | — (a fact, not an inference) | 1.00 | 0.90 | `{fromField, toField, constraint, onDelete}` |
| `NEAR_DUPLICATE` | 0.90 | `min(containment) × colsetJaccard`, written only when **both** > 0.9 | 0.90 | **penalty** | `{columnsMatched[], containmentAB, containmentBA, colsetJaccard}` |
| `SHARED_VALUES` | 0.85 | `containment(smaller in larger)`, 128-permutation MinHash | 0.85 | 0.80 | `{fromField, toField, jaccard, containmentAB, containmentBA, overlapCount, overlapExamples[]}` |
| `SHARED_ENTITY` | 0.60 | bucketed IDF of the shared entity | 0.60 | 1.00 | `{entities[], idfBucket, foundIn[]}` |
| `NAME_AFFINITY` | 0.35 | Jaro–Winkler on normalized names, written only at ≥ 0.90 | 0.35 | 0.45 | `{fromField, toField, normalizedFrom, normalizedTo, similarity}` |
| `TEMPORAL_ALIGNMENT` | 0.20 | overlap fraction of observed ranges | 0.20 | amplifier only | `{fromRange, toRange, overlapFraction, source}` |
| `SHARED_KEYWORD` | 0.15 | bucketed IDF | 0.15 | 0.50 | `{keywords[], idfBucket}` |

`SAME_COLLECTION` (§5's existing kind) keeps factor 0.40. **`SAME_SOURCE` is a predicate, never a row** — `ce.dataSourceId = seed.dataSourceId`, computed inside the CTE with factor 0.30. Materialising it would make one 400-table source 79,800 edge rows on its own.

Because every weight above is already bounded in `[0,1]`, the router does **no** normalisation. An earlier draft divided by the max weight out of each node, which makes every node's best edge 1.0 and inflates weak neighbourhoods into strong ones.

Six rules keep the graph honest:

1. **`overlapExamples` obeys the exemplar gate.** An overlap between two `SHAPE_ONLY` fields reports `overlapCount` and the column pair, and `overlapExamples: []`. The join is discoverable; the joined values are not.
2. **Dataset-level rollup is `max` over contributing field pairs, never `sum`.** Otherwise a 40-column table with 40 weak name matches outranks a real foreign key, and the graph starts recommending width.
3. **`TEMPORAL_ALIGNMENT` is an amplifier only.** A pair whose *only* edge is temporal is not returned as related — everything that happened in March would otherwise relate to everything else that happened in March.
4. **IDF is bucketed, never raw.** `idfBucket ∈ {common, uncommon, rare}`. A corpus-wide IDF surfaced as a float in `evidence` is an aggregate oracle over documents the reader cannot see.
5. **An edge with an empty evidence payload is a bug and the builder refuses to write it.** Every edge carries a mandatory header `{signal, method, runId, computedAt, sampled, exact}` alongside its signal-specific fields, so *"why do you think these are related"* has an answer that is data. This is what makes the graph explainable rather than a black box, and it is asserted.
6. **The build is banded and budgeted.** 400 datasets × 12 fields is 4,800 fields — ~11.5 M naive MinHash pair comparisons, which is not a vitest tick. Comparison is restricted to **LSH bands**: signatures are split into 16 bands of 8, bucketed by band hash, and only within-bucket pairs are compared. The edge pass runs as its own `CatalogRun` with `tier: EDGES`, a `catalog.budget.pairsCompared` cap (default 250 000) and a `PARTIAL` outcome with a cursor, exactly as tier 2 has. `catalog.edge.minWeight` (0.10) is a post-comparison filter and is not a scaling strategy; banding is.

`NEAR_DUPLICATE` earns its own justification: a catalog *will* contain a table, its view, its staging copy, its mart, and the spreadsheet somebody exported from it. A router that does not know these are the same thing spends its whole budget on five copies of one answer. **It is the one kind whose weight counts against a candidate, not for it.**

### The router: one statement, dataset-level scoring, a total order

`src/lib/kb/route.ts` exports `routeSources(chain, question, opts)`. One SQL statement, entitlement CTE outermost, gate in the `FROM`.

**Step 0 — the deterministic entity gate, before any scoring.** The ticket text runs through the *same* deterministic keyword/entity pass as `kb-08` — no provider call. Each entity is tested against every entitled catalog Document's `keywords` array with one `jsonb_path_ops` GIN lookup. **A dataset with an entity hit outranks every dataset without one, unconditionally** — a *leading sort key*, not a weight, because a weight can be swamped by a strong embedding on an irrelevant table and a sort key cannot.

**Step 1 — content score, per dataset, from its hit chunks.**

```
lex(d) = MAX over hit chunks of ts_rank_cd(c.tsv, q, 32)
vec(d) = MAX over hit chunks of (1 - (c.embedding <=> $q))   -- NULL when no vector
```

`ts_rank_cd`'s normalisation flag **32** is `rank/(rank+1)`, mapping the unbounded rank into `[0,1)` so the weights below mean something; `kb-10` blends the raw rank and can, because it adds nothing to it.

**`MAX`, not `SUM`, and this is a correctness decision.** Summing chunk scores rewards breadth: a 400-column table with 34 `columns` chunks would outscore a perfectly-matched 6-column table on volume alone. A wide table is not a relevant table.

**Step 2 — the blend**, reusing §5's committed constants rather than inventing a competing one:

```
content(d) = 0.5·vec(d) + 0.5·lex(d)               -- identical to kb-10
pre(d)     = content(d)
           + 0.20 · graph(d)
           + 0.05 · min(alt(d), 3)                 -- distinct card sections with content >= 0.15
```

There is no `cost` term. `log10(1+rows)/10 × 0.10` spans about 0.04 across every realistic table size, is swamped by `alt`, and `estimated_rows ASC` is already the tie-breaker in the `ORDER BY` — a weight that cannot change an outcome is a weight that hides a bug.

**Step 3 — the duplicate pass, second, because it cannot be first.** `dup` was specified as a term *of* `score` while also firing "only when the other endpoint already ranks higher" — the ranking it depends on is the ranking it changes. So it is a second pass over the `pre` ordering: `score(d) = pre(d) − 0.50` where a `NEAR_DUPLICATE` peer has a strictly higher `pre`, ties broken on id. One window function, no circularity.

**Step 4 — the order, and it is total.**

```sql
ORDER BY entity_hit DESC NULLS LAST,
         score DESC,
         estimated_rows ASC,
         d."createdAt" ASC,
         d.id ASC
```

It ends on a primary key, so the ranking is a **total order** — which is what lets `fed-06` assert an exact ranked id list twice across a database rebuild rather than asserting a set and hoping. Fixtures seed **literal primary keys** (`ds_7f3`, `ds_2a1`, `ds_9c4`); `@default(cuid())` ids are not stable across a drop-and-rebuild and the assertion would fail on day one.

**Vector-absent behaviour.** `vec` is `NULL` when no embedder is configured or `embeddingModel` differs, exactly as `kb-09`/`kb-10` specify; `content` degrades to `0.5·lex`, the entity gate still fires, the graph term is unaffected because edge weights are deterministic. **The router works on keyword-only installs.** That is a normal state, not a failure.

### Graph-guided hopping

`graph(d)` is one recursive CTE over `KnowledgeEdge`, depth ≤ 2 **capped by the CTE, not a JS slice**, seeded by the union of: the top-k content matches, the datasets already accepted this run, and — critically — **the datasets already rejected this run**.

Expanding from a *rejected* node is the owner's scenario stated precisely. Rejection is not irrelevance of the neighbourhood: the agent looked in the HR database and the pay period wasn't there; the payroll database one `SHARED_ENTITY` hop away is now the best candidate in the corpus, and it got there because the wrong answer pointed at it.

```
graph(d) = MAX over seeds s of  0.6^hop(s,d) · weight(edge) · kindFactor(edge.kind)
```

**The entitled join lives inside the recursive term.** Applied to the finished path set, a two-hop path `A → B → C` through an unentitled `B` still reaches `C`, and reachability is information about `B`. The join is repeated at every level: **if the middle node is not entitled, the path does not exist.** A comment above the join says so, and `fed-02`'s red-team test fails when it is moved — the same construction `kb-10` uses.

**Termination — three exits, all explicit.**

1. **Found enough.** The model stops emitting federation calls. The router gives it a cheap stopping signal rather than making it guess: a candidate with an entity hit **and** `content ≥ 0.55` is marked `STRONG` in its brief.
2. **Budget exhausted.** Any budget hit returns the terminal string below. Never an exception, never a silent truncation.
3. **Nothing left.** Candidates minus visited is empty → `"No further related sources. Examined 3: ds_7f3 (no pay-period column), ds_2a1 (2019 archive only), ds_9c4 (marketing images)."` A model handed an empty result with no explanation confabulates over it; a model told what was examined and why does not.

### The tool surface

One module, `src/lib/ai/tools/federation.ts`. **Four tools**, deliberately non-overlapping — *if a human engineer can't definitively say which tool should be used, an AI agent can't be expected to do better*. Which source → what's in it → not this one → actually read it. Every definition carries **two worked example invocations**; that is the cheapest measured win available (72% → 90% on complex parameter handling) and it costs four hundred characters of static text.

| Tool | Answers | Return budget | Touches the silo? | Risk | Approval |
|---|---|---|---|---|---|
| `find_sources(question, from?)` | *which* sources might hold this | **1,200 chars**, ≤ 4 briefs | no | LOW | no |
| `open_dataset(id, section?, cursor?)` | *what is in* one source | **1,500 chars/call, 3,000/dataset/run** | no | LOW | no |
| `discard_source(id, reason, scope)` | *not this one — what's next* | **900 chars** | no | LOW | no |
| `query_dataset(id, …)` | the actual data | **2,000 chars** | **yes** | HIGH | **yes** |

**`RESULT_LIMIT` is not a backstop here, and the spec must not claim it is.** `RESULT_LIMIT = 4000` lives at `src/lib/ai/tools/types.ts:27` and is applied *ad hoc* by four tools (`history.ts:64`, `ops-db.ts:51`, `skills.ts:53`, `web.ts:79`); `engine.ts:592-599` appends the tool string verbatim. There is nothing at the engine boundary to spy on. `fed-04` therefore **adds** `capToolResult(name, result)` at **both** execute sites — `engine.ts:584` and the resume-path duplicate at `engine.ts:655` — and that is also where the ledger's character charge is taken. A cap applied at one site is not applied.

#### `find_sources` — ranked briefs, never schema

```
find_sources({question: "which pay period does employee 4471's bonus fall in?"})

[ds_7f3] payroll.employee_pay · postgres/hr-prod · ~48k rows · values: complete
  · pay period, employee id, gross, net, bonus · matched EMP_ID · 0.71 STRONG
[ds_2a1] s3://payroll-exports/2026/ · 214 objects, 31 MB, .csv · values: partial
  · pay period, employee, net · matched EMP_ID · 0.58
[ds_9c4] hr.employee · postgres/hr-prod · ~5k rows · employee id, name, start date · 0.31
— 3 of 41 entitled datasets shown; 38 scored below 0.20 and were omitted.
  Probe one with open_dataset(id). Budget: 0/8 probed, 0/24000 chars.
```

The footer does three jobs: it prevents confabulation over a weak result set, it makes the budget visible without a prompt instruction, and **its denominator is the count of entitled datasets, never the total**. `find_sources` returns **ids and briefs only** — it reads `Document.summary` and nothing else, so it is structurally incapable of returning a column list, a type or a row.

#### `open_dataset` — the probe, at one altitude, from the catalog

`section ∈ overview | columns | values | freshness | neighbours`, default `overview`. **It reads the catalog Document. It opens no connection, issues no query, produces no egress** — asserted with a connection-factory spy showing zero calls, not with an unresolvable hostname, because DNS behaviour is environment-dependent and this file is 127.0.0.1-only. "Opening" a 400-table warehouse to decide against it costs one catalog read.

`columns` and `values` paginate with `{entry, section, from}` and the result names the next cursor. `neighbours` returns up to 5 entitled graph neighbours as briefs with edge kind and weight — this is how an agent that has *accepted* a source finds the join partner it also needs; a router that returns two tables with no path between them has returned nothing useful.

**Per-dataset ceiling.** `MAX_CHARS_PER_DATASET = 3000` and `MAX_PAGES_PER_DATASET = 3`, both counted in the ledger. Without them, `MAX_SOURCES_PROBED` counts *distinct ids* and an agent can page one 400-column dataset 34 times for ~40 KB, bounded only by the global budget — which makes the headline number false. `fed-06` includes an adversarial mock that pages every cursor on every candidate and still cannot exceed either cap.

#### `discard_source` — discard and hop in one call, at two scopes

```
discard_source({id: "ds_9c4", reason: "no pay-period or bonus column", scope: "dataset"})

Discarded ds_9c4. Next candidates:
[ds_7f3] payroll.employee_pay · ~48k rows · SHARED_ENTITY(EMP_ID) from ds_9c4, w 0.88 · 0.74
[ds_2a1] s3://payroll-exports/2026/ · 214 .csv · DECLARED_FK via employee_id · 0.61
Budget: 2/8 probed, 3,140/24,000 chars, 1/4 hops.
```

**`scope: "source"` is not optional sugar — without it the headline scenario is inexpressible.** One Document is minted per *dataset*, so rejecting a 400-table warehouse dataset-by-dataset would take ~100 calls against `MAX_FIND_CALLS = 6`. A source-scoped discard is backed by the `level: SOURCE` card, marks the whole `dataSourceId` visited, and suppresses every one of its datasets from every later `find_sources` in the run.

**Discard *and* hop in one tool call, forced by the substrate.** `MAX_ITERATIONS = 12` counts provider turns and overrunning it **throws** (`engine.ts:603`). A design where rejecting costs one turn and re-searching costs another burns the run's ceiling in six rejections. Fusing them halves it. `discard_source` also writes the reason into the ledger and echoes it in every later footer, so the model does not re-probe.

#### `query_dataset` — HIGH, approval-gated, rarely on the path

The only tool that reaches the silo. `HIGH / requiresApproval: true / enabled: true` in `DEFAULT_TOOL_POLICIES`, matching `execute_ops_sql` and satisfying the quarantine triple. It looks expensive until you notice it is almost never needed: for a source in **INDEX** mode the content is already ingested as ordinary `DocumentChunk` rows under the ordinary ACL, reached with `search_knowledge` at LOW. `query_dataset` exists for **FEDERATE** mode, where the data was deliberately never copied. So *routing across forty silos costs zero approvals; reading a customer's live database costs one, from a named human.* That is Servo's thesis, not a compromise with it.

Bounds enforced in `execute()`, before serialisation, independent of any prompt: ≤ 20 rows, ≤ 8 columns, ≤ 2,000 result characters, 2-second `statement_timeout`, `BEGIN … SET TRANSACTION READ ONLY` on the read-only role. The `LIMIT` is **injected into the statement**, so a `SELECT * FROM devices` never leaves the database — unlike `ops-db.ts:51`, which materialises the whole result set in Node and then cuts to 4000 characters. Object reads: ≤ 3 objects, ≤ 8 KB of head bytes each, every URL through `safeFetch`/`checkEgress` including every redirect, with the guard's two documented holes **inherited, not solved**.

**Amendment to `kb-11`:** `search_knowledge` gains one optional `dataset` argument adding `AND c."documentId" IN (dataset ∪ its same-source siblings)` **inside** the existing entitled statement — one clause in one query, not a new read path. And it is **charged to the federation ledger** whenever `dataset` is set or any returned chunk belongs to a `kind = 'CATALOG'` Document; otherwise it is an uncharged path to the same catalog chunks and one amendment sentence undoes this section's central enforcement claim.

**Not exposed over MCP in v1**, for `kb-11`'s reason exactly: `src/lib/mcp.ts` authenticates one shared bearer token with no user identity, so there is no human principal and the `A ∩ B` chain has no `A`. All four are absent from the registry and the route returns the per-user-token message.

### Per-run budgets, enforced in the tool layer

**A prompt is advisory; a tool is not.** Every number below is checked inside `execute()` against persisted state, and no prompt edit, system-prompt injection or ticket text can raise any of them.

**The ledger** is `AgentRun.retrieval Json @default("{}")` — one additive, defaulted column holding `{probed:[], opened:[], discarded:[{id,reason,scope}], perDataset:{id:{chars,pages}}, chars:0, hops:0, finds:0, compacted:[]}`. Persisted, not in-memory, because `resumeAfterApproval` rebuilds the loop context from the database and an in-memory ledger resets to zero the moment a `query_dataset` approval pauses the run — precisely when it must not.

| Budget | Value | Counts |
|---|---|---|
| `MAX_FIND_CALLS` | 6 | `find_sources` + `discard_source` invocations |
| `MAX_SOURCES_PROBED` | 8 | distinct ids passed to `open_dataset` |
| `MAX_DATASETS_OPENED` | 3 | distinct ids reaching `query_dataset` |
| `MAX_HOPS` | 4 | graph expansions |
| `MAX_CHARS_PER_DATASET` | **3,000** | every character any tool returned about one dataset |
| `MAX_PAGES_PER_DATASET` | 3 | cursor pages of `columns`/`values` for one dataset |
| `FED_CONTEXT_BUDGET` | **24,000 characters** | every character every federation tool returned this run |

**Characters, not tokens, and the spec says why.** Token counting needs a tokenizer matching the configured provider; the mock provider has none, and a budget that cannot be asserted offline is not a budget. Characters are deterministic, provider-independent and assertable. 24,000 characters ≈ 6,000 tokens — about 40% of one `github_read_file` return (`FILE_READ_LIMIT = 60_000`), today's unbudgeted worst case and the honest baseline.

**The ledger is monotone: compaction never refunds.** If rewriting a transcript gave characters back, `probe → discard → compact → probe` would loop unboundedly through a fixed budget. Compaction is a **context-window** measure, not a **budget** measure, and the two numbers deliberately diverge after it runs.

**When a return would exceed the remaining budget, the tool downgrades altitude — it does not truncate.** Compute the budget *before* building the string; if the full return does not fit, return the next altitude down (`columns` → `overview` → brief) plus the cursor and a line naming what was withheld; if not even the brief fits, refuse. Never a mid-sentence cut. §5 already ruled that pretending the cap is the answer *would produce a tool that silently truncates the middle of a policy*; the same reasoning forbids truncating a column list, because a half-read column list is worse than none — the model will reason confidently over the columns it saw.

**The refusal is terminal, actionable, carries the residue, and never throws:**

```
Retrieval budget spent: 8/8 sources probed, 21,400/24,000 characters admitted.
No further sources may be opened this run.
Examined: ds_9c4 (no pay-period column), ds_2a1 (2019 archive only),
          ds_4b8 (marketing images, no employee data).
Answer from what you have, or escalate to a human with what is missing.
```

### The discard step, honestly

**Prior tool results cannot be unsaid.** A transformer conversation is append-only; the provider re-reads every message every turn. Nothing here "clears the context" in the sense of making the model not have seen something. Three mechanisms, in strict order of importance:

**1. Prevention — this is the mechanism; the other two are damage control.** No federation tool can return a schema dump or a row. `find_sources` reads only `Document.summary`. `open_dataset` reads only cards, at one altitude, bounded per call *and* per dataset. The worst case for a rejected source is ≤ 1,720 characters at overview altitude and ≤ 3,000 under any paging pattern, bounded by construction rather than by a cap applied afterwards.

**2. Rewrite in place, not erase — and it is not free.** `ctx.messages` is Servo's own array, rebuilt from `AgentRun.conversation` on every resume, so the engine *can* replace the `content` of an earlier `tool_result` block, keeping its `tool_use_id` so the conversation stays structurally valid. Replacement text, ≤ 120 characters: `Examined ds_9c4 (hr.employee). Not relevant: no pay-period column. Full result discarded.` Two rules govern it. **Restorability:** the replacement names the handle, so `open_dataset("ds_9c4")` re-fetches everything removed — nothing is compacted that cannot be re-fetched by a handle named in the replacement. Lossy for the model, lossless for the system. **KV-cache cost:** rewriting a message invalidates the provider's cached prefix from that point, so compaction runs only when `discard_source` fires **and** admitted characters exceed **60% of `FED_CONTEXT_BUDGET`** (14,400), at most once per dataset per run.

**3. The audit trail is not compacted.** `AgentStep` rows keep the original tool result verbatim; only `ctx.messages` / `AgentRun.conversation` is rewritten. The human reviewing the run sees exactly what the agent saw; the agent's next turn does not. In a control plane that is the point, not a detail. **It is also an accepted residual**: `AgentStep.content` is a second, ungated copy of card-derived text, and anyone who can view the run reads it. It is named in the risk list, and the run viewer is gated on the same entitlement chain rather than on `tickets.view` alone.

**The graceful last turn.** `MAX_ITERATIONS = 12` currently *throws* (`engine.ts:603`), turning "I hopped four times and found nothing" into a `FAILED` run. At `iteration === MAX_ITERATIONS - 1` the loop calls the provider once more with `tools: []`, so the model must emit text and the run `COMPLETED`s with a summary. Budget exhaustion should produce an answer that says what was searched, not a stack trace.

### Freshness, drift and revocation

**Fingerprint.** `sha256` over the *structural* part only: level, fqn, the ordered column list with types and nullability, PK/FK constraints; for object storage the prefix, the extension histogram and the object count bucketed to a power of two. Counts, statistics, timestamps and sample outcomes excluded, so an unchanged table re-profiles to a byte-identical fingerprint and a jittery `reltuples` never triggers a re-render.

**Cadence.** Cheap thing often, expensive thing rarely. Tier 1 re-runs per DataSource every `catalog.reprofile.hours` (24) and on demand. Tier 2 re-runs only when the tier-1 fingerprint changed, or when `catalog.resample.days` (30) elapsed, or when a `PARTIAL` cursor remains. A stable, fully-profiled warehouse costs one catalog read per day and touches no data for a month.

**Drift.** A changed fingerprint re-renders, re-chunks, re-embeds and recomputes that entry's edges through the **same** pipeline `kb-04` runs on re-upload — reused, not forked. The diff (`added` / `removed` / `retyped`) lands in `CatalogRun.stats`; a run already is the timeseries record, so there is no drift table.

**Two kinds of disappearance, and conflating them is a leak.** The section already notes that `pg_stats` only returns readable tables — so a `REVOKE SELECT` presents to the profiler as absence. Treating that as a table drop would keep serving the card for 90 days.

- **`DROPPED`** — absent from `pg_class` as well: the object is gone. The `CatalogEntry` row is **kept** (a dropped-then-restored table keeps its id, its human `note` and its `inferredPurpose`; deleting on absence makes a failed listing indistinguishable from a `DROP TABLE`). Its `DocumentChunk` rows are **deleted**, so the card vanishes from keyword and vector search **with no change whatsoever to the retrieval statement** — no `WHERE dropped = false` to forget. `read_document` still resolves and returns the card with a dated *"this dataset no longer exists as of …"* header, which is the honest answer to an agent following a stale citation. Edges are **suspended, not deleted**: `weight = 0`, `evidence` retained, and every read filters `weight > 0`. A live edge into a dead node is a trap; deleting it destroys the record that the relationship existed.
- **`UNREADABLE`** — present in `pg_class`, gone from `information_schema`/`pg_stats`: access was withdrawn. Chunks **and** `exemplars` **and** `signature` are deleted immediately, the entitlement CTE excludes `UNREADABLE` outright, and `read_document` returns the identity line plus *"access to this dataset was withdrawn on `<date>`"* and nothing else. Search-invisible is not read-invisible, and the columns, statistics and domain members of a now-forbidden table must not stay fetchable by handle.

**Retention.** After `catalog.dropped.retainDays` (90) the entry, its `Document`, its chunks and its edges are hard-deleted in one transaction. There are no mirrored grants to sweep — entitlement is derived — which is one whole class of orphan bug this design does not have.

**Revocation.** Revoking or deleting the DataSource is instantaneous through the CTE. Deleting the row additionally removes every entry, card, chunk and edge in one transaction; a partial failure rolls back and leaves the catalog readable exactly as before.

### Determinism and offline testing

Nothing in the profile pass calls a model. Everything is a pure function of catalog rows, listings and aggregate results.

- **Pure, fixture-tested, no container:** `mapPgCatalog`, `mapMssqlCatalog`, `mapObjectListing`, the classifier registry, the exemplar gate, the fingerprint, the card renderer, the edge builder, the LSH bander. Fixtures under `tests/fixtures/catalog/`.
- **Silo A (SQL):** a second database `servo_catalog_src` on the **existing** `pgvector/pgvector:pg17` container on port 5433, created by the harness the way `db-05` creates the ops sandbox, seeded with 400 generated tables of which three are payroll-shaped, plus a fixture schema carrying an FK, a low-cardinality enum, a `COMMENT` and a column whose `n_distinct` is negative — and **`ANALYZE`d**, or `pg_stats` is empty and the live-run criterion cannot pass. No `docker-compose.yml` diff, no new container.
- **Silo B (object storage):** an **in-process HTTP fixture server** implementing the handful of `GET`/`LIST` operations the connector uses, bound to 127.0.0.1 on an ephemeral port, torn down with the test. §11 already permits local fixture servers. MinIO is **not** used: it is AGPL-3.0 server-side, and shipping it in a repo compose file is a distribution question the loop must not settle alone. If real SigV4 verification is ever needed, `adobe/S3Mock` and `gaul/s3proxy` (both Apache-2.0) are the candidates for the adopt-first gate — the connection layer's call, not this one's.
- **SQL Server is fixture-only in v1**, and the spec says so rather than implying a live test that does not exist.
- **The mock provider is extended, and that is in scope.** `src/lib/ai/mock.ts:89-90` dedupes script steps **by tool name** (`script.find((step) => !used.has(step.name))`), so the second `open_dataset` in `find → open → discard → open → answer` would never fire; and `complete` returns exactly one `toolCall` per turn, so a parallel-call assertion is unrunnable. `fed-04` changes step identity from `name` to a per-step key and allows multi-call turns — and notes that both touch every existing mock-driven test.
- **The arc is budgeted against `MAX_ITERATIONS = 12`.** Five federation steps plus the existing default script is close to the ceiling, which is why the graceful last turn (`fed-05`) lands **before** the end-to-end (`fed-06`).

The measurable assertions:

| Assertion | Where |
|---|---|
| 400-table reject-and-hop run admits **< 4,000 characters** total; `probed === 2`; `opened === 0` | fed-06 |
| No dataset exceeds **3,000 characters** or **3 pages** under an adversarial paging mock | fed-06 |
| Same fixture + same question ⇒ **byte-identical ranked id list**, twice, across a database drop and rebuild | fed-01, fed-06 |
| `find_sources`' denominator equals the entitled count, not the total | fed-01 |
| Red team: agent entitled to `{A,C}`, requester to `{A,B}`, edges `A→B→C`. `C` unreachable; `B`'s id, name and evidence appear in **no** tool result, **no** `AgentStep.content`, **no** `AgentRun.conversation`. Deleting the in-recursion entitled join fails it | fed-02 |
| Budget refusal fires at the tool: a system prompt saying budgets do not apply, plus a mock requesting 20 probes, still stops at 8 | fed-03 |
| Compaction: replacement line in `conversation`, original card text in `AgentStep.content`, neither in the other | fed-05 |
| Routing **recall@3 ≥ 0.9 and recall@1 ≥ 0.7** over a hard-negative eval set | fed-06 |

That last one is a real metric only if it is hard. Generating each question from a card's own purpose sentence plus two of its own column names makes lexical retrieval win by construction — the score would read ~1.0 whether or not `graph`, `alt` and `dup` are weighted correctly, which is exactly the regression it claims to catch. So the set is built with **hard negatives** (three payroll-shaped tables; a table, its view and its CSV export) and a fixed synonym-substitution pass so questions do not reuse card tokens. Still deterministic, still no provider call, still regenerated free when the fixtures change.

### Claims discipline

Until `fed-04` merges, no user-visible surface may say Servo searches connected data sources, routes between silos, or catalogs a database. Until `fed-06` merges, no surface may quote a context-saving number. When they land, the honest claim is bounded and is written bounded: *"Servo profiles a connected source into a catalog entry and routes an agent to the right one before opening it — self-hosted, on your infrastructure."* No hosted offering exists and nothing here may imply one.

### Limits — what this does not do, and what breaks when

**A polluted transcript can be compacted, but not unsaid.** This is the honest ceiling of the whole design. Compaction rewrites Servo's own message array; it cannot reach into a provider's attention over turns already taken, and it costs a KV-cache invalidation every time it runs. Prevention is the mechanism. If a federation tool ever returns a schema dump, everything downstream is damage control.

**The catalog is a description, and descriptions go stale.** A 24-hour tier-1 cadence means a table added at 09:00 is invisible until the next run. An agent can be routed confidently to a card whose source changed an hour ago. The fingerprint, the dated drop header and the per-card provenance line make staleness legible; they do not make it not happen.

**Tier 2 does not finish, and cards without `values` route worse.** A large warehouse converges over several runs. Until it does, value-level questions ("orders from ACME") cannot be routed by cards whose `values` sections do not exist yet, because the value simply is not indexed. The card says `values: absent` so this is visible rather than mysterious, but it is a real gap and no weight fixes it.

**Edge building is the scaling wall.** LSH banding turns ~11.5 M pairs into a bounded within-bucket comparison, but banding trades recall for cost: a genuine join whose signatures never share a band is never discovered. The budget makes the run finite; it does not make the graph complete.

**The router is not a query planner.** It ranks sources and closes join paths one hop at a time. It does not decompose a question across three silos, does not federate a join, and does not know that the answer requires two sources until the agent asks for neighbours. Multi-source synthesis is the agent's job, under the same budget.

**Semantic classification is rules, not intelligence.** A column named `col_47` holding national ids with an unusual format will classify `UNKNOWN`, which denies — safely, but it also means no exemplars, no keywords and a weaker card. Recall of the sensitivity classifier is not measured and is not claimed.

**Scale.** The comfortable envelope is the one §5 states — tens of thousands of documents, low millions of chunks — with catalog cards counted in it: 400 datasets is roughly 400 cards and perhaps 15,000 chunks, which is nothing. What bites first, in order: (1) the edge build, at a few thousand datasets, where banding parameters become a tuning problem; (2) tier-2 convergence time on a warehouse with tens of thousands of tables, where the cursor never catches up to the 24-hour drift cadence; (3) HNSW index memory, unchanged from §5.

**Not done here, deliberately:** column-level lineage, query-history mining for join affinities, CRUSH4SQL-style hallucinated-schema query expansion, an LLM re-ranker over briefs, cross-source `NEAR_DUPLICATE` merge into a single canonical entry, and OCR for scanned objects. Each is a roadmap line, not an omission.
