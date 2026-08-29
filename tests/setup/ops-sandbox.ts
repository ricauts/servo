// tests/setup/ops-sandbox.ts — servo_test_ops (throwaway-shaped, so the
// tmpDb harness's application-database rail stays satisfied) on the EXISTING 5433 test
// cluster: the database, the two roles and their revokes, exactly as
// scripts/postgres-init.sql creates them on a fresh volume (idempotent —
// roles are cluster-wide, the database is per-cluster). The offline
// checks (db-05) run the real SQL tools against it through the real
// opsdb.ts adapter.

import { PrismaClient } from "@prisma/client";
import { testDatabaseUrl } from "../helpers/tmp-db";

export const OPS_RW_URL =
  process.env.OPS_TEST_URL_BASE ??
  (() => {
    // Same host/port/user-shape as the test server; credentials ride the
    // URL the way compose sets them.
    const base = new URL(testDatabaseUrl());
    return `postgresql://servo_ops_rw:servo_ops_rw@${base.hostname}:${base.port || 5432}/servo_test_ops?schema=public`;
  })();

export const OPS_RO_URL = OPS_RW_URL.replace("servo_ops_rw:servo_ops_rw", "servo_ops_ro:servo_ops_ro");

function baseAdminUser(): string {
  return decodeURIComponent(new URL(testDatabaseUrl()).username || "servo");
}
function baseAdminPassword(): string {
  return decodeURIComponent(new URL(testDatabaseUrl()).password || "servo");
}

let ready: Promise<void> | null = null;

export function opsSandbox(): Promise<void> {
  ready ??= (async () => {
    const withLimit = (url: string) =>
      url.includes("connection_limit") ? url : url + (url.includes("?") ? "&" : "?") + "connection_limit=2";
    const admin = new PrismaClient({ datasourceUrl: withLimit(testDatabaseUrl()) });
    try {
      await admin.$executeRawUnsafe(`CREATE DATABASE servo_test_ops`);
    } catch (err) {
      if (!/already exists/i.test(String(err))) throw err;
    } finally {
      await admin.$disconnect();
    }

    // Roles + revokes, create-or-leave (cluster-wide, like rls_probe).
    const base = new URL(testDatabaseUrl());
    base.pathname = "/postgres";
    const ownerUrl = base.toString() + (base.search ? "&" : "?") + "connection_limit=2";
    const owner = new PrismaClient({ datasourceUrl: ownerUrl });
    await owner.$executeRawUnsafe(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'servo_ops_rw') THEN
        CREATE ROLE servo_ops_rw LOGIN PASSWORD 'servo_ops_rw';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'servo_ops_ro') THEN
        CREATE ROLE servo_ops_ro LOGIN PASSWORD 'servo_ops_ro';
      END IF;
    END $$`);
    await owner.$executeRawUnsafe(`ALTER ROLE servo_ops_ro SET default_transaction_read_only = on`);
    await owner.$executeRawUnsafe(`REVOKE CONNECT ON DATABASE servo_test_template FROM servo_ops_rw`);
    await owner.$executeRawUnsafe(`REVOKE CONNECT ON DATABASE servo_test_template FROM servo_ops_ro`);
    await owner.$disconnect();

    // Inside the sandbox: the schema revokes and grants from the init
    // file — issued as the ADMIN (the initdb superuser in production;
    // the rw role is not the schema owner and cannot grant).
    const adminOnOps = new URL(OPS_RW_URL);
    adminOnOps.username = baseAdminUser();
    adminOnOps.password = baseAdminPassword();
    const ops = new PrismaClient({ datasourceUrl: adminOnOps.toString() });
    await ops.$executeRawUnsafe(`REVOKE ALL ON SCHEMA public FROM PUBLIC`);
    await ops.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO servo_ops_rw`);
await ops.$executeRawUnsafe(`GRANT CREATE ON SCHEMA public TO servo_ops_rw`);
    await ops.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO servo_ops_ro`);
    await ops.$executeRawUnsafe(`REVOKE TEMPORARY ON DATABASE servo_test_ops FROM PUBLIC`);
    await ops.$disconnect();
  })();
  return ready;
}

/** Point the app's opsdb at the test sandbox (before any ops call). */
export async function pointOpsEnv(): Promise<void> {
  await opsSandbox();
  process.env.OPS_DATABASE_URL = OPS_RW_URL;
  process.env.OPS_DATABASE_READONLY_URL = OPS_RO_URL;
}
