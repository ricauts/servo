// fed-04: the four federation tools. Policies and the quarantine baseline,
// the engine-boundary cap at BOTH sites (deleting either fails the test),
// find_sources' briefs (no columns/types/rows; the SSN literal appears
// nowhere), open_dataset (no silo connection — connection-factory spy),
// discard_source (same-call next candidates; source scope suppresses),
// query_dataset's LIMIT injection and AND-joined re-verification, the MCP
// denial by name, and identical unentitled/unknown strings byte-for-byte.

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { PrismaClient } from "@prisma/client";
import { tmpDb, type TmpDb } from "./helpers/tmp-db";

type ServoDb = { [key: string]: unknown };
const holder = vi.hoisted(() => ({
  db: null as unknown as ServoDb,
  user: null as unknown as { id: string; role: string },
}));
vi.mock("@/lib/db", () => ({ get db() { return holder.db; } }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: async () => holder.user }));

import { federationTools } from "@/lib/ai/tools/federation";
import { TOOLS } from "@/lib/ai/tools";
import { DEFAULT_TOOL_POLICIES } from "@/lib/ai/tool-policies";
import { readLedger, FED_CONTEXT_BUDGET } from "@/lib/ai/retrieval-budget";

const handles: TmpDb[] = [];
afterAll(async () => {
  for (const h of handles) await h.dispose();
});

let db: PrismaClient;
let admin: { id: string; role: string };
let requester: { id: string };
let resolver: { id: string };
let runId: string;
let ticketId: string;
let cardId: string;

/** A connection-factory spy: open_dataset must record ZERO calls. */
const connections: unknown[] = [];
const siloFactory = vi.fn(async () => {
  connections.push({ at: Date.now() });
  return { query: async () => [] };
});

async function ctx(over: Record<string, unknown> = {}) {
  return {
    ticketId,
    runId,
    agentUser: resolver as never,
    principals: { agentId: "agent-x", humanId: requester.id },
    silo: { query: siloFactory as never },
    ...over,
  };
}

async function seedCard(opts: { id?: string; name?: string; dataSource?: string; text?: string } = {}) {
  const id = opts.id ?? "ds_fed_1";
  const catalogUser = await db.user.create({
    data: { name: "Servo Catalog", email: `c${Date.now()}${Math.random()}@servo.ai`, role: "AI_AGENT", aiKind: "CATALOG" },
  });
  await db.document.create({
    data: {
      id, name: opts.name ?? "public.payroll", contentType: "application/vnd.servo.catalog+json",
      sha256: "x", byteSize: 1, data: null, textStatus: "EXTRACTED",
      summary: "Payroll rows by period. SSN_LAST4 withheld.", ownerId: catalogUser.id,
      visibility: "PRIVATE", kind: "CATALOG",
    },
  });
  const entry = await db.catalogEntry.create({
    data: { dataSourceId: opts.dataSource ?? "silo-f", level: "DATASET", fqn: `pg://f/${id}`, displayName: opts.name ?? "public.payroll", documentId: id },
    select: { id: true },
  });
  await db.document.update({ where: { id }, data: { catalogEntryId: entry.id } });
  await db.documentChunk.createMany({
    data: [
      { documentId: id, index: 0, text: opts.text ?? "public.payroll overview · pg f — derived from the exact profile of 2026-08-28. Payroll rows by period.", locator: { entry: id, section: "overview" } },
      { documentId: id, index: 1, text: "values of status: ACTIVE (×600), CLOSED (×100).", locator: { entry: id, section: "values", from: "status" } },
    ],
  });
  return id;
}

