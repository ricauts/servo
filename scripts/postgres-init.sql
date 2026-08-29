-- Runs only on an EMPTY data directory (docker-entrypoint-initdb.d):
-- an upgraded volume never sees this file. The migration guide carries
-- the same SQL to run by hand, and ensureOpsSchema() applies the
-- idempotent parts at boot. db-05 fills in the ops-sandbox roles; the
-- main database needs nothing from this file today.
SELECT 1;
