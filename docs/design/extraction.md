<!-- Design rationale for spec.md. spec.md remains the work order:
     the backlog, the tick protocol and the claims ledger live there. -->

# Structured facts — typed extraction over knowledge-base text

Section 5 makes the company's documents *findable*. This section makes them *queryable*. Today a chunk's structure is a bag of strings: `"$2,400"` and `"USD 2400.00"` are two unrelated keywords, `"30 days"` cannot be compared to `"6 weeks"`, and `"last quarter"` means nothing to `websearch_to_tsquery`. A deterministic parsing pass over the same text produces typed, normalized, orderable facts — money in minor units, a date as an interval, a duration in seconds — and three things become possible that keyword rank alone cannot do:

- **Filters that work.** *"everything about invoices over $2k from last quarter"* resolves to `kind='MONEY' AND unit='USD' AND num >= 200000` intersected with a date interval, applied **inside** the entitlement query, with the free-text residue (`invoices`) still ranked by `ts_rank_cd`.
- **Graph edges with semantics.** Two documents both saying `$2,400` — one writing it `USD 2,400.00` — link because both normalize to `USD:240000`, not because they share a token.
- **Behaviour a tick can test.** No model call, no network, no clock read, no host locale. Same text plus same reference date plus same ruleset version produces byte-identical rows, so acceptance is a golden-file diff.

### What this upgrades, and what it does not touch

`kb-08` ships one pass with two halves: **keywords** (tokenize, drop stopwords, top-N terms) and **entities** (emails, codes like `INV-2024-113`, capitalized multi-word names, column headers). Both halves produce *strings*, stored in the `keywords` JSONB column.

**This section upgrades the entity half only, and adds rather than replaces.** Bindingly, for the loop:

| kb-08 surface | Status after §11 |
|---|---|
| `Document.keywords` / `DocumentChunk.keywords` JSONB | **Unchanged** — same shape, same contents, same `documentchunk_kw` GIN index (`§5`, migration `0003_kb`) |
| the tokenizer, the stopword list, top-N term selection | **Unchanged, and reused** — `src/lib/kb/facts/` imports them rather than forking them |
| `KnowledgeEdge` kinds `SHARED_KEYWORD`, `SHARED_ENTITY`, `SAME_COLLECTION` | **Unchanged.** `SHARED_FACT` is a fourth kind |
| kb-08's red-team acceptance (a non-entitled edge discloses nothing) | **Unchanged, and inherited** |
| capitalized multi-word names, column headers | **Stay lexical.** Free-text NER is not deterministic-cheap and is not attempted |

An `ext-*` tick that "cleans up" kb-08's string entity list because the typed pass now covers part of it is a **scope violation**, not a tidy-up. The overlap — `INV-2024-113` existing both as a keyword string and as an `IDENTIFIER` fact — is harmless and costs one extra edge row.

### Adopt-first verdict — recorded here so no tick re-litigates it

Per §0.4 this verdict is **cited, never re-opened**. The changelog cell for every `ext-*` tick reads: *"Duckling (facebook/duckling, BSD-3-Clause) is adoptable by licence but service-only — a Haskell library whose shipped artifact is an HTTP server; taxonomy borrowed, parsers hand-written."*

| Candidate | Licence | Verdict |
|---|---|---|
| `facebook/duckling` (the canonical repo; `wit-ai/duckling` does not exist, `facebookarchive/duckling_old` is deprecated in its favour) | **BSD-3-Clause** — adoptable | **IDEAS-ONLY.** The licence is not the blocker; the artifact is. It is Haskell, its shipped form is an HTTP server (`POST /parse`), and its own `Dockerfile` targets `haskell:8-buster` / `debian:buster` — both EOL. Last release `v0.2.0.0`, 2021-04. Adopting it means a **second service**, and §14's offline rule forbids any acceptance criterion depending on one |
| `@nlpjs/builtin-duckling` | MIT, alpha since 2025-01 | **REJECT** — an HTTP *client* to that Haskell server; it removes nothing |
| `ClaudiuCeia/ts-duckling` | MIT, zero runtime deps, in-process, offline | **REJECT, with regret.** The only in-process TypeScript option — but 5★, one maintainer, its own README warns of false positives, and **it has no money parser and no duration parser**. Those are the two dimensions this section exists for |
| `duckdb` / `@duckdb/node-api` | MIT | **A different job entirely** — external-source federation, §12. Never on the KB ingestion path; the refusal and its three reasons are written once, in §12, and cited from here |

