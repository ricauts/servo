// db-08: the platform smoke test — what the DATABASE guarantees, proven on
// the real engine rather than assumed from the migrations. Four contracts,
// each named so a failure says which pillar fell:
//
//   1. pgvector: a vector(8) column with an HNSW (vector_cosine_ops) index
//      returns the true nearest neighbour by <=> distance.
//   2. Full-text: a GIN index over to_tsvector('simple', …) is matched by
//      websearch_to_tsquery.
//   3. RLS's half-trap: ENABLE ROW LEVEL SECURITY alone does NOT bind the
//      table's OWNER — only FORCE ROW LEVEL SECURITY does. An entitlement
//      backstop that skips FORCE protects nobody, because the app connects
//      as the role that owns the tables.
//   4. Fail-closed reads: a policy keyed on
//      current_setting('app.human_id', true) returns ZERO rows when the
//      setting is absent — never all rows.
//
// docs/ARCHITECTURE.md's "what the database guarantees" block cites these
// four, so KB items stop rediscovering them.

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { tmpDb, type TmpDb } from "./helpers/tmp-db";

const handles: TmpDb[] = [];
let db: PrismaClient;

beforeEach(async () => {
  // Each describe needs a fresh clone (the RLS tables must not leak between
  // cases), but only one spare is kept alive: seven live clones would hold
  // seven Prisma pools and exhaust the server's connection budget.
  if (handles.length > 1) await handles.shift()?.dispose();
  const a = await tmpDb();
  handles.push(a);
  db = a.client;
});

afterAll(async () => {
  for (const h of handles) await h.dispose();
});

async function sql<T = unknown>(statement: string): Promise<T[]> {
  return db.$queryRawUnsafe<T[]>(statement);
}

describe("pgvector — HNSW cosine ordering", () => {
  beforeEach(async () => {
    await sql(`CREATE TABLE pgv_smoke (id int PRIMARY KEY, embedding vector(8))`);
    // Orthogonal-ish axes: the query hugs axis 0, so row 1 is the true
    // nearest; rows 2 and 3 are progressively further; row 4 is the
    // opposite corner and must come last.
    await sql(`INSERT INTO pgv_smoke VALUES
      (1, '[1,0,0,0,0,0,0,0]'),
      (2, '[0,1,0,0,0,0,0,0]'),
      (3, '[0,0,1,0,0,0,0,0]'),
      (4, '[0,0,0,0,0,0,0,1]')`);
    await sql(`CREATE INDEX pgv_smoke_hnsw ON pgv_smoke
      USING hnsw (embedding vector_cosine_ops)`);
  });

  it("returns the true nearest neighbour by <=> distance", async () => {
    const rows = await sql<{ id: number }>(
      `SELECT id FROM pgv_smoke ORDER BY embedding <=> '[0.95,0.05,0,0,0,0,0,0]' LIMIT 3`,
    );
    expect(rows.map((r) => r.id)).toEqual([1, 2, 3]);
  });

  it("ranks the opposite corner last", async () => {
    const rows = await sql<{ id: number }>(
      `SELECT id FROM pgv_smoke ORDER BY embedding <=> '[1,0,0,0,0,0,0,0]'`,
    );
    expect(rows[rows.length - 1].id).toBe(4);
    expect(rows[0].id).toBe(1);
  });
});

