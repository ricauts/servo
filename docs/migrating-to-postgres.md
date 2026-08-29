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
SQL tools have something to operate on. The container entrypoint recreates
it on an empty directory, and db-05 moves it to its own Postgres database
with fresh fixtures. Carrying fictional HR rows across a migration would be
work with no reader.

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
