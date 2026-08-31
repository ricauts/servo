<!-- Design rationale extracted from spec.md. spec.md remains the work order:
     the backlog, the tick protocol and the claims ledger live there. -->

# Company knowledge base

Servo grows a place where the company's own documents live: the accounting workbook, the PDF product manual, the onboarding note. They are chunked, keyworded, linked into a small knowledge graph, and — when an embedding endpoint is configured — vectorized, with every chunk carrying a pointer back to the exact sheet-and-range or page it came from. When an agent answers, it answers from evidence and cites it: *"per Pricing.xlsx, sheet `2026`, cells B4:D9"*. This is the substrate the "AI control plane" positioning keeps pointing at.

This area lands **after** `db-01` (Postgres) and `db-08` (the pgvector/RLS platform smoke test). Every storage decision below is a Postgres decision; the SQLite-era design that preceded it (`sqlite-vec`, FTS5, Float32 blobs, JS cosine) is replaced outright, and the caveats it carried are dropped — see *Scale honesty*, which says exactly which ones and why.

### The access-control invariant

Access control is not a feature of this area. It is the area.

> **Retrieval is entitlement-filtered in SQL, before candidate selection, before vector scoring, before anything is formatted into a tool result or a prompt. A chunk the principal chain may not read never enters model context, so it can never leak into an answer, a draft, a log, or a webhook.**

Post-filtering is forbidden. A chunk that transited the context has already leaked, and no amount of filtering afterwards un-leaks it.

The first review of this area scored 5/10 because the main door was sound and every window was open. Those windows are closed here, each by a named mechanism, and each with an acceptance criterion that fails if the mechanism is removed:

| Leak | Closed by |
|---|---|
| Related-files / graph panel read the corpus unfiltered, leaking a non-entitled document's existence, title and the shared entity in `KnowledgeEdge.evidence` | Both edge endpoints go through the same entitlement CTE; `evidence` is withheld unless **both** nodes are entitled (kb-08) |
| Human-approved sends were never re-verified — a grant revoked between draft and approval still shipped | Re-verification moved **into `approveDraft`**, so every send re-checks, human or automatic (kb-13) |
| Off-ticket / MCP use had no requester principal and fell back to agent ∩ ORG | No fallback exists. An unresolvable human principal **denies**. KB tools are not exposed over MCP in v1 at all (kb-11) |
| `visibility: ORG` meant "every authenticated human", and `inbound-email.ts:171` mints a `REQUESTER` for every external sender who ever emailed the desk | `ORG` is deleted. `PRIVATE \| STAFF \| PUBLIC`; `STAFF` resolves against `role IN ('ADMIN','AGENT')` and can never include an auto-provisioned requester (kb-02) |
| Existence oracle: `read_document` distinguished 403 from 404; `list_collections` returned corpus-wide document counts | Non-entitled and non-existent return the identical string; counts are counts of **entitled** documents, and a collection with zero entitled documents is not listed (kb-11) |
| Auto-deliver trusted `ReplyDraft.sources` to be complete, but nothing stopped the body quoting un-logged KB text | Provenance is by construction: the drafter has no tool loop, its KB context is a deterministic pre-retrieval step, and `sources` **is** the injected set (kb-12) |
| Crafted files: xlsx is a zip (bomb, XXE), PDF parsers crash and hang; only stored bytes were capped | Extraction runs in a forked worker with entry-count, decompressed-size, wall-clock and heap caps and XML external entities disabled; failure is `FAILED`, never a dead container (kb-05) |
| `@@unique([documentId, collectionId, subjectType, subjectId])` never deduped — one column is always NULL and Postgres, like SQLite, treats NULLs as distinct | Two **partial unique indexes** plus a `CHECK (num_nonnulls(...) = 1)`, both hand-written in the migration (kb-01) |
| Query text leaves the container when embeddings are on | Stated in *Embeddings*, with keyword-only as the shipped default and a local `baseUrl` as the private-with-vectors mode |

### Principal chains

Two shapes, and only two.

**Agent chain** — every tool call and the drafter. `A` = the agent principal, `B` = the human the answer flows to. Effective set = **A ∩ B**. `B` is the ticket requester, resolved the way `currentTicket()` does in `src/lib/ai/tools/history.ts:73`. If `B` cannot be resolved, the call is denied.

`A` needs a definition that survives profile-less runs, which the first review caught: `AgentRun.profileId` is nullable and is null for TRIAGE and default resolver runs (`prisma/schema.prisma:133`, `src/lib/ai/engine.ts:450`). So:

```ts
// src/lib/kb/principals.ts — the only place an agent principal is derived.
agentPrincipalId(run)   // run.profileId ?? "builtin:resolver"
draftPrincipalId(prof)  // prof?.id      ?? "builtin:drafter"
```

`builtin:` is a reserved prefix that can never collide with a `cuid()`, and both builtin principals appear as named rows in every share panel. `ToolContext` (`src/lib/ai/tools/types.ts:13-17`) gains `principals: { agentId: string; humanId: string | null }`, populated by `buildLoopContext` in the engine.

**Agents get nothing implicitly.** No ownership, no `STAFF`, no `PUBLIC`. An agent reads only what a `subjectType: AGENT` grant gives it. This is deliberately strict, so the Knowledge UI shows an explicit "no agent can read this yet" empty state on every document with no agent grant, and offers a one-click grant to the builtin resolver.

**Human chain** — a person browsing the Knowledge area. Only `B`; no agent, therefore no intersection. Same resolver, one argument.

