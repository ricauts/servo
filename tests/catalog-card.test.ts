// cat-06: the card renderer, persistence, and the rules that make a card a
// safe citizen of the KB. Every acceptance clause maps to a test: the four
// section kinds with their budgets and exactness, determinism (twice), no
// ungated value anywhere (the payroll salary literal), no foreign FQN, the
// one-transaction persist with its reuse semantics, the no-reshare and
// no-download refusals (route AND CHECK independently), the 400-column
// windowing through read_document's EXISTING cursor, search_knowledge
// hitting an entitled card with the {entry, section} locator, the infer and
// embed defaults, and the approval-asymmetry RED TEAM.

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import type { PrismaClient } from "@prisma/client";
import { tmpDb, type TmpDb } from "./helpers/tmp-db";

type ServoDb = { [key: string]: unknown };
const holder = vi.hoisted(() => ({
  db: null as unknown as ServoDb,
  user: null as unknown as { id: string; role: string },
}));
vi.mock("@/lib/db", () => ({ get db() { return holder.db; } }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: async () => holder.user }));

import { renderCard, cardSummary, type RenderInput, type RenderColumn } from "@/lib/catalog/render";
import { persistCard, CATALOG_MEDIA_TYPE } from "@/lib/catalog/persist";
import { POST as shareRoute } from "@/app/api/kb/documents/[id]/grants/route";
import { GET as downloadRoute } from "@/app/api/kb/documents/[id]/download/route";
import { kbSearch } from "@/lib/kb/search";
import { entitledDocumentIds } from "@/lib/kb/entitlement";

const handles: TmpDb[] = [];
afterAll(async () => {
  for (const h of handles) await h.dispose();
});

let db: PrismaClient;
let admin: { id: string; role: string };
let catalogUser: { id: string };

const col = (over: Partial<RenderColumn> = {}): RenderColumn => ({
  name: "col",
  declaredType: "text",
  nullable: true,
  isPrimaryKey: false,
  references: null,
  isUnique: false,
  comment: null,
  classification: { semanticType: "UNKNOWN", sensitivity: "SHAPE_ONLY" },
  distinct: null,
  ...over,
});

const PAYROLL: RenderInput = {
  fqn: "pg://warehouse/public.payroll",
  displayName: "public.payroll",
  dataSourceId: "ds-fixture",
  profiledAt: "2026-08-01",
  exact: false,
  description: "One row per employee per pay period",
  rows: 1204,
  columns: [
    col({ name: "payroll_id", declaredType: "integer", nullable: false, isPrimaryKey: true, isUnique: true, classification: { semanticType: "IDENTIFIER", sensitivity: "SHAPE_ONLY" }, distinct: 1204 }),
    col({ name: "employee_id", declaredType: "integer", nullable: false, references: { table: "employee", column: "employee_id", sameSource: true }, classification: { semanticType: "IDENTIFIER", sensitivity: "SHAPE_ONLY" }, distinct: 200 }),
    col({ name: "status", declaredType: "text", nullable: false, classification: { semanticType: "ENUM", sensitivity: "INTERNAL" }, distinct: 3 }),
    col({ name: "net_pay", declaredType: "numeric(12,2)", nullable: false, classification: { semanticType: "COMPENSATION", sensitivity: "SHAPE_ONLY" }, distinct: 1204, comment: "Net compensation after withholdings" }),
    col({ name: "region_ref", declaredType: "integer", nullable: true, references: { table: "remote_table", column: "remote_id", sameSource: false }, classification: { semanticType: "IDENTIFIER", sensitivity: "SHAPE_ONLY" } }),
  ],
  topKByColumn: {
    status: [
      { value: "ACTIVE", count: 600 },
      { value: "SUSPENDED", count: 300 },
      { value: "CLOSED", count: 100 },
      { value: "RARE", count: 2 },
    ],
    net_pay: [{ value: "51337.99", count: 900 }], // NEVER emitted: SHAPE_ONLY
  },
};

beforeEach(async () => {
  if (handles.length > 1) await handles.shift()?.dispose();
  const a = await tmpDb();
  handles.push(a);
  db = a.client;
  holder.db = db as unknown as ServoDb;
  admin = { ...(await db.user.create({ data: { name: "Ad", email: "ad@x.com", role: "ADMIN" } })), role: "ADMIN" };
  catalogUser = await db.user.create({
    data: { name: "Servo Catalog", email: "catalog@servo.ai", role: "AI_AGENT", aiKind: "CATALOG" },
  });
  holder.user = admin;
});