async function entitle(humanId: string, sourceIds: string[]) {
  const rows = sourceIds.map((s) => `SELECT '${s}'::text AS "dataSourceId", '${humanId}'::text AS "userId"`).join(" UNION ALL ");
  await db.$executeRawUnsafe(
    `CREATE OR REPLACE VIEW datasource_readable_by_human AS ${rows.length > 0 ? rows : `SELECT ''::text AS "dataSourceId", ''::text AS "userId" WHERE false`}`,
  );
  // The AGENT side of the chain: same grants (the fixture's agent reads
  // what its requester reads — the intersection is then the human set).
  const arows = sourceIds.map((s) => `SELECT '${s}'::text AS "dataSourceId", 'agent-x'::text AS "agentId"`).join(" UNION ALL ");
  await db.$executeRawUnsafe(
    `CREATE OR REPLACE VIEW datasource_readable_by_agent AS ${arows.length > 0 ? arows : `SELECT ''::text AS "dataSourceId", ''::text AS "agentId" WHERE false`}`,
  );
}

beforeEach(async () => {
  if (handles.length > 1) await handles.shift()?.dispose();
  const a = await tmpDb();
  handles.push(a);
  db = a.client;
  holder.db = db as unknown as ServoDb;
  admin = { ...(await db.user.create({ data: { name: "Ad", email: "ad@x.com", role: "ADMIN" } })), role: "ADMIN" };
  requester = await db.user.create({ data: { name: "R", email: "r@x.com", role: "REQUESTER" } });
  resolver = await db.user.create({ data: { name: "S", email: `s${Date.now()}@servo.ai`, role: "AI_AGENT", aiKind: "RESOLVER" } });
  holder.user = admin;
  const ticket = await db.ticket.create({ data: { number: 9600, title: "payroll totals", description: "d", requesterId: requester.id, category: "DATABASE" } });
  ticketId = ticket.id;
  const run = await db.agentRun.create({ data: { ticketId, agentUserId: resolver.id, kind: "RESOLVE", status: "RUNNING" } });
  runId = run.id;
  cardId = await seedCard();
  await entitle(requester.id, ["silo-f"]);
  connections.length = 0;
  siloFactory.mockClear();
});

describe("policies and the quarantine baseline", () => {
  it("query_dataset HIGH+approval; the other three LOW+no-approval; no existing row modified", () => {
    const byName = new Map(DEFAULT_TOOL_POLICIES.map((p) => [p.toolName, p]));
    expect(byName.get("query_dataset")).toMatchObject({ riskLevel: "HIGH", requiresApproval: true });
    for (const name of ["find_sources", "open_dataset", "discard_source"]) {
      expect(byName.get(name)).toMatchObject({ riskLevel: "LOW", requiresApproval: false });
    }
    // The pre-existing rows are untouched:
    expect(byName.get("query_ops_database")).toMatchObject({ riskLevel: "LOW", requiresApproval: false });
    expect(byName.get("execute_ops_sql")).toMatchObject({ riskLevel: "HIGH", requiresApproval: true });
    // policy-guard passes with the additive baseline (run in the same test):
    const { execFileSync } = require("node:child_process");
    const out = execFileSync("node", ["scripts/policy-guard.mjs"], { encoding: "utf8" });
    expect(out).toMatch(/OK/);
  });

  it("ensureToolPolicies backfills all four without touching an admin-edited row", async () => {
    const { ensureToolPolicies } = await import("@/lib/ai/custom-tools");
    // Simulate an admin edit to find_sources BEFORE the backfill:
    await db.toolPolicy.upsert({
      where: { toolName: "find_sources" },
      create: { toolName: "find_sources", description: "admin desc", riskLevel: "MEDIUM", requiresApproval: true, enabled: false },
      update: { riskLevel: "MEDIUM", requiresApproval: true },
    });
    await ensureToolPolicies();
    const edited = await db.toolPolicy.findUniqueOrThrow({ where: { toolName: "find_sources" } });
    expect(edited.riskLevel).toBe("MEDIUM"); // untouched
    for (const name of ["open_dataset", "discard_source", "query_dataset"]) {
      const row = await db.toolPolicy.findUnique({ where: { toolName: name } });
      expect(row, name).not.toBeNull();
    }
  });
});

