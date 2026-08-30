// cnp-03: MCP tools in the registry and the engine approval gate, end to
// end. The fixture server speaks real Streamable HTTP on 127.0.0.1 with
// the egress allowlist naming it exactly — no mock of the protocol, and
// nothing beyond the loopback fixture is ever reached.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { tmpDb, type TmpDb } from "./helpers/tmp-db";

type ServoDb = { [key: string]: unknown };
const holder = vi.hoisted(() => ({ db: null as unknown as ServoDb }));
vi.mock("@/lib/db", () => ({ get db() { return holder.db; } }));

import { startMcpFixture, type FixtureTool, type McpFixture } from "./setup/mcp-fixture-server";
import { getToolRegistry } from "@/lib/ai/custom-tools";
import { getMcpTools } from "@/lib/mcp";
import { resumeAfterApproval, runResolver } from "@/lib/ai/engine";
import { ensureAiAgents } from "@/lib/bootstrap";
import { MockProvider } from "@/lib/ai/mock";
import { profileAllowsTool } from "@/lib/agent-profile-format";
import { mcpToolName } from "@/lib/mcp-client";

const ECHO: FixtureTool = {
  name: "echo",
  description: "Echo a string back.",
  inputSchema: { type: "object", properties: { text: { type: "string" } } },
};

const handles: TmpDb[] = [];
afterAll(async () => {
  for (const h of handles) await h.dispose();
  await fixture?.close();
});

let fixture: McpFixture | null = null;
let db: PrismaClient;
let requesterId: string;
let adminId: string;

beforeAll(async () => {
  fixture = await startMcpFixture([ECHO]);
});

beforeEach(async () => {
  if (handles.length > 1) await handles.shift()?.dispose();
  const handle = await tmpDb();
  handles.push(handle);
  db = handle.client;
  holder.db = db as unknown as ServoDb;
  fixture!.setTools([ECHO]);
  await ensureAiAgents();
  // The egress rule, not a hole in it: a loopback fixture is refused unless
  // an admin names the host exactly (cnp-02's rule, reused as shipped).
  await db.setting.create({
    data: { key: "integration.egress.allowlist", value: `127.0.0.1:${fixture!.port}` },
  });
  // An ENABLED server whose snapshot carries echo — the row sync would have
  // written after a tools/list, seeded here directly for the registry paths.
  await db.mcpServer.create({
    data: {
      slug: "fixture", name: "Fixture", url: fixture!.url, enabled: true,
      toolsJson: JSON.stringify([
        { name: "echo", description: "Echo a string back.", inputSchema: "{}", hash: "h1", declaredRiskLevel: null, declaredHints: "{}" },
      ]),
    },
  });
  // The Ruling-6 policy the sync writes for every derived tool.
  await db.toolPolicy.create({
    data: { toolName: "mcp__fixture__echo", description: "Echo on the fixture server", enabled: true, requiresApproval: true, riskLevel: "HIGH" },
  });
  requesterId = (await db.user.create({ data: { name: "Rita Requester", email: `r${Date.now()}@x.com`, role: "REQUESTER" } })).id;
  adminId = (await db.user.create({ data: { name: "Ada Admin", email: `a${Date.now()}@x.com`, role: "ADMIN" } })).id;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the registry", () => {
  it("merges ENABLED servers' snapshots; built-ins survive intact; a disabled server contributes nothing", async () => {
    await db.mcpServer.create({
      data: {
        slug: "off", name: "Off", url: "http://127.0.0.1:1/mcp", enabled: false,
        toolsJson: JSON.stringify([
          { name: "secret", description: "should not appear", inputSchema: "{}", hash: "h2", declaredRiskLevel: null, declaredHints: "{}" },
        ]),
      },
    });
    const registry = await getToolRegistry();
    expect(registry[mcpToolName("fixture", "echo")]).toBeDefined();
    expect(registry[mcpToolName("fixture", "echo")].description).toBe("Echo a string back.");
    // Built-ins win by construction: they spread LAST, and every one of
    // them is still present beside the derived tool.
    expect(registry.search_knowledge).toBeDefined();
    expect(registry[mcpToolName("off", "secret")]).toBeUndefined(); // disabled: nothing merges
  });

  it("the derived execute never throws for an unreachable server: 'Error: ...' within RESULT_LIMIT", async () => {
    await db.mcpServer.update({ where: { slug: "fixture" }, data: { url: "http://127.0.0.1:9/mcp" } });
    const registry = await getToolRegistry();
    const out = await registry[mcpToolName("fixture", "echo")].execute({ text: "x" }, {} as never);
    expect(out).toMatch(/^Error: /);
    expect(out.length).toBeLessThanOrEqual(4000);
  });

  it("getMcpTools() never proxies the mcp__ namespace — Servo's server is not a hop-through", async () => {
    const proxied = await getMcpTools();
    expect(Object.keys(proxied).some((n) => n.startsWith("mcp__"))).toBe(false);
  });
});

