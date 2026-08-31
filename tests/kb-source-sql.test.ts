// xds-04: the external SQL crawler. The second endpoint is the extdb
// compose service on 5434 — a REAL, deliberately separate Postgres — so
// the read-only-role refusal and the crawl both run against real
// servers. No new driver: a second PrismaClient, Servo-composed SQL.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { tmpDb, type TmpDb } from "./helpers/tmp-db";

type ServoDb = { [key: string]: unknown };
const holder = vi.hoisted(() => ({ db: null as unknown as ServoDb }));
vi.mock("@/lib/db", () => ({ get db() { return holder.db; } }));

import {
  READ_ONLY_ROLE_SQL,
  composeStatement,
  crawlSqlScope,
  externalLocator,
  renderRow,
  type SqlScopeEntry,
} from "@/lib/kb/sources/sql";
import { assertScopeExplicit, SourceConfigError } from "@/lib/kb/sources";

const EXT_URL =
  process.env.EXTERNAL_TEST_DATABASE_URL?.trim() ||
  "postgresql://servo:servo@127.0.0.1:5434/erp";

const handles: TmpDb[] = [];
afterAll(async () => {
  for (const h of handles) await h.dispose();
  await ext.$disconnect().catch(() => undefined);
});

const ext = new PrismaClient({ datasourceUrl: EXT_URL });
let db: PrismaClient;
let admin: { id: string };

const SCOPE: SqlScopeEntry = {
  schema: "public",
  table: "invoices",
  idColumn: "inv_id",
  textColumns: ["amount", "note"],
  titleColumn: "inv_id",
  updatedAtColumn: "updated_at",
};

beforeAll(async () => {
  // The read-only ROLE the operator's own runbook creates — the same text
  // READ_ONLY_ROLE_SQL ships. The smuggled-write test refuses AGAINST
  // THIS ROLE, not merely inside a transaction on a read-write login.
  // CREATE ROLE has no IF NOT EXISTS — a DO block is the idempotent form.
  await ext.$executeRawUnsafe(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'servo_ext_ro') THEN
      CREATE ROLE servo_ext_ro LOGIN PASSWORD 'x';
    END IF;
  END $$`);
  await ext.$executeRawUnsafe(`ALTER ROLE servo_ext_ro SET default_transaction_read_only = on`);
  // Drop the VIEW before the table (a view depends on its table; the
  // IF EXISTS on the table alone cannot drop a dependent view).
  await ext.$executeRawUnsafe(`DROP VIEW IF EXISTS invoices_recent`);
  await ext.$executeRawUnsafe(`DROP TABLE IF EXISTS invoices`);
  await ext.$executeRawUnsafe(`CREATE TABLE invoices (inv_id TEXT PRIMARY KEY, amount INT, note TEXT, updated_at TIMESTAMPTZ DEFAULT now())`);
  for (let i = 1; i <= 3; i++) {
    await ext.$executeRawUnsafe(`INSERT INTO invoices (inv_id, amount, note) VALUES ($1, $2, $3)`, `INV-2024-100${i}`, i * 100, `row ${i}`);
  }
  await ext.$executeRawUnsafe(`CREATE VIEW invoices_recent AS SELECT * FROM invoices WHERE amount > 100`);
  await ext.$executeRawUnsafe(`GRANT CONNECT ON DATABASE erp TO servo_ext_ro`);
  await ext.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO servo_ext_ro`);
  await ext.$executeRawUnsafe(`GRANT SELECT ON invoices TO servo_ext_ro`);
  await ext.$executeRawUnsafe(`GRANT SELECT ON invoices_recent TO servo_ext_ro`);
});

beforeEach(async () => {
  if (handles.length > 1) await handles.shift()?.dispose();
  const a = await tmpDb();
  handles.push(a);
  db = a.client;
  holder.db = db as unknown as ServoDb;
  admin = await db.user.create({ data: { name: "A", email: `a${Date.now()}@x.com`, role: "ADMIN" } });
});

const CONFIG = { host: "127.0.0.1", port: 5434, database: "erp", user: "servo_ext_ro", password: "x" };