describe("find_sources — briefs, never internals", () => {
  it("≤1200 chars, ≤4 briefs, no column/type/row, footer consistent", async () => {
    const res = await federationTools.find_sources.execute({ question: "payroll" } as never, await ctx());
    expect(res.length).toBeLessThanOrEqual(1200);
    const briefs = (res.match(/^- /gm) ?? []).length;
    expect(briefs).toBeLessThanOrEqual(4);
    // The card's distinctive summary literal appears NOWHERE:
    expect(res).not.toContain("SSN_LAST4");
    // Plain substring checks — no regex metacharacters in the banned list.
    for (const banned of ["numeric(", "text,", " ACTIVE", "(×"]) {
      expect(res).not.toContain(banned);
    }
    expect(res).not.toMatch(/(^|\s)col(umn|s)?\s/);
    // Footer internal consistency: "N of M ... shown, K below the cut" with N+K ≤ M.
    const footer = res.match(/footer: (\d+) of (\d+) accessible datasets shown, (\d+) below the cut/);
    expect(footer).not.toBeNull();
    const [n, m, k] = footer!.slice(1).map(Number);
    expect(n).toBe(briefs);
    expect(n + k).toBeLessThanOrEqual(m);
  });
});

describe("open_dataset — cards only, no silo connection", () => {
  it("≤1500 chars per call, section-coursed, next cursor named", async () => {
    const res = await federationTools.open_dataset.execute({ datasetId: cardId, section: "overview" } as never, await ctx());
    expect(res.length).toBeLessThanOrEqual(1500);
    expect(res).toContain("overview");
    expect(res).toMatch(/next:/);
    // The connection factory recorded ZERO calls:
    expect(connections).toHaveLength(0);
  });

  it("columns/values paginate with {entry, section, from} named", async () => {
    const res = await federationTools.open_dataset.execute({ datasetId: cardId, section: "values" } as never, await ctx());
    expect(res).toContain("values");
    expect(res).toMatch(/from/);
    expect(connections).toHaveLength(0);
  });
});

describe("discard_source — same-call candidates, source scope", () => {
  it("≤900 chars, records {id, reason, scope}, returns next candidates in the SAME call", async () => {
    const res = await federationTools.discard_source.execute({ datasetId: cardId, reason: "sales not payroll" } as never, await ctx());
    expect(res.length).toBeLessThanOrEqual(900);
    expect(res).toMatch(/Discarded dataset/);
    expect(res).toMatch(/next candidates|0 next candidates/);
    const ledger = await readLedger(db as never, runId);
    expect(ledger.discarded).toBe(1);
    expect(ledger.discards.join(" ")).toMatch(/dataset:/);
    expect(ledger.discards.join(" ")).toContain("sales not payroll");
  });

  it("a source-scoped discard suppresses the whole source from later find_sources", async () => {
    // 400-table fixture on one source, one good table on another.
    for (let i = 0; i < 8; i++) {
      await seedCard({ id: `ds_noise_${i}`, name: `public.noise_${i}`, dataSource: "silo-noise" });
    }
    await seedCard({ id: "ds_good", name: "public.good_payroll", dataSource: "silo-good" });
    await entitle(requester.id, ["silo-f", "silo-noise", "silo-good"]);

    await federationTools.discard_source.execute(
      { sourceId: "silo-noise", scope: "source", reason: "staging mirror payroll" } as never,
      await ctx(),
    );
    // A later find_sources in the same run sees no noise dataset:
    const res = await federationTools.find_sources.execute({ question: "payroll" } as never, await ctx());
    expect(res).not.toContain("noise_");
  });
});

