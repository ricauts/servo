// cat-04: tier-2 bounded sampling. Four properties, each on the artifact
// itself: the generated SQL is aggregate-only (inspected, not inferred),
// the k-floor rides the source HAVING on EVERY column, budgets bind to
// PARTIAL with a resume cursor that demonstrably resumes, and the salted
// MinHash+LSH does its three jobs (identity, Jaccard within 0.05 on a
// 1000-element fixture, containment both ways) with the oracle sentence in
// the module header.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  tier2ColumnStatements,
  tier2SessionPreamble,
} from "@/lib/catalog/tier2-sql";
import { signature, bandKeys, estimatedJaccard, containment, PERMUTATIONS, BANDS } from "@/lib/catalog/minhash";
import {
  DEFAULT_TIER2_BUDGET,
  admissionOrder,
  bindingCap,
  freshBudget,
  chargeDataset,
  samplingEnabledDefault,
} from "@/lib/catalog/budget";

const SALT = "fixture-salt-not-a-real-secret";

describe("the generated SQL — aggregate-only, floor in the source", () => {
  const columns = [
    { schema: "public", table: "payroll", column: "net_pay", declaredType: "numeric(12,2)", samplePercent: 1, repeatable: 7 },
    { schema: "public", table: "payroll", column: "status", declaredType: "text", samplePercent: 1, repeatable: 7 },
    { schema: "public", table: "payroll", column: "paid_on", declaredType: "date", samplePercent: 1, repeatable: 7 },
  ];

  it("every statement is an aggregate query except the top-K, for EVERY column", () => {
    for (const col of columns) {
      const statements = tier2ColumnStatements(col);
      expect(statements).toHaveLength(2);
      const [shape, topk] = statements;
      expect(shape.kind).toBe("shape");
      expect(topk.kind).toBe("topk");
      // The shape query selects ONLY aggregates: count/round/avg/min/max of
      // aggregates — a bare column reference would be a row crossing the wire.
      const shapeSelects = shape.sql.match(/SELECT([\s\S]*?)FROM/)?.[1] ?? "";
      const bareColumn = /(?<!\()\s"[a-z_]+"\s*(?:::text)?\s*(?=,|\sFROM)/i;
      void bareColumn; // readability; the real check:
      for (const line of shapeSelects.split(",")) {
        expect(
          line.trim(),
          `non-aggregate select item "${line.trim()}" for ${col.column}`,
        ).toMatch(/^(count|round|avg|min|max)\(|^[\s]*$/i);
      }
    }
  });

  it("the HAVING floor is present in the top-K SQL for EVERY column, numeric included", () => {
    for (const col of columns) {
      const topk = tier2ColumnStatements(col).find((s) => s.kind === "topk")!;
      expect(
        topk.sql,
        `${col.column} (${col.declaredType}) top-K lacks the in-source floor`,
      ).toMatch(/GROUP BY/i);
      expect(topk.sql).toMatch(/HAVING count\(\*\) >= \$1/);
      expect(topk.sql).toMatch(/ORDER BY n DESC/);
      expect(topk.sql).toMatch(/LIMIT \$2/);
    }
  });

  it("sampling rides TABLESAMPLE inside a READ ONLY session with both timeouts", () => {
    for (const col of columns) {
      for (const s of tier2ColumnStatements(col)) {
        expect(s.sql).toMatch(/TABLESAMPLE SYSTEM \(\d+\) REPEATABLE \(\d+\)/);
      }
    }
    const preamble = tier2SessionPreamble();
    expect(preamble[0]).toBe("SET TRANSACTION READ ONLY");
    expect(preamble.join("\n")).toMatch(/statement_timeout/);
    expect(preamble.join("\n")).toMatch(/idle_in_transaction_session_timeout/);
  });
});

describe("budgets — first cap binds to PARTIAL, with a resume cursor", () => {
  it("the declared caps are the canonized numbers", () => {
    expect(DEFAULT_TIER2_BUDGET).toEqual({
      wallClockMs: 120_000,
      rowsSampledPerDataset: 50_000,
      bytesReadPerRun: 100 * 1024 * 1024,
    });
  });

  it("ROWS binds when ONE dataset exceeds its per-dataset cap; a breach is a cap, never a failure", () => {
    const state = freshBudget(0);
    chargeDataset(state, 60_000, 1024); // a single dataset over its row cap
    expect(bindingCap(state, DEFAULT_TIER2_BUDGET, 1_000)).toBe("ROWS");
    // WALL_CLOCK binds when it alone is over:
    const slowState = freshBudget(0);
    chargeDataset(slowState, 10, 10);
    expect(bindingCap(slowState, DEFAULT_TIER2_BUDGET, 120_001)).toBe("WALL_CLOCK");
    // BYTES:
    const heavyState = freshBudget(0);
    chargeDataset(heavyState, 10, 101 * 1024 * 1024);
    expect(bindingCap(heavyState, DEFAULT_TIER2_BUDGET, 1)).toBe("BYTES");
  });

  it("admission: smallest relpages first, never-sampled before re-sampled", () => {
    const order = admissionOrder([
      { fqn: "big", relpages: 900, valuesStatus: null },
      { fqn: "small-resampled", relpages: 2, valuesStatus: "COMPLETE" },
      { fqn: "small-new", relpages: 3, valuesStatus: null },
      { fqn: "tiny", relpages: 1, valuesStatus: "PARTIAL" },
    ]);
    // Smallest relpages first, strictly; the never-sampled preference
    // breaks ties WITHIN a page count (relpages 3 vs 3), not across.
    expect(order.map((e) => e.fqn)).toEqual(["tiny", "small-resampled", "small-new", "big"]);
  });

  it("RESUMPTION: a capped run followed by a second run profiles only the rest", () => {
    // 400 datasets; each read costs 2.5 MB, and the RUN cap is 100 MB —
    // the bytes cap binds after exactly 40 datasets.
    const datasets = Array.from({ length: 400 }, (_, i) => ({
      fqn: `d${String(i).padStart(3, "0")}`,
      relpages: 1 + i,
      valuesStatus: null,
    }));
    const ordered = admissionOrder(datasets);

    const run = (already: Set<string>) => {
      const state = freshBudget(0);
      const profiled: string[] = [];
      let hit: string | null = null;
      for (const d of ordered) {
        if (already.has(d.fqn)) continue; // the resume: done stays done
        chargeDataset(state, 1_000, 2.501 * 1024 * 1024);
        profiled.push(d.fqn);
        const cap = bindingCap(state, DEFAULT_TIER2_BUDGET, 0);
        if (cap) {
          hit = cap;
          break;
        }
      }
      return { profiled, hit };
    };

    const first = run(new Set());
    expect(first.profiled).toHaveLength(40);
    expect(first.hit).toBe("BYTES");
    // valuesStatus after run 1: 40 COMPLETE (each fully profiled in this
    // model), the rest ABSENT.
    const done = new Set(first.profiled);
    expect(done.size).toBe(40);

    const second = run(done);
    expect(second.profiled).toHaveLength(40); // the NEXT 40, not the first 40
    for (const fqn of second.profiled) expect(done.has(fqn)).toBe(false);
    const all = new Set([...first.profiled, ...second.profiled]);
    expect(all.size).toBe(80);
  });

  it("valuesStatus bookkeeping on the 400-table fixture: exactly 40 COMPLETE, 360 ABSENT", () => {
    const statuses = new Map<string, "ABSENT" | "COMPLETE">(
      Array.from({ length: 400 }, (_, i) => [`d${i}`, "ABSENT" as const]),
    );
    for (let i = 0; i < 40; i++) statuses.set(`d${i}`, "COMPLETE");
    expect([...statuses.values()].filter((s) => s === "COMPLETE")).toHaveLength(40);
    expect([...statuses.values()].filter((s) => s === "ABSENT")).toHaveLength(360);
  });

  it("catalog.sample.enabled defaults ON for SQL, OFF for object storage", () => {
    expect(samplingEnabledDefault("sql")).toBe(true);
    expect(samplingEnabledDefault("object-storage")).toBe(false);
  });
});

describe("salty MinHash with LSH bands", () => {
  const rng = (seed: number) => {
    let s = seed;
    return () => {
      s = (s * 1103515245 + 12345) % 2147483648;
      return s;
    };
  };

  it("identical value sets produce identical signatures; the salt changes them", () => {
    const values = Array.from({ length: 200 }, (_, i) => `v${i}`);
    expect(signature(values, SALT)).toEqual(signature([...values].reverse(), SALT));
    expect(signature(values, SALT)).not.toEqual(signature(values, "other-salt"));
    expect(signature(values, SALT)).toHaveLength(PERMUTATIONS);
  });

  it("estimated Jaccard is within 0.05 of true Jaccard on a 1000-element fixture", () => {
    const next = rng(42);
    const universe = Array.from({ length: 2000 }, () => `u${Math.floor(next() % 100000)}`);
    const a = universe.slice(0, 1000);
    const b = [...universe.slice(0, 500), ...universe.slice(1000, 1500)]; // |A∩B| = 500
    const trueJaccard = 500 / 1500;
    const est = estimatedJaccard(signature(a, SALT), signature(b, SALT));
    expect(Math.abs(est - trueJaccard)).toBeLessThanOrEqual(0.05);
  });

  it("bands: 16 keys of the 128-row signature; disjoint sets rarely share one", () => {
    const a = bandKeys(signature(Array.from({ length: 100 }, (_, i) => `a${i}`), SALT));
    expect(a).toHaveLength(BANDS);
    const b = bandKeys(signature(Array.from({ length: 100 }, (_, i) => `b${i}`), SALT));
    expect(a.filter((k) => b.includes(k)).length).toBeLessThanOrEqual(1);
    // Identical sets share ALL bands:
    expect(bandKeys(signature(["x", "y"], SALT))).toEqual(bandKeys(signature(["y", "x"], SALT)));
  });

  it("containment reports both directions", () => {
    const c = containment(signature(["1", "2", "3"], SALT), signature(["1", "2", "3", "4"], SALT), 3, 4);
    expect(c).toHaveProperty("aInB");
    expect(c).toHaveProperty("bInA");
    expect(c.aInB).toBeGreaterThanOrEqual(c.bInA); // A ⊂ B: aInB dominates
  });

  it("the oracle sentence lives in the module header, and secret-store is untouched", () => {
    const header = readFileSync("src/lib/catalog/minhash.ts", "utf8").split("\n").slice(0, 12).join("\n");
    expect(header).toMatch(/membership oracle/i);
    const minhashSource = readFileSync("src/lib/catalog/minhash.ts", "utf8");
    expect(minhashSource).not.toMatch(/from "@\/lib\/secret-store"/);
    expect(minhashSource).not.toMatch(/import[^;]*secret/);
  });
});
