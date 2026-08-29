// cat-01: the catalog schema, its two CHECKs, the derived entitlement and
// the RLS extension. The acceptance's every clause maps to a test here —
// the CHECKs are the only things preventing a card being widened or
// downloaded, and the entitlement is DERIVED so revoking the fixture
// DataSource darkens every card in the same statement, with no mirror
// function anywhere in src/.

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { PrismaClient } from "@prisma/client";
import { tmpDb, type TmpDb } from "./helpers/tmp-db";

type ServoDb = { [key: string]: unknown };
const holder = vi.hoisted(() => ({ db: null as unknown as ServoDb }));
vi.mock("@/lib/db", () => ({ get db() { return holder.db; } }));

import { ensureAiAgents } from "@/lib/bootstrap";
import { humanChainCte, agentChainCte, entitledDocumentIds } from "@/lib/kb/entitlement";
import { DS_READABLE_BY_HUMAN, DS_READABLE_BY_AGENT } from "@/lib/catalog/datasource-contract";

const handles: TmpDb[] = [];
afterAll(async () => {
  for (const h of handles) await h.dispose();
});

let db: PrismaClient;
let catalogAgent: { id: string; aiKind: string | null };

beforeEach(async () => {
  if (handles.length > 1) await handles.shift()?.dispose();
  const a = await tmpDb();
  handles.push(a);
  db = a.client;
  holder.db = db as unknown as ServoDb;
  await ensureAiAgents();
  catalogAgent = await db.user.findUniqueOrThrow({ where: { email: "catalog@servo.ai" } });
});

async function sql<T = unknown>(statement: string): Promise<T[]> {
  return db.$queryRawUnsafe<T[]>(statement);
}

/** A minimal catalog card + its entry, as the profile pipeline will write
 *  them: one transaction, entry back-linked to document. */
async function seedCard(opts: { fqn?: string; dataSourceId?: string; profileStatus?: string } = {}) {
  const dataSourceId = opts.dataSourceId ?? "ds_fixture";
  const fqn = opts.fqn ?? "pg://warehouse/public.payroll";
  const doc = await db.document.create({
    data: {
      name: "public.payroll",
      contentType: "application/json",
      sha256: "x",
      byteSize: 0,
      data: null,
      ownerId: catalogAgent.id,
      visibility: "PRIVATE",
      kind: "CATALOG",
    },
  });
  const entry = await db.catalogEntry.create({
    data: {
      dataSourceId,
      level: "DATASET",
      fqn,
      displayName: "public.payroll",
      documentId: doc.id,
      ...(opts.profileStatus ? { profileStatus: opts.profileStatus } : {}),
    },
  });
  await db.document.update({ where: { id: doc.id }, data: { catalogEntryId: entry.id } });
  return { doc, entry };
}

describe("the CATALOG-is-private CHECKs", () => {
  it("kind=CATALOG with visibility STAFF is refused by the CHECK", async () => {
    await expect(
      db.document.create({
        data: {
          name: "card", contentType: "application/json", sha256: "x", byteSize: 0,
          ownerId: catalogAgent.id, visibility: "STAFF", kind: "CATALOG",
        },
      }),
    ).rejects.toThrow(/document_catalog_private_ck/);
  });

  it("kind=CATALOG with non-null data is refused by the other CHECK", async () => {
    await expect(
      db.document.create({
        data: {
          name: "card", contentType: "application/json", sha256: "x", byteSize: 1,
          data: new Uint8Array([1]), ownerId: catalogAgent.id, kind: "CATALOG",
        },
      }),
    ).rejects.toThrow(/document_catalog_data_null_ck/);
  });

  it("PRIVATE + NULL data succeeds — the one legal card shape", async () => {
    const { doc } = await seedCard();
    expect(doc.kind).toBe("CATALOG");
  });

  it("a FILE document is untouched by either CHECK", async () => {
    const human = await db.user.create({ data: { name: "H", email: "h@x.com", role: "AGENT" } });
    const file = await db.document.create({
      data: {
        name: "note.md", contentType: "text/markdown", sha256: "x", byteSize: 2,
        data: new Uint8Array([1, 2]), ownerId: human.id, visibility: "STAFF",
      },
    });
    expect(file.kind).toBe("FILE");
  });
});