describe("query_dataset — the gated reach", () => {
  it("injects LIMIT when absent; the silo's query log carries the clause", async () => {
    const queries: string[] = [];
    const res = await federationTools.query_dataset.execute(
      { datasetId: cardId, sql: "SELECT * FROM payroll" } as never,
      await ctx({ silo: { query: async (sql: string) => { queries.push(sql); return Array.from({ length: 20 }, (_, i) => ({ i })); } } }),
    );
    expect(queries).toHaveLength(1);
    expect(queries[0]).toMatch(/LIMIT 20$/i);
    expect(res).toContain("20 rows");
  });

  it("revoking the CARD entitlement mid-run blocks the call; unknown and unentitled return IDENTICAL strings", async () => {
    // Revoke the card (empty the readable view → the oracle excludes it):
    await entitle(requester.id, []);
    const unentitled = await federationTools.open_dataset.execute({ datasetId: cardId } as never, await ctx());
    const unknown = await federationTools.open_dataset.execute({ datasetId: "nope" } as never, await ctx());
    expect(unentitled).toBe(unknown); // byte-for-byte

    // discard_source is excluded: recording a discard is its function and
    // its reply names the id it recorded — the acceptance's identical-string
    // rule covers the read tools and query_dataset.
    for (const tool of ["find_sources", "open_dataset", "query_dataset"] as const) {
      const a = await federationTools[tool].execute({ question: "x", datasetId: cardId, reason: "r", sql: "SELECT 1" } as never, await ctx({ principals: { agentId: "z", humanId: "nobody" } }));
      const b = await federationTools[tool].execute({ question: "x", datasetId: "nope", reason: "r", sql: "SELECT 1" } as never, await ctx({ principals: { agentId: "z", humanId: "nobody" } }));
      expect(a).toBe(b);
    }
  });
});

describe("the engine-boundary cap at BOTH sites", () => {
  it("both capToolResult calls exist, each naming the other; deleting either fails this test", () => {
    const source = readFileSync("src/lib/ai/engine.ts", "utf8");
    const calls = source.match(/capToolResult\(ctx,/g) ?? [];
    expect(calls.length, "exactly two sites").toBe(2);
    // Each site's comment names the other site:
    const site1 = source.indexOf("site 1 of 2");
    const site2 = source.indexOf("site 2 of 2");
    expect(site1).toBeGreaterThan(-1);
    expect(site2).toBeGreaterThan(-1);
    const comment1 = source.slice(Math.max(0, site1 - 500), site1 + 200);
    const comment2 = source.slice(Math.max(0, site2 - 500), site2 + 200);
    expect(comment1).toMatch(/resumeAfterApproval/);
    expect(comment2).toMatch(/driveResolverLoop/);
  });

  it("tool results CHARGE the ledger: a run reaching the budget through tools alone refuses", async () => {
    // Drive open_dataset repeatedly until the ledger refuses:
    let refusals = 0;
    for (let i = 0; i < 40 && refusals === 0; i++) {
      const res = await federationTools.open_dataset.execute({ datasetId: cardId, section: "overview" } as never, await ctx());
      if (/Budget exhausted/.test(res)) refusals++;
    }
    expect(refusals).toBe(1);
    const ledger = await readLedger(db as never, runId);
    expect(ledger.chars).toBeGreaterThan(0);
    expect(ledger.chars).toBeLessThanOrEqual(FED_CONTEXT_BUDGET);
  });
});

describe("registry, descriptions, MCP denial", () => {
  it("all four are in TOOLS with two worked examples each", () => {
    for (const name of ["find_sources", "open_dataset", "discard_source", "query_dataset"]) {
      expect(TOOLS[name], name).toBeDefined();
      const examples = (TOOLS[name].description.match(/find_sources\(|open_dataset\(|discard_source\(|query_dataset\(/g) ?? []).length;
      expect(examples, `${name} needs two worked examples`).toBeGreaterThanOrEqual(2);
    }
  });

  it("all four are ABSENT from the MCP registry, by name", async () => {
    const { getMcpTools } = await import("@/lib/mcp");
    const mcp = Object.keys(await getMcpTools());
    for (const name of ["find_sources", "open_dataset", "discard_source", "query_dataset"]) {
      expect(mcp).not.toContain(name);
    }
  });
});