**Steal the taxonomy, not the dependency.** Duckling's dimension vocabulary (`Time`, `Duration`, `AmountOfMoney`, `Numeral`, `Quantity`, `Email`, `PhoneNumber`, `Url`) is a well-tested description of what a service desk needs out of text. Table-driven parsers over the dimensions Servo actually filters on are smaller, offline, dependency-free and testable — which is what kb-08's pass already promises. Duckling returns in §15 as an **optional sidecar**, roadmap only.

### What gets extracted — seven dimensions

| kind | `norm` (canonical) | `num` | `unit` | `ts` / `tsEnd` | example surface forms |
|---|---|---|---|---|---|
| `DATE` | `2026-03-31` | — | — | the interval | `31/03/2026`, `March 31, 2026`, `2026-03-31`, `next Tuesday`, `el 31 de marzo` |
| `MONEY` | `USD:240000` | `240000` (minor units) | `USD` | — | `$2,400`, `USD 2.400,00`, `2400 dólares` |
| `DURATION` | `P30D` | `2592000` (seconds) | `s` | — | `30 days`, `6 weeks`, `48h`, `treinta días` |
| `QUANTITY` | `12:kg` | `12` | `kg` | — | `12 kg`, `1.5 GB`, `250 unidades` |
| `IDENTIFIER` | `INV-2024-113` | — | — | — | `INV-2024-113`, `inv 2024 113`, `PO#4471` |
| `EMAIL` | `ana@example.com` (case-folded) | — | — | — | as written |
| `URL` | origin + path, no query, no fragment | — | — | — | as written |

`num` is one orderable scalar whose meaning is fixed by `kind`. That is why the table has one numeric column and not three.

**Every date is an interval.** A single day is `ts = 2026-03-31T00:00:00Z`, `tsEnd = 2026-04-01T00:00:00Z`; a month, quarter or "last week" is the same shape with a wider span. One representation means one code path, and range overlap (`f.ts < $end AND f."tsEnd" > $start`) is the only date predicate anyone writes.

**Deliberately not extracted in v1**, each with its reason so no tick reads the list as an oversight: **bare numerals** (noise on a spreadsheet; they would dominate every rarity weight); **person, organisation and place names** (that is NER, and kb-08's lexical half already keeps them as keywords, which is the honest amount of confidence they deserve); **phone numbers** (on a service desk, phone-shaped strings are overwhelmingly ticket ids and part codes — they ship when a fixture corpus shows a false-positive rate below the identifier matcher's); **times of day and timezones** (see the UTC rule); **unit conversion** (`1.5 GB` and `1536 MB` stay two facts — conversion needs a units table with an opinion, and an opinion is a thing to get wrong silently).

### Storage — a typed table, not more JSONB

§4 bought JSONB and it is the right tool for `locator`, `keywords` and `evidence`, which are read whole and never compared. Facts are the opposite: the point is `num >= 200000` and `ts < $end`, which over JSONB needs expression indexes and casts that lose the type on every query. A row per fact gets a plain btree, makes the edge builder a self-join, and — the reason that settles it — **keeps kb-08's column exactly as kb-08 defines it**.

```prisma
model DocumentFact {
  id         String        @id @default(cuid())
  documentId String
  document   Document      @relation(fields: [documentId], references: [id], onDelete: Cascade)
  chunkId    String
  chunk      DocumentChunk @relation(fields: [chunkId], references: [id], onDelete: Cascade)
  kind       String        // DATE | MONEY | DURATION | QUANTITY | IDENTIFIER | EMAIL | URL
  norm       String        // "2026-03-31" | "USD:240000" | "P30D" | "INV-2024-113"
  num        Decimal?      @db.Decimal(38, 6)   // MONEY: minor units. DURATION: seconds. QUANTITY: value.
  unit       String        @default("")         // "USD" | "s" | "kg" | ""
  ts         DateTime?     // DATE only — interval start, UTC
  tsEnd      DateTime?     // DATE only — interval end, exclusive, UTC
  text       String        // the exact surface form, as it appeared
  offset     Int           // character offset within chunk.text — the locator for a fact
  length     Int
  confidence String        @default("EXACT")    // EXACT | ASSUMED
  extractor  String                             // ruleset version, e.g. "facts@1"
  createdAt  DateTime      @default(now())

  @@unique([chunkId, offset, kind])
  @@index([documentId, kind])
  @@index([kind, norm])
  @@index([kind, num])
  @@index([kind, ts])
}
```

Four things there are load-bearing:

- **`@@unique([chunkId, offset, kind])` makes re-extraction an idempotent upsert.** Longest match wins at a given offset, so the constraint is free, and a re-run after a ruleset bump replaces rather than duplicates.
- **`confidence`.** `ASSUMED` marks a fact the parser resolved through a configured default rather than the text: a bare `$` under `kb.facts.defaultCurrency`, an ambiguous `03/04/2026` under `kb.facts.dateOrder`. **An `ASSUMED` fact may narrow a search and may never build a graph edge.** An assumption that costs a user some results is a nuisance; an assumption that invents a relationship in the knowledge graph is a lie that outlives the query.
- **`extractor`.** Output is a function of the ruleset, so the ruleset version travels with the row. Changing a parser bumps `facts@N`, and `ext-04`'s backfill re-extracts everything below the current version.
- **`offset` / `length`.** A fact cites its exact span inside a chunk that already cites its exact sheet-and-range or page. Provenance stays end-to-end.

`Document` and `DocumentChunk` gain one back-relation field each (`facts DocumentFact[]`). **No column lands on either table**, so the migration is `CREATE TABLE` + `CREATE INDEX` plus the RLS block.

**Facts are content, so facts are entitled.** `DocumentFact` is born under kb-15's floor in the same migration that creates it: `ENABLE` **and** `FORCE ROW LEVEL SECURITY`, policy over `current_setting('app.human_id', true)` / `app.agent_id` resolved through the parent document. A table of document fragments the backstop does not cover is a hole in the backstop, and retrofitting one is strictly worse than being born covered. This is why `ext-01` depends on `kb-15` and is Tier C.

**Ticket text is out of scope for v1, and the reason is access control.** A fact row inherits its source's read rules, and a ticket's read rules are `permissions.ts` plus requester scoping — a *different* resolver from the KB entitlement CTE. Two access models in one table is the exact shape of leak this area exists to prevent. Tickets still get the benefit without the table: the extractor is pure and source-agnostic, so `ext-07` parses ticket text **at query time** and passes the resulting filters into `kbSearch` under the caller's own chain.

### Determinism — the five rules

1. **No model call, ever**, at ingest or at query time. Same rule as kb-08, same reason (`withUsage` accounting), and here also because a fact must be reproducible from the text alone.
2. **`refDate` is an explicit argument, and so is every setting.** The extractor never reads the clock and never reads a `Setting` row. `dateOrder` and `defaultCurrency` arrive as fields of the `ruleset` argument, resolved by the caller. Ingestion passes the document's `createdAt`; the query side passes the request time; tests pass a frozen date. This is the rule an autonomous loop is most likely to break by reaching for `new Date()`.
3. **UTC only, and no host locale.** Dates normalize to UTC midnight; the extractor never calls `Intl` or `toLocaleDateString`. A desk spanning timezones is off by up to a day at the boundary — a written, known limitation, and far better than golden fixtures that pass on the owner's laptop and fail in CI. A per-desk timezone is §15.
4. **Ambiguity resolves by a written, tested precedence, never by chance.** Overlapping spans: longest match wins; ties break on the fixed order `URL > EMAIL > IDENTIFIER > MONEY > DATE > DURATION > QUANTITY`, which is what keeps `INV-2024-113` from being eaten as a date. Numeric dates whose day is ≤ 12 resolve under `kb.facts.dateOrder` (default `DMY`, the same multilingual reasoning that picked `'simple'`) with `confidence: ASSUMED`; where the day is > 12 the parse is unambiguous and the setting is irrelevant.
5. **Bounded regexes and a step budget.** Extraction runs over untrusted uploaded text, so every pattern uses bounded quantifiers with no nesting, the pass carries a per-chunk **step counter** (asserted as a count, never as elapsed milliseconds — a wall-clock assertion is CI-flaky), and for uploads it runs **inside kb-05's forked worker**, with the same caps as the extraction it follows. Query-side input is capped at 512 characters before parsing.

Golden corpora live at `tests/fixtures/facts/*.txt` with `*.expected.json` beside them, one file per dimension, **Spanish and English**. A ruleset change that moves any golden output fails the test, which forces the version bump to be deliberate. Coverage is EN and ES only; a Portuguese desk gets identifiers, money, emails, URLs and absolute dates but no relative-date parsing, and `ext-03` makes that visible in the module header rather than silent.

### Typed edges — `SHARED_FACT`

kb-08's edge builder gains one kind. Two documents get a `SHARED_FACT` edge when they share a `(kind, norm)` pair, weighted by rarity, with three rules that keep the graph from collapsing into a clique:

- **Rarity counts distinct documents, not occurrences.** kb-06 repeats an xlsx header row into every chunk of its region, so occurrence counting would make a header date look ubiquitous and a body date look rare — backwards.
- **A norm present in more than 20% of documents produces no edge.** `2026` and `USD:0` are stopwords with a type. Without the cap an accounting corpus is fully connected.
- **`EXACT` facts only.**