describe("CatalogEntry shape", () => {
  it("dataSourceId+fqn is unique per source; duplicate rows raise", async () => {
    await seedCard();
    await expect(seedCard()).rejects.toMatchObject({ code: "P2002" });
    // The unique shape is the constraint itself, not just Prisma's error:
    const idx = await sql<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'CatalogEntry' AND indexname = 'CatalogEntry_dataSourceId_fqn_key'`,
    );
    expect(idx).toHaveLength(1);
    // A different source may hold the same fqn:
    const other = await seedCard({ dataSourceId: "ds_other" });
    expect(other.entry.fqn).toContain("payroll");
  });

  it("dataSourceId is a plain string with NO foreign key", async () => {
    const cols = await sql<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'CatalogEntry'`,
    );
    expect(cols.map((c) => c.column_name)).toContain("dataSourceId");
    const fks = await sql(
      `SELECT 1 FROM information_schema.table_constraints
       WHERE table_name = 'CatalogEntry' AND constraint_type = 'FOREIGN KEY'`,
    );
    expect(fks).toHaveLength(0);
  });
});

describe("derived entitlement — grant and revoke in the same statement", () => {
  it("granting the fixture DataSource makes the card retrievable; revoking darkens it, no mirror", async () => {
    const { doc } = await seedCard();
    const human = await db.user.create({ data: { name: "H", email: "h@x.com", role: "REQUESTER" } });

    // Fixture views ship EMPTY (fail-closed): the card is dark.
    expect(await entitledDocumentIds(db, { humanId: human.id, agentId: null })).not.toContain(doc.id);

    // Grant through the CONTRACT relation — the fixture implementation is
    // swapped in for the test exactly the way the merge will swap the real
    // views: DROP + CREATE over the same name.
    await db.$executeRawUnsafe(
      `CREATE OR REPLACE VIEW ${DS_READABLE_BY_HUMAN} AS
         SELECT 'ds_fixture'::text AS "dataSourceId", '${human.id}'::text AS "userId"`,
    );
    expect(await entitledDocumentIds(db, { humanId: human.id, agentId: null })).toContain(doc.id);

    // Revoke: dark again IN THE SAME STATEMENT — nothing to reconcile.
    await db.$executeRawUnsafe(
      `CREATE OR REPLACE VIEW ${DS_READABLE_BY_HUMAN} AS
         SELECT ''::text AS "dataSourceId", ''::text AS "userId" WHERE false`,
    );
    expect(await entitledDocumentIds(db, { humanId: human.id, agentId: null })).not.toContain(doc.id);
  });

  it("the agent chain derives through its own relation, and the intersection still applies", async () => {
    const { doc } = await seedCard();
    const human = await db.user.create({ data: { name: "H", email: "h@x.com", role: "REQUESTER" } });
    const agent = await db.user.create({
      data: { name: "A", email: "a@servo.ai", role: "AI_AGENT", aiKind: "RESOLVER" },
    });
    await db.$executeRawUnsafe(
      `CREATE OR REPLACE VIEW ${DS_READABLE_BY_AGENT} AS
         SELECT 'ds_fixture'::text AS "dataSourceId", '${agent.id}'::text AS "agentId"`,
    );
    // Human side dark → the A ∩ B intersection denies even though the
    // agent side is lit. The chain is unchanged by the catalog branch.
    expect(await entitledDocumentIds(db, { humanId: human.id, agentId: agent.id })).not.toContain(doc.id);
    await db.$executeRawUnsafe(
      `CREATE OR REPLACE VIEW ${DS_READABLE_BY_HUMAN} AS
         SELECT 'ds_fixture'::text AS "dataSourceId", '${human.id}'::text AS "userId"`,
    );
    expect(await entitledDocumentIds(db, { humanId: human.id, agentId: agent.id })).toContain(doc.id);
  });

  it("an UNREADABLE source contributes nothing even to an entitled principal", async () => {
    const { doc } = await seedCard({ profileStatus: "UNREADABLE" });
    const human = await db.user.create({ data: { name: "H", email: "h2@x.com", role: "REQUESTER" } });
    await db.$executeRawUnsafe(
      `CREATE OR REPLACE VIEW ${DS_READABLE_BY_HUMAN} AS
         SELECT 'ds_fixture'::text AS "dataSourceId", '${human.id}'::text AS "userId"`,
    );
    expect(await entitledDocumentIds(db, { humanId: human.id, agentId: null })).not.toContain(doc.id);
  });

  it("no KbGrant row is ever written for a card, and no mirror function exists in src/", async () => {
    await seedCard();
    await seedCard({ dataSourceId: "ds_other", fqn: "s3://exports/finance/" });
    expect(await db.kbGrant.count()).toBe(0);
    // The mirror is banned by name across the whole source tree.
    const walked: string[] = [];
    const { readdirSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (name === "node_modules" || name.startsWith(".")) continue;
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx|mjs|cjs)$/.test(name)) walked.push(p);
      }
    };
    walk("src");
    for (const file of walked) {
      expect(
        readFileSync(file, "utf8"),
        `${file} names a grant-mirroring function — derived entitlement has no reconciler`,
      ).not.toMatch(/mirrorDataSourceGrants|mirror.*[Gg]rant/i);
    }
  });
});

