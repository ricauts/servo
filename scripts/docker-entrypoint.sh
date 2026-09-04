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

# Encryption at rest, on by default (ops-01). An operator who sets
# SERVO_ENCRYPTION_KEY keeps full control; otherwise the container makes one
# 32-byte key on first boot and keeps it in SERVO_ENCRYPTION_KEY_FILE
# (default /data/encryption.key, on the persistent volume) so every later
# boot reads the same key and every sealed secret stays readable. The key is
# never written to the database and never printed. Back the file up with
# the database: a dump without it holds ciphertext nobody can open.
if [ -z "$SERVO_ENCRYPTION_KEY" ]; then
  KEY_FILE="${SERVO_ENCRYPTION_KEY_FILE:-/data/encryption.key}"
  if [ ! -s "$KEY_FILE" ]; then
    mkdir -p "$(dirname "$KEY_FILE")"
    umask 077
    node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))" > "$KEY_FILE"
    umask 022
    echo "[servo] Generated an encryption key at $KEY_FILE — back it up together with the database."
  fi
  SERVO_ENCRYPTION_KEY="$(cat "$KEY_FILE")"
  export SERVO_ENCRYPTION_KEY
fi

echo "[servo] Applying database migrations…"
npx prisma migrate deploy

# The core seed is create-only and idempotent: it backfills system rows an
# upgrade may have added without ever touching existing data.
npx tsx prisma/seed-core.ts
if [ "$SERVO_DEMO" = "1" ]; then
  echo "[servo] SERVO_DEMO=1 — loading the showcase dataset…"
  npx tsx prisma/seed-demo.ts
fi

# Seal any secret written before a key existed (idempotent: rows already
# sealed are left alone). Best-effort — a failure here is logged, never a
# refusal to boot, because the app reads legacy plaintext as-is.
node scripts/ops/encrypt-secrets.cjs || echo "[servo] encrypt-secrets skipped (see above)."

exec npm run start