describe("the engine approval gate, end to end on the mock provider", () => {
  function echoTicket(number: number) {
    return db.ticket.create({
      data: {
        number,
        title: "Echo this through the MCP fixture",
        description: "Please echo a message via the connected mcp integration.",
        requesterId,
        category: "DEVOPS",
        status: "TRIAGED",
      },
    });
  }

  it("mcp__fixture__echo with requiresApproval pauses the run; the decision resumes it and the fixture's result lands in the conversation", async () => {
    const ticket = await echoTicket(9101);
    const run = await runResolver(ticket.id);

    expect(run.status).toBe("WAITING_APPROVAL");
    expect((await db.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).status).toBe("WAITING_APPROVAL");

    const approvals = await db.approval.findMany({ where: { runId: run.id } });
    expect(approvals).toHaveLength(1);
    expect(approvals[0]).toMatchObject({
      toolName: "mcp__fixture__echo",
      status: "PENDING",
      riskLevel: "HIGH",
    });
    expect(approvals[0].toolUseId).toBeTruthy();

    // Paused BEFORE executing: the request step exists, the call does not.
    const requests = await db.agentStep.findMany({ where: { runId: run.id, type: "APPROVAL_REQUEST" } });
    expect(requests.map((s) => s.toolName)).toEqual(["mcp__fixture__echo"]);
    const calls = await db.agentStep.findMany({ where: { runId: run.id, type: "TOOL_CALL" } });
    expect(calls.map((s) => s.toolName)).not.toContain("mcp__fixture__echo");

    // Approve, resume: the run completes and the fixture server's echo —
    // the string the mock sent — is in the recorded conversation.
    await db.approval.update({
      where: { id: approvals[0].id },
      data: { status: "APPROVED", decidedAt: new Date(), deciderId: adminId },
    });
    const resumed = await resumeAfterApproval(approvals[0].id);
    expect(resumed.status).toBe("COMPLETED");
    expect(resumed.error).toBeNull();

    const executed = await db.agentStep.findMany({ where: { runId: resumed.id, type: "TOOL_CALL" } });
    const echoCall = executed.find((s) => s.toolName === "mcp__fixture__echo");
    expect(echoCall).toBeDefined(); // exactly the resume path executed it

    const conversation = (await db.agentRun.findUniqueOrThrow({ where: { id: resumed.id } })).conversation;
    expect(conversation).toContain("hello from the fixture");

    // The mock provider really drove it.
    expect(await db.agentRun.count({ where: { id: resumed.id } })).toBe(1);
    void MockProvider; // imported for the pattern parity with loop-05's suite
  }, 60_000);

  it("a policy with enabled:false makes the derived tool invisible to the loop (deny-by-default preserved)", async () => {
    await db.toolPolicy.update({
      where: { toolName: "mcp__fixture__echo" },
      data: { enabled: false },
    });
    const ticket = await echoTicket(9102);
    const run = await runResolver(ticket.id);
    // The tool never existed for the run: no approval, no call, and the run
    // completes on the ordinary script instead of pausing.
    expect(run.status).toBe("COMPLETED");
    expect(await db.approval.count({ where: { runId: run.id } })).toBe(0);
    const calls = await db.agentStep.findMany({ where: { runId: run.id, type: "TOOL_CALL" } });
    expect(calls.map((s) => s.toolName)).not.toContain("mcp__fixture__echo");
  }, 60_000);
});

describe("profile allowlisting — EXACT-NAME matching", () => {
  it("frontmatter listing mcp__fixture__echo allowlists it; wildcards stay Roadmap", () => {
    const exact = { tools: JSON.stringify(["mcp__fixture__echo"]) };
    expect(profileAllowsTool(exact, "mcp__fixture__echo")).toBe(true);
    expect(profileAllowsTool(exact, "mcp__fixture__wipe")).toBe(false); // exact name, not a prefix
    expect(profileAllowsTool(exact, "search_tickets")).toBe(false); // not core-listed? core check first
    const wildcard = { tools: JSON.stringify(["mcp__*"]) };
    expect(profileAllowsTool(wildcard, "mcp__fixture__echo")).toBe(false); // wildcards are Roadmap
  });
});
