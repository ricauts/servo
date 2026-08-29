-- The ops sandbox (spec item db-05): a SEPARATE database on the same server,
-- with two login roles, so an agent running SQL can never reach ticket data.
-- A database boundary rather than a schema one: Postgres has no cross-database
-- query without dblink/postgres_fdw, neither of which is installed, so
-- `SELECT * FROM "Ticket"` on the sandbox connection fails at the catalog
-- rather than at a GRANT somebody has to keep right forever.
--
-- WHEN THIS RUNS. /docker-entrypoint-initdb.d executes this file ONLY on an
-- EMPTY data directory, so an upgraded volume NEVER sees it. That is why
-- docs/migrating-to-postgres.md gives the command to apply THIS FILE by hand,
-- and why ensureOpsSchema() (src/lib/bootstrap.ts) re-applies the parts that
-- need no superuser — the three in-sandbox revokes and the read-role grants —
-- on every boot. Creating the database and the roles still needs this file.
--
-- THE DESK DATABASE IS NAMED BELOW. The first REVOKE names `servo`, which is
-- POSTGRES_DB in docker-compose.yml. An install that renamed its desk database
-- must rename it here too, or the script stops there under ON_ERROR_STOP=1
-- with "database servo does not exist".
--
-- It is a psql script: it uses \gexec and \connect, which is how the
-- entrypoint runs it and how the migration guide tells you to run it
-- (`psql -v ON_ERROR_STOP=1 -f scripts/postgres-init.sql`). Every statement
-- is idempotent, so re-running it is safe.
--
-- CREDENTIALS. The password below matches the URLs in .env.example and the
-- compose defaults. It is a local development default, exactly like
-- POSTGRES_PASSWORD: change it in production and change OPS_DATABASE_URL /
-- OPS_DATABASE_READONLY_URL to match.

-- The two sandbox login roles. Neither is a superuser and neither owns
-- anything in the desk database.
DO $init$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'servo_ops_rw') THEN
    CREATE ROLE servo_ops_rw LOGIN PASSWORD 'servo_ops';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'servo_ops_ro') THEN
    CREATE ROLE servo_ops_ro LOGIN PASSWORD 'servo_ops';
  END IF;
END
$init$;

-- The read role's SESSION DEFAULT. It is a convenience, not the guarantee: a
-- session may clear it for itself with set_config(). What makes this role
-- read-only is the grants below — SELECT and nothing else — and what makes
-- every statement read-only is the transaction src/lib/opsdb.ts opens around
-- it (BEGIN ... SET TRANSACTION READ ONLY), which no session setting reaches.
ALTER ROLE servo_ops_ro SET default_transaction_read_only = on;

-- Revoke 1 of 4, and the load-bearing one: neither sandbox role may open the
-- desk database at all. PUBLIC loses CONNECT in the same statement, so the
-- default grant every future role inherits is gone too.
REVOKE CONNECT ON DATABASE servo FROM PUBLIC, servo_ops_rw, servo_ops_ro;

-- The sandbox database, owned by the read-write role so ensureOpsSchema() can
-- keep the grants below current without a superuser. CREATE DATABASE cannot
-- run inside a DO block, hence \gexec.
SELECT 'CREATE DATABASE servo_ops OWNER servo_ops_rw'
 WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'servo_ops')\gexec

\connect servo_ops

-- Revokes 2 and 3, inside the sandbox: PUBLIC gets nothing on the schema and
-- cannot create temporary objects, so the read role has nowhere to stage a
-- write even if it found a way to start one.
REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE TEMPORARY ON DATABASE servo_ops FROM PUBLIC;

-- Revoke 4: PUBLIC does not get to connect to the sandbox either; the two
-- named roles below do, explicitly.
REVOKE CONNECT ON DATABASE servo_ops FROM PUBLIC;
GRANT CONNECT ON DATABASE servo_ops TO servo_ops_rw, servo_ops_ro;

-- The read role: connect, look, and nothing else. ALTER DEFAULT PRIVILEGES
-- covers the tables ensureOpsSchema() and the demo seed create later.
GRANT USAGE ON SCHEMA public TO servo_ops_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO servo_ops_ro;
ALTER DEFAULT PRIVILEGES FOR ROLE servo_ops_rw IN SCHEMA public
  GRANT SELECT ON TABLES TO servo_ops_ro;
