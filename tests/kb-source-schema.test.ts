// xds-01: the DataSource model, the rules that live in the CATALOG rather
// than only in JavaScript, the third KbGrant target, the never-Servo's-own-
// database guard, and the two new permission actions.
//
// Everything runs on a tmpDb() clone. The constraint cases INSERT with RAW
// SQL on purpose: a validator in a route proves nothing about a row written
// by a seed, a migration or a psql session, and "the rules are in the
// catalog" is the criterion. The guard cases run against TWO REAL Postgres
// endpoints — 5433 (the throwaway test server) and 5434 (docker-compose's
// extdb) — because a guard that compares URL strings passes against one.

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { hostname } from "node:os";
import { PrismaClient } from "@prisma/client";
import { tmpDb, testDatabaseUrl, urlForDatabase, type TmpDb } from "./helpers/tmp-db";

type ServoDb = { [key: string]: unknown };
const holder = vi.hoisted(() => ({
  db: null as unknown as ServoDb,
  user: null as unknown as { id: string; role: string },
}));
vi.mock("@/lib/db", () => ({ get db() { return holder.db; } }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: async () => holder.user }));

import { GET as getSources, POST as postSource } from "@/app/api/kb/sources/route";
import { GET as getSource } from "@/app/api/kb/sources/[id]/route";
import { can } from "@/lib/permissions";
import {
  SourceValidationError,
  addressToken,
  assertNotServoDatabase,
  parsePostgresUrl,
  validateSourceConfig,
  validateSourceScope,
} from "@/lib/kb/sources";

const handles: TmpDb[] = [];
afterAll(async () => {
  for (const h of handles) await h.dispose();
});

let db: PrismaClient;
let admin: { id: string; role: string };
let deskAgent: { id: string; role: string };
let requester: { id: string; role: string };

beforeEach(async () => {
  if (handles.length > 1) await handles.shift()?.dispose();
  const handle = await tmpDb();
  handles.push(handle);
  db = handle.client;
  holder.db = db as unknown as ServoDb;
  const mk = async (name: string, email: string, role: string) =>
    ({ ...(await db.user.create({ data: { name, email, role } })), role });
  admin = await mk("Admin", `a${Date.now()}@x.com`, "ADMIN");
  deskAgent = await mk("Desk", `d${Date.now()}@x.com`, "AGENT");
  requester = await mk("Req", `r${Date.now()}@x.com`, "REQUESTER");
  holder.user = admin;
});

/** A DataSource written with RAW SQL — the point of every constraint case
 *  below is that the route is not the thing enforcing the rule. */
function rawSource(fields: Record<string, string>): Promise<unknown> {
  const row: Record<string, string> = {
    id: `'s${Math.random().toString(36).slice(2, 10)}'`,
    name: `'n${Math.random().toString(36).slice(2, 10)}'`,
    kind: `'S3'`,
    '"secretRef"': `''`,
    '"createdById"': `'${admin.id}'`,
    '"updatedAt"': "now()",
    ...fields,
  };
  return db.$executeRawUnsafe(
    `INSERT INTO "DataSource"(${Object.keys(row).join(",")}) VALUES (${Object.values(row).join(",")})`,
  );
}

async function source(overrides: Record<string, unknown> = {}) {
  return db.dataSource.create({
    data: { name: `src-${Math.random().toString(36).slice(2, 10)}`, kind: "S3", secretRef: "", createdById: admin.id, ...overrides },
  });
}

describe("the DataSource model lands as canonized", () => {
  it("carries every column with its default, and mode defaults to INDEX", async () => {
    const row = await source();
    expect(row).toMatchObject({
      mode: "INDEX",
      status: "DISABLED",
      statusError: null,
      lastSyncAt: null,
      lastCompleteSyncAt: null,
      syncEveryMin: 0,
      maxRows: 20_000,
    });
    expect(row.configJson).toEqual({});
    expect(row.scopeJson).toEqual([]);
    expect(row.cursorJson).toEqual({});
    expect(row.createdAt).not.toBeNull();
    expect(row.updatedAt).not.toBeNull();
  });

  it("stores the unions as strings and the three config columns as JSONB — no Prisma enum", async () => {
    const cols = await db.$queryRawUnsafe<{ column_name: string; data_type: string; is_nullable: string }[]>(
      `SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'DataSource'`,
    );
    const by = new Map(cols.map((c) => [c.column_name, c]));
    for (const name of ["kind", "mode", "status", "secretRef"]) {
      expect(by.get(name)?.data_type, name).toBe("text");
    }
    for (const name of ["configJson", "scopeJson", "cursorJson"]) {
      expect(by.get(name)?.data_type, name).toBe("jsonb");
    }
    expect(by.get("name")?.is_nullable).toBe("NO");
    expect(by.get("statusError")?.is_nullable).toBe("YES");
    // A Prisma enum would be a USER-DEFINED type in this catalog.
    const enums = await db.$queryRawUnsafe<{ typname: string }[]>(
      `SELECT typname FROM pg_type WHERE typtype = 'e'`,
    );
    expect(enums).toEqual([]);
  });

  it("name is unique", async () => {
    await source({ name: "erp" });
    await expect(source({ name: "erp" })).rejects.toThrow();
  });
});