describe("RLS: six hardened tables, not four", () => {
  it("outside the SET LOCAL wrapper, CatalogEntry and CatalogRun return ZERO rows", async () => {
    // The test connection is the bootstrap superuser, and superusers bypass
    // RLS entirely — so the floor is proven as the table-owning NON-superuser
    // role (the same shape db-08's platform test established).
    await sql(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rls_probe') THEN
        CREATE ROLE rls_probe NOSUPERUSER NOLOGIN;
      END IF;
    END $$`);
    await sql(`GRANT USAGE ON SCHEMA public TO rls_probe`);
    await sql(`GRANT SELECT ON "CatalogEntry", "CatalogRun" TO rls_probe`);
    // The floor policies subquery Document/User/KbGrant while evaluating;
    // the probe role needs read access to them (RLS still applies to those
    // reads through their own policies).
    await sql(`GRANT SELECT ON "Document", "User", "KbGrant" TO rls_probe`);
    await seedCard();
    await db.catalogRun.create({ data: { dataSourceId: "ds_fixture", trigger: "CONNECT", tier: "TIER1" } });

    const policies = await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL ROLE rls_probe");
      const entries = await tx.$queryRawUnsafe<{ n: number }[]>("SELECT COUNT(*)::int AS n FROM \"CatalogEntry\"");
      const runs = await tx.$queryRawUnsafe<{ n: number }[]>("SELECT COUNT(*)::int AS n FROM \"CatalogRun\"");
      return { entries: entries[0].n, runs: runs[0].n };
    });
    // The GUC was never set: fail-closed, zero rows — never all.
    expect(policies.entries).toBe(0);
    expect(policies.runs).toBe(0);
  });

  it("both catalog tables carry ENABLE and FORCE", async () => {
    const rows = await sql<{ relname: string; relrowsecurity: string; relforcerowsecurity: string }>(
      `SELECT c.relname, c.relrowsecurity::text, c.relforcerowsecurity::text
         FROM pg_class c WHERE c.relname IN ('CatalogEntry','CatalogRun')`,
    );
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.relrowsecurity).toBe("true");
      expect(row.relforcerowsecurity).toBe("true");
    }
  });
});

describe("ownership and the system agent", () => {
  it("Servo Catalog exists, and no human role owns a CATALOG document", async () => {
    expect(catalogAgent.aiKind).toBe("CATALOG");
    await seedCard();
    const owners = await sql<{ roles: string }>(
      `SELECT DISTINCT u.role AS roles FROM "Document" d JOIN "User" u ON u.id = d."ownerId"
        WHERE d.kind = 'CATALOG'`,
    );
    for (const row of owners) {
      expect(["ADMIN", "AGENT", "REQUESTER"]).not.toContain(row.roles);
    }
  });
});

describe("the fourth locator shape and the unions", () => {
  it("DocumentChunk accepts {entry, section, from?} as a locator value", async () => {
    const { doc } = await seedCard();
    await db.documentChunk.create({
      data: {
        documentId: doc.id,
        index: 0,
        text: "net_pay numeric(12,2)",
        locator: { entry: "ce_fixture", section: "columns", from: "net_pay" },
      },
    });
    const chunk = await db.documentChunk.findFirstOrThrow({ where: { documentId: doc.id } });
    expect(chunk.locator).toEqual({ entry: "ce_fixture", section: "columns", from: "net_pay" });
  });

  it("the schema comment carries the fourth shape; no parallel column exists", async () => {
    const schema = readFileSync("prisma/schema.prisma", "utf8");
    expect(schema).toMatch(/"entry":"\.\.\.","section":"columns","from":"net_pay"/);
    const cols = await sql<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'DocumentChunk'`,
    );
    expect(cols.map((c) => c.column_name)).not.toContain("entry");
  });

  it("the placeholder personal-agent rule: entitlement flows through DS_READABLE_BY_AGENT only", () => {
    // PLACEHOLDER, named for the rule it must grow into (cat-01
    // acceptance): the day AgentProfile gains an owner column, extend this
    // to intersect the agent owner's OWN entitlements inside
    // datasource_readable_by_agent — a personal agent's effective set is
    // explicit grants ∩ its owner's set. Today there is no owner column,
    // so the only assertion available is the one that pins the flow point.
    expect(DS_READABLE_BY_AGENT).toBe("datasource_readable_by_agent");
    expect(DS_READABLE_BY_HUMAN).toBe("datasource_readable_by_human");
    const agentSql = agentChainCte("human-x", "agent-y");
    expect(agentSql).toContain("datasource_readable_by_agent");
    const humanSql = humanChainCte("human-x");
    expect(humanSql).toContain("datasource_readable_by_human");
    expect(humanSql).not.toContain("datasource_readable_by_agent");
  });
});