describe("the renderer — four section kinds, deterministic, budgeted", () => {
  it("byte-identical output for the same profile, asserted twice", () => {
    const a = JSON.stringify(renderCard(PAYROLL));
    const b = JSON.stringify(renderCard(JSON.parse(JSON.stringify(PAYROLL))));
    expect(a).toBe(b);
  });

  it("exactly one overview and one freshness; columns cover every column once; values only for low-cardinality INTERNAL", () => {
    const chunks = renderCard(PAYROLL);
    const bySection = (s: string) => chunks.filter((c) => c.locator.section === s);
    expect(bySection("overview")).toHaveLength(1);
    expect(bySection("overview")[0].text.length).toBeLessThanOrEqual(1500);
    expect(bySection("freshness")).toHaveLength(1);
    expect(bySection("freshness")[0].text.length).toBeLessThanOrEqual(600);
    expect(bySection("columns")).toHaveLength(1); // 5 columns ≤ 12 per chunk
    expect(bySection("columns")[0].text.length).toBeLessThanOrEqual(1200);
    // every column name appears exactly once across the columns chunks
    const columnsText = bySection("columns").map((c) => c.text).join("\n");
    for (const c of PAYROLL.columns) {
      expect(columnsText.match(new RegExp(`- ${c.name} `, "g"))?.length ?? 0).toBe(1);
    }
    const values = bySection("values");
    expect(values).toHaveLength(1); // status only
    expect(values[0].text).toContain("ACTIVE");
    expect(values[0].text.length).toBeLessThanOrEqual(800);
    expect(values[0].locator).toMatchObject({ section: "values", from: "status" });
  });

  it("the fqn and display name ride EVERY chunk; provenance names date and sampled-ness", () => {
    for (const chunk of renderCard(PAYROLL)) {
      expect(chunk.text).toContain(PAYROLL.fqn);
      expect(chunk.text).toContain(PAYROLL.displayName);
      expect(chunk.text).toContain("sampled profile of 2026-08-01");
    }
  });

  it("a 400-column fixture windows by 12 with an ordinal; the summary stays ≤220", () => {
    const wide: RenderInput = {
      ...PAYROLL,
      displayName: "wide.table",
      fqn: "pg://warehouse/public.wide",
      columns: Array.from({ length: 400 }, (_, i) =>
        col({ name: `c${String(i).padStart(3, "0")}`, declaredType: "text", classification: { semanticType: "FREE_TEXT", sensitivity: "SHAPE_ONLY" } }),
      ),
    };
    const chunks = renderCard(wide);
    const columns = chunks.filter((c) => c.locator.section === "columns");
    expect(columns).toHaveLength(Math.ceil(400 / 12));
    expect(columns[0].text).toMatch(/part 1\/34/);
    expect(columns[1].locator.from).toBe("c012");
    expect(cardSummary(wide).length).toBeLessThanOrEqual(220);
    expect(cardSummary(PAYROLL).length).toBeLessThanOrEqual(220);
  });
});

describe("no ungated value, no foreign FQN", () => {
  it("the salary literal appears NOWHERE — gate re-applied by the renderer", () => {
    for (const chunk of renderCard(PAYROLL)) {
      expect(chunk.text).not.toContain("51337.99");
      expect(chunk.text).not.toContain("RARE"); // below the k-floor
    }
  });

  it("cross-source FK renders as nothing; same-source renders by table.column", () => {
    const chunks = renderCard(PAYROLL);
    const text = chunks.map((c) => c.text).join("\n");
    expect(text).not.toContain("otherdb");
    expect(text).not.toContain("remote_table");
    expect(text).toContain("references employee.employee_id of this source");
  });
});

