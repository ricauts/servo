// cat-03: tier-1 SQL introspection, the seeded source database and the
// fingerprint. Two halves: the PURE mappers tested from recorded fixtures
// with no container and no network, and ONE live run against the seeded
// servo_catalog_src on the existing port-5433 test server — with the
// executed statements recorded, because tier 1 issues ZERO table scans.
//
// The SQL Server path is FIXTURE-ONLY in v1: no live SQL Server test is
// claimed anywhere in this file, and the sys.* object names are not
// asserted against a live server.

import { afterAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { PrismaClient } from "@prisma/client";
import { catalogSrc, disposeCatalogSrc } from "./setup/catalog-src";
import {
  mapPgCatalog,
  mapMssqlCatalog,
  resolveNDistinct,
  runPgTier1,
  pgTier1Rows,
  type PgCatalogRow,
  type MssqlCatalogRow,
  type SqlExecutor,
} from "@/lib/catalog/tier1-sql";
import { fingerprint, structureOf, bucketPowerOfTwo } from "@/lib/catalog/fingerprint";

const fixture = JSON.parse(
  readFileSync("tests/fixtures/catalog/pg-payroll.json", "utf8"),
) as { payroll: PgCatalogRow[]; employee: PgCatalogRow[] };
const mssqlFixture = JSON.parse(
  readFileSync("tests/fixtures/catalog/mssql-orders.json", "utf8"),
) as { rows: MssqlCatalogRow[] };

afterAll(async () => {
  await disposeCatalogSrc();
});

describe("the n_distinct trap — both branches", () => {
  it("a negative n_distinct is the NEGATED RATIO, not a count", () => {
    // n_distinct = -1 on 1 000 rows means UNIQUE, not one distinct value.
    expect(resolveNDistinct(-1, 1000)).toBe(1000);
    expect(resolveNDistinct(-0.25, 8000)).toBe(2000);
    // Positive is absolute:
    expect(resolveNDistinct(37, 1000)).toBe(37);
    expect(resolveNDistinct(0, 1000)).toBeNull();
  });

  it("the fixture column with n_distinct = -1 profiles as unique, not constant", () => {
    const profile = mapPgCatalog(fixture.employee);
    if (!profile) throw new Error("employee fixture did not map");
    const ref = profile.columns.find((c) => c.name === "reference_code");
    if (!ref) throw new Error("reference_code missing");
    expect(fixture.employee.find((r) => r.column_name === "reference_code")?.n_distinct).toBe(-1);
    expect(ref.stats.distinct).toBe(fixture.employee[0].reltuples); // ~all rows
    expect(ref.stats.exact).toBe(false); // a pg_stats estimate, never a count
  });
});

describe("mapPgCatalog — pure, from the recorded fixture, no container", () => {
  it("maps structure: ordered columns, format_type, nullability, PK, FK", () => {
    const p = mapPgCatalog(fixture.payroll);
    if (!p) throw new Error("payroll fixture did not map");
    expect(p.fqn).toBe("pg://payroll/payroll");
    expect(p.displayName).toBe("payroll.payroll");
    expect(p.columns.map((c) => c.name)).toEqual([
      "payroll_id",
      "employee_id",
      "status",
      "net_pay",
      "paid_on",
    ]);
    expect(p.columns.map((c) => c.declaredType)).toContain("numeric(12,2)");
    expect(p.primaryKey).toEqual(["payroll_id"]);
    const fk = p.columns.find((c) => c.name === "employee_id");
    expect(fk?.references).toBe("employee.employee_id");
    expect(fk?.nullable).toBe(false);
  });

  it("captures the source's own COMMENTs — table and column", () => {
    const p = mapPgCatalog(fixture.payroll);
    expect(p?.description).toBe("One row per employee per pay period");
    expect(p?.columns.find((c) => c.name === "net_pay")?.comment).toBe(
      "Net compensation after withholdings",
    );
  });

  it("keeps estimates flagged inexact and unique/distinct separate fields", () => {
    const p = mapPgCatalog(fixture.payroll);
    for (const c of p?.columns ?? []) {
      expect(c.stats.exact).toBe(false); // pg_stats is always an estimate
      expect(c).toHaveProperty("isUnique");
      expect(c.stats).toHaveProperty("distinct");
    }
    const status = p?.columns.find((c) => c.name === "status");
    expect(status?.stats.distinct).toBe(3); // the low-cardinality enum
    expect(status?.stats.mostCommonVals.length).toBeGreaterThan(0);
  });
});

describe("mapMssqlCatalog — fixture-only in v1", () => {
  it("maps the sys.* fixture, including (max) and MS_Description", () => {
    const p = mapMssqlCatalog(mssqlFixture.rows);
    if (!p) throw new Error("mssql fixture did not map");
    expect(p.fqn).toBe("mssql://dbo/orders");
    expect(p.description).toBe("Sales orders (MS_Description captured verbatim)");
    const notes = p.columns.find((c) => c.name === "notes");
    expect(notes?.declaredType).toBe("nvarchar(max)");
    expect(notes?.nullable).toBe(true);
    const fk = p.columns.find((c) => c.name === "customer_code");
    expect(fk?.references).toBe("dbo.customer.customer_code");
    expect(fk?.comment).toBe("The ordering customer (FK)");
    expect(p.primaryKey).toEqual(["order_id"]);
  });
});

describe("the live run against servo_catalog_src — and ZERO table scans", () => {
  let src: PrismaClient;
  const executed: string[] = [];
  const recordingExec: SqlExecutor = async (sql, params) => {
    executed.push(sql);
    return src.$queryRawUnsafe(sql, ...(params ?? [])) as never;
  };

  it(
    "produces the same Profile the fixtures produce",
    async () => {
      src = await catalogSrc();
      executed.length = 0;
      const live = await runPgTier1(recordingExec, "payroll", "payroll");
      const fromFixture = mapPgCatalog(fixture.payroll);
      expect(live).toEqual(fromFixture);

      const liveEmployee = await runPgTier1(recordingExec, "payroll", "employee");
      expect(liveEmployee).toEqual(mapPgCatalog(fixture.employee));
    },
    60_000,
  );

  it("issued ZERO table scans — every statement reads catalog surfaces only", () => {
    expect(executed.length).toBeGreaterThan(0);
    for (const sql of executed) {
      // Any FROM/JOIN naming a user table (payroll.*) is a table scan.
      // Catalog surfaces are pg_catalog.* / information_schema.* / pg_stats.
      const userTable = /\b(?:FROM|JOIN)\s+(?!pg_catalog\.|information_schema\.|pg_stats\b|pg_class\b|pg_namespace\b|pg_attribute\b|pg_attrdef\b|pg_index\b|pg_constraint\b|pg_stats\s|LATERAL|\(|generate_series|unnest\()"?(payroll|public|dbo)\b/i.exec(
        sql,
      );
      if (userTable) {
        throw new Error(
          `tier 1 scanned a user table (${userTable[0]}) — tier 1 reads the catalog only`,
        );
      }
    }
    // And the statements DO read pg_stats with the text-array casts the
    // driver requires (see the comment on PgCatalogRow): the naive
    // anyarray select cannot cross the wire, so the cast is never removed.
    expect(executed.join("\n")).toContain("most_common_vals::text::text[]");
    expect(executed.join("\n")).toContain("most_common_freqs::text::double precision[]");
    expect(executed.join("\n")).toContain("histogram_bounds::text::text[]");
  });

  it("pg_stats emptiness is named as the cause when ANALYZE did not run", async () => {
    src = await catalogSrc();
    // The setup's post-condition throws with the pg_stats message if
    // ANALYZE ever stops running; pin that the message exists in the
    // setup source, naming the cause verbatim.
    const setupSource = readFileSync("tests/setup/catalog-src.ts", "utf8");
    expect(setupSource).toMatch(/pg_stats is empty/);
    expect(setupSource).toMatch(/the ANALYZE step did not take effect/);
  });
});

describe("the structural fingerprint", () => {
  const profile = mapPgCatalog(fixture.payroll);
  if (!profile) throw new Error("fixture did not map");

  it("is byte-identical across runs on the same fixture", () => {
    const a = fingerprint(structureOf(profile));
    const b = fingerprint(structureOf(mapPgCatalog(fixture.payroll) ?? profile));
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when a column is added; ignores a reltuples change", () => {
    const base = fingerprint(structureOf(profile));
    const withColumn = fingerprint(
      structureOf({
        ...profile,
        columns: [...profile.columns, { name: "bonus", declaredType: "numeric(8,2)", nullable: true, isPrimaryKey: false, references: null }],
      }),
    );
    expect(withColumn).not.toBe(base);

    // reltuples is not part of the structure at all — a fresh ANALYZE with
    // different estimates is not a change.
    const driftRows = fixture.payroll.map((r) => ({ ...r, reltuples: r.reltuples * 3 + 17 }));
    const drifted = fingerprint(structureOf(mapPgCatalog(driftRows) ?? profile));
    expect(drifted).toBe(base);

    // Reordering columns IS structure:
    const reordered = fingerprint(
      structureOf({ ...profile, columns: [...profile.columns].reverse() }),
    );
    expect(reordered).not.toBe(base);
  });

  it("buckets object counts to powers of two and orders the extension histogram", () => {
    expect(bucketPowerOfTwo(0)).toBe(1);
    expect(bucketPowerOfTwo(1)).toBe(1);
    expect(bucketPowerOfTwo(5)).toBe(4);
    expect(bucketPowerOfTwo(12000)).toBe(8192);
    const a = fingerprint({ kind: "object-storage", prefix: "s3://exports/finance/", extensions: { csv: 12, pdf: 3 }, objectCount: 12000 });
    const sameShape = fingerprint({ kind: "object-storage", prefix: "s3://exports/finance/", extensions: { pdf: 3, csv: 12 }, objectCount: 9000 });
    expect(a).toBe(sameShape); // 9000 and 12000 bucket to 8192; histogram order irrelevant
    const churn = fingerprint({ kind: "object-storage", prefix: "s3://exports/finance/", extensions: { csv: 12, pdf: 4 }, objectCount: 12000 });
    expect(churn).not.toBe(a); // a new extension IS structural
  });
});