describe("Document and KbGrant gain their external columns", () => {
  it("Document takes sourceId, externalLocator, externalVersion, externalSeenAt and the GONE status", async () => {
    const src = await source();
    const doc = await db.document.create({
      data: {
        name: "row.md",
        contentType: "text/markdown",
        byteSize: 1,
        sha256: "1".repeat(64),
        ownerId: admin.id,
        sourceId: src.id,
        textStatus: "GONE",
        externalLocator: { kind: "S3", bucket: "contracts", key: "2026/a.pdf" },
        externalVersion: '"9f8c"',
        externalSeenAt: new Date(),
      },
    });
    expect(doc.textStatus).toBe("GONE");
    expect(doc.externalLocator).toMatchObject({ kind: "S3" });
    expect(doc.externalSeenAt).not.toBeNull();
  });

  it("the source FK is RESTRICT: a source cannot be deleted out from under its documents", async () => {
    const src = await source();
    await db.document.create({
      data: { name: "a.md", contentType: "text/markdown", byteSize: 1, sha256: "2".repeat(64), ownerId: admin.id, sourceId: src.id },
    });
    await expect(db.dataSource.delete({ where: { id: src.id } })).rejects.toThrow();
  });

  it("an uploaded document keeps sourceId NULL and every external column NULL", async () => {
    const doc = await db.document.create({
      data: { name: "u.md", contentType: "text/markdown", byteSize: 1, sha256: "3".repeat(64), ownerId: admin.id },
    });
    expect(doc.sourceId).toBeNull();
    expect(doc.externalLocator).toBeNull();
    expect(doc.externalVersion).toBeNull();
    expect(doc.externalSeenAt).toBeNull();
  });
});

describe("the rules are in the catalog, not only in JavaScript", () => {
  it("refuses mode FEDERATE on a RAW INSERT", async () => {
    await expect(rawSource({ mode: `'FEDERATE'` })).rejects.toThrow(/DataSource_mode_check/);
    await expect(rawSource({ mode: `'INDEX'` })).resolves.toBeDefined();
  });

  it("refuses a kind outside S3 | POSTGRES on a RAW INSERT", async () => {
    await expect(rawSource({ kind: `'MYSQL'` })).rejects.toThrow(/DataSource_kind_check/);
  });

  it("refuses a status outside the six on a RAW INSERT", async () => {
    await expect(rawSource({ status: `'HEALTHY'` })).rejects.toThrow(/DataSource_status_check/);
    for (const ok of ["DISABLED", "READY", "SYNCING", "ERROR", "UNREACHABLE", "PURGED"]) {
      await expect(rawSource({ status: `'${ok}'` }), ok).resolves.toBeDefined();
    }
  });

  it("refuses a wildcard bucket, schema or table on a RAW INSERT", async () => {
    for (const bad of [`[{"bucket":"*"}]`, `[{"schema":"*","table":"t"}]`, `[{"schema":"public","table":"*"}]`]) {
      await expect(rawSource({ '"scopeJson"': `'${bad}'` }), bad).rejects.toThrow(/DataSource_scope_allowlist/);
    }
  });

  it("refuses a free-text where key, and a non-object scope entry, on a RAW INSERT", async () => {
    await expect(
      rawSource({ '"scopeJson"': `'[{"schema":"public","table":"invoices","where":"1=1"}]'` }),
    ).rejects.toThrow(/DataSource_scope_allowlist/);
    await expect(rawSource({ '"scopeJson"': `'["*"]'` })).rejects.toThrow(/DataSource_scope_allowlist/);
  });

  it("a deeply nested scope is refused CHEAPLY — the CHECK cannot be turned into a denial of service", async () => {
    // The `$.**` + keyvalue() spelling that first closed the case/nesting
    // holes allocated superlinearly in depth: 8 s of backend CPU at 2,000
    // levels, and an OOM-kill that took the whole cluster into crash recovery
    // at 8,000. Refusing nesting outright keeps the rules non-recursive.
    let nested = '"leaf"';
    for (let i = 0; i < 8000; i++) nested = `{"a":${nested}}`;
    const payload = `[{"schema":"public","table":"t","idColumn":"id","textColumns":["b"],"titleColumn":${nested}}]`;
    const started = Date.now();
    await expect(rawSource({ '"scopeJson"': `'${payload}'` })).rejects.toThrow(/DataSource_scope_allowlist/);
    expect(Date.now() - started).toBeLessThan(5_000);
    // And the server is still there to answer.
    expect(await db.$queryRawUnsafe(`SELECT 1 AS ok`)).toEqual([{ ok: 1 }]);
  });

  it("the CATALOG is not looser than the ROUTE: case, nesting and non-string wildcards all raise too", async () => {
    // Each of these committed under the narrow `$[*].where` / `$[*].bucket`
    // spelling while src/lib/kb/sources.ts refused them — which would make
    // "as constrained as one written by the route" false in the direction
    // that matters. The raw INSERT is the whole point: a JS validator cannot
    // stop a seed or a psql session.
    // The whitespace spellings are here because an anchored match with a
    // character class does NOT give parity: POSIX [[:space:]] and JavaScript
    // \s disagree about NBSP, the zero-width no-break space and the vertical
    // tab, and all six committed in the catalog while the route refused them.
    // Both sides now test CONTAINMENT, which is the same rule twice.
    const payloads = [
      `[{"schema":"public","table":"t","WHERE":"1=1"}]`,
      `[{"schema":"public","table":"t","Where":"1=1"}]`,
      `[{"schema":"public","table":"t","where ":"1=1"}]`,
      `[{"schema":"public","table":"t","\\u0009where":"1=1"}]`,
      `[{"schema":"public","table":"t","\\u000bwhere":"1=1"}]`,
      `[{"schema":"public","table":"t","\\u00a0where":"1=1"}]`,
      `[{"schema":"public","table":"t","\\u2003where":"1=1"}]`,
      `[{"schema":"public","table":"t","\\ufeffwhere":"1=1"}]`,
      `[{"schema":"public","table":"t","where\\u000a":"1=1"}]`,
      `[{"schema":"public","table":"t","filter":{"where":"1=1 OR true"}}]`,
      `[{"bucket":{"n":"*"}}]`,
      `[{"bucket":"b","suffixes":["*"]}]`,
      `[{"bucket":"b","nested":{"deep":"any*thing"}}]`,
      `[{"bucket":"b","suffixes":[{"where":"1=1"}]}]`,
      // A wildcard buried in nested arrays: caught by the string rule one and
      // two levels down, and by the nesting rule from three levels down,
      // which is what makes "carries * for bucket, schema or table" hold at
      // every depth rather than only at the top.
      `[{"bucket":"b","suffixes":[["*"]]}]`,
      `[{"bucket":"b","suffixes":[[["*"]]]}]`,
      `[{"bucket":"b","suffixes":[[{"where":"1=1"}]]}]`,
    ];
    for (const payload of payloads) {
      await expect(rawSource({ '"scopeJson"': `'${payload}'` }), payload).rejects.toThrow(
        /DataSource_scope_allowlist/,
      );
      // The route refuses the same payload — neither side is the looser one.
      expect(() => validateSourceScope("S3", JSON.parse(payload)), payload).toThrow(SourceValidationError);
      expect(() => validateSourceScope("POSTGRES", JSON.parse(payload)), payload).toThrow(SourceValidationError);
    }
  });

  it("the ONE asymmetry is the harmless direction, and it is the one the header names", async () => {
    // An array of arrays of plain strings carries neither a wildcard nor a
    // predicate, so neither of the criterion's two rules applies to it. It
    // commits in the catalog (jsonpath's lax mode unwraps it out of sight)
    // and the ROUTE refuses it as a shape error. Route-stricter is the safe
    // direction: no row the route writes can be one the catalog rejects.
    await expect(rawSource({ '"scopeJson"': `'[{"bucket":"b","suffixes":[[".pdf"]]}]'` })).resolves.toBeDefined();
    expect(() => validateSourceScope("S3", [{ bucket: "b", suffixes: [[".pdf"]] }])).toThrow(/may not nest/);
  });

  it("accepts a real scope entry and an EMPTY list — empty reaches nothing, it is not an error", async () => {
    await expect(
      rawSource({ '"scopeJson"': `'[{"bucket":"contracts","prefix":"2026/","suffixes":[".pdf"]}]'` }),
    ).resolves.toBeDefined();
    await expect(rawSource({ '"scopeJson"': `'[]'` })).resolves.toBeDefined();
  });
});