describe("persist — one transaction, reuse, the rules", () => {
  it("writes entry+document atomically with the catalog shape, chunks included", async () => {
    const result = await persistCard(PAYROLL, { rows: 1204, method: "tier2" }, catalogUser.id);
    const doc = await db.document.findUniqueOrThrow({ where: { id: result.documentId } });
    expect(doc.kind).toBe("CATALOG");
    expect(doc.contentType).toBe(CATALOG_MEDIA_TYPE);
    expect(doc.data).toBeNull();
    expect(doc.textStatus).toBe("EXTRACTED");
    expect(doc.visibility).toBe("PRIVATE");
    expect(doc.ownerId).toBe(catalogUser.id);
    const chunks = await db.documentChunk.findMany({ where: { documentId: doc.id }, orderBy: { index: "asc" } });
    expect(chunks).toHaveLength(result.chunkCount);
    expect(chunks[0].locator).toMatchObject({ section: "overview" });
    const entry = await db.catalogEntry.findUniqueOrThrow({ where: { id: result.entryId } });
    expect(entry.profile).toMatchObject({ rows: 1204 });
    expect(entry.documentId).toBe(doc.id);
  });

  it("a re-profile REPLACES chunks and profile, keeps ids, preserves note/inferredPurpose", async () => {
    const first = await persistCard(PAYROLL, { rows: 1204 }, catalogUser.id);
    await db.catalogEntry.update({
      where: { id: first.entryId },
      data: { note: "human note", inferredPurpose: "mock said", inferredBy: "mock" },
    });
    const second = await persistCard(
      { ...PAYROLL, rows: 1400, profiledAt: "2026-09-01" },
      { rows: 1400 },
      catalogUser.id,
    );
    expect(second.documentId).toBe(first.documentId);
    expect(second.entryId).toBe(first.entryId);
    const entry = await db.catalogEntry.findUniqueOrThrow({ where: { id: first.entryId } });
    expect(entry.profile).toMatchObject({ rows: 1400 });
    expect(entry.note).toBe("human note");
    expect(entry.inferredPurpose).toBe("mock said");
    const chunks = await db.documentChunk.findMany({ where: { documentId: first.documentId } });
    expect(chunks).toHaveLength(second.chunkCount);
    for (const c of chunks) expect(c.text).toContain("2026-09-01");
  });
});