describe("composition — the statement is Servo's, entirely", () => {
  it("identifiers quoted, columns restricted to the scope's, cursor a bound parameter", () => {
    const first = composeStatement(SCOPE, null, 50);
    expect(first.sql).toContain('SELECT "inv_id", "inv_id", "updated_at", "amount", "note" FROM "public"."invoices"');
    expect(first.sql).toContain("ORDER BY \"inv_id\" ASC LIMIT 50");
    expect(first.params).toEqual([]);
    const paged = composeStatement(SCOPE, "INV-2024-1002", 50);
    expect(paged.sql).toContain('WHERE "inv_id" > $1');
    expect(paged.params).toEqual(["INV-2024-1002"]); // bound, never interpolated
  });

  it("a forged identifier is refused, never quoted through", () => {
    expect(() => composeStatement({ ...SCOPE, table: 'x"; DROP TABLE invoices; --' }, null, 5)).toThrow(SourceConfigError);
    expect(() => composeStatement({ ...SCOPE, idColumn: "1; DELETE" }, null, 5)).toThrow(/plain identifier/);
  });

  it("a scope entry carrying a WHERE key is refused by the catalog CHECK", async () => {
    // The validator mirrors the CHECK; both refuse it.
    expect(() => assertScopeExplicit([{ ...SCOPE, where: "1=1" } as never], "POSTGRES")).toThrow(/where/);
    const row = await db.dataSource.create({
      data: {
        name: `bad-${Date.now()}`, kind: "POSTGRES", secretRef: "s",
        configJson: CONFIG, createdById: admin.id,
        scopeJson: [{ ...SCOPE, where: "1=1" }],
      } as never,
    }).catch((err) => {
      expect(String(err)).toMatch(/scope_explicit|where/i); // the CHECK fires
      return null;
    });
    expect(row).toBeNull();
  });

  it("READ_ONLY_ROLE_SQL is the exact text xds-09 will render", () => {
    expect(READ_ONLY_ROLE_SQL).toContain("CREATE ROLE servo_ext_ro LOGIN PASSWORD");
    expect(READ_ONLY_ROLE_SQL).toContain("ALTER ROLE servo_ext_ro SET default_transaction_read_only = on");
    expect(READ_ONLY_ROLE_SQL).toContain("GRANT SELECT ON your_schema.your_table TO servo_ext_ro");
  });
});

describe("the read-only role, against the real second endpoint", () => {
  it("a smuggled write (WITH x AS (...) DELETE ...) fails AGAINST THE ROLE", async () => {
    const ro = new PrismaClient({ datasourceUrl: `postgresql://servo_ext_ro:x@127.0.0.1:5434/erp?schema=public&connection_limit=1` });
    try {
      await expect(
        ro.$queryRawUnsafe(`WITH x AS (SELECT 1) DELETE FROM invoices WHERE inv_id = 'INV-2024-1001'`),
      ).rejects.toThrow(/read-only|cannot execute DELETE/i);
      // A second smuggle shape: the write is not even a CTE.
      await expect(
        ro.$queryRawUnsafe(`DELETE FROM invoices WHERE inv_id = 'INV-2024-1001'`),
      ).rejects.toThrow(/read-only|cannot execute DELETE/i);
    } finally {
      await ro.$disconnect().catch(() => undefined);
    }
  });
});

describe("crawling", () => {
  it("a fixture TABLE produces one CrawledRow per row, deterministic versions", async () => {
    const result = await crawlSqlScope({ configJson: CONFIG, scopeJson: [SCOPE], maxRows: 100 }, SCOPE);
    expect(result.overCap).toBe(false);
    expect(result.rows).toHaveLength(3);
    expect(result.rows.map((r) => r.externalId)).toEqual(["INV-2024-1001", "INV-2024-1002", "INV-2024-1003"]);
    const first = result.rows[0];
    expect(first.text).toContain("inv_id = INV-2024-1001");
    expect(first.text).toContain("amount = 100");
    // The version includes updatedAt (now()), so equality is asserted on a
    // scope that EXCLUDES the wall-clock column — the rendering itself is
    // deterministic.
    const noClock = { ...SCOPE, updatedAtColumn: "amount" };
    expect(renderRow(noClock, { inv_id: "INV-2024-1001", amount: 100, note: "row 1" }).version)
      .toBe(renderRow(noClock, { inv_id: "INV-2024-1001", amount: 100, note: "row 1" }).version);
  });

  it("a VIEW is crawled identically to a table", async () => {
    const viewScope = { ...SCOPE, table: "invoices_recent" };
    const result = await crawlSqlScope({ configJson: CONFIG, scopeJson: [viewScope], maxRows: 100 }, viewScope);
    expect(result.overCap).toBe(false);
    expect(result.rows.map((r) => r.externalId)).toEqual(["INV-2024-1002", "INV-2024-1003"]);
  });

  it("a scope over maxRows returns overCap — the caller lands ERROR and writes NOTHING", async () => {
    const result = await crawlSqlScope({ configJson: CONFIG, scopeJson: [SCOPE], maxRows: 2 }, SCOPE);
    expect(result.overCap).toBe(true);
    expect(result.rows).toHaveLength(2); // the flag, not silent truncation
  });

  it("the externalLocator is xds-01's canonized shape", () => {
    expect(externalLocator(SCOPE, "erp", "INV-2024-1001")).toEqual({
      kind: "POSTGRES", source: "erp", schema: "public", table: "invoices",
      idColumn: "inv_id", id: "INV-2024-1001",
    });
  });

  it("assertNotServoDatabase re-runs AT CRAWL TIME — a source edited to DATABASE_URL after creation is refused before connecting", async () => {
    // The guard reads the PROCESS env: stage DATABASE_URL naming Servo's
    // own database on the same reachable host, restore it after.
    const prev = process.env.DATABASE_URL;
    process.env.DATABASE_URL = `postgresql://servo:servo@127.0.0.1:5433/servo`;
    try {
      await expect(
        crawlSqlScope({ configJson: { host: "127.0.0.1", port: 5433, database: "servo" }, scopeJson: [SCOPE], maxRows: 5 }, SCOPE),
      ).rejects.toThrow(/points at Servo's own database/);
    } finally {
      if (prev === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = prev;
    }
  });
});
