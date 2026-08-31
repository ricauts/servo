// xds-01: the DataSource model, the scope allowlist IN THE CATALOG, and the
// never-Servo's-own-database refusal.
//
// The catalog assertions all go through RAW SQL rather than Prisma, on
// purpose: the acceptance is that a row written by a seed, a migration or a
// direct write is as constrained as one written by the route, and a Prisma
// create proves only that Prisma agrees with itself.
//
// The second endpoint is real. `assertNotServoDatabase` is asserted against
// two live Postgres servers — the 5433 test database it must REFUSE and the
// 5434 external one it must ACCEPT — because a guard whose only proof is a
// unit test with two strings is a guard that has never seen a socket.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { tmpDb, testDatabaseUrl, type TmpDb } from "./helpers/tmp-db";
import { parseDatabaseName as guardParseDatabaseName } from "../scripts/loop-guard.mjs";

type ServoDb = { [key: string]: unknown };
const holder = vi.hoisted(() => ({
  db: null as unknown as ServoDb,
  user: null as unknown as { id: string; role: string },
}));
vi.mock("@/lib/db", () => ({ get db() { return holder.db; } }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: async () => holder.user }));
// GET /api/settings is imported below because one acceptance clause — "never
// returned by any route" — is about ITS response body, not only the source
// routes'. It reaches next-auth through @/lib/authjs, which vitest's node
// resolution cannot load; only the key names are needed here, and they are
// the file's own constants.
vi.mock("@/lib/authjs", () => ({
  AUTH_SETTING_KEYS: {
    issuer: "auth.oidc.issuer",
    clientId: "auth.oidc.clientId",
    clientSecret: "auth.oidc.clientSecret",
    providerName: "auth.oidc.providerName",
    adminEmails: "auth.adminEmails",
    allowedDomains: "auth.allowedDomains",
  },
}));

import {
  SourceConfigError,
  assertConfigShape,
  assertNoCredentials,
  assertNotServoDatabase,
  assertScopeExplicit,
  assertSecretNotServoDatabase,
  parseDatabaseName,
  sourceSecretKey,
} from "@/lib/kb/sources";
import { can } from "@/lib/permissions";
import { isSealed, isSensitiveSettingKey, open } from "@/lib/secret-store";
import { GET as listSources, POST as createSource } from "@/app/api/kb/sources/route";
import { GET as getSource } from "@/app/api/kb/sources/[id]/route";
import { GET as getSettings } from "@/app/api/settings/route";
import { agentChainCte, humanChainCte } from "@/lib/kb/entitlement";

/** The external SQL server the compose test stack publishes on 5434. */
const EXTERNAL_URL =
  process.env.EXTERNAL_TEST_DATABASE_URL?.trim() ||
  "postgresql://servo:servo@localhost:5434/erp";

/** tmp-db's discipline, applied to the two clients this file opens itself:
 *  the shared server's 100-connection limit is reached by the full suite. */
const withLimit = (url: string) =>
  url.includes("connection_limit") ? url : url + (url.includes("?") ? "&" : "?") + "connection_limit=2";

const handles: TmpDb[] = [];
let db: PrismaClient;
let admin: { id: string; role: string };
let agent: { id: string; role: string };
let requester: { id: string; role: string };

beforeAll(async () => {
  const a = await tmpDb();
  handles.push(a);
  db = a.client;
  holder.db = db as unknown as ServoDb;
  admin = { ...(await db.user.create({ data: { name: "A", email: "a@x.com", role: "ADMIN" } })), role: "ADMIN" };
  agent = { ...(await db.user.create({ data: { name: "G", email: "g@x.com", role: "AGENT" } })), role: "AGENT" };
  requester = { ...(await db.user.create({ data: { name: "R", email: "r@x.com", role: "REQUESTER" } })), role: "REQUESTER" };
});

afterAll(async () => {
  for (const h of handles) await h.dispose();
});

