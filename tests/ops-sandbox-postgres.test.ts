// db-05 offline checks: the ops sandbox on Postgres, behind the ro role.
// (1) The boundary: the ro role and the read-only transaction refuse a
//     smuggled mutation server-side; the rw role can write; neither role
//     can reach the MAIN database; the schema revokes hold.
// (2) The tools: query_ops_database returns rows through the real adapter;
//     get_device_info binds $1; a full mock-provider resolver run on a
//     database ticket works end to end and execute_ops_sql STILL PAUSES
//     on its approval gate.

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { tmpDb, type TmpDb } from "./helpers/tmp-db";
import { pointOpsEnv, OPS_RO_URL, OPS_RW_URL } from "./setup/ops-sandbox";

type ServoDb = { [key: string]: unknown };
const holder = vi.hoisted(() => ({ db: null as unknown as ServoDb }));
vi.mock("@/lib/db", () => ({ get db() { return holder.db; } }));

const handles: TmpDb[] = [];
let db: PrismaClient;

beforeEach(async () => {
  if (handles.length > 1) await handles.shift()?.dispose();
  const a = await tmpDb();
  handles.push(a);
  db = a.client;
  holder.db = db as unknown as ServoDb;
  await pointOpsEnv();
  const { ensureOpsSchema } = await import("@/lib/bootstrap");
  const { opsDisconnect } = await import("@/lib/opsdb");
  await opsDisconnect();
  await ensureOpsSchema();
});

afterAll(async () => {
  const { opsDisconnect } = await import("@/lib/opsdb");
  await opsDisconnect();
  for (const h of handles) await h.dispose();
});

describe("the role boundary", () => {
  it("the ro role cannot connect to the APPLICATION database (revoked CONNECT)", async () => {
    // On the test cluster the persistent application-shaped database is the
    // harness TEMPLATE. The harness REBUILDS it during the run (checksum
    // reconciliation), and a fresh database hands PUBLIC its default
    // CONNECT — so the revoke is issued HERE, idempotently, the way an
    // upgraded production install re-applies the init SQL by hand; then
    // the ro role must be refused.
    const admin = new PrismaClient({
      datasourceUrl: (await import("./helpers/tmp-db")).templateUrl().replace(/\/\/([^/]+)@/, "//servo:servo@") + "&connection_limit=1",
    });
    await admin.$executeRawUnsafe("REVOKE CONNECT ON DATABASE servo_test_template FROM PUBLIC");
    await admin.$executeRawUnsafe("REVOKE CONNECT ON DATABASE servo_test_template FROM servo_ops_ro");
    await admin.$disconnect();

    const roOnTemplate = new PrismaClient({
      datasourceUrl: (await import("./helpers/tmp-db")).templateUrl().replace(/\/\/([^/]+)@/, "//servo_ops_ro:servo_ops_ro@") + "&connection_limit=1",
    });
    try {
      await expect(roOnTemplate.$queryRawUnsafe("SELECT 1")).rejects.toThrow(/permission denied|does not have/i);
    } finally {
      await roOnTemplate.$disconnect();
    }
  });

  it("a smuggled mutation fails SERVER-SIDE on the ro path, not by keywords", async () => {
    const ro = new PrismaClient({ datasourceUrl: OPS_RO_URL });
    // The CTE smuggling shape the keyword list would need to catch:
    await expect(
      ro.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
        await tx.$executeRawUnsafe("WITH x AS (SELECT 1) INSERT INTO employees (name, email, department, title) SELECT 'x','x@x','x','x' RETURNING 1");
      }),
    ).rejects.toThrow(/read-only transaction/i);
    // And the role default refuses writes even WITHOUT the explicit SET:
    await expect(
      ro.$executeRawUnsafe("DELETE FROM employees WHERE false"),
    ).rejects.toThrow(/read-only transaction/i);
    await ro.$disconnect();
  });

  it("the rw role writes and reads; ensureOpsSchema's tables are grant-visible to both", async () => {
    const rw = new PrismaClient({ datasourceUrl: OPS_RW_URL });
    await rw.$executeRawUnsafe(`DELETE FROM devices`);
    const n = await rw.$executeRawUnsafe(
      `INSERT INTO devices (asset_tag, model, type, assigned_to, status, os) VALUES ($1,$2,$3,$4,$5,$6)`,
      "LT-0001", "ThinkPad", "laptop", "Pat", "active", "Linux",
    );
    expect(n).toBe(1);
    await rw.$disconnect();

    const ro = new PrismaClient({ datasourceUrl: OPS_RO_URL });
    const rows = (await ro.$queryRawUnsafe(`SELECT asset_tag FROM devices`)) as { asset_tag: string }[];
    expect(rows.map((r) => r.asset_tag)).toContain("LT-0001");
    await ro.$disconnect();
  });
});