describe("full-text — GIN over to_tsvector, matched by websearch_to_tsquery", () => {
  beforeEach(async () => {
    await sql(`CREATE TABLE ts_smoke (id int PRIMARY KEY, body text)`);
    await sql(`INSERT INTO ts_smoke VALUES
      (1, 'The spindle motor overheats under continuous load'),
      (2, 'Printer paper jam in tray two'),
      (3, 'Spindle calibration drifts after firmware update')`);
    await sql(`CREATE INDEX ts_smoke_gin ON ts_smoke
      USING gin (to_tsvector('simple', body))`);
  });

  it("matches plain words and quoted phrases the way kbSearch does", async () => {
    const word = await sql<{ id: number }>(
      `SELECT id FROM ts_smoke
       WHERE to_tsvector('simple', body) @@ websearch_to_tsquery('simple', 'spindle')
       ORDER BY id`,
    );
    expect(word.map((r) => r.id)).toEqual([1, 3]);

    const phrase = await sql<{ id: number }>(
      `SELECT id FROM ts_smoke
       WHERE to_tsvector('simple', body) @@ websearch_to_tsquery('simple', '"spindle motor"')`,
    );
    expect(phrase.map((r) => r.id)).toEqual([1]);
  });

  it("does not match text the query never named", async () => {
    const none = await sql<{ id: number }>(
      `SELECT id FROM ts_smoke
       WHERE to_tsvector('simple', body) @@ websearch_to_tsquery('simple', 'zabbix')`,
    );
    expect(none).toHaveLength(0);
  });
});

describe("RLS — the FORCE half-trap and the fail-closed shape", () => {
  beforeEach(async () => {
    // The test connection is the container's bootstrap superuser, and
    // superusers bypass RLS entirely — so the trap is demonstrated through
    // a non-superuser role that OWNS the table, which is exactly the
    // production app's position. Roles are cluster-wide across clones, so
    // create-or-leave rather than create-or-die.
    await sql(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rls_probe') THEN
        CREATE ROLE rls_probe NOSUPERUSER NOLOGIN;
      END IF;
    END $$`);
    await sql(`CREATE TABLE rls_smoke (id int PRIMARY KEY, owner text)`);
    await sql(`INSERT INTO rls_smoke VALUES (1, 'alice'), (2, 'bob'), (3, 'carol')`);
    // The entitlement shape: the policy keys on a per-request GUC, the way
    // the KB's RLS backstop keys on app.human_id / app.agent_id.
    await sql(`CREATE POLICY rls_smoke_owner ON rls_smoke
      USING (owner = current_setting('app.human_id', true))`);
    await sql(`GRANT USAGE ON SCHEMA public TO rls_probe`);
    await sql(`GRANT SELECT ON rls_smoke TO rls_probe`);
    await sql(`ALTER TABLE rls_smoke OWNER TO rls_probe`);
    await sql(`ALTER TABLE rls_smoke ENABLE ROW LEVEL SECURITY`);
  });

  /** One query as the table-owning, non-superuser role, on a single pinned
   *  connection: SET LOCAL … ROLE scopes to the transaction, which is also
   *  what keeps Prisma's pool from answering on a different session. */
  async function selectAsProbe(
    humanId: string | null,
  ): Promise<number[]> {
    return db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL ROLE rls_probe");
      if (humanId !== null) {
        await tx.$executeRawUnsafe(`SET LOCAL app.human_id = '${humanId}'`);
      }
      const rows = await tx.$queryRawUnsafe<{ id: number }[]>("SELECT id FROM rls_smoke ORDER BY id");
      return rows.map((r) => r.id);
    });
  }

  it("HALF the trap: with only ENABLE, the table's owner still sees every row", async () => {
    const ids = await selectAsProbe("bob");
    expect(
      ids,
      "the trap changed shape: ENABLE now binds owners — update the FORCE backstop and this test",
    ).toEqual([1, 2, 3]);
  });

  it("the OTHER half: FORCE binds the owner, and the policy filters", async () => {
    await sql(`ALTER TABLE rls_smoke FORCE ROW LEVEL SECURITY`);
    const ids = await selectAsProbe("bob");
    expect(ids).toEqual([2]);
  });

  it("fail-closed: an absent setting yields ZERO rows, never all rows", async () => {
    await sql(`ALTER TABLE rls_smoke FORCE ROW LEVEL SECURITY`);
    // humanId null: the GUC is never set in this transaction — the
    // production "absent" case for current_setting(..., true).
    const ids = await selectAsProbe(null);
    expect(
      ids.length,
      "fail-open: current_setting('app.human_id', true) returned rows with the setting absent — every entitlement backstop built on it is open",
    ).toBe(0);
  });
});