const post = (body: unknown) =>
  new Request("http://x/api/kb/sources", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as never;

/** A raw INSERT of a DataSource row, bypassing every JavaScript validator. */
async function rawInsert(fields: Record<string, string>): Promise<void> {
  const base: Record<string, string> = {
    id: `raw_${Math.random().toString(36).slice(2, 10)}`,
    name: `raw_${Math.random().toString(36).slice(2, 10)}`,
    kind: `'S3'`,
    secretRef: `'k'`,
    createdById: `'${admin.id}'`,
    updatedAt: "now()",
  };
  const row = { ...base, ...fields };
  const cols = Object.keys(row).map((c) => `"${c}"`).join(", ");
  const vals = Object.entries(row)
    .map(([k, v]) => (k === "id" || k === "name" ? `'${v}'` : v))
    .join(", ");
  await db.$executeRawUnsafe(`INSERT INTO "DataSource" (${cols}) VALUES (${vals})`);
}

describe("the DataSource model lands as canonized", () => {
  it("carries every column, with the canonized types and defaults", async () => {
    const cols = await db.$queryRawUnsafe<
      { column_name: string; data_type: string; is_nullable: string; column_default: string | null }[]
    >(
      `SELECT column_name, data_type, is_nullable, column_default
         FROM information_schema.columns WHERE table_name = 'DataSource'`,
    );
    const by = new Map(cols.map((c) => [c.column_name, c]));
    expect([...by.keys()].sort()).toEqual(
      [
        "configJson", "createdAt", "createdById", "cursorJson", "id", "kind",
        "lastCompleteSyncAt", "lastSyncAt", "maxRows", "mode", "name",
        "scopeJson", "secretRef", "status", "statusError", "syncEveryMin",
        "updatedAt",
      ].sort(),
    );
    // JSONB, not json and not text — the CHECK below uses jsonb_path_exists.
    for (const j of ["configJson", "scopeJson", "cursorJson"]) {
      expect(by.get(j)!.data_type, `${j} must be jsonb`).toBe("jsonb");
    }
    expect(by.get("mode")!.column_default).toContain("INDEX");
    expect(by.get("status")!.column_default).toContain("DISABLED");
    expect(by.get("maxRows")!.column_default).toContain("20000");
    expect(by.get("syncEveryMin")!.column_default).toContain("0");
    expect(by.get("secretRef")!.is_nullable).toBe("NO");
    expect(by.get("statusError")!.is_nullable).toBe("YES");
    expect(by.get("lastCompleteSyncAt")!.is_nullable).toBe("YES");

    // name @unique.
    const idx = await db.$queryRawUnsafe<{ indexname: string }[]>(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'DataSource'`,
    );
    expect(idx.map((r) => r.indexname)).toContain("DataSource_name_key");
  });

  it("has no Prisma enum anywhere — the unions are String columns plus CHECKs", async () => {
    const enums = await db.$queryRawUnsafe<{ typname: string }[]>(
      `SELECT typname FROM pg_type WHERE typtype = 'e'`,
    );
    expect(enums).toEqual([]);
  });

  it("gives Document its four external columns and KbGrant its third target", async () => {
    const docCols = await db.$queryRawUnsafe<{ column_name: string; is_nullable: string }[]>(
      `SELECT column_name, is_nullable FROM information_schema.columns
        WHERE table_name = 'Document'
          AND column_name IN ('sourceId','externalLocator','externalVersion','externalSeenAt')`,
    );
    expect(docCols.length).toBe(4);
    for (const c of docCols) expect(c.is_nullable, c.column_name).toBe("YES");

    const grantCol = await db.$queryRawUnsafe<{ column_name: string }[]>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'KbGrant' AND column_name = 'sourceId'`,
    );
    expect(grantCol.length).toBe(1);

    // onDelete: Restrict on Document, Cascade on KbGrant.
    const fks = await db.$queryRawUnsafe<{ conname: string; confdeltype: string }[]>(
      `SELECT conname, confdeltype FROM pg_constraint
        WHERE conname IN ('Document_sourceId_fkey','KbGrant_sourceId_fkey')`,
    );
    const byName = new Map(fks.map((f) => [f.conname, f.confdeltype]));
    expect(byName.get("Document_sourceId_fkey")).toBe("r"); // RESTRICT
    expect(byName.get("KbGrant_sourceId_fkey")).toBe("c"); // CASCADE
  });

  it("accepts GONE as a Document.textStatus", async () => {
    const doc = await db.document.create({
      data: {
        name: "gone.md", contentType: "text/markdown", byteSize: 1,
        sha256: "f".repeat(64), ownerId: admin.id, textStatus: "GONE",
      },
    });
    expect(doc.textStatus).toBe("GONE");
    await db.document.delete({ where: { id: doc.id } });
  });
});

describe("the rules are in the catalog, not only in JavaScript", () => {
  it("refuses FEDERATE, an unknown kind and an unknown status on a RAW INSERT", async () => {
    await expect(rawInsert({ mode: `'FEDERATE'` })).rejects.toThrow(/DataSource_mode_index_only/);
    await expect(rawInsert({ kind: `'MYSQL'` })).rejects.toThrow(/DataSource_kind_known/);
    await expect(rawInsert({ status: `'PENDING'` })).rejects.toThrow(/DataSource_status_known/);
    // Every canonized status is accepted.
    for (const s of ["DISABLED", "READY", "SYNCING", "ERROR", "UNREACHABLE", "PURGED"]) {
      await expect(rawInsert({ status: `'${s}'` })).resolves.toBeUndefined();
    }
  });

  // ONE table, run through BOTH layers, kind by kind. "A row written by a
  // seed, a migration or a direct write is as constrained as one written by
  // the route" is only true if the CHECK and the validator agree on the same
  // inputs — and every REFUSED row below was, at some point in this item's
  // construction, a genuine disagreement between them.
  const SCOPE_TABLE: { kind: "S3" | "POSTGRES"; scope: unknown; ok: boolean; why: string }[] = [
    { kind: "S3", scope: [], ok: true, why: "empty reaches nothing" },
    { kind: "S3", scope: [{ bucket: "contracts", prefix: "2026/", suffixes: [".pdf", ".xlsx"] }], ok: true, why: "the canonized S3 entry" },
    { kind: "POSTGRES", scope: [{ schema: "public", table: "invoices_indexable", idColumn: "id", textColumns: ["number", "customer"], titleColumn: "number", updatedAtColumn: "updated_at" }], ok: true, why: "the canonized Postgres entry" },
    { kind: "S3", scope: [{ bucket: "*" }], ok: false, why: "wildcard bucket" },
    { kind: "POSTGRES", scope: [{ schema: "*", table: "t" }], ok: false, why: "wildcard schema" },
    { kind: "POSTGRES", scope: [{ schema: "public", table: "*" }], ok: false, why: "wildcard table" },
    { kind: "S3", scope: [{ bucket: "prod-*", prefix: "2026/" }], ok: false, why: "wildcard inside a name" },
    { kind: "S3", scope: [{ bucket: "contracts", suffixes: [".pdf", "*"] }], ok: false, why: "wildcard inside a list" },
    { kind: "POSTGRES", scope: [{ schema: "public", table: "invoices", where: "1=1" }], ok: false, why: "a where key" },
    { kind: "POSTGRES", scope: [{ schema: "public", table: "t", opts: { where: "1=1" } }], ok: false, why: "a nested where" },
    { kind: "POSTGRES", scope: [{ schema: "public", table: ["*"] }], ok: false, why: "array-valued table" },
    { kind: "S3", scope: [{ bucket: { name: "*" } }], ok: false, why: "object-valued bucket" },
    { kind: "S3", scope: [[{ bucket: "*" }]], ok: false, why: "entry wrapped in an array" },
    { kind: "S3", scope: [[[{ bucket: "*" }]]], ok: false, why: "entry wrapped twice" },
    { kind: "S3", scope: ["*"], ok: false, why: "a bare string entry" },
    { kind: "S3", scope: [null], ok: false, why: "a null entry" },
    { kind: "S3", scope: [[]], ok: false, why: "an empty array entry" },
    { kind: "S3", scope: {}, ok: false, why: "not an array at all" },
    // The whole point of a scope KEY ALLOWLIST: an open key set is a place to
    // park a credential, and the list route serves scopeJson to every AGENT.
    { kind: "POSTGRES", scope: [{ schema: "public", table: "invoices", password: "hunter2" }], ok: false, why: "a credential key" },
    { kind: "POSTGRES", scope: [{ schema: "public", table: "invoices", note: "postgresql://reader:pw@erp/erp" }], ok: false, why: "a DSN parked in an extra key" },
    { kind: "S3", scope: [{ bucket: "contracts", region: "us-east-1" }], ok: false, why: "a config key in a scope entry" },
  ];

  it("the catalog and the validator agree on scopeJson, in BOTH directions", async () => {
    for (const row of SCOPE_TABLE) {
      const raw = rawInsert({
        kind: `'${row.kind}'`,
        // A POSTGRES row needs a valid config to reach the scope constraint at
        // all — the config CHECK requires host and database for that kind.
        configJson:
          row.kind === "POSTGRES" ? `'{"host":"erp.internal","database":"erp"}'::jsonb` : `'{}'::jsonb`,
        scopeJson: `'${JSON.stringify(row.scope).replace(/'/g, "''")}'::jsonb`,
      });
      if (row.ok) await expect(raw, `catalog: ${row.why}`).resolves.toBeUndefined();
      else await expect(raw, `catalog: ${row.why}`).rejects.toThrow(/DataSource_scope_explicit/);

      const validator = () => assertScopeExplicit(row.scope, row.kind);
      if (row.ok) expect(validator, `validator: ${row.why}`).not.toThrow();
      else expect(validator, `validator: ${row.why}`).toThrow(SourceConfigError);
    }
  });

  // The same differential for configJson. Every REFUSED row below was, at some
  // point in this item's construction, a genuine disagreement between the
  // catalog and the validator.
  const CONFIG_TABLE: { kind: "S3" | "POSTGRES"; config: unknown; ok: boolean; why: string }[] = [
    { kind: "S3", config: {}, ok: true, why: "empty" },
    { kind: "S3", config: { endpoint: "https://minio.internal", region: "us-east-1", forcePathStyle: true }, ok: true, why: "the S3 happy path" },
    { kind: "POSTGRES", config: { host: "erp.internal", port: 5432, database: "erp", ssl: true }, ok: true, why: "the Postgres happy path" },
    { kind: "POSTGRES", config: { host: "erp.internal", database: "erp", pass_word: "hunter2" }, ok: false, why: "separator-spelled credential key" },
    { kind: "POSTGRES", config: { host: "erp.internal", database: "erp", "pass-word": "hunter2" }, ok: false, why: "hyphen-spelled credential key" },
    { kind: "POSTGRES", config: { host: "erp.internal", database: "erp", s_e_c_r_e_t: "x" }, ok: false, why: "fully separated credential key" },
    { kind: "S3", config: { endpoint: " https://AKIA:wJalrXUt@minio.internal/" }, ok: false, why: "leading space before the scheme" },
    { kind: "S3", config: { endpoint: "https://AKIA:s3\tcr3t@s3.example.com/" }, ok: false, why: "tab inside the authority" },
    { kind: "S3", config: { endpoint: "\nhttps://u:p@h/" }, ok: false, why: "leading newline" },
    { kind: "S3", config: { ssl_certs: ["-----BEGIN PRIVATE KEY-----"] }, ok: false, why: "key blob as an array of strings" },
    { kind: "S3", config: { region: "-----BEGIN PRIVATE KEY-----" }, ok: false, why: "short PEM under an allowed key" },
    { kind: "POSTGRES", config: { database: "servo" }, ok: false, why: "no host — the guard would have nothing to compare" },
    { kind: "POSTGRES", config: { host: "h" }, ok: false, why: "no database" },
    { kind: "POSTGRES", config: { host: "   ", database: "servo" }, ok: false, why: "a blank host, which reaches the local machine" },
    { kind: "S3", config: { host: "erp.internal" }, ok: false, why: "a POSTGRES key under an S3 source" },
    { kind: "S3", config: { endpoint: 1 }, ok: false, why: "wrong scalar type" },
    { kind: "POSTGRES", config: { host: "h", database: "d", port: "5432" }, ok: false, why: "port as a string" },
    { kind: "POSTGRES", config: { host: "h", database: "d", ssl: { mode: "require" } }, ok: false, why: "nested object" },
    { kind: "POSTGRES", config: { host: "host=127.0.0.1 dbname=servo password=hunter2", database: "d" }, ok: false, why: "a libpq conninfo carrying a password" },
    { kind: "S3", config: { endpoint: "https://u:pw@minio.internal" }, ok: false, why: "userinfo in the one field that IS a URL" },
    { kind: "S3", config: { region: "https://anything" }, ok: false, why: "a URL in a field that is not the endpoint" },
  ];

  it("the catalog and the validator agree on configJson, in BOTH directions", async () => {
    for (const row of CONFIG_TABLE) {
      const raw = rawInsert({
        kind: `'${row.kind}'`,
        configJson: `'${JSON.stringify(row.config).replace(/'/g, "''")}'::jsonb`,
      });
      if (row.ok) await expect(raw, `catalog: ${row.why}`).resolves.toBeUndefined();
      else await expect(raw, `catalog: ${row.why}`).rejects.toThrow(/DataSource_config_nonsecret/);

      const validator = () => assertConfigShape(row.kind, row.config);
      if (row.ok) expect(validator, `validator: ${row.why}`).not.toThrow();
      else expect(validator, `validator: ${row.why}`).toThrow(SourceConfigError);
    }
  });

  it("refuses a credential in configJson on a RAW INSERT, and refuses nesting", async () => {
    for (const config of [
      `{"password":"hunter2"}`,
      `{"connectionString":"postgres://u:p@h/db"}`,
      `{"ssl":{"key":"-----BEGIN PRIVATE KEY-----"}}`,
      `{"endpoint":"https://u:pw@minio.internal"}`,
      `{"list":["postgres://u:p@h/db"]}`,
      `[]`,
    ]) {
      await expect(rawInsert({ configJson: `'${config}'::jsonb` }), config).rejects.toThrow(
        /DataSource_config_nonsecret/,
      );
    }
    // The happy paths, each under the kind whose allowlist names its keys —
    // the catalog's key rule is per-kind, exactly as CONFIG_KEYS is.
    await expect(rawInsert({ configJson: `'{}'::jsonb` })).resolves.toBeUndefined();
    await expect(
      rawInsert({ kind: `'S3'`, configJson: `'{"endpoint":"https://minio.internal","region":"us-east-1"}'::jsonb` }),
    ).resolves.toBeUndefined();
    await expect(
      rawInsert({ kind: `'POSTGRES'`, configJson: `'{"host":"erp.internal","port":5432,"database":"erp"}'::jsonb` }),
    ).resolves.toBeUndefined();
    // And the per-kind allowlist really is per kind: a POSTGRES key under an
    // S3 source is refused by the catalog, not merely by the route.
    await expect(
      rawInsert({ kind: `'S3'`, configJson: `'{"host":"erp.internal"}'::jsonb` }),
    ).rejects.toThrow(/DataSource_config_nonsecret/);
    // A POSTGRES source with no host is the shape assertNotServoDatabase
    // exists to refuse; the catalog refuses it too, so a seed cannot make one.
    await expect(
      rawInsert({ kind: `'POSTGRES'`, configJson: `'{"database":"servo"}'::jsonb` }),
    ).rejects.toThrow(/DataSource_config_nonsecret/);
    // cursorJson is an object too — a scalar there is a cursor nobody wrote.
    await expect(rawInsert({ cursorJson: `'[]'::jsonb` })).rejects.toThrow(/DataSource_config_nonsecret/);
  });
});

describe("the widened KbGrant one-target CHECK and the third partial index", () => {
  let sourceA: string;
  let sourceB: string;

  beforeAll(async () => {
    sourceA = (await db.dataSource.create({
      data: { name: "grant-src-a", kind: "S3", secretRef: "k", createdById: admin.id },
    })).id;
    sourceB = (await db.dataSource.create({
      data: { name: "grant-src-b", kind: "S3", secretRef: "k", createdById: admin.id },
    })).id;
  });

  it("raises on two targets and on none", async () => {
    const collection = await db.collection.create({ data: { name: "c1" } });
    await expect(
      db.kbGrant.create({
        data: { sourceId: sourceA, collectionId: collection.id, subjectType: "USER", subjectId: admin.id, grantedById: admin.id },
      }),
    ).rejects.toThrow(/KbGrant_one_target/);
    await expect(
      db.kbGrant.create({
        data: { subjectType: "USER", subjectId: admin.id, grantedById: admin.id },
      }),
    ).rejects.toThrow(/KbGrant_one_target/);
  });

  it("raises a unique violation on two identical source+subject grants", async () => {
    await db.kbGrant.create({
      data: { sourceId: sourceA, subjectType: "USER", subjectId: admin.id, grantedById: admin.id },
    });
    await expect(
      db.kbGrant.create({
        data: { sourceId: sourceA, subjectType: "USER", subjectId: admin.id, grantedById: admin.id },
      }),
    ).rejects.toThrow(/Unique constraint failed/);
    // Through raw SQL as well — a seed or a migration writing the same pair
    // hits the same index, and the failure is SQLSTATE 23505 naming the
    // three-column key. (Prisma rewrites the driver message on both paths, so
    // the index NAME is asserted structurally against pg_indexes below.)
    await expect(
      db.$executeRawUnsafe(
        `INSERT INTO "KbGrant" (id, "sourceId", "subjectType", "subjectId", "grantedById", "createdAt")
         VALUES ('raw-dup', '${sourceA}', 'USER', '${admin.id}', '${admin.id}', now())`,
      ),
    ).rejects.toThrow(/23505[\s\S]*"sourceId", "subjectType", "subjectId"/);
    // A different source, or a different subject type, is a different grant.
    await expect(
      db.kbGrant.create({
        data: { sourceId: sourceB, subjectType: "USER", subjectId: admin.id, grantedById: admin.id },
      }),
    ).resolves.toBeTruthy();
    await expect(
      db.kbGrant.create({
        data: { sourceId: sourceA, subjectType: "AGENT", subjectId: admin.id, grantedById: admin.id },
      }),
    ).resolves.toBeTruthy();
  });

  it("leaves 0003_kb's two partial indexes exactly as they were", async () => {
    const rows = await db.$queryRawUnsafe<{ indexname: string; indexdef: string }[]>(
      `SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'KbGrant' ORDER BY indexname`,
    );
    const by = new Map(rows.map((r) => [r.indexname, r.indexdef]));
    expect(by.get("KbGrant_doc_subject_key")).toBe(
      'CREATE UNIQUE INDEX "KbGrant_doc_subject_key" ON public."KbGrant" USING btree ("documentId", "subjectType", "subjectId") WHERE ("documentId" IS NOT NULL)',
    );
    expect(by.get("KbGrant_coll_subject_key")).toBe(
      'CREATE UNIQUE INDEX "KbGrant_coll_subject_key" ON public."KbGrant" USING btree ("collectionId", "subjectType", "subjectId") WHERE ("collectionId" IS NOT NULL)',
    );
    expect(by.get("KbGrant_source_subject_key")).toBe(
      'CREATE UNIQUE INDEX "KbGrant_source_subject_key" ON public."KbGrant" USING btree ("sourceId", "subjectType", "subjectId") WHERE ("sourceId" IS NOT NULL)',
    );
  });
});

describe("the third target type does not disturb kb-02's entitlement primitive", () => {
  it("a source-target grant contributes NO row — and never a NULL id — to either chain", async () => {
    const source = await db.dataSource.create({
      data: { name: "cte-src", kind: "S3", secretRef: "k", createdById: admin.id },
    });
    const owner = await db.user.create({ data: { name: "O", email: "o-cte@x.com", role: "AGENT" } });
    const doc = await db.document.create({
      data: { name: "own.md", contentType: "text/markdown", byteSize: 1, sha256: "c".repeat(64), ownerId: owner.id },
    });
    // The row shape this item makes legal, on BOTH legs.
    await db.kbGrant.create({ data: { sourceId: source.id, subjectType: "USER", subjectId: owner.id, grantedById: admin.id } });
    await db.kbGrant.create({ data: { sourceId: source.id, subjectType: "AGENT", subjectId: "builtin:resolver", grantedById: admin.id } });

    for (const cte of [humanChainCte(owner.id), agentChainCte(owner.id, "builtin:resolver")]) {
      const rows = await db.$queryRawUnsafe<{ id: string | null }[]>(`${cte} SELECT id FROM entitled`);
      // A NULL here is not a leak — nothing joins to it — but it is a
      // non-string coming out of the one primitive that answers "may this
      // principal read this document", and `id: { in: [...] }` rejects it.
      expect(rows.every((r) => typeof r.id === "string"), JSON.stringify(rows)).toBe(true);
      // A source grant is a CEILING: on its own it entitles nothing. The
      // owner's own document is still theirs on the human chain.
      expect(rows.map((r) => r.id)).not.toContain(source.id);
    }
    const human = await db.$queryRawUnsafe<{ id: string }[]>(
      `${humanChainCte(owner.id)} SELECT id FROM entitled`,
    );
    expect(human.map((r) => r.id)).toContain(doc.id);
  });

  it("refuses to delete a source while a document still points at it (onDelete: Restrict)", async () => {
    const source = await db.dataSource.create({
      data: { name: "restrict-src", kind: "S3", secretRef: "k", createdById: admin.id },
    });
    const doc = await db.document.create({
      data: {
        name: "crawled.md", contentType: "text/markdown", byteSize: 1,
        sha256: "d".repeat(64), ownerId: admin.id, sourceId: source.id,
        externalLocator: { kind: "S3", bucket: "b", key: "k" },
        externalVersion: '"etag"', externalSeenAt: new Date(),
      },
    });
    await expect(db.dataSource.delete({ where: { id: source.id } })).rejects.toThrow();
    // A grant on the source, by contrast, cascades away with it.
    await db.kbGrant.create({ data: { sourceId: source.id, subjectType: "USER", subjectId: admin.id, grantedById: admin.id } });
    await db.document.delete({ where: { id: doc.id } });
    await db.dataSource.delete({ where: { id: source.id } });
    expect(await db.kbGrant.count({ where: { sourceId: source.id } })).toBe(0);
  });
});

describe("RLS on DataSource, and kb-15's grant floor amended for the third target", () => {
  it("enables and FORCEs row level security on DataSource", async () => {
    const rel = await db.$queryRawUnsafe<{ relrowsecurity: boolean; relforcerowsecurity: boolean }[]>(
      `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'DataSource'`,
    );
    expect(rel[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    const policies = await db.$queryRawUnsafe<{ policyname: string }[]>(
      `SELECT policyname FROM pg_policies WHERE tablename = 'DataSource'`,
    );
    expect(policies.map((p) => p.policyname)).toEqual(["kb_source_floor"]);
  });

  it("keeps the floor COARSER than the application filter — it knows nothing of sourceId or GONE", async () => {
    // EVERY policy in the database, not a chosen three: a floor that named a
    // target column anywhere would make the migration's headline sentence
    // false, and the catalog is where to ask.
    const defs = await db.$queryRawUnsafe<{ tablename: string; qual: string }[]>(
      `SELECT tablename, qual FROM pg_policies`,
    );
    expect(defs.length).toBeGreaterThanOrEqual(4);
    // The floor knows nothing about sourceId or GONE — asserted on EVERY
    // policy the migration leaves behind, including the two it writes. A
    // policy that named a target column would make the migration header's
    // own headline sentence false.
    for (const d of defs) {
      expect(d.qual, d.tablename).not.toContain("sourceId");
      expect(d.qual, d.tablename).not.toContain("GONE");
    }
  });

  it("admits a source-target grant on the same terms as the other two, and closes without a principal", async () => {
    const source = await db.dataSource.create({
      data: { name: "rls-src", kind: "S3", secretRef: "k", createdById: admin.id },
    });
    const collection = await db.collection.create({ data: { name: "rls-coll" } });
    await db.kbGrant.create({ data: { sourceId: source.id, subjectType: "USER", subjectId: admin.id, grantedById: admin.id } });
    await db.kbGrant.create({ data: { collectionId: collection.id, subjectType: "USER", subjectId: admin.id, grantedById: admin.id } });

    // Superusers bypass RLS unconditionally, so the proof runs as a
    // non-privileged owner role — kb-15's finding, reused.
    const role = `xds_rls_probe_${process.pid}`;
    await db.$executeRawUnsafe(`CREATE ROLE ${role} NOLOGIN NOBYPASSRLS`);
    await db.$executeRawUnsafe(`ALTER TABLE "KbGrant" OWNER TO ${role}`);
    try {
      const asRole = (humanId: string | null) =>
        db.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(`SET LOCAL ROLE ${role}`);
          if (humanId !== null) await tx.$executeRawUnsafe(`SET LOCAL app.human_id = '${humanId}'`);
          return tx.$queryRawUnsafe<{ sourceId: string | null; collectionId: string | null }[]>(
            `SELECT "sourceId", "collectionId" FROM "KbGrant"`,
          );
        });

      const withPrincipal = await asRole(admin.id);
      expect(withPrincipal.some((r) => r.sourceId === source.id)).toBe(true);
      expect(withPrincipal.some((r) => r.collectionId === collection.id)).toBe(true);

      // Failure mode CLOSED: no principal, no rows — never all rows. Asserted
      // AFTER an entitled query on the SAME connection, which is the case a
      // fresh-connection assertion cannot see: SET LOCAL on a custom GUC
      // leaves the session value as the empty string, so an `IS NOT NULL`
      // principal test would pass here and open the floor.
      expect(await asRole(null)).toEqual([]);
    } finally {
      await db.$executeRawUnsafe(`ALTER TABLE "KbGrant" OWNER TO CURRENT_USER`);
      await db.$executeRawUnsafe(`DROP ROLE IF EXISTS ${role}`);
    }
  });
});

describe("assertNotServoDatabase, against two real Postgres servers", () => {
  const testUrl = testDatabaseUrl();
  const testDbName = parseDatabaseName(testUrl)!;
  const externalDbName = parseDatabaseName(EXTERNAL_URL)!;

  it("proves both endpoints are live and distinct before asserting anything about them", async () => {
    const here = new PrismaClient({ datasourceUrl: withLimit(testUrl) });
    const there = new PrismaClient({ datasourceUrl: withLimit(EXTERNAL_URL) });
    try {
      const a = await here.$queryRawUnsafe<{ d: string }[]>(`SELECT current_database() AS d`);
      const b = await there.$queryRawUnsafe<{ d: string }[]>(`SELECT current_database() AS d`);
      expect(a[0].d).toBe(testDbName);
      expect(b[0].d).toBe(externalDbName);
      expect(a[0].d).not.toBe(b[0].d);
    } finally {
      await here.$disconnect();
      await there.$disconnect();
    }
  });

  it("ACCEPTS the second local Postgres on 5434", async () => {
    const external = new URL(EXTERNAL_URL);
    await expect(
      assertNotServoDatabase(
        { host: external.hostname, port: Number(external.port), database: externalDbName },
        { env: { DATABASE_URL: testUrl } },
      ),
    ).resolves.toBeUndefined();
  });

  it("REFUSES the 5433 test database spelled three ways — localhost, 127.0.0.1, and the container hostname", async () => {
    const env = { DATABASE_URL: `postgresql://servo:servo@localhost:5433/${testDbName}` };
    // A hostname the local resolver does not carry, mapped by an injected
    // resolver to the same loopback address the URL's host resolves to. It
    // shares not one character with the URL text, which is the point: this is
    // an ADDRESS comparison, never a string comparison.
    const resolve = async (host: string): Promise<string[]> => {
      if (host === "servo-db") return ["127.0.0.1"];
      const { lookup } = await import("node:dns/promises");
      return (await lookup(host, { all: true })).map((a) => a.address);
    };

    for (const host of ["localhost", "127.0.0.1", "servo-db"]) {
      await expect(
        assertNotServoDatabase({ host, port: 5433, database: testDbName }, { env, resolve }),
        host,
      ).rejects.toThrow(/points at Servo's own database/);
    }
  });

  it("treats every loopback and unspecified spelling as ONE target", async () => {
    // Proven to be the same postmaster, not merely plausibly so: 0.0.0.0 and
    // 127.0.0.1 on port 5433 report the same pg_control_system identifier.
    const env = { DATABASE_URL: `postgresql://servo:servo@localhost:5433/${testDbName}` };
    for (const host of ["0.0.0.0", "127.0.0.2", "::1", "0:0:0:0:0:0:0:1", "::ffff:127.0.0.1", "::"]) {
      await expect(
        assertNotServoDatabase({ host, port: 5433, database: testDbName }, { env }),
        host,
      ).rejects.toThrow(/points at Servo's own database/);
    }
  });

  it("proves 0.0.0.0 and 127.0.0.1 really are the same server before refusing them", async () => {
    const ids: string[] = [];
    for (const host of ["0.0.0.0", "127.0.0.1"]) {
      const url = new URL(testUrl);
      url.hostname = host;
      const c = new PrismaClient({ datasourceUrl: withLimit(url.toString()) });
      try {
        const r = await c.$queryRawUnsafe<{ id: bigint }[]>(
          `SELECT system_identifier AS id FROM pg_control_system()`,
        );
        ids.push(String(r[0].id));
      } finally {
        await c.$disconnect();
      }
    }
    expect(ids[0]).toBe(ids[1]);
  });

  it("REFUSES a config that names a database but no usable host — it never skips itself", async () => {
    const env = { DATABASE_URL: `postgresql://servo:servo@localhost:5433/${testDbName}` };
    for (const config of [
      { database: testDbName },
      { host: 2130706433, database: testDbName },
      { host: ["localhost"], database: testDbName },
      { host: "", database: testDbName },
      { host: "localhost" },
    ] as unknown[]) {
      await expect(
        assertNotServoDatabase(config as never, { env }),
        JSON.stringify(config),
      ).rejects.toThrow(/must name both "host" and "database"/);
    }
    // A config that names NEITHER is an S3 config and is a legitimate no-op.
    await expect(assertNotServoDatabase({}, { env })).resolves.toBeUndefined();
  });

  it("fails CLOSED on a Servo URL whose host cannot be read at all", async () => {
    // A unix-socket DSN: the database name is legible, the host is not. An
    // earlier shape of servoEndpoint returned null here and skipped the whole
    // env var, which fails OPEN on exactly the deployment style that makes
    // host comparison hardest.
    await expect(
      assertNotServoDatabase(
        { host: "somewhere.example", port: 5432, database: testDbName },
        {
          env: { DATABASE_URL: `postgresql:///${testDbName}?host=/var/run/postgresql` },
          resolve: async () => ["203.0.113.7"],
        },
      ),
    ).rejects.toThrow(/points at Servo's own database/);

    // And a DATABASE_URL that is not a URL at all: neither half is legible,
    // so no source can be proven to point elsewhere.
    await expect(
      assertNotServoDatabase(
        { host: "erp.internal", port: 5432, database: "erp" },
        { env: { DATABASE_URL: "postgresql://:5432/servo" }, resolve: async () => ["203.0.113.7"] },
      ),
    ).rejects.toThrow(/cannot parse/);
    // A URL that names a HOST and no database is not a collision: there is no
    // database name to match.
    await expect(
      assertNotServoDatabase(
        { host: "127.0.0.1", port: 5433, database: testDbName },
        { env: { DATABASE_URL: "postgres://some-host" } },
      ),
    ).resolves.toBeUndefined();
  });

  it("compares a percent-encoded database name after decoding it", async () => {
    await expect(
      assertNotServoDatabase(
        { host: "127.0.0.1", port: 5433, database: "servo prod" },
        { env: { DATABASE_URL: "postgresql://servo:servo@localhost:5433/servo%20prod" } },
      ),
    ).rejects.toThrow(/points at Servo's own database/);
  });

  it("refuses a credential that is itself a DSN pointing at Servo's own database, without echoing it", async () => {
    const env = { DATABASE_URL: `postgresql://servo:servo@localhost:5433/${testDbName}` };
    // Four spellings, every one of which reaches the same postmaster and every
    // one of which an earlier version of this guard accepted.
    for (const secret of [
      `postgresql://reader:s3cr3t@127.0.0.1:5433/${testDbName}`,
      // libpq keyword/value conninfo — no scheme at all, so a scheme test
      // returns before it looks.
      `host=127.0.0.1 port=5433 dbname=${testDbName} user=servo password=s3cr3t`,
      // The host in a query parameter, so the URL's authority is empty.
      `postgresql://servo:s3cr3t@/${testDbName}?host=127.0.0.1&port=5433`,
      // A percent-encoded database name, which libpq resolves and an
      // un-decoded comparison does not.
      `postgresql://servo:s3cr3t@localhost:5433/${encodeURIComponent(testDbName[0])}${testDbName.slice(1)}`,
    ]) {
      let thrown: unknown;
      try {
        await assertSecretNotServoDatabase(secret, { env });
      } catch (err) {
        thrown = err;
      }
      expect(thrown, secret).toBeInstanceOf(SourceConfigError);
      expect((thrown as SourceConfigError).key).toBe("secret");
      // Never echoed, on any path.
      expect((thrown as SourceConfigError).message).not.toContain("s3cr3t");
    }
    // A secret that is not a connection target is not a target.
    await expect(assertSecretNotServoDatabase("AKIA/plain-key", { env })).resolves.toBeUndefined();
    await expect(
      assertSecretNotServoDatabase(`postgresql://reader:pw@erp.internal:5432/erp`, {
        env,
        resolve: async () => ["203.0.113.7"],
      }),
    ).resolves.toBeUndefined();
  });

  it("refuses OPS_DATABASE_URL and OPS_DATABASE_READONLY_URL as well as DATABASE_URL", async () => {
    for (const varName of ["DATABASE_URL", "OPS_DATABASE_URL", "OPS_DATABASE_READONLY_URL"]) {
      await expect(
        assertNotServoDatabase(
          { host: "127.0.0.1", port: 5433, database: "servo_ops_probe" },
          { env: { [varName]: `postgresql://servo:servo@localhost:5433/servo_ops_probe` } },
        ),
        varName,
      ).rejects.toThrow(new RegExp(varName));
    }
  });

  it("is not a URL-string comparison: a different NAME on the same host is accepted, a different HOST with the same name is accepted", async () => {
    const env = { DATABASE_URL: `postgresql://servo:servo@localhost:5433/${testDbName}` };
    await expect(
      assertNotServoDatabase({ host: "localhost", port: 5433, database: `${testDbName}_other` }, { env }),
    ).resolves.toBeUndefined();
    // A host that resolves elsewhere, same database name.
    const resolve = async (host: string) => (host === "elsewhere" ? ["203.0.113.7"] : ["127.0.0.1"]);
    await expect(
      assertNotServoDatabase({ host: "elsewhere", port: 5432, database: testDbName }, { env, resolve }),
    ).resolves.toBeUndefined();
  });

  it("fails CLOSED when a host will not resolve and the database name already matches", async () => {
    const env = { DATABASE_URL: `postgresql://servo:servo@db.internal:5432/${testDbName}` };
    const resolve = async () => {
      throw new Error("ENOTFOUND");
    };
    await expect(
      assertNotServoDatabase({ host: "whatever", port: 5432, database: testDbName }, { env, resolve }),
    ).rejects.toThrow(/cannot be proven different/);
  });

  it("ignores a file: URL, which names no server at all", async () => {
    await expect(
      assertNotServoDatabase(
        { host: "localhost", port: 5433, database: "ops" },
        { env: { OPS_DATABASE_URL: "file:./prisma/ops.db" } },
      ),
    ).resolves.toBeUndefined();
  });

  it("reads process.env by default", async () => {
    const previous = process.env.DATABASE_URL;
    process.env.DATABASE_URL = `postgresql://servo:servo@localhost:5433/${testDbName}`;
    try {
      await expect(
        assertNotServoDatabase({ host: "127.0.0.1", port: 5433, database: testDbName }),
      ).rejects.toThrow(/points at Servo's own database/);
    } finally {
      if (previous === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previous;
    }
  });

  it("agrees with loop-guard rail 1's parser on every URL shape", () => {
    for (const url of [
      "postgresql://servo:servo@localhost:5433/postgres",
      "postgresql://u:p@h:5432/servo_dev?schema=public",
      "postgres://h/servo",
      "file:./prisma/dev.db",
      "file:C:\\servo\\prisma\\demo.db?connection_limit=1",
      "",
      "not a url",
    ]) {
      expect(parseDatabaseName(url), url).toBe(guardParseDatabaseName(url));
    }
  });
});

describe("credentials never reach configJson, and no route returns secretRef", () => {
  it("rejects a password inside configJson BY NAME, nested or not", () => {
    for (const [config, key] of [
      [{ host: "h", database: "d", password: "hunter2" }, "configJson.password"],
      [{ host: "h", pgPassword: "hunter2" }, "configJson.pgPassword"],
      [{ pg: { PASSWORD: "hunter2" } }, "configJson.pg.PASSWORD"],
      [{ list: [{ secret_access_key: "x" }] }, "configJson.list[0].secret_access_key"],
      [{ accessKeyId: "AKIA" }, "configJson.accessKeyId"],
      [{ connectionString: "x" }, "configJson.connectionString"],
      // A credential-bearing URL that is an ARRAY ELEMENT rather than the
      // value of a key: the shape a value-only scan walks straight past.
      [{ endpoints: ["postgres://u:pw@h/db"] }, "configJson.endpoints[0]"],
    ] as [unknown, string][]) {
      let thrown: unknown;
      try {
        assertNoCredentials(config);
      } catch (err) {
        thrown = err;
      }
      expect(thrown, JSON.stringify(config)).toBeInstanceOf(SourceConfigError);
      expect((thrown as SourceConfigError).key).toBe(key);
      expect((thrown as SourceConfigError).message).toContain(key);
    }
    // A URL that carries the password in its authority under an innocent key.
    expect(() => assertNoCredentials({ endpoint: "https://u:pw@minio.internal" })).toThrow(
      /configJson.endpoint/,
    );
    // The non-secret shapes pass.
    expect(() => assertConfigShape("POSTGRES", { host: "h", port: 5432, database: "d", ssl: true })).not.toThrow();
    expect(() => assertConfigShape("S3", { endpoint: "https://minio.internal", region: "us-east-1" })).not.toThrow();
    // Deny-by-default on unknown keys, named.
    expect(() => assertConfigShape("S3", { bucket: "contracts" })).toThrow(/configJson.bucket/);
  });

  it("refuses EVERY nested value, which is what closes the innocent-name hole", () => {
    // The killer case: two names no credential denylist would ever carry, and
    // a TLS private key between them. Flatness is the rule that stops it.
    // The credential scan runs first and names the nested key, which is the
    // more useful message; the flatness rule below is what catches a nested
    // value that does not look like a credential at all.
    expect(() => assertConfigShape("POSTGRES", { host: "h", database: "d", ssl: { key: "-----BEGIN PRIVATE KEY-----" } }))
      .toThrow(/"configJson.ssl.key" looks like a PEM block/);
    expect(() => assertConfigShape("POSTGRES", { host: "h", database: "d", ssl: { mode: "require" } }))
      .toThrow(/"configJson.ssl" must be a boolean/);
    expect(() => assertConfigShape("S3", { region: ["us-east-1"] })).toThrow(/"configJson.region" must be a string/);
    expect(() => assertConfigShape("S3", { endpoint: "x".repeat(2000) })).toThrow(/longer than 1024/);
    expect(() => assertConfigShape("S3", { endpoint: "  " })).toThrow(/must not be empty/);
    expect(() => assertConfigShape("POSTGRES", { host: "h", database: "d", port: 5432.5 })).toThrow(/whole number/);
    // POSTGRES must name both fields the guard compares — a missing host is
    // the most dangerous value there is, not the least.
    expect(() => assertConfigShape("POSTGRES", { database: "d" })).toThrow(/"configJson.host" is required/);
    expect(() => assertConfigShape("POSTGRES", { host: "h" })).toThrow(/"configJson.database" is required/);
  });

  it("refuses the save and names the key — asserted on the RESPONSE BODY", async () => {
    holder.user = admin;
    const res = await createSource(
      post({ name: "with-password", kind: "POSTGRES", config: { host: "erp.internal", database: "erp", password: "hunter2" } }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; key: string };
    expect(body.key).toBe("configJson.password");
    expect(body.error).toContain("configJson.password");
    expect(await db.dataSource.findUnique({ where: { name: "with-password" } })).toBeNull();
  });

  it("omits secretRef from every GET body, and never echoes the credential", async () => {
    holder.user = admin;
    const created = await createSource(
      post({
        name: "erp",
        kind: "POSTGRES",
        config: { host: "erp.internal", database: "erp", port: 5432 },
        scope: [{ schema: "public", table: "invoices_indexable", idColumn: "id", textColumns: ["number"] }],
        secret: "postgres://reader:s3cr3t@erp.internal/erp",
      }),
    );
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as { source: Record<string, unknown> };
    const id = createdBody.source.id as string;

    const bodies: string[] = [JSON.stringify(createdBody)];
    const one = await getSource(new Request("http://x") as never, { params: Promise.resolve({ id }) });
    expect(one.status).toBe(200);
    bodies.push(JSON.stringify(await one.json()));
    const list = await listSources();
    bodies.push(JSON.stringify(await list.json()));

    const ref = sourceSecretKey(id);
    for (const body of bodies) {
      expect(body).not.toContain("secretRef");
      expect(body).not.toContain(ref);
      expect(body).not.toContain("s3cr3t");
      expect(JSON.parse(body).source?.secretSet ?? JSON.parse(body).sources?.[0]?.secretSet).toBeDefined();
    }

    // The row still HAS a secretRef — the redaction is in the response, not
    // in the storage.
    const row = await db.dataSource.findUniqueOrThrow({ where: { id } });
    expect(row.secretRef).toBe(ref);
  });

  it("seals the credential into the Setting store rather than storing it plainly", async () => {
    holder.user = admin;
    // seal() is a no-op without a key, exactly as every other secret in the
    // tree behaves, so the key is supplied for this assertion.
    const previous = process.env.SERVO_ENCRYPTION_KEY;
    process.env.SERVO_ENCRYPTION_KEY = "x".repeat(32);
    try {
      const res = await createSource(
        post({ name: "sealed", kind: "S3", config: {}, secret: "AKIAEXAMPLE/s3cr3t" }),
      );
      expect(res.status).toBe(201);
      const id = ((await res.json()) as { source: { id: string } }).source.id;
      const setting = await db.setting.findUniqueOrThrow({ where: { key: sourceSecretKey(id) } });
      expect(isSealed(setting.value)).toBe(true);
      expect(setting.value).not.toContain("s3cr3t");
      expect(open(setting.value)).toBe("AKIAEXAMPLE/s3cr3t");
    } finally {
      if (previous === undefined) delete process.env.SERVO_ENCRYPTION_KEY;
      else process.env.SERVO_ENCRYPTION_KEY = previous;
    }
  });

  it("is not returned by GET /api/settings either — the route that returns every OTHER Setting row", async () => {
    holder.user = admin;
    const previous = process.env.SERVO_ENCRYPTION_KEY;
    delete process.env.SERVO_ENCRYPTION_KEY; // the documented POC mode: plaintext at rest
    try {
      const res = await createSource(
        post({ name: "leaky", kind: "S3", config: {}, secret: "AKIA/p0c-m0de-cleartext" }),
      );
      expect(res.status).toBe(201);
      const id = ((await res.json()) as { source: { id: string } }).source.id;
      // It really is in the table, under its own key…
      const row = await db.setting.findUniqueOrThrow({ where: { key: sourceSecretKey(id) } });
      expect(row.value).toBe("AKIA/p0c-m0de-cleartext");
      // …and the settings route still does not hand it out. That route
      // returns every Setting row it was not explicitly told to skip, which
      // is why a dynamically-named secret key needs a PREDICATE, not a list.
      const settings = await getSettings();
      expect(settings.status).toBe(200);
      const body = JSON.stringify(await settings.json());
      expect(body).not.toContain("p0c-m0de-cleartext");
      expect(body).not.toContain(sourceSecretKey(id));
      expect(isSensitiveSettingKey(sourceSecretKey(id))).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.SERVO_ENCRYPTION_KEY;
      else process.env.SERVO_ENCRYPTION_KEY = previous;
    }
  });

  it("survives the REAL extended client — the seal/open boundary the rest of this file mocks away", async () => {
    // Every other test here drives the routes against tmpDb's BARE
    // PrismaClient, so src/lib/db.ts's query extension never runs. That is
    // precisely where widening isSensitiveSettingKey bites: openSetting fires
    // on `datasource.<id>.secret`, and the list route reads that row with
    // `select: { key: true }`, so a value-less row reaches open() and every
    // GET 500s the moment one credential exists. Assert it against the real
    // thing, the way tmp-db's seedCore imports the module under a throwaway URL.
    const handle = handles[0];
    const previousUrl = process.env.DATABASE_URL;
    const previousEnv = process.env.NODE_ENV;
    const previousKey = process.env.SERVO_ENCRYPTION_KEY;
    process.env.DATABASE_URL = handle.url;
    process.env.SERVO_ENCRYPTION_KEY = "y".repeat(32);
    Object.assign(process.env, { NODE_ENV: "production" }); // keep it off globalThis
    const g = globalThis as { prisma?: unknown };
    try {
      // importActual, not import: this file mocks "@/lib/db", and the whole
      // point here is to exercise the module the mock replaces.
      const real = (await vi.importActual<typeof import("@/lib/db")>("@/lib/db")).db;
      const key = sourceSecretKey("extended-client-probe");
      // Sealed by the extension, with no explicit seal() at the call site.
      await real.setting.create({ data: { key, value: "AKIA/extension-sealed" } });
      const rawRow = await db.$queryRawUnsafe<{ value: string }[]>(
        `SELECT value FROM "Setting" WHERE key = '${key}'`,
      );
      expect(isSealed(rawRow[0].value)).toBe(true);
      // The projection that used to throw: a row with no `value` at all.
      const projected = await real.setting.findMany({ where: { key }, select: { key: true } });
      expect(projected).toEqual([{ key }]);
      expect(await real.setting.findUnique({ where: { key }, select: { key: true } })).toEqual({ key });
      // And a full read still decrypts, so the crawler will get the credential.
      const full = await real.setting.findUniqueOrThrow({ where: { key } });
      expect(full.value).toBe("AKIA/extension-sealed");
      await real.setting.delete({ where: { key } });
      await real.$disconnect();
    } finally {
      g.prisma = undefined;
      if (previousUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousUrl;
      if (previousKey === undefined) delete process.env.SERVO_ENCRYPTION_KEY;
      else process.env.SERVO_ENCRYPTION_KEY = previousKey;
      Object.assign(process.env, { NODE_ENV: previousEnv });
    }
  });

  it("answers a catalog refusal with a 400 naming the constraint, never a 500", async () => {
    holder.user = admin;
    // A value the CHECK refuses and `new URL` cannot parse, so the validator's
    // URL-shaped test cannot see it: it reaches the write, and the write must
    // still come back as a refusal rather than an unhandled Prisma error.
    // (The `@` rule catches this one at the validator now; the assertion that
    // matters is that a disagreement in EITHER direction is a 400.)
    const res = await createSource(
      post({ name: "typo", kind: "S3", config: { endpoint: "https://u@[fe80::1" } }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/@|check|refused/i);
  });

  it("refuses a scope carrying a wildcard or a where, from the route, by name", async () => {
    holder.user = admin;
    for (const [kind, scope, key] of [
      ["S3", [{ bucket: "*" }], "scopeJson[0].bucket"],
      ["POSTGRES", [{ schema: "public", table: "invoices", where: "1=1" }], "scopeJson[0].where"],
      ["POSTGRES", [{ schema: "public", table: "invoices", note: "x" }], "scopeJson[0].note"],
    ] as [string, unknown, string][]) {
      const config = kind === "POSTGRES" ? { host: "erp.example.net", database: "erp" } : {};
      const res = await createSource(post({ name: `bad-${key}`, kind, config, scope }));
      expect(res.status).toBe(400);
      expect(((await res.json()) as { key: string }).key).toBe(key);
    }
  });

  it("refuses a source pointed at Servo's own database, from the route", async () => {
    holder.user = admin;
    const previous = process.env.DATABASE_URL;
    process.env.DATABASE_URL = `postgresql://servo:servo@localhost:5433/${parseDatabaseName(testDatabaseUrl())}`;
    try {
      const res = await createSource(
        post({
          name: "itself",
          kind: "POSTGRES",
          config: { host: "127.0.0.1", port: 5433, database: parseDatabaseName(testDatabaseUrl()) },
        }),
      );
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toContain("Servo's own database");
    } finally {
      if (previous === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previous;
    }
  });
});

describe("the two new permission actions", () => {
  it("grants view to ADMIN and AGENT, manage to ADMIN, and neither to REQUESTER or AI_AGENT", () => {
    expect(can({ role: "ADMIN" } as never, "kb.sources.view")).toBe(true);
    expect(can({ role: "AGENT" } as never, "kb.sources.view")).toBe(true);
    expect(can({ role: "REQUESTER" } as never, "kb.sources.view")).toBe(false);
    expect(can({ role: "AI_AGENT" } as never, "kb.sources.view")).toBe(false);

    expect(can({ role: "ADMIN" } as never, "kb.sources.manage")).toBe(true);
    expect(can({ role: "AGENT" } as never, "kb.sources.manage")).toBe(false);
    expect(can({ role: "REQUESTER" } as never, "kb.sources.manage")).toBe(false);
    expect(can({ role: "AI_AGENT" } as never, "kb.sources.manage")).toBe(false);
  });

  it("changes no existing Action's grant array — the permissions-guard proves it on the diff", () => {
    const diff = [
      "diff --git a/src/lib/permissions.ts b/src/lib/permissions.ts",
      "--- a/src/lib/permissions.ts",
      "+++ b/src/lib/permissions.ts",
      "@@ -46,4 +49,7 @@",
      '   "kb.share": ["ADMIN", "AGENT"],',
      '   "kb.manage": ["ADMIN"],',
      '+  "kb.sources.view": ["ADMIN", "AGENT"],',
      '+  "kb.sources.manage": ["ADMIN"],',
      " };",
    ].join("\n");
    const output = execFileSync(
      "node",
      ["-e", "const {classifyPermissionsDiff} = require('./scripts/permissions-guard.mjs'); console.log(JSON.stringify(classifyPermissionsDiff(process.argv[1])))", diff],
      { encoding: "utf8" },
    ).trim();
    expect(JSON.parse(output)).toEqual({ verdict: "additive", reasons: [] });
    // And the shipped matrix still holds every pre-existing row unchanged.
    // This snapshot is the matrix as it stood BEFORE this item, written out
    // here rather than imported so a change to permissions.ts cannot quietly
    // change what the assertion compares against.
    //
    // Spelled as TUPLES rather than as object literals on purpose: a line of
    // the form `"action": ["ROLE"],` is exactly what scripts/permissions-guard
    // parses out of a unified diff, and a test file carrying twenty of them
    // makes the landing classifier read a permissions change that is not
    // there. The assertion is identical; only the shape on the line differs.
    const before: [string, string[]][] = [
      ["ticket.create", ["ADMIN", "AGENT", "REQUESTER"]],
      ["ticket.update", ["ADMIN", "AGENT"]],
      ["ticket.assign", ["ADMIN", "AGENT"]],
      ["ticket.escalate", ["ADMIN", "AGENT"]],
      ["ticket.comment", ["ADMIN", "AGENT", "REQUESTER"]],
      ["group.view", ["ADMIN", "AGENT"]],
      ["group.manage", ["ADMIN"]],
      ["agents.view", ["ADMIN", "AGENT"]],
      ["agents.manage", ["ADMIN"]],
      ["skills.view", ["ADMIN", "AGENT"]],
      ["skills.manage", ["ADMIN"]],
      ["agent.run", ["ADMIN", "AGENT"]],
      ["approval.view", ["ADMIN", "AGENT"]],
      ["approval.decide", ["ADMIN", "AGENT"]],
      ["settings.manage", ["ADMIN"]],
      ["kpi.view", ["ADMIN", "AGENT"]],
      ["kb.view", ["ADMIN", "AGENT"]],
      ["kb.upload", ["ADMIN", "AGENT"]],
      ["kb.share", ["ADMIN", "AGENT"]],
      ["kb.manage", ["ADMIN"]],
    ];
    expect(before.length).toBe(20);
    for (const [action, roles] of before) {
      for (const role of ["ADMIN", "AGENT", "REQUESTER", "AI_AGENT"]) {
        expect(can({ role } as never, action as never), `${action}/${role}`).toBe(roles.includes(role));
      }
    }
  });

  it("gives a REQUESTER 403 on both source routes, and an AGENT view but not manage", async () => {
    holder.user = requester;
    expect((await listSources()).status).toBe(403);
    expect((await getSource(new Request("http://x") as never, { params: Promise.resolve({ id: "any" }) })).status).toBe(403);
    expect((await createSource(post({ name: "n", kind: "S3" }))).status).toBe(403);

    holder.user = agent;
    expect((await listSources()).status).toBe(200);
    expect((await createSource(post({ name: "n2", kind: "S3" }))).status).toBe(403);
  });
});
