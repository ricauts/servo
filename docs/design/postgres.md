<!-- Design rationale extracted from spec.md. spec.md remains the work order:
     the backlog, the tick protocol and the claims ledger live there. -->

# Database platform: PostgreSQL

Servo's main database moves from SQLite to PostgreSQL. This section is the work order for that cutover. It lands **before** the knowledge-base area and before any area that adds new tables (identity/RBAC, packaging, connectors) — those schemas are born on Postgres, never migrated twice.

### Decision record

**Why (owner's reasons).**

- **pgvector** for knowledge-base embeddings: real ANN indexes (HNSW) instead of a JS cosine loop, and `tsvector` + GIN for keyword search instead of FTS5. This deletes the scale caveats the KB draft had to carry.
- **JSONB** for the knowledge graph's entity/relation metadata, where today every list is a JSON string column parsed with `try/catch` (`parseCategories`, `subscribes`).
- **bytea** for blobs — `Attachment.data` is already `Bytes` (`prisma/schema.prisma:112`) and gains a real large-object storage path for uploaded manuals and spreadsheets.
- **Concurrent writers.** The desk, resolver runs, KB ingestion and the 5-hour loop all write. SQLite serialises every writer on one file lock.
- **Row-Level Security** as a second enforcement layer under the KB's ACL filter.
- The **planned** hosted offering (which does not exist today) would need Postgres regardless, and building the schema twice is the expensive way to find that out.

**What is lost — honestly.**

1. **The zero-infrastructure contributor path.** `npm install && npm run setup && npm run dev` currently needs nothing but Node. After the cutover it needs a running Postgres. Mitigation: `docker compose up -d db` is one command and is the documented first step; there is no supported "SQLite fallback" mode, because two datasources in `schema.prisma` is not a thing Prisma supports and a second schema file would double every migration forever.
2. **"One container."** It becomes two. `docker compose up --build` is still one command, but the public claim changes (see *Claims discipline*).
3. **A database you can `cp`.** `scripts/make-capture-db.mjs` builds the recording fixture with `copyFileSync` + `node:sqlite` `DatabaseSync` — that trick dies. It becomes `pg_dump` → `createdb servo_capture` → `psql`, with the same redaction statements run through `psql` instead of `db.prepare()`. Recordings get slower to stage; they do not get less deterministic.
4. **`prisma db push`'s forgiving boot.** `scripts/docker-entrypoint.sh` runs `db push` on every start because it is idempotent and never needs a history. That is replaced by `prisma migrate deploy` + a real `prisma/migrations/` directory: drift becomes possible, and a bad migration can wedge a boot. This is a cost paid deliberately, because `schema.prisma` cannot express `CREATE EXTENSION`, `CREATE INDEX … USING hnsw`, generated `tsvector` columns or RLS policies — and the KB area needs all four.
5. **CI gains a service container.** `.github/workflows/ci.yml:2` currently says "SQLite means no services are needed". That stops being true.
6. **Disk and memory footprint** grow by a Postgres container (~250 MB image, ~50 MB RSS idle). Irrelevant on a server, noticeable on a laptop.

**What does *not* change, and must not be claimed to change.** Servo stays **one Node process**. The resolver's in-process re-entrancy guard (`activeResolverTickets`, `src/lib/ai/engine.ts:419`) still assumes it. There is still no queue, no worker and no scheduler — `POST /api/sla/scan` still needs an external caller. Postgres removes writer contention *inside* the single app process; it does not authorise a second app container, and nothing in docs, README or the landing page may imply that it does.

### Target architecture

**Compose.** `docker-compose.yml` gains a `db` service and the app waits for it:

```yaml
services:
  db:
    image: pgvector/pgvector:pg17        # the official `postgres` image does NOT ship pgvector
    environment:
      POSTGRES_USER: servo
      POSTGRES_PASSWORD: servo           # override in production
      POSTGRES_DB: servo
    volumes:
      - servo-db:/var/lib/postgresql/data
      - ./scripts/postgres-init.sql:/docker-entrypoint-initdb.d/10-servo.sql:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U servo -d servo"]
      interval: 5s
      timeout: 3s
      retries: 20
    restart: unless-stopped

  servo:
    build: .
    depends_on:
      db: { condition: service_healthy }
    environment:
      DATABASE_URL: "postgresql://servo:servo@db:5432/servo?schema=public"
      OPS_DATABASE_URL: "postgresql://servo_ops_rw:servo_ops@db:5432/servo_ops"
      OPS_DATABASE_READONLY_URL: "postgresql://servo_ops_ro:servo_ops@db:5432/servo_ops"
    ports: ["3000:3000"]
    volumes:
      - servo-data:/data                 # legacy SQLite volume — see the migration guide; removable once imported
    restart: unless-stopped

volumes:
  servo-db:
  servo-data:
```

The app container becomes **stateless** — attachments are `bytea` rows, not files. `servo-data` survives one release only so upgraders can read `/data/servo.db`; the migration guide tells them when to drop it.

**Extension enabled by migration, not by hand.** `prisma/migrations/0001_pgvector/migration.sql` is `CREATE EXTENSION IF NOT EXISTS vector;`. The image ships the shared library; the migration installs it into the app database. `servo_ops` does **not** get the extension.

**Contract the KB area may rely on** (this section guarantees the platform; it does not design the policies):

- `vector(N)` columns are available. Prisma 6 has no native vector type: declare them `Unsupported("vector(1536)")` in `schema.prisma`, create the index in a hand-written migration (`USING hnsw (embedding vector_cosine_ops)`), and query through `$queryRaw`.
- `to_tsvector` / `websearch_to_tsquery` + GIN indexes are available with no extension, replacing the FTS5 plan.
- **RLS is available and OFF by default.** The KB area may `ALTER TABLE … ENABLE ROW LEVEL SECURITY` in its own migrations, driven by a per-request `SET LOCAL app.current_user_id`. Two traps this section states so the KB area cannot fall into them silently: (a) the app connects as the **table owner**, and owners bypass RLS unless the table also has `FORCE ROW LEVEL SECURITY` — without it the policies are decorative; (b) RLS is the **second** layer. The application-level ACL filter that runs before anything reaches model context stays the primary gate, exactly as the KB access-control review demanded.

### The ops sandbox: a separate database, not a separate schema

`execute_ops_sql` and `query_ops_database` (`src/lib/ai/tools/ops-db.ts`) operate on a sandbox that must stay isolated from ticket data. Today that is a second SQLite file (`src/lib/opsdb.ts:9`, `OPS_DATABASE_URL`).

**Recommendation: a separate database `servo_ops` on the same Postgres server, with two dedicated login roles.** Not a separate schema.

Why the database boundary wins:

- Postgres has **no cross-database queries** without `dblink`/`postgres_fdw`, neither of which is installed. A smuggled `SELECT * FROM public."Ticket"` on the ops connection does not hit a permissions check — the object does not exist in that catalog. There is nothing to get wrong.
- A schema split, by contrast, depends on GRANT hygiene forever: `public` sits on the default `search_path`, `PUBLIC` keeps `USAGE` on it, and one future migration with a broad `GRANT SELECT ON ALL TABLES` re-opens the desk to the sandbox. A database boundary cannot be re-opened by a forgotten grant.
- It preserves the existing shape: `OPS_DATABASE_URL` stays a separate URL, `src/lib/opsdb.ts` keeps two clients, and `execute_ops_sql` still gets a real DDL playground where `DROP TABLE employees_backup` is harmless and `ensureOpsSchema()` (`src/lib/bootstrap.ts:118`) recreates the tables on the next boot.

**Why the read path gets strictly stronger than SQLite ever gave.** `PRAGMA query_only = ON` is a *session* setting on a connection that otherwise has full write access to the file — enforcement depends on that one statement landing on the right connection, which is precisely why `opsdb.ts:30` has to pin `?connection_limit=1`. Replace it with:

1. A login role `servo_ops_ro` with `CONNECT` on `servo_ops`, `USAGE` on its schema, `SELECT` on its tables, and nothing else, plus `ALTER ROLE servo_ops_ro SET default_transaction_read_only = on`. The server enforces this on every connection whether or not the app remembers to run anything.
2. Belt and braces for installs that do not configure the second URL: `opsSelect()` runs its statement inside `BEGIN … SET TRANSACTION READ ONLY`, so a smuggled `WITH x AS (…) DELETE …` fails even on the read-write role.
3. `REVOKE CONNECT ON DATABASE servo FROM PUBLIC, servo_ops_rw, servo_ops_ro;` — the load-bearing line. Neither sandbox role can open the desk database at all.
4. `REVOKE ALL ON SCHEMA public FROM PUBLIC;` and `REVOKE TEMPORARY ON DATABASE servo_ops FROM PUBLIC;` inside `servo_ops`, so the read role cannot create temp objects to stage a write.

With the role in place the `connection_limit=1` hack is deleted and pooling is restored.

**Known caveat, stated in the item.** `/docker-entrypoint-initdb.d` runs only on an empty data directory, so an upgraded volume never sees `postgres-init.sql`. The migration guide includes the same SQL to run by hand, and `ensureOpsSchema()` applies the idempotent parts at boot.

### Migration path for existing installs

A **documented one-shot script**, not an automatic import.

`scripts/migrate-sqlite-to-postgres.mjs`:

- Opens the legacy file with `node:sqlite`'s `DatabaseSync` read-only — the same dependency-free pattern already proven in `scripts/make-capture-db.mjs:16`.
- Copies every table in FK dependency order through a `PrismaClient` bound to the new `DATABASE_URL`, preserving `cuid()` ids and all timestamps so nothing re-numbers.
- `Attachment.data` copies as a `Buffer` into `bytea`.
- Sealed secrets (`enc:v1:…`) copy **verbatim**, so the same `SERVO_ENCRYPTION_KEY` keeps opening them; the script never decrypts.
- Ends with `setval('ticket_number_seq', max(number))` so the next ticket continues the series.
- Refuses to run against a non-empty target unless `--force`, and prints a per-table row-count comparison at the end.

`docs/migrating-to-postgres.md`: stop the old container → `docker compose up -d db` → run the script with `--sqlite /data/servo.db` → check the counts → `docker compose up -d`. It states plainly that the **ops sandbox is not migrated**: it is a sandbox, `ensureOpsSchema()` recreates the tables empty and `npm run demo` refills the showcase rows.

**What happens to someone who ignores it** — stated in the guide in these words:

- If the new image starts with a `file:` `DATABASE_URL`, the entrypoint **exits 1** with the link to the guide. It does not silently start an empty desk.
- If they point at Postgres and skip the script, `migrate deploy` creates an empty schema, `seed-core` runs, and `needsSetup()` (zero human users) sends them to `/setup`. They get a brand-new, empty desk. **Nothing is deleted and nothing is auto-imported**: their tickets are still sitting untouched in `servo.db` on the `servo-data` volume, and they can run the script later. The one irreversible mistake is pruning that volume, which the guide says in bold.

### Dev & test story

**Dev.** `docker compose up -d db`, then `npm run dev`. `.env.example` ships:

```
DATABASE_URL="postgresql://servo:servo@localhost:5432/servo?schema=public"
OPS_DATABASE_URL="postgresql://servo_ops_rw:servo_ops@localhost:5432/servo_ops"
# Optional but recommended: a read-only role for query_ops_database.
# OPS_DATABASE_READONLY_URL="postgresql://servo_ops_ro:servo_ops@localhost:5432/servo_ops"
```

**Test: one throwaway database per run, cloned from a template.**

Every test today mocks `@/lib/db` wholesale (`tests/mcp-approval-gate.test.ts:21`), so no isolated-database pattern exists to port — this builds it, and it is the harness that ~15 backlog items across the other areas assume.

- `docker-compose.test.yml` runs `pgvector/pgvector:pg17` on port **5433** so it never collides with a dev instance, with `tmpfs: /var/lib/postgresql/data` (nothing survives, nothing to clean).
- `vitest.config.ts` gains `globalSetup: "tests/setup/postgres.ts"`. It connects to `TEST_DATABASE_URL` (default `postgresql://servo:servo@localhost:5433/postgres`), creates `servo_test_template` if absent, runs `prisma db push --skip-generate` plus `CREATE EXTENSION vector` against it once, then **disconnects** — `CREATE DATABASE … TEMPLATE` fails while any connection to the template is open.
- `tests/helpers/tmp-db.ts` exports `tmpDb()`: `CREATE DATABASE servo_test_<pid>_<n> TEMPLATE servo_test_template` (~100–300 ms, roughly a file copy), returns a `PrismaClient` bound to it; `afterAll` disconnects and drops it. `globalTeardown` sweeps leftovers by name prefix.
- **Why database-per-run and not schema-per-run:** a Postgres extension exists once per *database*. With one shared database and N schemas, the `vector` type lives in one schema and every test schema would have to reach it through a `search_path` that Prisma's `?schema=` overwrites. Cloning a template gives each run the extension, the indexes and the RLS policies exactly as production has them.
- **"Offline-checkable" holds.** A local container pulled once is fine; external SaaS is not, and no item may substitute one. If the container is not running, `globalSetup` **fails with the exact command to start it** — it must never fall back to mocks, or a tick reports green against a database that was not there.
- **The mock provider is unaffected.** `src/lib/ai/mock.ts` never touched the database; the deterministic offline loop keeps working. Its one canned SQL string is the exception, handled in db-05.
- CI: `.github/workflows/ci.yml` gains a `services:` block with the same image; the header comment claiming no services are needed is rewritten in the same commit.

### Claims discipline

Public claims are code-verified, so **every claim below changes in the same commit as the behaviour it describes.** A tick that cuts the datasource over without touching the landing page is a failed tick.

Changed in **db-01** (the cutover):

| Where | Current claim | Becomes |
|---|---|---|
| `servoai-site/index.html:885` | "One container, SQLite on a volume." | "Two containers — the app and its Postgres — on one volume." (the `docker compose up --build` code block stays true) |
| `README.md:49` | "…a self-contained instance with persistent SQLite volumes." | "…the app plus its Postgres (pgvector) container, on a persistent volume." |
| `README.md:96` | "The database is SQLite — no external services needed." | names `docker compose up -d db` as step one of the Node path |
| `README.md:91` | `npm run setup # prisma generate + db push + core bootstrap` | `prisma generate + migrate deploy + core bootstrap` |
| `README.md:108` | "The container bootstraps its SQLite databases on a named volume (`/data`)" | Postgres volume + `migrate deploy` on boot |
| `README.md:152`, `SECURITY.md:18` | "…before it touches SQLite" | "…before it touches the database" |
| `README.md:183` | `schema.prisma # data model (SQLite; enum-likes are strings)` | `(PostgreSQL; enum-likes are strings by choice)`; the same line's `seed.ts` is stale — the files are `seed-core.ts`/`seed-demo.ts` |
| `SECURITY.md:93` | "SQLite files (`/data` in Docker) hold your tickets and sealed secrets" | the Postgres volume, plus `pg_dump` as the backup instruction |
| `docs/ARCHITECTURE.md:14, 25, 91, 359` | SQLite stack row, "SQLite has no enums", "A second SQLite database", "move from SQLite to a server database" | Postgres equivalents; line 359's advice is now already done |
| `docs/CONTRACT.md:19, 26` | "Prisma 6 + SQLite", "SQLite has no enums" | Postgres; the string-union rule survives with a new reason |
| `docs/PORTING-LEDGER.md:17, 46, 50, 74, 173, 200` | present-tense SQLite statements | Postgres, or explicitly marked as history |
| `ROADMAP.md:35, 39` | "SQLite-first vector storage", "Postgres & MySQL connectors … beyond the SQLite sandbox" | pgvector; the sandbox is Postgres now |
| `.github/workflows/ci.yml:2` | "SQLite means no services are needed" | names the service container |
| `.gitignore:9` | "local sqlite files are generated by `npm run setup`" | dropped with the `prisma/*.db` rules in db-10 |
| `prisma/schema.prisma:1-2`, `src/lib/types.ts:1` | "SQLite does not support Prisma enums" | "enum-like fields are strings **by choice**" — the rule outlives its original reason |

Changed in **db-05** (ops sandbox): `SECURITY.md:64` "Read-only SQL is enforced at the driver (`PRAGMA query_only`)" → "enforced by a read-only Postgres role and a read-only transaction, not just keyword filtering". `servoai-site/index.html:862` "Read-only SQL on a sandbox database" stays true and may be strengthened to name the role — only if the item verifies it.

The rebrand area's claims linter gains `sqlite` as a banned word outside `docs/migrating-to-postgres.md` and the explicitly-historical part of `docs/PORTING-LEDGER.md`.

### Prisma specifics

- `datasource db { provider = "postgresql" }`. No new runtime dependency — the Postgres driver ships inside `@prisma/client`'s query engine.
- **String unions stay. No Postgres enums.** Every enum-like column remains `String`, with `src/lib/types.ts` as the single source of truth. The reason is no longer dialect: a Prisma enum turns "add a status / a role / a category" into a migration plus a deploy, and the extensibility story (installed packs contributing categories, custom roles) depends on those values being data. The schema header comment says exactly this after db-01.
- **Lists stay JSON-in-TEXT for now.** `categories`, `tools`, `events`, `conversation` remain `String` columns parsed defensively. Converting them to `Json`/`String[]` would touch every `parseCategories`/`subscribes` call site; the cutover must not also be a type migration. **New** models — KB documents, chunks, graph nodes — may use `Json` (JSONB) from birth. That permission is granted here so the KB area does not have to re-litigate it.
- `Bytes` → `bytea` automatically; `Attachment.data` (`schema.prisma:112`) needs no change.
- **Migrations: regenerate from scratch, do not port.** There is no `prisma/migrations/` directory today — `package.json`'s `setup` script and `scripts/docker-entrypoint.sh` both run `prisma db push`, so there is no history to port. db-01 creates `0000_init` via `prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script`, then `0001_pgvector` and `0002_ticket_number_seq` by hand. Boot switches to `prisma migrate deploy`. `db push` survives **only** in the test harness against throwaway databases, and the loop-guard preflight refuses it against any other `DATABASE_URL`.
- **Case sensitivity — a silent behaviour regression if missed.** Prisma's `contains` compiles to `LIKE`, which is case-**in**sensitive for ASCII on SQLite and case-**sensitive** on Postgres. Two sites break: `src/lib/ai/tools/history.ts:126-127` (`search_tickets`, with the comment at line 118 explaining the old behaviour) and `src/app/api/tickets/route.ts:47` (the ticket-list search). Both need `mode: "insensitive"` (Postgres-only, compiles to `ILIKE`). No existing test would catch this, because they all mock `@/lib/db`.
- **Ticket numbering breaks under the concurrency we just bought.** `nextTicketNumber()` (`src/lib/tickets.ts:58-61`) is `max(number) + 1`. Under SQLite's single writer that was effectively safe. On Postgres, two concurrent creates — `POST /api/tickets:77`, `src/lib/mcp.ts:70`, `src/lib/inbound-email.ts:283` — read the same max and one dies on the `Ticket.number` unique index. Replace with a sequence started at 1001; `seed-demo.ts` writes explicit numbers and must `setval` afterwards.
- **Still correct, comment only.** `db.approval.updateMany({ where: { id, status: "PENDING" } })` (`src/app/api/approvals/[id]/route.ts:45`) is a single atomic `UPDATE` on Postgres too; only "atomic in SQLite" changes. `jsonSafe` (`src/lib/utils.ts:41`) still needs its BigInt guard — `COUNT(*)` comes back as BigInt through `$queryRawUnsafe` on Postgres as well; only "raw SQLite queries" changes.
- Ranking in TypeScript (`src/lib/ai/ticket-history.ts:6`) stays for now. Postgres `tsvector` could replace it, but that is a KB-area decision, not a cutover one; the comment's reasoning is rewritten, the code is not.

### Backlog

**db-01 — Cut the datasource over to PostgreSQL** · two-ticks · depends-on: —
- `prisma/schema.prisma` provider is `postgresql`; the header comment says enum-like fields are strings **by choice** and names `src/lib/types.ts`; no Prisma enums are introduced; no column type changes except those Prisma derives automatically.
- `prisma/migrations/0000_init/migration.sql` generated with `prisma migrate diff --from-empty --to-schema-datamodel … --script`; `0001_pgvector/migration.sql` is `CREATE EXTENSION IF NOT EXISTS vector;`.
- `docker-compose.yml` has the `db` service exactly as sketched above: `pgvector/pgvector:pg17`, named volume, `pg_isready` healthcheck, `depends_on: { condition: service_healthy }`.
- `scripts/docker-entrypoint.sh` no longer branches on a file's existence and runs `npx prisma migrate deploy` (never `db push`); it **exits 1 with the migration-guide link** when `DATABASE_URL` starts with `file:`.
- `Dockerfile` `ENV DATABASE_URL/OPS_DATABASE_URL` updated; `.env.example` updated; `package.json` `setup` uses `migrate deploy`, and the stale `prisma.seed` → `prisma/seed.ts` pointer is corrected to `prisma/seed-core.ts`.
- Offline check: `docker compose up --build` on a clean volume reaches `/setup`; a ticket created through the UI persists across `docker compose restart`; `psql -c "SELECT extname FROM pg_extension"` lists `vector`.
- Every claim in the db-01 row of the *Claims discipline* table is updated **in this same commit**, landing-page line included.

**db-02 — Throwaway-Postgres test harness** · one-tick · depends-on: db-01
- `docker-compose.test.yml` runs `pgvector/pgvector:pg17` on 5433 with a tmpfs data directory.
- `tests/setup/postgres.ts` (wired as vitest `globalSetup`) builds `servo_test_template` once — `db push --skip-generate` + `CREATE EXTENSION vector` — then disconnects; it **fails with the exact `docker compose -f docker-compose.test.yml up -d` command** when the server is unreachable, and never falls back to mocks.
- `tests/helpers/tmp-db.ts` exports `tmpDb()` (clone from template, bound `PrismaClient`, drop in `afterAll`) and a `seedCore()` convenience wrapping `src/lib/bootstrap.ts`.
- `tests/tmp-db.test.ts` proves isolation: two `tmpDb()` handles in one file do not see each other's rows; the database is gone after teardown.
- `.github/workflows/ci.yml` gains the `services:` block and its header comment is rewritten; `npm test` is green in CI and locally with the container up.

**db-03 — Restore case-insensitive search** · one-tick · depends-on: db-02
- `mode: "insensitive"` added at `src/lib/ai/tools/history.ts:126-127` and `src/app/api/tickets/route.ts:47`; the comment at history.ts:118 rewritten.
- `tests/search-case.test.ts` on a `tmpDb()`: a ticket titled "VPN timeout" is returned by `search_tickets` for `vpn`, `VPN` and `Vpn`, and by `GET /api/tickets?q=VPN`. The test fails if `mode` is removed.

**db-04 — Ticket numbers from a sequence** · one-tick · depends-on: db-02
- Migration `0002_ticket_number_seq` creates `ticket_number_seq START 1001`; `nextTicketNumber()` (`src/lib/tickets.ts:58`) returns `nextval`; `prisma/seed-demo.ts` `setval`s after writing its explicit numbers.
- `tests/ticket-number.test.ts`: 20 `Promise.all` creates against a `tmpDb()` produce 20 distinct consecutive numbers and zero unique-constraint errors. The same test fails against the old `max + 1` implementation.

**db-05 — Ops sandbox on Postgres, behind a read-only role** · two-ticks · depends-on: db-01
- `scripts/postgres-init.sql` creates `servo_ops`, roles `servo_ops_rw`/`servo_ops_ro`, `ALTER ROLE servo_ops_ro SET default_transaction_read_only = on`, and the four revokes listed above (`CONNECT` on `servo` revoked from both ops roles is mandatory).
- `src/lib/opsdb.ts`: `PRAGMA query_only` and `?connection_limit=1` deleted; `opsSelect()` uses `OPS_DATABASE_READONLY_URL` when set and always wraps the statement in a read-only transaction; `opsExecute()` uses the rw role.
- `get_device_info` (`src/lib/ai/tools/ops-db.ts:95`) uses `$1`, not `?`; `singleStatement`/`looksMutating` keep working and `pragma` leaves the keyword list.
- Portable DDL: `ensureOpsSchema()` (`src/lib/bootstrap.ts:118`) and `prisma/seed-demo.ts:265-360` use Postgres types (`GENERATED BY DEFAULT AS IDENTITY`, not `AUTOINCREMENT`) and `$1…$n` placeholders.
- The canned SQL in the deterministic mock provider (`src/lib/ai/mock.ts:250`), the fixture step in `prisma/seed-demo.ts:584`, the example in `docs/CONTRACT.md:171`, `agents/analytics-agent.md:14` and `skills/production-database-change/SKILL.md:18` all move off `sqlite_master` to `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`.
- Offline check: a full mock-provider resolver run on a database ticket completes end to end, `query_ops_database` returns rows, `execute_ops_sql` still pauses on its approval gate.
- `SECURITY.md:64` and, if verified, the landing line at `index.html:862` are updated in this commit.
- The guide documents the manual SQL for upgraded volumes, since `/docker-entrypoint-initdb.d` never runs on a non-empty data directory.

**db-06 — Prove the sandbox boundary** · one-tick · depends-on: db-05, db-02
- `tests/ops-isolation.test.ts` against the test container: on the read path, `INSERT`, a CTE-smuggled `DELETE`, `CREATE TEMP TABLE` and `SELECT … FROM pg_read_file('…')` all fail; on either path, `SELECT * FROM "Ticket"` fails because the desk database is unreachable (`CONNECT` revoked), not merely empty.
- Each assertion names which layer refused it (role grant, `default_transaction_read_only`, read-only transaction, or `CONNECT` revoke), so a regression says which gate fell.

**db-07 — One-shot migration for existing installs** · one-tick · depends-on: db-01
- `scripts/migrate-sqlite-to-postgres.mjs` (Node builtins + `@prisma/client` only) copies every table in FK order, preserving ids and timestamps, `Attachment.data` as a Buffer, `enc:v1:` values verbatim; `setval`s the ticket sequence; refuses a non-empty target without `--force`; prints a per-table count comparison.
- `docs/migrating-to-postgres.md` gives the ordered procedure, states that the ops sandbox is not migrated, and states in bold what happens if the script is skipped (empty desk, old data intact on `servo-data`, nothing auto-imported, do not prune the volume).
- Offline check: a SQLite fixture built by `prisma db push` against a temp file plus `seed-demo` imports into a `tmpDb()` with matching row counts on every table and a byte-identical attachment blob.

**db-08 — pgvector + RLS platform smoke test (the KB contract)** · one-tick · depends-on: db-02
- `tests/pgvector-platform.test.ts` against a `tmpDb()`: create a table with a `vector(8)` column, insert rows, build `USING hnsw (embedding vector_cosine_ops)`, and confirm `<=>` ordering returns the expected nearest neighbour; build a GIN index over `to_tsvector('simple', …)` and confirm `websearch_to_tsquery` matches.
- A second case enables RLS on a scratch table and proves both halves of the trap: without `FORCE ROW LEVEL SECURITY` the owning role still sees every row, and with it the policy filters. The assertion message names the trap.
- `docs/ARCHITECTURE.md` gains a short "what the database guarantees" block the KB area cites instead of rediscovering.

**db-09 — Backup, restore and operator docs** · one-tick · depends-on: db-01
- `SECURITY.md` and `README.md` replace "back up the SQLite files" with `pg_dump`/`pg_restore` against the `db` service, covering both `servo` and `servo_ops`, and say plainly that a dump contains sealed secrets and is only as safe as `SERVO_ENCRYPTION_KEY`.
- `scripts/make-capture-db.mjs` is repointed at `pg_dump` → `createdb servo_capture` → `psql`, with the redaction statements unchanged in substance; the header comment's `--experimental-sqlite` invocation is corrected.
- Offline check: dump, restore into a fresh database, boot the app against it, ticket counts match.

**db-10 — SQLite residue sweep and a lint that keeps it swept** · one-tick · depends-on: db-01, db-05
- `.gitignore`'s `prisma/*.db` rules and their comment removed; stray `prisma/*.db` files deleted from the working tree.
- Remaining comment-level claims corrected: `src/lib/secret-store.ts:10`, `src/lib/utils.ts:41`, `src/app/api/approvals/[id]/route.ts:45`, `src/lib/ai/ticket-history.ts:6`, `src/lib/opsdb.ts:4,24`, `src/lib/types.ts:1`.
- The claims linter fails on `sqlite` (case-insensitive) anywhere outside `docs/migrating-to-postgres.md` and the marked history section of `docs/PORTING-LEDGER.md`; running it on the tree exits 0.
- The loop-guard preflight gains a rule: refuse a commit whose `schema.prisma` changed without a matching `prisma/migrations/` addition, and refuse `prisma db push` when `DATABASE_URL` is not a `servo_test_*` database.

### Dependency edges other areas gain

- **Knowledge base (kb-\*)** — every item depends on **db-01**, and every vector/keyword item depends on **db-08**. The draft's `sqlite-vec`, FTS5 and JS-cosine designs are replaced by pgvector HNSW and `tsvector`/GIN; the FTS5 shadow-table-recreated-after-`db push` problem disappears with `db push`, and the "thousands of ids blow the bind-variable limit" caveat is answered by a join against a temp table or `= ANY($1::text[])`.
- **The throwaway-DB harness** — the loop area's SQLite `tmp-db.ts` item is **superseded by db-02**; delete it and repoint the env-scrub item at db-02. Every acceptance criterion across connectors, marketplace, identity, UX and rebrand that seeds a real database or drives an engine E2E flow (`WAITING_APPROVAL` → `Approval` → `resumeAfterApproval`) gains a hard `depends-on: db-02`. This is the single largest un-declared dependency the feasibility judge found.
- **New-schema areas** — identity/RBAC models, the packaging/pack models and the provenance columns all depend on **db-01**, so they are born on Postgres and ship as numbered migrations rather than `db push`. Any of them may use `Json` (JSONB) for genuinely new columns; none may introduce a Prisma enum.
- **The MCP P0 is exempt and stays backlog item #1.** It is a security fix and must not queue behind a database migration. Its one additive audit model lands on whatever datasource is current and is folded into `0000_init` when db-01 regenerates the baseline — which costs nothing precisely because there is no migration history to rewrite.
- **Rebrand / claims lint** — gains the `sqlite` banned word and the two exempted paths (see db-10).
- **Roadmap** — "SQLite-first vector storage" and "Postgres & MySQL connectors beyond the SQLite sandbox" are rewritten by db-01; the second is partly delivered by db-05 and must not be left claiming otherwise.

---