describe("KbGrant gains a third target", () => {
  async function grant(fields: Record<string, string | null>) {
    const cols = ['"subjectType"', '"subjectId"', "access", '"grantedById"', ...Object.keys(fields)];
    const vals = [`'USER'`, `'${admin.id}'`, `'READ'`, `'${admin.id}'`, ...Object.values(fields).map((v) => (v === null ? "NULL" : `'${v}'`))];
    return db.$executeRawUnsafe(
      `INSERT INTO "KbGrant"(id,${cols.join(",")}) VALUES ('g${Math.random().toString(36).slice(2, 10)}',${vals.join(",")})`,
    );
  }

  it("two of the three targets raise the CHECK; none raises it too", async () => {
    const src = await source();
    const coll = await db.collection.create({ data: { name: `c${Date.now()}` } });
    await expect(grant({ '"sourceId"': src.id, '"collectionId"': coll.id })).rejects.toThrow(/KbGrant_one_target/);
    await expect(grant({})).rejects.toThrow(/KbGrant_one_target/);
    await expect(grant({ '"sourceId"': src.id })).resolves.toBeDefined();
  });

  it("two identical source+subject grants raise the unique violation", async () => {
    const src = await source();
    await grant({ '"sourceId"': src.id });
    // Prisma rewrites the server's message and drops the constraint NAME, so
    // the assertion is on the key tuple Postgres reports — which is the third
    // partial index's column list and nothing else's.
    await expect(grant({ '"sourceId"': src.id })).rejects.toThrow(
      /Key \("sourceId", "subjectType", "subjectId"\)[\s\S]*already exists/,
    );
    // A grant of the same subject on a DIFFERENT source is not a duplicate.
    const other = await source();
    await expect(grant({ '"sourceId"': other.id })).resolves.toBeDefined();
  });

  it("the two pre-existing partial indexes are untouched, and the third has the same shape", async () => {
    const rows = await db.$queryRawUnsafe<{ indexname: string; indexdef: string }[]>(
      `SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'KbGrant' ORDER BY indexname`,
    );
    const by = new Map(rows.map((r) => [r.indexname, r.indexdef]));
    expect(by.get("KbGrant_doc_subject_key")).toMatch(/WHERE \("documentId" IS NOT NULL\)/);
    expect(by.get("KbGrant_coll_subject_key")).toMatch(/WHERE \("collectionId" IS NOT NULL\)/);
    const third = by.get("kbgrant_source_subject") ?? "";
    expect(third).toMatch(/UNIQUE INDEX/);
    expect(third).toMatch(/"sourceId", "subjectType", "subjectId"/);
    expect(third).toMatch(/WHERE \("sourceId" IS NOT NULL\)/);
  });

  it("the exactly-one CHECK now names all three columns", async () => {
    const rows = await db.$queryRawUnsafe<{ def: string }[]>(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'KbGrant_one_target'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].def).toMatch(/num_nonnulls/);
    expect(rows[0].def).toMatch(/sourceId/);
  });
});

