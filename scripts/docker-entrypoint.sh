#!/bin/sh
set -e

# The datasource is PostgreSQL: the schema arrives as numbered migrations,
# never `db push` (db-01). A legacy SQLite URL means someone pointed the new
# image at an old install — refuse rather than silently start an empty desk.
case "$DATABASE_URL" in
  file:*)
    echo "[servo] DATABASE_URL is a SQLite path ($DATABASE_URL)."
    echo "[servo] The database is PostgreSQL now — see docs/migrating-to-postgres.md"
    echo "[servo] for the one-shot import and the new compose stack."
    exit 1
    ;;
esac

echo "[servo] Applying database migrations…"
npx prisma migrate deploy

# The core seed is create-only and idempotent: it backfills system rows an
# upgrade may have added without ever touching existing data.
npx tsx prisma/seed-core.ts
if [ "$SERVO_DEMO" = "1" ]; then
  echo "[servo] SERVO_DEMO=1 — loading the showcase dataset…"
  npx tsx prisma/seed-demo.ts
fi

exec npm run start