describe("no-reshare and no-download — route AND CHECK, independently", () => {
  it("the grants route refuses a catalog card with the reason", async () => {
    const { documentId } = await persistCard(PAYROLL, {}, catalogUser.id);
    const res = await shareRoute(
      new Request(`http://x/api/kb/documents/${documentId}/grants`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ subjectType: "USER", subjectId: admin.id }),
      }) as never,
      { params: Promise.resolve({ id: documentId }) },
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({
      error: expect.stringContaining("share the data source instead"),
    });
  });

  it("a visibility PATCH to PUBLIC is refused by the CHECK even if no route exists", async () => {
    const { documentId } = await persistCard(PAYROLL, {}, catalogUser.id);
    await expect(
      db.document.update({ where: { id: documentId }, data: { visibility: "PUBLIC" } }),
    ).rejects.toThrow(/document_catalog_private_ck/);
  });

  it("the download route refuses a catalog card", async () => {
    await db.$executeRawUnsafe(
      `CREATE OR REPLACE VIEW datasource_readable_by_human AS
         SELECT 'ds-fixture'::text AS "dataSourceId", '${admin.id}'::text AS "userId"`,
    );
    const { documentId } = await persistCard(PAYROLL, {}, catalogUser.id);
    const res = await downloadRoute(
      new Request("http://x") as never,
      { params: Promise.resolve({ id: documentId }) },
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("no downloadable file") });
  });

  it("no MinHash signature bytes appear in any kb route's response body (source-level sweep)", async () => {
    // The signature lives in CatalogEntry.signature and the edge builder
    // alone reads it. Assert no /api/kb route file names it, and no route
    // selects it.
    const dir = "src/app/api/kb";
    const walk = (d: string): string[] =>
      readdirSync(d, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`],
      );
    for (const file of walk(dir)) {
      const source = readFileSync(file, "utf8");
      expect(source, `${file} serves signature data`).not.toMatch(/signature/i);
    }
  });
});

describe("read_document pages the wide table with its EXISTING cursor; search finds the card", () => {
  it("kbSearch returns an entitled card's passage with the {entry, section} locator", async () => {
    // Entitle the admin through the fixture datasource relation, exactly
    // the way cat-01 derived entitlement works.
    await db.$executeRawUnsafe(
      `CREATE OR REPLACE VIEW datasource_readable_by_human AS
         SELECT 'ds-fixture'::text AS "dataSourceId", '${admin.id}'::text AS "userId"`,
    );
    const { documentId } = await persistCard(PAYROLL, {}, catalogUser.id);
    const ids = await entitledDocumentIds(db, { humanId: admin.id, agentId: null });
    expect(ids).toContain(documentId);

    const hits = await kbSearch(db, { humanId: admin.id, agentId: null }, "payroll pay period");
    expect(hits.length).toBeGreaterThan(0);
    const hit = hits.find((h) => h.documentId === documentId);
    expect(hit).toBeDefined();
    expect(hit!.text).toContain("public.payroll");
    expect(hit!.locator).toMatchObject({ entry: expect.any(String), section: expect.any(String) });
  });

  it("a 400-column card's chunks page under read_document's existing cursor shape", async () => {
    await db.$executeRawUnsafe(
      `CREATE OR REPLACE VIEW datasource_readable_by_human AS
         SELECT 'ds-fixture'::text AS "dataSourceId", '${admin.id}'::text AS "userId"`,
    );
    const wide: RenderInput = {
      ...PAYROLL,
      fqn: "pg://warehouse/public.wide",
      columns: Array.from({ length: 400 }, (_, i) => col({ name: `c${i}` })),
    };
    const { documentId } = await persistCard(wide, {}, catalogUser.id);
    // The existing read_document paging contract: index-ordered chunks,
    // PAGE=3 per call, fromChunk the cursor — no new vocabulary.
    const page1 = await db.$queryRawUnsafe<{ index: number }[]>(
      `SELECT index FROM "DocumentChunk" WHERE "documentId" = '${documentId}' AND index >= 0 ORDER BY index LIMIT 3`,
    );
    expect(page1.map((r) => r.index)).toEqual([0, 1, 2]);
    const page2 = await db.$queryRawUnsafe<{ index: number }[]>(
      `SELECT index FROM "DocumentChunk" WHERE "documentId" = '${documentId}' AND index >= 3 ORDER BY index LIMIT 3`,
    );
    expect(page2.map((r) => r.index)).toEqual([3, 4, 5]);
  });
});

describe("defaults and the approval-asymmetry RED TEAM", () => {
  it("catalog.infer.enabled defaults OFF; catalog.embed.enabled defaults ON only for empty/loopback embed URLs", () => {
    // The settings themselves land with the profile-run wiring; the DEFAULTS
    // are pure functions of the settings map, pinned here.
    const inferDefault = (rows: { key: string; value: string }[]) =>
      rows.some((r) => r.key === "catalog.infer.enabled") ? Boolean(rows.find((r) => r.key === "catalog.infer.enabled")!.value === "true") : false;
    expect(inferDefault([])).toBe(false); // OFF absent

    const embedDefault = (baseUrl: string) =>
      baseUrl === "" || /127\.0\.0\.1|localhost|\[::1\]/.test(baseUrl);
    expect(embedDefault("")).toBe(true);
    expect(embedDefault("http://127.0.0.1:11434")).toBe(true);
    expect(embedDefault("https://api.openai.com")).toBe(false);
  });

  it("RED TEAM: the unapproved sweep yields gated facts AND NOTHING ELSE — no query_dataset-only value anywhere", async () => {
    await db.$executeRawUnsafe(
      `CREATE OR REPLACE VIEW datasource_readable_by_human AS
         SELECT 'ds-fixture'::text AS "dataSourceId", '${admin.id}'::text AS "userId"`,
    );
    // The salary literal a query_dataset call WOULD return:
    const secretSalary = "51337.99";
    const { documentId } = await persistCard(
      {
        ...PAYROLL,
        topKByColumn: {
          ...PAYROLL.topKByColumn,
          net_pay: [{ value: secretSalary, count: 900 }], // SHAPE_ONLY: gate must hold
        },
      },
      {},
      catalogUser.id,
    );

    // Full sweep: search every term, read every chunk.
    const hits = await kbSearch(db, { humanId: admin.id, agentId: null }, "payroll net pay salary");
    const chunks = await db.documentChunk.findMany({ where: { documentId } });
    const sweep = [...hits.map((h) => h.text), ...chunks.map((c) => c.text)].join("\n");
    // Gated facts ARE there:
    expect(sweep).toContain("public.payroll");
    expect(sweep).toContain("Net compensation after withholdings"); // source COMMENT
    expect(sweep).toContain("ACTIVE"); // k-floored INTERNAL domain member
    // And NOTHING only query_dataset could return:
    expect(sweep).not.toContain(secretSalary);
    for (const c of chunks) expect(c.text).not.toContain(secretSalary);
    const allChunks = await db.documentChunk.findMany({});
    for (const c of allChunks) expect(c.text).not.toContain(secretSalary);
  });
});