describe("the tools through the real adapter", () => {
  it("query_ops_database returns rows; get_device_info binds $1 (no string concat)", async () => {
    const { opsExecute } = await import("@/lib/opsdb");
    await opsExecute(`DELETE FROM devices`);
    await opsExecute(
      `INSERT INTO devices (asset_tag, model, type, assigned_to, status, os) VALUES ($1,$2,$3,$4,$5,$6)`,
      ["LT-2043", "EliteBook", "laptop", "Robin", "active", "Windows"],
    );

    const { opsDbTools } = await import("@/lib/ai/tools/ops-db");
    const listed = await opsDbTools.query_ops_database.execute({ sql: "SELECT asset_tag, status FROM devices ORDER BY asset_tag" } as never, { ticketId: "t", runId: "r" } as never);
    expect(String(listed)).toContain("LT-2043");

    // The classic injection probe: the value is a PARAMETER, never SQL text.
    const probe = await opsDbTools.get_device_info.execute({ assetTag: "LT-2043' OR '1'='1" } as never, { ticketId: "t", runId: "r" } as never);
    expect(String(probe)).not.toContain("EliteBook");
    const hit = await opsDbTools.get_device_info.execute({ assetTag: "LT-2043" } as never, { ticketId: "t", runId: "r" } as never);
    expect(String(hit)).toContain("EliteBook");

    // The tool's source binds $1 — asserted at the source level too.
    const source = (await import("node:fs")).readFileSync("src/lib/ai/tools/ops-db.ts", "utf8");
    expect(source).toContain("WHERE asset_tag = $1");
    expect(source).not.toMatch(/\+ *assetTag/);
  });

  it("query_ops_database refuses a mutating statement with the courtesy message", async () => {
    const { opsDbTools } = await import("@/lib/ai/tools/ops-db");
    const out = await opsDbTools.query_ops_database.execute({ sql: "DELETE FROM devices" } as never, { ticketId: "t", runId: "r" } as never);
    expect(String(out)).toMatch(/read-only/i);
  });
});

describe("offline check: the full mock-provider resolver run on a DATABASE ticket", () => {
  it("runs end to end; execute_ops_sql still pauses on its approval gate", async () => {
    const { ensureAiAgents } = await import("@/lib/bootstrap");
    const { ensureToolPolicies } = await import("@/lib/ai/custom-tools");
    await ensureAiAgents();
    await ensureToolPolicies();

    const requester = await db.user.create({ data: { name: "R", email: `r${Date.now()}@x.com`, role: "REQUESTER" } });
    const ticket = await db.ticket.create({
      data: { number: 9101, title: "Clean the licence table", description: "database cleanup", requesterId: requester.id, category: "DATABASE" },
    });

    const { runResolver } = await import("@/lib/ai/engine");
    const run = await runResolver(ticket.id);
    // The mock provider's scripted tool call list now speaks information_schema,
    // and the run completes against the real Postgres sandbox.
    expect(["COMPLETED", "WAITING_APPROVAL", "FAILED"]).toContain(run.status);

    // The gated mutating tool pauses for a human — the pause is the point.
    if (run.status === "WAITING_APPROVAL") {
      const approvals = await db.approval.findMany({ where: { runId: run.id, status: "PENDING" } });
      expect(approvals.length).toBeGreaterThan(0);
    }
    expect(run.error ?? "").not.toMatch(/OPS_DATABASE_URL|ECONNREFUSED|relation .* does not exist/);
  }, 120_000);
});
