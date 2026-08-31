-- Runs only on an EMPTY data directory (docker-entrypoint-initdb.d):
-- an upgraded volume never sees this file. The migration guide carries
-- the same SQL to run by hand, and ensureOpsSchema() applies the
-- idempotent parts at boot. db-05: the ops sandbox moves to its own
-- Postgres database behind a read-only role — the four REVOKEs below are
-- the boundary, and each is mandatory.

-- The sandbox database itself.
CREATE DATABASE servo_ops;

-- Two login roles: the read-write side the mutating tool uses, and the
-- read-only side every SELECT rides. default_transaction_read_only makes
-- the ro role refuse writes AT THE SERVER even before the explicit
-- SET TRANSACTION READ ONLY wrapper in opsdb.ts.
CREATE ROLE servo_ops_rw LOGIN PASSWORD 'servo_ops_rw';
CREATE ROLE servo_ops_ro LOGIN PASSWORD 'servo_ops_ro';
ALTER ROLE servo_ops_ro SET default_transaction_read_only = on;

-- The four revokes (db-05 acceptance, mandatory):
-- 1. No incidental access to the MAIN database for either sandbox role.
REVOKE CONNECT ON DATABASE servo FROM PUBLIC;
REVOKE CONNECT ON DATABASE servo FROM servo_ops_rw;
REVOKE CONNECT ON DATABASE servo FROM servo_ops_ro;

\connect servo_ops

-- 2/3. Inside the sandbox: no PUBLIC schema rights, no temp objects.
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO servo_ops_rw;
GRANT CREATE ON SCHEMA public TO servo_ops_rw;
GRANT USAGE ON SCHEMA public TO servo_ops_ro;

-- 4. No temporary tables — a temp table is a write the ro role must not
-- have, and a scratch surface the rw role could use to smuggle data out
-- of scope.
REVOKE TEMPORARY ON DATABASE servo_ops FROM PUBLIC;

-- Ownership and defaults: the app's superuser owns the schema it creates
-- at boot (ensureOpsSchema); both roles may read what exists, only rw
-- may change it. Future tables need the same grants — ensureOpsSchema
-- re-applies them idempotently.
ALTER DEFAULT PRIVILEGES FOR ROLE servo IN SCHEMA public
  GRANT SELECT ON TABLES TO servo_ops_ro;
ALTER DEFAULT PRIVILEGES FOR ROLE servo IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO servo_ops_rw;