describe("row level security", () => {
  it("DataSource is born under ENABLE and FORCE row level security", async () => {
    const rows = await db.$queryRawUnsafe<{ relrowsecurity: boolean; relforcerowsecurity: boolean }[]>(
      `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'DataSource'`,
    );
    expect(rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  });

  it("kb-15's grant policy is amended for the third target type", async () => {
    const rows = await db.$queryRawUnsafe<{ polname: string; qual: string }[]>(
      `SELECT p.polname, pg_get_expr(p.polqual, p.polrelid) AS qual
         FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
        WHERE c.relname IN ('KbGrant','DataSource')`,
    );
    const grantPolicy = rows.find((r) => r.polname === "kb_grant_floor");
    expect(grantPolicy?.qual).toMatch(/app\.human_id/);
    expect(grantPolicy?.qual).toMatch(/sourceId/);
    expect(rows.find((r) => r.polname === "kb_source_floor")?.qual).toMatch(/app\.human_id/);
  });

  it("the floor stays COARSER than the application filter — no ceiling, and no second table", async () => {
    // Asserted from the live catalog, not from the file, so a later edit that
    // moves the source ceiling into RLS trips a test rather than passing
    // quietly: the ceiling belongs in src/lib/kb/entitlement.ts (xds-02).
    const rows = await db.$queryRawUnsafe<{ polname: string; qual: string }[]>(
      `SELECT p.polname, pg_get_expr(p.polqual, p.polrelid) AS qual
         FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
        WHERE c.relname IN ('KbGrant','DataSource')`,
    );
    for (const row of rows) {
      // Nothing about which sources a principal may read, nothing about
      // status, nothing about GONE.
      expect(row.qual, row.polname).not.toMatch(/GONE/);
      expect(row.qual, row.polname).not.toMatch(/DISABLED|PURGED|status/);
    }
    // And the grant floor reads no SECOND table. It is not only a coarseness
    // rule: kb_document_floor already subqueries "KbGrant", so a policy here
    // that reads "DataSource" imposes SELECT on "DataSource" on every role
    // that reads a Document — which is exactly how kb-15's NOBYPASSRLS probe
    // role broke ("permission denied for table DataSource").
    const grantPolicy = rows.find((r) => r.polname === "kb_grant_floor");
    expect(grantPolicy?.qual).not.toMatch(/DataSource/);

    const sql = readFileSync("prisma/migrations/0012_datasource/migration.sql", "utf8");
    expect(sql).toMatch(/COARSER than the application filter/);
  });

  it("BEHAVIOURALLY: the amended grant floor still lets kb-15's probe role read, and still closes without a principal", async () => {
    // The structural assertions above would all pass if the floor let
    // everything through, and they would not have caught the regression that
    // shipped in the first draft of this migration (a policy reading
    // "DataSource" made every Document read fail with "permission denied for
    // table DataSource" for kb-15's role). This is the same probe kb-15 uses:
    // roles are cluster-wide, so the name carries the pid and a counter.
    const role = `xds_probe_${process.pid}_${Math.floor(Math.random() * 1e6)}`;
    const src = await source();
    const doc = await db.document.create({
      data: { name: "public.md", contentType: "text/markdown", byteSize: 1, sha256: "9".repeat(64), ownerId: admin.id, visibility: "PUBLIC" },
    });
    await db.kbGrant.create({
      data: { documentId: doc.id, subjectType: "USER", subjectId: admin.id, grantedById: admin.id },
    });
    await db.kbGrant.create({
      data: { sourceId: src.id, subjectType: "USER", subjectId: admin.id, grantedById: admin.id },
    });
    await db.$executeRawUnsafe(`CREATE ROLE ${role} NOLOGIN NOBYPASSRLS`);
    for (const table of ["Document", "DocumentChunk", "KnowledgeEdge", "KbGrant"]) {
      await db.$executeRawUnsafe(`ALTER TABLE "${table}" OWNER TO ${role}`);
    }
    await db.$executeRawUnsafe(`GRANT SELECT ON "User" TO ${role}`);

    const asProbe = <T>(humanId: string | null, sql: string) =>
      db.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL ROLE ${role}`);
        if (humanId !== null) await tx.$executeRawUnsafe(`SET LOCAL app.human_id = '${humanId}'`);
        return tx.$queryRawUnsafe<T>(sql);
      });

    // The regression case: reading Document goes through kb_document_floor,
    // which subqueries "KbGrant", whose policy must not reach a fifth table
    // this role has no privilege on.
    const docs = await asProbe<{ name: string }[]>(admin.id, `SELECT name FROM "Document"`);
    expect(docs.map((r) => r.name)).toContain("public.md");
    const grants = await asProbe<{ id: string }[]>(admin.id, `SELECT id FROM "KbGrant"`);
    expect(grants.length).toBe(2); // the document grant AND the source grant

    // Closed, not open, with no principal resolved. This must run on a
    // connection that has NEVER carried one: after a single committed
    // transaction that did `SET LOCAL app.human_id`, the same pooled
    // connection reports current_setting('app.human_id', true) as '' rather
    // than NULL, and every kb-15 policy whose gate is that NULL test opens.
    // That is a pre-existing property of 0004_kb_rls, not of this item — it
    // is raised as a dated owner question in §14 — so the check here uses a
    // fresh client rather than asserting a guarantee this item did not make.
    const fresh = new PrismaClient({ datasourceUrl: handles[handles.length - 1].url });
    try {
      const blind = await fresh.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL ROLE ${role}`);
        return tx.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM "KbGrant"`);
      });
      expect(blind).toEqual([]);
    } finally {
      await fresh.$disconnect();
    }
  });
});

describe("assertNotServoDatabase — resolved addresses, never a URL string", () => {
  const TEST_URL = testDatabaseUrl();
  const own = parsePostgresUrl(urlForDatabase("servo_test_guard", TEST_URL));
  const SECOND_PORT = 5434;
  let saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    saved = {
      DATABASE_URL: process.env.DATABASE_URL,
      OPS_DATABASE_URL: process.env.OPS_DATABASE_URL,
      OPS_DATABASE_READONLY_URL: process.env.OPS_DATABASE_READONLY_URL,
    };
    delete process.env.OPS_DATABASE_URL;
    delete process.env.OPS_DATABASE_READONLY_URL;
    process.env.DATABASE_URL = urlForDatabase("servo_test_guard", TEST_URL);
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("the second Postgres on 5434 is a REAL, DIFFERENT server", async () => {
    const url = new URL(TEST_URL);
    url.port = String(SECOND_PORT);
    const second = new PrismaClient({ datasourceUrl: url.toString() });
    try {
      const there = await second.$queryRawUnsafe<{ port: number }[]>(`SELECT inet_server_port() AS port`);
      expect(Number(there[0].port)).toBe(SECOND_PORT);
    } catch (err) {
      throw new Error(
        `The external test Postgres on ${SECOND_PORT} is not reachable, so the guard cannot be proven ` +
          `against two endpoints. Start it with: docker compose -f docker-compose.test.yml up -d\n` +
          `  ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      await second.$disconnect();
    }
    const here = await db.$queryRawUnsafe<{ port: number }[]>(`SELECT inet_server_port() AS port`);
    expect(Number(here[0].port)).not.toBe(SECOND_PORT);
  });

  it("REFUSES Servo's own database spelled localhost, 127.0.0.1 and the container hostname — all three", async () => {
    expect(own).not.toBeNull();
    // The third spelling is the CONTAINER'S OWN NAME — a name that resolves
    // to the same address as the other two, which is exactly the case a
    // string comparison lets through.
    const spellings = ["localhost", "127.0.0.1", hostname()];
    for (const host of spellings) {
      await expect(
        assertNotServoDatabase({ host, port: own!.port, database: own!.database }),
        host,
      ).rejects.toThrow(/Servo's own database/);
    }
    // NOT a URL-string comparison, stated as something that can fail: two of
    // the three spellings do not appear anywhere in DATABASE_URL, and both
    // are refused anyway. A guard built on string equality would accept them.
    const urlHost = new URL(process.env.DATABASE_URL!).hostname;
    const unmatched = spellings.filter((h) => h !== urlHost);
    expect(unmatched.length).toBe(2);
    for (const host of unmatched) {
      expect(process.env.DATABASE_URL, host).not.toContain(host);
    }
  });

  it("REFUSES every other spelling of the same endpoint: 0.0.0.0 and the IPv6 loopback family", async () => {
    // Each of these was ACCEPTED by an address-set comparison that treated
    // resolved addresses as opaque strings. connect(0.0.0.0) is routed to
    // loopback by the kernel, and ::1 / 0:0:0:0:0:0:0:1 / ::ffff:127.0.0.1
    // are the same destination as 127.0.0.1 on any dual-stack server.
    for (const host of ["0.0.0.0", "0", "::1", "[::1]", "0:0:0:0:0:0:0:1", "::ffff:127.0.0.1", "::"]) {
      await expect(
        assertNotServoDatabase({ host, port: own!.port, database: own!.database }),
        host,
      ).rejects.toThrow(/Servo's own database/);
    }
  });

  it("REFUSES in the INVERSE direction: DATABASE_URL spelled in IPv6, source spelled in IPv4", async () => {
    process.env.DATABASE_URL = `postgresql://servo:servo@[::1]:${own!.port}/${own!.database}`;
    for (const host of ["localhost", "127.0.0.1", "::1"]) {
      await expect(
        assertNotServoDatabase({ host, port: own!.port, database: own!.database }),
        host,
      ).rejects.toThrow(/Servo's own database/);
    }
  });

  it("REFUSES a SQL config that names NO database — an omitted name defaults to the connection user", async () => {
    // Servo's shipped DATABASE_URL is postgresql://servo:servo@db:5432/servo,
    // where the user name IS the database name, so {host, port} with no
    // database reaches the desk and a guard that returned here never looked.
    for (const config of [{ host: "db", port: 5432 }, { port: 5433 }, { host: "localhost", ssl: false }]) {
      await expect(assertNotServoDatabase(config), JSON.stringify(config)).rejects.toThrow(/names no database/);
    }
    // An S3 config names neither a database nor a SQL endpoint, and is not
    // caught by that rule.
    await expect(
      assertNotServoDatabase({ endpoint: "http://s3mock:9090", region: "us-east-1" }),
    ).resolves.toBeUndefined();
  });

  it("REFUSES a database named under a spelling the guard was not written for — it never returns silently", async () => {
    // toPostgresTarget used to read the literal keys `host` and `database`
    // only, so {Host, DATABASE}, {dbname} and {connectionString} all made the
    // guard a no-op that ACCEPTED. A guard whose failure mode is acceptance
    // is not a guard.
    const cases: Record<string, unknown>[] = [
      { Host: "127.0.0.1", port: own!.port, DATABASE: own!.database },
      { host: "localhost", port: own!.port, dbname: own!.database },
      { hostname: "localhost", port: String(own!.port), db: own!.database },
      { connectionString: `postgresql://servo:servo@localhost:${own!.port}/${own!.database}` },
      { url: `postgres://servo:servo@127.0.0.1:${own!.port}/${own!.database}` },
      // No host at all: libpq's own default is the local server.
      { port: own!.port, database: own!.database },
    ];
    for (const config of cases) {
      await expect(assertNotServoDatabase(config), JSON.stringify(config)).rejects.toThrow(
        /Servo's own database/,
      );
    }
  });

  it("parses the libpq spellings a plain URL parser drops, instead of refusing every source", async () => {
    // A socket URL and a database-less URL both used to parse as null, which
    // made the guard refuse EVERY source on such a deployment.
    expect(parsePostgresUrl("postgresql://servo:servo@/erp?host=/var/run/postgresql")).toMatchObject({
      host: "/var/run/postgresql",
      database: "erp",
    });
    expect(parsePostgresUrl("postgresql://servo:servo@localhost:5433")).toMatchObject({
      host: "localhost",
      port: 5433,
      database: "servo", // libpq: dbname defaults to the user name
    });
    expect(parsePostgresUrl("postgresql://u@h:5432/db?port=6000")).toMatchObject({ port: 5432 });
    // Ambiguous userinfo stays null — and null means refuse, never guess.
    expect(parsePostgresUrl("postgresql://servo:pa/ss@localhost:5433/db")).toBeNull();
    process.env.DATABASE_URL = "postgresql://servo:pa/ss@localhost:5433/db";
    await expect(
      assertNotServoDatabase({ host: "example.invalid.test", port: 5432, database: "erp" }),
    ).rejects.toThrow(/DATABASE_URL is set but is not a connection URL/);
  });

  it("addressToken collapses the spellings of one endpoint and keeps distinct hosts distinct", () => {
    for (const loopback of ["127.0.0.1", "127.1.2.3", "0.0.0.0", "::1", "0:0:0:0:0:0:0:1", "::ffff:127.0.0.1", "::"]) {
      expect(addressToken(loopback), loopback).toBe("loopback");
    }
    expect(addressToken("10.0.0.7")).toBe("10.0.0.7");
    expect(addressToken("::ffff:10.0.0.7")).toBe("10.0.0.7");
    expect(addressToken("2001:db8::1")).toBe(addressToken("2001:0db8:0000:0000:0000:0000:0000:0001"));
    expect(addressToken("2001:db8::1")).not.toBe("loopback");
  });

  it("ACCEPTS the second server: same host, same database name, different port", async () => {
    await expect(
      assertNotServoDatabase({ host: "127.0.0.1", port: SECOND_PORT, database: own!.database }),
    ).resolves.toBeUndefined();
    await expect(
      assertNotServoDatabase({ host: "localhost", port: SECOND_PORT, database: own!.database }),
    ).resolves.toBeUndefined();
  });

  it("ACCEPTS a different database on the same server, and refuses it once OPS_DATABASE_URL names it", async () => {
    const other = { host: "127.0.0.1", port: own!.port, database: "some_customer_db" };
    await expect(assertNotServoDatabase(other)).resolves.toBeUndefined();
    process.env.OPS_DATABASE_URL = `postgresql://servo:servo@localhost:${own!.port}/some_customer_db`;
    await expect(assertNotServoDatabase(other)).rejects.toThrow(/OPS_DATABASE_URL/);
  });

  it("also guards OPS_DATABASE_READONLY_URL", async () => {
    process.env.OPS_DATABASE_READONLY_URL = `postgresql://servo:servo@127.0.0.1:${own!.port}/ro_replica`;
    await expect(
      assertNotServoDatabase({ host: "localhost", port: own!.port, database: "ro_replica" }),
    ).rejects.toThrow(/OPS_DATABASE_READONLY_URL/);
  });

  it("fails CLOSED on a host it cannot resolve", async () => {
    await expect(
      assertNotServoDatabase({ host: "no-such-host.invalid", port: 5432, database: "erp" }),
    ).rejects.toThrow(/does not resolve/);
  });

  it("is a no-op for a config that names no database (an S3 endpoint)", async () => {
    await expect(assertNotServoDatabase({ endpoint: "http://s3mock:9090", region: "us-east-1" })).resolves.toBeUndefined();
  });
});

describe("credentials never reach configJson, and no route returns them", () => {
  async function post(body: unknown) {
    const res = await postSource(new Request("http://t/api/kb/sources", { method: "POST", body: JSON.stringify(body) }) as never);
    return { status: res.status, body: (await res.json()) as Record<string, never> };
  }

  it("a save posting a password inside configJson is rejected BY NAME", async () => {
    const res = await post({
      name: "erp",
      kind: "POSTGRES",
      config: { host: "erp.internal", port: 5432, database: "erp", password: "hunter2" },
    });
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toContain('"password"');
    expect(String(res.body.error)).toMatch(/may not carry credentials/);
    expect(await db.dataSource.count()).toBe(0);
  });

  it("rejects an S3 secret access key inside configJson by name too", async () => {
    const res = await post({
      name: "docs",
      kind: "S3",
      config: { endpoint: "http://s3mock:9090", region: "us-east-1", secretAccessKey: "AKIA" },
    });
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toContain('"secretAccessKey"');
    // Asserted as well as the name: without this the unknown-key branch's
    // message also contains "secretAccessKey", so the test would stay green
    // with the credential gate removed entirely.
    expect(String(res.body.error)).toMatch(/may not carry credentials/);
  });

  it("a credential NESTED inside an allowed key is rejected — the key NAME is not the whole check", async () => {
    // Every one of these was stored verbatim in configJson and echoed back by
    // both read routes when only top-level key NAMES were checked.
    const smuggles: [string, unknown][] = [
      ["POSTGRES", { host: "127.0.0.1", port: 65432, database: "notservo", ssl: { password: "hunter2" } }],
      ["S3", { endpoint: "http://s3mock:9090", forcePathStyle: { secretAccessKey: "supersecretvalue" } }],
      ["POSTGRES", { host: "127.0.0.1", port: 65432, database: "notservo", ssl: ["hunter2"] }],
    ];
    for (const [kind, config] of smuggles) {
      const res = await post({ name: `s${Math.random()}`, kind, config });
      expect(res.status, JSON.stringify(config)).toBe(400);
      expect(String(res.body.error)).toMatch(/may not be an object or a list/);
    }
    expect(await db.dataSource.count()).toBe(0);
  });

  it("a credential smuggled inside an allowed STRING is rejected — userinfo, and a whole connection URL", async () => {
    const endpoint = await post({
      name: "e",
      kind: "S3",
      config: { endpoint: "http://AKIAKEY:supersecretvalue@minio:9000", region: "us-east-1" },
      scope: [{ bucket: "b" }],
    });
    expect(endpoint.status).toBe(400);
    expect(String(endpoint.body.error)).toMatch(/must not embed a username or password/);

    const asUrl = await post({
      name: "u",
      kind: "POSTGRES",
      config: { host: "127.0.0.1", port: 65432, database: "postgresql://u:supersecretvalue@h/d" },
    });
    expect(asUrl.status).toBe(400);
    expect(String(asUrl.body.error)).toMatch(/plain database name/);

    const inHost = await post({
      name: "h",
      kind: "POSTGRES",
      config: { host: "127.0.0.1?password=supersecretvalue", port: 65432, database: "notservo" },
    });
    expect(inHost.status).toBe(400);
    expect(String(inHost.body.error)).toMatch(/plain hostname or IP address/);
    // The refusal does not echo the smuggled value back.
    expect(String(inHost.body.error)).not.toContain("supersecretvalue");

    expect(await db.dataSource.count()).toBe(0);
  });

  it("a GET of a source omits secretRef's value — asserted on the RESPONSE BODY", async () => {
    const created = await post({
      name: "docs",
      kind: "S3",
      config: { endpoint: "http://s3mock:9090", region: "us-east-1" },
      scope: [{ bucket: "contracts", prefix: "2026/", suffixes: [".pdf"] }],
      secret: "AKIAEXAMPLE/verysecret",
    });
    expect(created.status).toBe(201);

    const id = (created.body.source as unknown as { id: string }).id;
    const res = await getSource(new Request("http://t") as never, { params: Promise.resolve({ id }) });
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).not.toContain("secretRef");
    expect(text).not.toContain("verysecret");
    expect(text).not.toContain("datasource.");
    expect(JSON.parse(text).source).toMatchObject({ hasSecret: true, status: "DISABLED", mode: "INDEX" });

    // The list route is built from the same projection.
    const listText = await (await getSources()).text();
    expect(listText).not.toContain("secretRef");
    expect(listText).not.toContain("verysecret");

    // The credential is where it belongs: a Setting row, sealed, and the
    // stored config never carried it.
    const row = await db.dataSource.findUniqueOrThrow({ where: { id } });
    expect(row.secretRef).toBe(`datasource.${id}.secret`);
    expect(JSON.stringify(row.configJson)).not.toContain("verysecret");
    expect(await db.setting.findUnique({ where: { key: row.secretRef } })).not.toBeNull();
  });

  it("refuses a save whose POSTGRES config points at Servo's own database", async () => {
    const savedUrl = process.env.DATABASE_URL;
    const parsed = parsePostgresUrl(urlForDatabase("servo_test_guard", testDatabaseUrl()))!;
    process.env.DATABASE_URL = urlForDatabase("servo_test_guard", testDatabaseUrl());
    try {
      const res = await post({
        name: "self",
        kind: "POSTGRES",
        config: { host: "127.0.0.1", port: parsed.port, database: parsed.database },
      });
      expect(res.status).toBe(400);
      expect(String(res.body.error)).toMatch(/Servo's own database/);
      expect(await db.dataSource.count()).toBe(0);
    } finally {
      if (savedUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = savedUrl;
    }
  });

  it("refuses a prototype-member config key by the ALLOWLIST, not by accident", async () => {
    // `spec[key]` answered __proto__ / constructor / toString with an
    // inherited truthy value, skipping the unknown-key branch and producing
    // "must be a undefined".
    for (const key of ["__proto__", "constructor", "toString"]) {
      const res = await post({ name: `p${key}`, kind: "S3", config: JSON.parse(`{"${key}":"x"}`) });
      expect(res.status, key).toBe(400);
      expect(String(res.body.error), key).toMatch(/may not carry/);
      expect(String(res.body.error), key).not.toMatch(/must be a undefined/);
    }
    expect(Object.prototype).not.toHaveProperty("x");
  });

  it("refuses hostile scope inputs with a 400, never a 500 from the driver or the database", async () => {
    // Both of these used to pass the validator and blow up further down: a
    // NUL raises "unsupported Unicode escape sequence" at Postgres, and a
    // ~5000-deep scope throws RangeError inside Prisma's serializer.
    const nul = await post({ name: "n", kind: "S3", config: {}, scope: [{ bucket: `acme${String.fromCharCode(0)}docs` }] });
    expect(nul.status).toBe(400);
    expect(String(nul.body.error)).toMatch(/control characters/);

    // 3000 rather than 6000: past roughly 4000 this Node build cannot
    // JSON.stringify the body at all, so the request never leaves the test.
    // 3000 is comfortably inside what the JS half used to accept and hand to
    // Prisma, which is where the RangeError landed.
    let nested: unknown = "leaf";
    for (let i = 0; i < 3000; i++) nested = { a: nested };
    const deep = await post({
      name: "d",
      kind: "POSTGRES",
      config: {},
      scope: [{ schema: "public", table: "t", idColumn: "id", textColumns: ["b"], titleColumn: nested }],
    });
    expect(deep.status).toBe(400);
    expect(String(deep.body.error)).toMatch(/may not nest/);
    expect(await db.dataSource.count()).toBe(0);
  });

  it("refuses a scope carrying a wildcard or a where clause, before anything is written", async () => {
    const wildcard = await post({ name: "w", kind: "S3", config: {}, scope: [{ bucket: "*" }] });
    expect(wildcard.status).toBe(400);
    expect(String(wildcard.body.error)).toMatch(/wildcard/);
    const predicate = await post({
      name: "p",
      kind: "POSTGRES",
      config: {},
      scope: [{ schema: "public", table: "t", idColumn: "id", textColumns: ["a"], where: "1=1" }],
    });
    expect(predicate.status).toBe(400);
    expect(String(predicate.body.error)).toMatch(/where/);
    expect(await db.dataSource.count()).toBe(0);
  });
});

describe("the two new permission actions", () => {
  it("kb.sources.view is ADMIN and AGENT; kb.sources.manage is ADMIN only; neither reaches REQUESTER", () => {
    expect(can({ role: "ADMIN" } as never, "kb.sources.view")).toBe(true);
    expect(can({ role: "AGENT" } as never, "kb.sources.view")).toBe(true);
    expect(can({ role: "REQUESTER" } as never, "kb.sources.view")).toBe(false);
    expect(can({ role: "AI_AGENT" } as never, "kb.sources.view")).toBe(false);
    expect(can({ role: "ADMIN" } as never, "kb.sources.manage")).toBe(true);
    expect(can({ role: "AGENT" } as never, "kb.sources.manage")).toBe(false);
    expect(can({ role: "REQUESTER" } as never, "kb.sources.manage")).toBe(false);
    expect(can({ role: "AI_AGENT" } as never, "kb.sources.manage")).toBe(false);
  });

  it("changed no existing action's grant array", () => {
    const source = readFileSync("src/lib/permissions.ts", "utf8");
    const matrix = source.match(/const MATRIX[^=]*=\s*\{([\s\S]*?)\n\};/)?.[1] ?? "";
    const rows = new Map(
      [...matrix.matchAll(/"([a-z.]+)":\s*\[([^\]]*)\]/g)].map((m) => [
        m[1],
        [...m[2].matchAll(/"([A-Z_]+)"/g)].map((r) => r[1]).join(","),
      ]),
    );
    const BEFORE: Record<string, string> = {
      "ticket.create": "ADMIN,AGENT,REQUESTER",
      "ticket.update": "ADMIN,AGENT",
      "ticket.assign": "ADMIN,AGENT",
      "ticket.escalate": "ADMIN,AGENT",
      "ticket.comment": "ADMIN,AGENT,REQUESTER",
      "group.view": "ADMIN,AGENT",
      "group.manage": "ADMIN",
      "agents.view": "ADMIN,AGENT",
      "agents.manage": "ADMIN",
      "skills.view": "ADMIN,AGENT",
      "skills.manage": "ADMIN",
      "agent.run": "ADMIN,AGENT",
      "approval.view": "ADMIN,AGENT",
      "approval.decide": "ADMIN,AGENT",
      "settings.manage": "ADMIN",
      "kpi.view": "ADMIN,AGENT",
      "kb.view": "ADMIN,AGENT",
      "kb.upload": "ADMIN,AGENT",
      "kb.share": "ADMIN,AGENT",
      "kb.manage": "ADMIN",
    };
    for (const [key, value] of Object.entries(BEFORE)) {
      expect(rows.get(key), `${key} drift`).toBe(value);
    }
  });

  it("an AGENT may list sources; a REQUESTER may not, and may not create one", async () => {
    holder.user = deskAgent;
    expect((await getSources()).status).toBe(200);
    const agentCreate = await postSource(
      new Request("http://t", { method: "POST", body: JSON.stringify({ name: "x", kind: "S3", config: {} }) }) as never,
    );
    expect(agentCreate.status).toBe(403);

    holder.user = requester;
    expect((await getSources()).status).toBe(403);
    const requesterCreate = await postSource(
      new Request("http://t", { method: "POST", body: JSON.stringify({ name: "y", kind: "S3", config: {} }) }) as never,
    );
    expect(requesterCreate.status).toBe(403);
  });
});

describe("the validators mirror the catalog", () => {
  it("refuses the same scope shapes the CHECK refuses", () => {
    expect(() => validateSourceScope("S3", [{ bucket: "*" }])).toThrow(SourceValidationError);
    expect(() => validateSourceScope("S3", [{ bucket: "contracts*" }])).toThrow(/wildcard/);
    expect(() => validateSourceScope("POSTGRES", [{ schema: "public", table: "t", idColumn: "id", textColumns: ["a"], where: "1" }])).toThrow(/where/);
    expect(() => validateSourceScope("S3", ["*"])).toThrow(/must be an object/);
    expect(validateSourceScope("S3", [])).toEqual([]);
  });

  it("allows only the non-secret config keys, per kind", () => {
    expect(validateSourceConfig("POSTGRES", { host: "h", port: 5432, database: "d", ssl: true })).toBeTruthy();
    expect(() => validateSourceConfig("POSTGRES", { endpoint: "x" })).toThrow(/may not carry "endpoint"/);
    expect(() => validateSourceConfig("S3", { accessKeyId: "AKIA" })).toThrow(/may not carry credentials/);
  });
});