`evidence` gains `{kind, norm, text}` entries and stays under kb-08's existing rule: withheld unless **both** endpoints are entitled, and an edge whose other node is not entitled is not returned at all, so its existence is not disclosed either. That rule is inherited verbatim, not restated with variations.

### Filters that work — the query side

The same extractor runs on the query string. What it recognises becomes a filter; what is left over is the residue that goes to `websearch_to_tsquery`. Comparators come from a small table-driven phrase list — `over / above / more than / at least`, `under / below / less than`, `between … and …`, and their Spanish equivalents — emitting exactly `>=`, `<=`, `between`, `=`. A closed set in a data file is translatable and testable; an open-ended parse is neither.

`kbSearch(chain, query, opts)` gains an optional `filters` argument and each filter lands **inside kb-10's single statement**, in the `WHERE`, correlated to a `documentId` the outer query has already constrained through the entitlement fragment — never as a pass over results, and never introducing a document set of its own:

```sql
-- ... kb-10's statement, unchanged, plus one EXISTS per filter:
AND EXISTS (
  SELECT 1 FROM "DocumentFact" f
    JOIN entitled e2 ON e2.id = f."documentId"     -- redundant here, and kept on purpose
   WHERE f."documentId" = c."documentId"
     AND f.kind = 'MONEY' AND f.unit = 'USD' AND f.num >= $7
)
```

That `JOIN entitled` is redundant while the outer query already joined the same document. It is kept because the first fact-only read path anyone writes — a facet count, an aggregate, a "documents mentioning this invoice" panel — will be copied from this block, and the pattern it copies has the gate in it. It also means that when §12's source ceiling narrows the composed fragment, this filter narrows with it for free.

Three invariants, each with a test:

- **Filters narrow; they never widen.** A filter can only remove rows from an already-entitled candidate set. A filter matching a document the principal may not read returns nothing, and the test asserts it by name.
- **No existence oracle, extended.** A filter matching zero entitled documents returns the same string as a filter matching nothing at all, character for character — kb-11's rule, now covering the filter path. Any facet or count surface counts **entitled** documents only, or it is an oracle with a nicer UI.
- **Interpretation is stated, not silent.** When the parser applies a filter the caller did not write literally, the tool result says so: *"read 'last quarter' as 2026-01-01..2026-04-01 against 2026-04-15; read '$2k' as USD 2000 (assumed currency)."* A silently narrowed search that returns nothing is indistinguishable from an empty knowledge base, and an operator will debug the wrong thing for an hour.

### Scale and caps

**64 facts per chunk**, kept in offset order, the rest dropped deterministically — an accounting sheet is *all* money and dates, and the pathological case is also the headline use case. Fact volume is one to three rows per chunk on prose and at the cap on dense sheets: against §5's stated envelope that is a table of the same order as `DocumentChunk`, with btree indexes rather than HNSW. No new operational surface, no new container, one Postgres. **The caps are constants, not settings** — a setting that changes extraction output silently invalidates every stored fact.

### Claims

Nothing here may be described publicly before it exists, per §16. Two traps: **"structured search over your documents"** must never be written before `ext-06` merges, and **"understands dates and amounts"** must always carry what it actually is — a deterministic rule-based parser for seven dimensions in two languages, not natural-language understanding. `ext-08` is the first item that may put any of this on screen.

### Risks

1. **A confidently wrong `ASSUMED` filter** silently hides the rows the user asked for. Mitigated by the interpretation readback, by `ASSUMED` never touching the graph, and by both settings being visible rather than buried constants.
2. **Fact volume on spreadsheet-heavy corpora.** Mitigated by the per-chunk cap and by excluding bare numerals — the two together are what keep an accounting workbook from being the whole table.
3. **The filter path becoming an existence oracle** through counts, facets or a "no results, but 3 documents matched" message. Mitigated by the entitled-only counting rule and the identical-string assertion carried forward from kb-11.
4. **`ext-01` is Tier C and gates the whole chain.** A stalled PR blocks seven items. That is the honest cost of being born under RLS; §0.6's anti-stall rule makes the loop skip past and work elsewhere.
5. **Ruleset churn.** Every parser improvement is a golden-fixture diff plus a backfill. Mitigated by making the version explicit from day one, so the cost is visible on the first change rather than discovered on the fifth.
6. **Language coverage is EN + ES.** Stated in the module header and in the docs, so a Portuguese or French desk knows what it is getting instead of concluding the feature is broken.

---