**Personal agents do not exist in v1.** `AgentProfile` has no owner column, so every `subjectType: AGENT` grant today targets a company agent. The rule for when the identity area adds them is pre-committed here so it cannot be got wrong later: *a personal agent's effective set is explicit grants **intersected with its owner's own entitlements**, always* — an agent grant must never outlive its owner's access to the same document.

### Data model

House style: string unions, no Prisma enums (per the schema header after `db-01`). New models, so they are born on Postgres and may use `Json`/JSONB from birth, as the database section grants.

```prisma
model Document {
  id           String   @id @default(cuid())
  name         String
  contentType  String                       // application/pdf | xlsx mime | text/markdown | text/plain
  byteSize     Int
  sha256       String                       // dedupe + "this file changed" detection
  data         Bytes                        // bytea; never selected outside the download route
  textStatus   String   @default("PENDING") // PENDING | EXTRACTING | EXTRACTED | FAILED | UNSUPPORTED
  textError    String?
  summary      String   @default("")        // deterministic extract — no model call at ingest
  keywords     Json     @default("[]")      // string[]
  ownerId      String
  owner        User     @relation(fields: [ownerId], references: [id])
  collectionId String?
  collection   Collection? @relation(fields: [collectionId], references: [id])
  visibility   String   @default("PRIVATE") // PRIVATE | STAFF | PUBLIC
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  chunks   DocumentChunk[]
  edgesOut KnowledgeEdge[] @relation("edgeFrom")
  edgesIn  KnowledgeEdge[] @relation("edgeTo")
}

model DocumentChunk {
  id             String   @id @default(cuid())
  documentId     String
  document       Document @relation(fields: [documentId], references: [id], onDelete: Cascade)
  index          Int
  text           String
  locator        Json                        // {"sheet":"2026","range":"B4:D9"} | {"page":12} | {"lines":"120-180"}
  keywords       Json     @default("[]")
  // pgvector. Nullable so `prisma db push` accepts an Unsupported type, and so
  // keyword-only installs are a normal state rather than a failure.
  embedding      Unsupported("vector(1536)")?
  embeddingModel String   @default("")       // "" = none, "mock" = deterministic mock embedder
  embeddingDims  Int      @default(0)        // native dimension before zero-padding
  createdAt      DateTime @default(now())

  @@unique([documentId, index])
  @@index([documentId])
}

model Collection {
  id          String   @id @default(cuid())
  name        String   @unique
  description String   @default("")
  createdAt   DateTime @default(now())
  documents   Document[]
}

model KnowledgeEdge {
  id        String   @id @default(cuid())
  fromId    String
  from      Document @relation("edgeFrom", fields: [fromId], references: [id], onDelete: Cascade)
  toId      String
  to        Document @relation("edgeTo",   fields: [toId],   references: [id], onDelete: Cascade)
  kind      String                          // SHARED_ENTITY | SHARED_KEYWORD | SAME_COLLECTION
  weight    Float    @default(0)
  evidence  Json     @default("[]")         // the shared entities/keywords — withheld unless both nodes entitled
  createdAt DateTime @default(now())

  @@unique([fromId, toId, kind])
}

// One grant of `access` on one target to one subject. Nullable FKs keep
// referential integrity; the real uniqueness and the exactly-one rule are
// partial indexes and a CHECK in the migration — Prisma cannot express either.
model KbGrant {
  id           String      @id @default(cuid())
  documentId   String?
  document     Document?   @relation(fields: [documentId],   references: [id], onDelete: Cascade)
  collectionId String?
  collection   Collection? @relation(fields: [collectionId], references: [id], onDelete: Cascade)
  subjectType  String                        // USER | GROUP | AGENT
  subjectId    String                        // User.id | Group.id | AgentProfile.id | "builtin:*"
  access       String      @default("READ")  // READ | MANAGE
  grantedById  String
  createdAt    DateTime    @default(now())
}
```

Additive on `ReplyDraft`: `sources Json @default("[]")` (`{docId, docName, locator, chunkId}[]`) and `autoDelivered Boolean @default(false)`.

**What the hand-written migration adds that `schema.prisma` cannot say.** This is precisely the capability the Postgres cutover was paid for:

```sql
CREATE UNIQUE INDEX kbgrant_doc_subject  ON "KbGrant" ("documentId","subjectType","subjectId")
  WHERE "documentId" IS NOT NULL;
CREATE UNIQUE INDEX kbgrant_coll_subject ON "KbGrant" ("collectionId","subjectType","subjectId")
  WHERE "collectionId" IS NOT NULL;
ALTER TABLE "KbGrant" ADD CONSTRAINT kbgrant_one_target
  CHECK (num_nonnulls("documentId","collectionId") = 1);

ALTER TABLE "DocumentChunk"
  ADD COLUMN tsv tsvector GENERATED ALWAYS AS (to_tsvector('simple', text)) STORED;
CREATE INDEX documentchunk_tsv     ON "DocumentChunk" USING gin (tsv);
CREATE INDEX documentchunk_kw      ON "DocumentChunk" USING gin (keywords jsonb_path_ops);
CREATE INDEX documentchunk_hnsw    ON "DocumentChunk" USING hnsw (embedding vector_cosine_ops);
```

Three notes that must be in the migration's own comment header, because each is a trap:

- `to_tsvector` is only IMMUTABLE in its **two-argument** form, which is why the config is written literally. That pins it: `'simple'` is chosen over `'english'` because the desk is multilingual and English stemming on a Spanish workbook is worse than no stemming — and **changing it later needs a migration**, not a setting.
- `prisma migrate diff --from-empty` does **not** regenerate CHECKs, partial indexes, generated columns or `Unsupported` index types. KB migrations are numbered after `0002` and are **never** folded into a regenerated baseline. `db-01`'s "regenerate, don't port" licence expires here.
- **Amendment to db-02, owned by kb-01:** `tests/setup/postgres.ts` builds `servo_test_template` with `prisma db push`, which would produce a template missing every object above. kb-01 switches the template build to `prisma migrate deploy`, so tests run against production's exact indexes and constraints. Without this amendment kb-01's own acceptance is unfalsifiable.

### Storage: what changed from the SQLite draft, and what that buys

| SQLite-era design | Now | Consequence |
|---|---|---|
| `sqlite-vec` (unloadable through Prisma's bundled engine) | pgvector `vector(1536)` + HNSW | The extension is installed by `0001_pgvector`; no dishonest bet on a loader that does not exist |
| Float32 `Bytes` + JS cosine over a ≤200-chunk window | `<=>` with `vector_cosine_ops` in SQL | Vector rank is computed inside the entitlement query, so it cannot be applied to a chunk that was never entitled |
| FTS5, probed at boot, with a `LIKE '%term%'` fallback | `tsvector` generated column + GIN | The probe, the fallback, the two code paths, and the "shadow table dropped by `db push`" bug all disappear |
| `keywords`/`locator`/`evidence` as JSON-in-TEXT parsed with try/catch | JSONB with a `jsonb_path_ops` GIN index | Queryable, indexable, no parse-failure branch |
| Entitled-doc ids passed as a bind-variable list (breaks at thousands) | The entitlement set is a **CTE in the same statement** | No id list crosses the wire; the invariant becomes structural rather than procedural |

**One fixed vector dimension: 1536, with zero-padding.** An HNSW index needs a fixed dimension, but the mock embedder is 256-dim, `nomic-embed-text` is 768 and `text-embedding-3-small` is 1536. Padding a vector with zeros changes neither its norm nor any dot product, so cosine similarity is preserved **exactly** — every endpoint producing `d ≤ 1536` is padded to 1536 and stores its native `d` in `embeddingDims`. `d > 1536` is refused at configuration time with a message naming the fix (OpenAI's `dimensions` parameter, or a smaller model). Chunks whose `embeddingModel` differs from the current setting are excluded from vector scoring and compete on keyword rank alone until re-embedded — mixed embedding spaces are never silently blended.

`Document.data` is `bytea` and Prisma materializes the whole buffer. Every query outside the download route uses an explicit `select` that omits it; the acceptance for kb-04 asserts that.

### Retrieval: one CTE, composed everywhere

`src/lib/kb/entitlement.ts` exports one SQL fragment and its thin wrappers. **Every** KB read path composes it: search, `read_document`, `list_collections`, related-files, the effective-readers preview, and send-time re-verification. There is one definition of "may read", it is audited as one function, and adding a read path that does not use it is a review failure.

```sql
WITH human_docs AS (
  SELECT d.id FROM "Document" d WHERE d."ownerId" = $1
  UNION
  SELECT d.id FROM "Document" d, "User" u
   WHERE u.id = $1
     AND (d.visibility = 'PUBLIC' OR (d.visibility = 'STAFF' AND u.role IN ('ADMIN','AGENT')))
  UNION
  SELECT COALESCE(g."documentId", d.id) FROM "KbGrant" g
    LEFT JOIN "Document" d ON d."collectionId" = g."collectionId"
   WHERE (g."subjectType" = 'USER'  AND g."subjectId" = $1)
      OR (g."subjectType" = 'GROUP' AND g."subjectId" IN
            (SELECT "groupId" FROM "GroupMember" WHERE "userId" = $1))
),
agent_docs AS (
  SELECT COALESCE(g."documentId", d.id) FROM "KbGrant" g
    LEFT JOIN "Document" d ON d."collectionId" = g."collectionId"
   WHERE g."subjectType" = 'AGENT' AND g."subjectId" = $2
),
entitled AS (
  SELECT id FROM human_docs
  INTERSECT                      -- omitted entirely on the human chain
  SELECT id FROM agent_docs
)
```

Search then runs **inside** it:

```sql
SELECT c.id, c."documentId", d.name, c.text, c.locator,
       ts_rank_cd(c.tsv, q) AS kw,
       CASE WHEN c.embedding IS NULL OR c."embeddingModel" <> $4
            THEN NULL ELSE 1 - (c.embedding <=> $5::vector) END AS vec
  FROM "DocumentChunk" c
  JOIN "Document" d ON d.id = c."documentId"
  JOIN entitled e   ON e.id = c."documentId"          -- the gate, in the FROM clause
  , websearch_to_tsquery('simple', $3) q
 WHERE c.tsv @@ q OR ($5 IS NOT NULL AND c.embedding IS NOT NULL)
 ORDER BY (0.5 * COALESCE(vec, 0) + 0.5 * kw) DESC
 LIMIT $6;
```

Empty intersection returns `"No accessible sources."` — never a degraded answer assembled from forbidden ones. `GroupMember` is `prisma/schema.prisma:41`; the result cap follows `RESULT_LIMIT` (`src/lib/ai/tools/types.ts:27`).

### Ingestion

Upload → extract → chunk → keyword/entity pass → embed-if-configured → graph edges. Each step writes `textStatus`, so a failed step is visible and retryable and never silent.

1. **Upload** (`POST /api/kb/documents`, multipart). Stores bytes, records `sha256` and `byteSize`, creates the document `PENDING` with the uploader as owner (ownership is implicit, not a grant row). 25 MB stored-byte cap enforced here.
2. **Extract**, in the hardened worker, by content type — see below.
3. **Keyword/entity pass** — deterministic, no model call: tokenize, drop stopwords, top-N terms per chunk, plus entities (emails, codes like `INV-2024-113`, capitalized multi-word names, column headers). `Document.summary` is a **deterministic** first-chunk extract. The first review was right that an ingest-time model call bypasses the `withUsage`/`AiUsage` accounting every other call goes through (`src/lib/ai/credentials.ts`); rather than route it, v1 does not make the call. An AI abstract is a roadmap item that must go through `withUsage`.
4. **Embed if configured.** No endpoint → skip; `embedding` stays null and everything downstream works.
5. **Graph edges** — recompute `KnowledgeEdge` for the new document against existing ones: shared entities (weighted by rarity), shared keywords, same collection. Computation is corpus-wide; **reads are always filtered**, which is the distinction the access-control review demanded.

Re-uploading replaces chunks and edges and re-runs 2–5. Grants are untouched.

### Extraction: decided libraries, hardened runner

The libraries are **decided**, not options (OWNER-DECISIONS D2, verified licence audit 2026-08-27):

- **xlsx → `exceljs` (MIT).** SheetJS / `xlsx` is **rejected**: npm is frozen at 0.18.5 since 2022-03 with two unfixed high CVEs (prototype pollution, ReDoS), and the fixed builds live only on the vendor's own CDN, which breaks reproducible Docker builds.
- **PDF → `unpdf` (MIT, zero runtime dependencies, pure JS).** `pdf-parse` v2 drags `@napi-rs/canvas` (native) for no benefit here.

Both go in `THIRD_PARTY.md` with upstream copyright, per the adopt-first gate.

Chunking and locators: xlsx → contiguous used region split into row windows, `{sheet, range}` in A1 notation, with the header row repeated into every chunk's text so a mid-sheet chunk still says what its columns mean. PDF → one chunk per page, `{page}`, oversized pages split by paragraph with an ordinal. text/markdown → split on headings and blank-line runs, `{lines}`.

**Scanned PDFs are the common case for product manuals and have no text layer.** There is no OCR in v1. A PDF whose extracted text is below a threshold lands `textStatus: UNSUPPORTED` with `textError: "No text layer — this looks like a scanned document. OCR is not available."` The file stays stored and shareable, just not searchable. Silence here would be the worst outcome: an operator would believe the manual was indexed.

**The hardened runner (kb-05).** Extraction runs in a `child_process.fork`ed worker, never on the request path or the main event loop:

- zip entry-count and **decompressed**-size caps before any parse (`byteSize` caps the compressed file; a bomb is 25 MB compressed and 40 GB expanded)
- XML external entities disabled — xlsx is a zip full of XML
- wall-clock kill and `--max-old-space-size` on the child
- any breach or crash → `textStatus: FAILED` with a specific `textError`; the container survives

kb-06 and kb-07 acceptance each include a zip-bomb fixture and an XXE fixture that must land `FAILED` inside the time budget.

### Embeddings, honestly

- **Anthropic has no embeddings API.** The embedding client therefore rides the OpenAI-compatible path only — a sibling of `OpenAiCompatibleProvider` (`src/lib/ai/provider.ts:161`) calling `POST {baseUrl}/embeddings`, one dialect covering OpenAI, Ollama and vLLM. Settings are their own keys (`kb.embed.baseUrl / apiKey / model / dimensions`), resolved env-first exactly like `getAiSettings()` (`src/lib/ai/settings.ts:68`). An Anthropic-only or Z.AI-only install simply leaves them empty and loses nothing but re-ranking.
- **Deterministic mock embedder**, mirroring `MockProvider` (`src/lib/ai/mock.ts`): tokenize, hash each token into one of 256 dimensions, accumulate, L2-normalize, zero-pad to 1536. Deterministic, offline, and cosine genuinely correlates with token overlap — so ranking assertions in tests mean something. Selected the way the mock provider is: when configuration says so, never silently in production.
- **Keyword-only is a first-class mode, not a failure.** With no endpoint configured — the shipped default — ingestion skips step 4 and search runs on `tsvector` rank alone. Same tools, same citations, same ACL sequence, same tests. Configuring an endpoint later triggers a backfill over null-embedding chunks. Mixed states are normal.
- **Query egress, stated plainly.** Turning embeddings on means the question text — which may carry requester PII — is sent to the configured endpoint on every search. Keyword-only is the private default. A local Ollama or vLLM `baseUrl` is the private-with-vectors mode. The Settings page says this next to the field, not in a doc nobody opens.

### Tools

One domain module `src/lib/ai/tools/kb.ts`, registered in `src/lib/ai/tools/index.ts`, with default rows appended to `DEFAULT_TOOL_POLICIES` in `src/lib/ai/tool-policies.ts` and backfilled on upgrade by `ensureToolPolicies()`.

| Tool | Purpose | Risk | Approval |
|---|---|---|---|
| `search_knowledge` | Ranked entitled passages with citations | LOW | no |
| `read_document` | One entitled document, **paginated** by sheet/page/chunk cursor | LOW | no |
| `list_collections` | Collections with **entitled** document counts | LOW | no |

Reads are LOW like `search_tickets`, but scoping lives inside `execute()`, exactly as `history.ts` withholds other requesters' identities: **policy gates whether a call runs** (`src/lib/ai/engine.ts:525` pauses on `requiresApproval`); **entitlement gates what it can see, and no policy edit can widen it.**

`read_document` is explicitly paginated. `RESULT_LIMIT` is 4000 characters and a manual does not fit; pretending the cap is the answer would produce a tool that silently truncates the middle of a policy. The cursor is `{sheet}` / `{page}` / `{fromChunk}` and the result names the next cursor.

**KB tools are not exposed over MCP in v1.** `src/lib/mcp.ts:31` authenticates a single shared bearer token with no user identity, so an MCP session has no human principal — and the only alternatives are to deny or to invent a fallback, which is the exact leak this area exists to prevent. The MCP registry omits the three tools and the route returns "knowledge tools require a per-user token". They switch on when the identity area ships per-user MCP tokens; that unlock is a one-line change guarded by a test.

The MCP approval-gate fix (**backlog item #1** — `src/app/api/mcp/route.ts` executes tools directly, bypassing the gate `src/lib/ai/engine.ts` enforces) is a hard dependency of kb-11 regardless: it is the item that makes "which tools does MCP serve, and under what gate" a single answer.

### The payoff loop

A question arrives by email (`src/lib/inbound-email.ts`), the drafter searches the KB, opens the manual, writes a cited answer — and if policy authorises it, the reply leaves in minutes; otherwise it parks at the ordinary approval queue that already exists.

**The drafter gets retrieval, not a tool loop.** `draftReply` calls `provider.complete({ ..., tools: [] })` (`src/lib/ai/draft.ts:76-80`) — a single completion, no `AgentRun`, no steps. Making it agentic was unlisted work, and it would also destroy provenance, because a model with a tool loop can quote a passage it never logged. So `draftReplyInner` gains a deterministic pre-retrieval step instead:

1. Resolve the chain: `A = draftPrincipalId(pickAgentProfile(ticket.category))`, `B = ticket.requesterId`.
2. `kbSearch(chain, ticket.title + description + recent comments)` → top passages within a `KB_CONTEXT_LIMIT` character budget.
3. Passages are injected into `draftUser` with numbered citation markers — `[1] Pricing.xlsx · sheet 2026 · B4:D9`.
4. `ReplyDraft.sources` **is** the injected set. Nothing else is in the context, so nothing else can be quoted. Provenance is enforced by construction rather than trusted.

Retrieval defaults **ON** (it only makes drafts better; it changes nothing about sending). The resolver keeps its agentic KB tools for interactive work, but **auto-deliver rides the draft path only**, because that is the path where provenance is structural.

**Send-time re-verification lives in `approveDraft`, not in the auto path.** This is the review's second blocker and the correction matters: a draft built while `A ∩ B` held and approved by a human a week later, after a grant was revoked, would otherwise ship now-forbidden content. So `approveDraft` (`src/lib/ai/draft.ts:110`) re-runs the chain against every entry in `sources` **before** its atomic claim. On any revocation it refuses, and the approval UI shows which citation went dark and offers regenerate. Every send is guarded, and the automatic path inherits the guard rather than owning it.

**Auto-deliver** then requires, in order: the per-category setting `kb.autodeliver.<CATEGORY>` is ON (default absent = OFF, admin-only via `settings.manage`); the draft has at least one citation; re-verification passes; the QA reviewer (`qaEnabled`) has not flagged it; and the daily cap `kb.autodeliver.dailyCap` (default 20) is not exhausted — a blast-radius bound, decided rather than left open. It then fires the same atomic claim with `deciderId: null`, `autoDelivered: true`, and the normal machinery follows: public comment, SMTP via `sendMail`, `firstResponseAt`, `reply.sent` webhook carrying `autoDelivered: true`.

The timeline comment needs an author (`Comment.authorId` is required and `approveDraft:135` posts as the decider). kb-14 adds a fourth system AI user via `ensureAiUsers` (`src/lib/bootstrap.ts:15-25`) — **Servo Drafter**, `aiKind: "DRAFT"`, `drafter@servo.ai` — matching the `agentName` the drafter already uses. Dashboard metrics that read `deciderId` must tolerate `SENT` with a null decider; kb-14 fixes them in the same commit.

Any condition failing leaves the draft `PENDING` in the ordinary queue. **Nothing auto-sends on a fresh install.**

### Row-Level Security: the second layer, never the gate

The application filter above is the primary gate and stays primary. RLS is defence in depth, and `db-08` already proved the trap it depends on.

kb-15 enables `ROW LEVEL SECURITY` **and `FORCE ROW LEVEL SECURITY`** on `Document`, `DocumentChunk`, `KnowledgeEdge` and `KbGrant`. Without `FORCE` the policies are decorative, because the app connects as the table owner and owners bypass RLS — that is the trap, and the assertion message in kb-15 names it. Policies read `current_setting('app.human_id', true)` and `app.agent_id`, and every KB read path runs inside `db.$transaction` so `SET LOCAL` and the query share one pooled connection.

Two honest limits, stated so nobody mistakes the backstop for the gate:

- The policy expresses the `A ∩ B` union-of-paths less legibly than the CTE does, and duplicating that logic in two places invites drift. The policy is therefore deliberately **coarser** than the application filter: it is a floor that catches a forgotten `WHERE`, not a restatement.
- If the `SET LOCAL` is missing, both settings are empty and the policies deny everything. A bug therefore fails **closed**, loudly, and kb-15's acceptance proves it: a query run outside the transaction wrapper returns zero rows rather than all of them.

### Scale honesty

The SQLite-era section claimed a comfortable envelope of low thousands of documents and 100–300k chunks in one file, and the feasibility review correctly called the fallback mode dishonest: without FTS5, candidate selection degraded to an unindexable `LIKE '%term%'` scan over every entitled chunk.

**Both problems are gone, and the caveats are dropped rather than quietly restated.** There is no fallback mode: GIN over a stored `tsvector` is always present, so keyword selection is index-backed at every install. Vector rank is an HNSW probe in the same statement. The envelope is now bounded by ordinary Postgres operations, comfortably **tens of thousands of documents and low millions of chunks** on a modest server.

What actually bites first, in order:

1. **`bytea` growth from original files.** Workbooks and manuals dominate the database size; the 25 MB cap and an admin storage meter are the guardrails, and `pg_dump` time grows with them.
2. **HNSW index build memory** on a bulk backfill — `maintenance_work_mem` is the knob, and the backfill job commits in batches rather than one transaction.
3. **Ingestion CPU** on very large workbooks — the forked worker processes one file at a time, in the same single-process spirit as the in-process guards in `draft.ts:26`.

The revisit trigger is now honest and much further out: a KB whose HNSW index no longer fits comfortably in RAM. The escape hatch at that point is `ivfflat` or a partitioned index — still no external vector service, still one Postgres.

### Claims discipline

The KB ships no public claim until the feature exists. Concretely: `ROADMAP.md:35`'s "SQLite-first vector storage" is rewritten by `db-01` to name pgvector, and the KB may only be described on the landing page or README **in the same item that ships the described behaviour**. The rebrand area's claims linter already bans `sqlite`; kb-01 adds `sqlite-vec` and `FTS5` to that list. Nothing in this area may imply a hosted offering: the KB is a feature of the self-hosted container, and "your documents never leave your infrastructure" is only true in keyword-only mode or with a local embedding endpoint — so that sentence, wherever it appears, carries the condition.

### Decisions that close the draft's open questions

- **Personal agents** — v1 has none; the pre-committed rule when they arrive is explicit grants intersected with the owner's own entitlements. Never implicit inheritance.
- **Ticket attachments** — the two stores stay separate. A "promote to KB" action is roadmap; it must create a real `Document` with real grants, never a shortcut read path.
- **Auto-deliver cap** — yes, `kb.autodeliver.dailyCap`, default 20.
- **Chunk-level grants** — no. Document granularity only; if one sheet is secret, the workbook is split. A partial-visibility model over a document is a leak surface with no cheap correct implementation.
- **Marketplace-seeded KB documents** — out of scope for v1 and gated on the canon packaging decision. A pack that could seed documents could seed grants, and grants from a package are not something to ship before the install path is single.
- **Role vocabulary** — the KB uses today's `ADMIN | AGENT | REQUESTER` from `src/lib/permissions.ts`. If the identity area renames the vocabulary, the `kb.*` actions move with the MATRIX in **that** item, not this one. New actions: `kb.view` / `kb.upload` (ADMIN, AGENT), `kb.share` (ADMIN, AGENT — own or MANAGE-granted only), `kb.manage` (ADMIN).
- **Requesters have no KB area.** They meet the KB only as cited answers, and the intersection guarantees that a citation shown to them is one they were entitled to see.

### Risks

1. **Entitlement leak into model context** — the one unforgivable bug. Mitigated by a single audited SQL fragment every read path composes, an RLS floor beneath it, and red-team assertions in kb-10 and kb-08 that a forbidden chunk's text appears in no `AgentStep.content`, no `ReplyDraft.body`, and no related-files response.
2. **Agents start with no access at all**, so a fresh KB is dark to automation and looks broken. Mitigated by the explicit empty state and the one-click grant, not by loosening the default.
3. **Auto-deliver sends a wrong-but-cited answer.** Mitigated by default OFF, per-category opt-in, mandatory citations, send-time re-verification, the daily cap, QA parity, and full timeline/webhook parity so it is always visible after the fact.
4. **Extraction quality on merged cells, formulas and pivot sheets** — garbage chunks that rank well. Mitigated by header repetition, per-chunk cell caps, and `FAILED` visibility instead of silent junk.
5. **Grant sprawl makes intersections unreasonable.** Mitigated by the "who can read this?" preview on every share panel, which calls the same resolver retrieval uses — if the preview and retrieval ever disagree, one of them is a bug and the test says which.
6. **The `'simple'` text-search config is pinned in a generated column.** Changing it is a migration and a full re-index, not a setting. Written into the migration header so nobody promises otherwise.

### Backlog

All acceptance is offline-checkable against a local Postgres container (`docker-compose.test.yml`, port 5433) with the mock provider and the mock embedder. Every item depends on `db-01`; every vector or keyword item also depends on `db-08`.

**kb-01 — Schema and the hand-written migration** · one-tick · depends-on: db-02, db-08
- `Document`, `DocumentChunk`, `Collection`, `KnowledgeEdge`, `KbGrant`, plus `ReplyDraft.sources` / `.autoDelivered`. String unions, no Prisma enums, JSONB for `locator`/`keywords`/`evidence`.
- Numbered migration adds: two partial unique indexes on `KbGrant`, the `num_nonnulls` CHECK, the generated `tsv` column, the GIN indexes, the HNSW index. Header comment records the three traps (two-arg `to_tsvector`, `migrate diff` will not regenerate these, never fold into a baseline).
- **Amends db-02**: `tests/setup/postgres.ts` builds `servo_test_template` with `prisma migrate deploy` instead of `db push`.
- Acceptance, on a `tmpDb()`: two identical `KbGrant` rows for the same document+subject raise a unique violation; a row with both targets and a row with neither both raise the CHECK; `\d "DocumentChunk"` shows the generated column and all three indexes; existing tests green.

**kb-02 — The entitlement resolver** · one-tick · depends-on: kb-01
- `src/lib/kb/entitlement.ts`: the CTE fragment plus `entitledDocumentIds()`, `humanChain()`, `agentChain()`. `src/lib/kb/principals.ts`: `agentPrincipalId` / `draftPrincipalId` with the `builtin:` prefix.
- Visibility resolves `STAFF` against `role IN ('ADMIN','AGENT')`; `PUBLIC` is the only value an auto-provisioned `REQUESTER` can reach.
- Acceptance: matrix test on a `tmpDb()` covering ownership, `PRIVATE`/`STAFF`/`PUBLIC`, direct USER grant, GROUP grant via `GroupMember`, collection grant, agent grant, `builtin:resolver`, and the empty intersection. A `REQUESTER` created the way `inbound-email.ts:171` creates one sees `STAFF` documents in **no** path — the test fails if `STAFF` is widened.

**kb-03 — Grant APIs, permissions, effective-readers preview** · one-tick · depends-on: kb-02
- Share/revoke on document and collection for USER / GROUP / AGENT; `kb.*` actions in `src/lib/permissions.ts`; grants deleted with their target in the same transaction (no FK on the polymorphic path means an explicit sweep, asserted).
- `GET /api/kb/documents/:id/readers` resolves the effective set through the same resolver.
- Acceptance: `REQUESTER` gets 403 on every `/api/kb/*` route; a non-owner without MANAGE cannot re-share; the readers preview and a direct retrieval on the same document return the same set for five different grant shapes.

**kb-04 — Upload, storage, text/markdown extraction, status lifecycle** · one-tick · depends-on: kb-01
- `POST /api/kb/documents` multipart; `sha256`/`byteSize`; 25 MB cap; chunking with `{lines}` locators; `PENDING → EXTRACTING → EXTRACTED | FAILED | UNSUPPORTED`; re-upload replaces chunks and edges and keeps grants.
- Acceptance: a `.md` fixture yields ordered chunks whose locators round-trip to the exact lines; an oversized file is rejected with a clear message and no row; a `SELECT` outside the download route never materializes `data` (asserted by query inspection).

**kb-05 — Hardened extraction worker** · one-tick · depends-on: kb-04
- `child_process.fork` runner with entry-count, decompressed-size, wall-clock and heap caps; XML external entities disabled; breach or crash → `FAILED` with a specific `textError`.
- Acceptance: a zip-bomb fixture and an XXE fixture both land `FAILED` within the wall-clock budget; the parent process and its database connection survive both; a killed child leaves no `EXTRACTING` row behind.

**kb-06 — xlsx extraction with exceljs** · one-tick · depends-on: kb-05
- `exceljs` (MIT) added to `package.json` and `THIRD_PARTY.md`. Sheets → row-window chunks, A1 `{sheet, range}` locators, header row repeated into every chunk of its region.
- Acceptance: a fixture workbook (two sheets, headers, a merged cell) produces chunks whose locators map back to the exact cells; header text is present in every chunk of its region; the zip-bomb fixture from kb-05 lands `FAILED`.

**kb-07 — PDF extraction with unpdf** · one-tick · depends-on: kb-05
- `unpdf` (MIT, zero deps) added to `package.json` and `THIRD_PARTY.md`. Page-per-chunk `{page}` locators, paragraph split for oversized pages.
- Acceptance: a 3-page fixture yields ≥3 chunks with correct page numbers; a corrupt fixture lands `FAILED` with `textError` set; a **text-layer-free** fixture lands `UNSUPPORTED` with the scanned-document message and remains downloadable and shareable.

**kb-08 — Keyword/entity pass, graph edges, ACL-filtered related documents** · one-tick · depends-on: kb-04, kb-02
- Deterministic keyword/entity pass (no provider call); `KnowledgeEdge` builder; `GET /api/kb/documents/:id/related` composing the entitlement CTE on **both** endpoints.
- Acceptance: two fixture documents sharing `INV-2024-113` get a `SHARED_ENTITY` edge whose evidence names the code; an unrelated third gets none; the pass is pure (same input → same keywords). **Red team:** a principal entitled to A but not B receives no edge to B — not its id, not its name, and not the evidence string — and the raw literal `INV-2024-113` appears nowhere in the response body.

**kb-09 — Embeddings client, mock embedder, backfill** · one-tick · depends-on: kb-01
- OpenAI-compatible embeddings client (sibling of `OpenAiCompatibleProvider`, `provider.ts:161`); `kb.embed.*` settings env-first like `settings.ts:68`; deterministic 256-dim mock zero-padded to 1536; `d > 1536` refused at config time with the fix named; batched backfill over null-embedding chunks.
- Acceptance: with the mock embedder, identical text produces a byte-identical vector; a 256-dim mock vector and a hand-built 1536-dim vector of the same content rank identically under `<=>` (the padding-preserves-cosine property, asserted); with no endpoint configured ingestion completes with `embedding` null and no error; a chunk whose `embeddingModel` differs from the current setting is excluded from vector scoring.

**kb-10 — Retrieval pipeline and the red-team test** · one-tick · depends-on: kb-02, kb-08, kb-09
- `kbSearch(chain, query, opts)`: one statement, entitlement CTE in the `FROM`, `ts_rank_cd` blended with `1 - (embedding <=> $q)`, citations attached, keyword-only when no vector is available.
- Acceptance: agent entitled to A+B, requester entitled to B+C → results come only from B. **Red team:** the text of a non-entitled chunk appears in no `AgentStep.content`, no `ReplyDraft.body` and no API response across the run. The same test passes with embeddings absent. Deleting the `JOIN entitled` line makes the test fail — a comment above the join says so.

**kb-11 — Tools, principal plumbing, MCP denial** · one-tick · depends-on: kb-10, backlog item #1 (MCP approval-gate fix)
- `src/lib/ai/tools/kb.ts` with `search_knowledge`, `read_document` (cursor-paginated), `list_collections` (entitled counts only, empty collections omitted); registered in `tools/index.ts`; LOW/no-approval rows in `tool-policies.ts`. `ToolContext` gains `principals`, populated by `buildLoopContext`.
- `MockProvider`'s script is extended to call `search_knowledge` on KB-shaped ticket text — the mock is scripted from ticket text (`src/lib/ai/mock.ts:197`) and would otherwise never call the tool. This is in scope, not assumed.
- KB tools are absent from the MCP registry; the route returns the per-user-token message.
- Acceptance: a mock-provider resolver run calls `search_knowledge` and the `tool_result` carries passage + document name + locator for an entitled document; a non-entitled query and a non-existent id return the **identical** string; `ensureToolPolicies()` backfills the three rows on an existing database; an MCP call to `search_knowledge` is refused and the refusal is asserted by name.

**kb-12 — Drafter retrieval and provenance by construction** · one-tick · depends-on: kb-10
- `draftReplyInner` gains the deterministic pre-retrieval step, numbered citation markers in `draftUser`, `KB_CONTEXT_LIMIT`, and `ReplyDraft.sources` written as exactly the injected set. No tool loop is added to the drafter.
- Acceptance: a draft on a ticket whose answer lives in a fixture workbook contains the citation marker and `sources` lists exactly the injected chunk ids; a ticket with no entitled sources drafts normally with `sources: []`; every entry in `sources` corresponds to text that was in the prompt (asserted against the recorded prompt, so an un-cited quote is structurally impossible).

**kb-13 — Send-time re-verification on every send** · one-tick · depends-on: kb-12, kb-03
- Re-verification runs inside `approveDraft` **before** the atomic claim, for human and automatic sends alike; the approval UI names the citation that went dark and offers regenerate.
- Acceptance: revoking one cited grant after drafting blocks a **human** approval with a specific error, and blocks the automatic path too; the atomic claim is untouched on refusal (draft still `PENDING`, no comment, no mail, no webhook); with grants intact the send proceeds unchanged and existing draft tests stay green.

**kb-14 — Auto-deliver** · one-tick · depends-on: kb-13
- `kb.autodeliver.<CATEGORY>` and `kb.autodeliver.dailyCap` settings (default OFF / 20), admin-only; the automatic path claims with `deciderId: null`, `autoDelivered: true`; `ensureAiUsers` gains **Servo Drafter** (`aiKind: "DRAFT"`) as the timeline comment author; dashboard metrics tolerate `SENT` with a null decider; `reply.sent` carries `autoDelivered`.
- Acceptance, all under the mock provider: policy ON + clean citations → draft auto-`SENT`, comment authored by Servo Drafter, webhook recorded with `autoDelivered: true`; a draft with zero citations never auto-sends; the 21st send in a day parks at the queue; policy OFF (the default, and the state of a fresh install) → nothing auto-sends; the KPI query returns correct counts with null deciders present.

**kb-15 — RLS backstop** · one-tick · depends-on: kb-10
- `ENABLE` **and** `FORCE ROW LEVEL SECURITY` on the four KB tables; policies over `current_setting('app.human_id', true)` / `app.agent_id`; every KB read path wrapped in `db.$transaction` with `SET LOCAL`.
- Acceptance: with `FORCE` removed the owning role sees every row and the test fails with a message naming the trap; with it, a policy-only query (application filter bypassed) returns only entitled rows; a query run **outside** the transaction wrapper returns **zero** rows, proving the failure mode is closed rather than open.

**kb-16 — Knowledge area UI** · one-tick · depends-on: kb-03, kb-08
- Upload, list, per-file ingest status (`EXTRACTED` / `FAILED` / `UNSUPPORTED` with its message), document detail with chunk locators, related-files panel, download. Consumes semantic tokens from `servo_design_system/tokens/*.css` per D3; the loop reads `servo_design_system/SKILL.md` before the tick.
- Acceptance: route-level permission tests (`REQUESTER` 403); all three status states render with distinguishable, actionable copy; the "no agent can read this yet" empty state appears on a document with no agent grant; no hardcoded hex — every colour resolves to a design-system token.

**kb-17 — Sharing, collections and settings UI** · one-tick · depends-on: kb-16, kb-14
- Share panel with the effective-readers preview; admin collection management and collection-level grants; embeddings configuration with the query-egress warning beside the field; auto-deliver toggles carrying an explicit "sends without a human" warning; an audit view of auto-delivered replies.
- Acceptance: the panel round-trips a USER, a GROUP and an AGENT grant and the preview matches retrieval; toggling auto-deliver requires `settings.manage`; the egress warning is present whenever `kb.embed.baseUrl` is non-local; design-system tokens only.

---
