# Migrating an existing install to PostgreSQL

For installs that started before the Postgres cutover (db-01): the app's data
lives in a SQLite file — `servo.db` — on the `servo-data` volume inside the
app container. This guide moves it into the PostgreSQL database the app now
expects. The whole procedure is one command plus two checks.

## What you need

- The **same** `SERVO_ENCRYPTION_KEY` the old install used. Sealed values
  (`enc:v1: …` — provider keys, webhook secrets, tool secrets) are copied
  **verbatim, never decrypted**: they only open under the key that sealed
  them, and a migration that "lost" them would be silent breakage later.
- The legacy file, still readable: `docker compose exec servo ls /data` shows
  `servo.db` (and probably `ops.db`).

## The procedure, in order

```bash
# 1. Stop the old app — nothing may write to the file mid-copy.
docker compose stop servo

# 2. Start only the database.
docker compose up -d db
#    First boot applies the migrations, creating the schema
#    (sequences, pgvector, indexes included).

# 3. Import. The script is read-only against the SQLite file and refuses to
#    touch a non-empty target unless you pass --force.
docker compose exec servo node scripts/migrate-sqlite-to-postgres.mjs \
  --sqlite /data/servo.db

# 4. Check the counts it prints — every table must show ✓.
#    (The script exits non-zero on any mismatch.)

# 5. Bring the app back up.
docker compose up -d
```

The copy preserves every cuid id and every timestamp; attachments arrive as
real binary blobs (byte-identical); ticket numbers move to the
`ticket_number_seq` sequence, set past the highest imported number.

## What is NOT migrated, and why

**The ops sandbox (`ops.db`) is not migrated.** It is disposable fixture
data — devices, employees, licences — that exists so the agent's sandboxed
SQL tools have something to operate on. It now lives in its own PostgreSQL
database with its own roles (see below); `ensureOpsSchema()` recreates the
empty tables at boot and `npm run demo` refills the showcase rows. Carrying
fictional HR rows across a migration would be work with no reader.

## Create the ops sandbox by hand (upgraded volumes only)

`scripts/postgres-init.sql` is mounted into `/docker-entrypoint-initdb.d`,
and **Postgres runs that directory only on an EMPTY data directory.** A
volume that already holds a database — which is every install that followed
the procedure above — therefore never sees it. The compose file ships both
sandbox URLs set, so the symptom is not "not configured": `query_ops_database`
comes back with a connection error naming `servo_ops_ro`, because neither the
database nor the roles those URLs name exist yet.

Apply the same file by hand, once, as a superuser:

```bash
docker compose cp scripts/postgres-init.sql db:/tmp/postgres-init.sql
docker compose exec -T db \
  psql -U servo -d servo -v ON_ERROR_STOP=1 -f /tmp/postgres-init.sql
```

It is idempotent — every statement re-runs safely — and it creates:

- the `servo_ops` database, owned by `servo_ops_rw`;
- login roles `servo_ops_rw` and `servo_ops_ro`, the latter granted `SELECT`
  and nothing else, with `ALTER ROLE … SET default_transaction_read_only = on`
  as its session default (the binding guarantee is the read-only transaction
  `src/lib/opsdb.ts` opens around every statement);
- the revokes that make the boundary real, above all **`REVOKE CONNECT ON
  DATABASE servo FROM PUBLIC, servo_ops_rw, servo_ops_ro`** — neither sandbox
  role can open the desk database at all.

Then set both URLs on the `servo` service (docker-compose.yml already ships
them) and restart it:

```
OPS_DATABASE_URL="postgresql://servo_ops_rw:servo_ops@db:5432/servo_ops"
OPS_DATABASE_READONLY_URL="postgresql://servo_ops_ro:servo_ops@db:5432/servo_ops"
```

**Change `servo_ops` from the default password** the same way you change
`POSTGRES_PASSWORD`: `ALTER ROLE servo_ops_rw PASSWORD '…';` and the same for
`servo_ops_ro`, then update both URLs.

On the next boot `ensureOpsSchema()` re-applies the parts that need no
superuser — the three revokes inside `servo_ops` and the read role's grants —
so those stay correct without anyone re-running the file. Creating the
database and the two roles is the part that still needs this file.

**Point `OPS_DATABASE_URL` at a database of its own.** Servo refuses one that
names the same database as `DATABASE_URL`, but it cannot know that some other
shared database is not yours to change: on every boot `ensureOpsSchema()`
revokes `CONNECT`, `TEMPORARY` and schema rights from `PUBLIC` on whatever
database that URL names, and creates its three fixture tables there. Give the
sandbox an empty database.

## If you skip this guide

Nothing dramatic happens, and that is the trap:

- On first boot against an empty PostgreSQL, `prisma migrate deploy` creates
  the schema, `seed-core` runs, and **`needsSetup()` sends you to `/setup`
  as if this were a brand-new install.**
- **Nothing is deleted. Nothing is auto-imported.** Your tickets, users,
  attachments and history are all still there, intact, in `servo.db` on the
  `servo-data` volume.
- **The one irreversible mistake is pruning that volume** (`docker compose
  down -v`, or a `docker volume rm servo_servo-data`). The moment the volume
  is gone, the SQLite file is gone with it, and no step of this guide can
  bring it back. Until the import has run AND its counts have been checked,
  treat that volume as the only copy of your data.

After a verified import, the file is redundant and the volume can go — but
not before.

## Backups, before and after

Take one backup of the SQLite file **before** starting (a plain file copy
while the app is stopped is enough). From then on, back up the way
[SECURITY.md](../SECURITY.md) describes: `pg_dump`/`pg_restore` against the `db`
service, covering both the `servo` and `servo_ops` databases — and remember
that a dump contains sealed secrets and is only as safe as your
`SERVO_ENCRYPTION_KEY`.
