// The MCP surface has no human in the loop, so a tool whose policy says
// requiresApproval must be unreachable there: absent from tools/list and never
// executed by tools/call. These tests spy on the real tool implementations, so
// they fail loudly if the gate is ever bypassed again.
//
// The same surface leaves no AgentRun/AgentStep trail, so every tools/call —
// executed, refused or thrown — must write exactly one McpCall row. That is
// asserted here too: an unaudited execution is the other half of the bug.

import { readFile } from "node:fs/promises";
import type { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_TOOL_POLICIES } from "@/lib/ai/tool-policies";
import { RESULT_LIMIT } from "@/lib/ai/tools/types";

interface PolicyRow {
  toolName: string;
  enabled: boolean;
  requiresApproval: boolean;
}

interface McpCallRow {
  toolName: string;
  inputJson: string;
  resultPreview: string;
  decision: string;
  callerLabel: string;
}

const state = vi.hoisted(() => ({
  policies: [] as PolicyRow[],
  customTools: [] as Record<string, unknown>[],
  mcpCalls: [] as McpCallRow[],
  agentUser: { id: "agent-1", role: "AI_AGENT", aiKind: "RESOLVER" } as Record<
    string,
    unknown
  > | null,
}));

vi.mock("@/lib/db", () => ({
  db: {
    setting: { findUnique: async () => null },
    toolPolicy: {
      findMany: async () => state.policies.map((p) => ({ ...p })),
      findUnique: async ({ where }: { where: { toolName: string } }) =>
        state.policies.find((p) => p.toolName === where.toolName) ?? null,
      createMany: async ({ data }: { data: { toolName: string; requiresApproval: boolean }[] }) => {
        for (const row of data) {
          state.policies.push({
            toolName: row.toolName,
            enabled: true,
            requiresApproval: row.requiresApproval,
          });
        }
        return { count: data.length };
      },
    },
    customTool: { findMany: async () => state.customTools },
    user: {
      findFirst: async () => state.agentUser,
    },
    mcpCall: {
      create: async ({ data }: { data: McpCallRow }) => {
        state.mcpCalls.push({ ...data });
        return { id: `call-${state.mcpCalls.length}`, ...data };
      },
    },
  },
}));

const { POST } = await import("@/app/api/mcp/route");
const { TOOLS } = await import("@/lib/ai/tools");

const TOKEN = "test-mcp-token";

/** A custom HTTP integration: created from the UI with approval on by default. */
const APPROVAL_CUSTOM_TOOL = {
  name: "wire_transfer",
  description: "Move money (admin-defined integration).",
  inputSchema: '{"type":"object","properties":{}}',
  method: "POST",
  url: "https://bank.example/transfer",
  headers: "{}",
  bodyTemplate: "",
  secret: "",
};

async function rpc(method: string, params?: Record<string, unknown>) {
  const req = new Request("http://localhost/api/mcp", {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  }) as unknown as NextRequest;
  const res = await POST(req);
  return (await res.json()) as {
    result?: { tools?: { name: string }[]; content?: { text: string }[]; isError?: boolean };
    error?: { code: number; message: string };
  };
}

describe("MCP approval gate", () => {
  let executeSql: ReturnType<typeof vi.spyOn>;
  let querySql: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env.MCP_TOKEN = TOKEN;
    state.policies = DEFAULT_TOOL_POLICIES.map((p) => ({
      toolName: p.toolName,
      enabled: true,
      requiresApproval: p.requiresApproval,
    }));
    state.policies.push({ toolName: "wire_transfer", enabled: true, requiresApproval: true });
    state.customTools = [APPROVAL_CUSTOM_TOOL];
    state.mcpCalls = [];
    state.agentUser = { id: "agent-1", role: "AI_AGENT", aiKind: "RESOLVER" };
    // Stand in for the real implementations: reaching them at all is the bug.
    executeSql = vi.spyOn(TOOLS.execute_ops_sql, "execute").mockResolvedValue("EXECUTED");
    querySql = vi.spyOn(TOOLS.query_ops_database, "execute").mockResolvedValue("0 rows.");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.MCP_TOKEN;
  });

  it("never lists a tool that requires approval", async () => {
    const { result } = await rpc("tools/list");
    const names = (result?.tools ?? []).map((t) => t.name);

    for (const gated of [
      "execute_ops_sql",
      "cloud_apply_deployment",
      "github_edit_file",
      "github_merge_pr",
      "wire_transfer", // admin-defined integrations are gated the same way
    ]) {
      expect(names).not.toContain(gated);
    }
    // The unguarded surface is still served, so this is not a blanket refusal.
    expect(names).toContain("query_ops_database");
    expect(names).toContain("create_ticket");
  });

  it("refuses to execute a tool that requires approval", async () => {
    const { result } = await rpc("tools/call", {
      name: "execute_ops_sql",
      arguments: { sql: "DROP TABLE Ticket" },
    });

    expect(executeSql).not.toHaveBeenCalled();
    expect(result?.isError).toBe(true);
    expect(result?.content?.[0]?.text).toMatch(/requires human approval/i);
  });

  it("refuses an approval-gated custom integration too", async () => {
    const { result } = await rpc("tools/call", { name: "wire_transfer", arguments: {} });

    expect(result?.isError).toBe(true);
    expect(result?.content?.[0]?.text).toMatch(/requires human approval/i);
  });

  it("still runs a tool that needs no approval", async () => {
    const { result } = await rpc("tools/call", {
      name: "query_ops_database",
      arguments: { sql: "SELECT 1" },
    });

    expect(querySql).toHaveBeenCalledTimes(1);
    expect(result?.isError).toBe(false);
    expect(result?.content?.[0]?.text).toBe("0 rows.");
  });

  it("keeps reporting a genuinely unknown tool as a protocol error", async () => {
    const { error } = await rpc("tools/call", { name: "not_a_tool", arguments: {} });
    expect(error?.code).toBe(-32602);
  });
});

describe("MCP call audit trail", () => {
  let querySql: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env.MCP_TOKEN = TOKEN;
    state.policies = DEFAULT_TOOL_POLICIES.map((p) => ({
      toolName: p.toolName,
      enabled: true,
      requiresApproval: p.requiresApproval,
    }));
    state.customTools = [];
    state.mcpCalls = [];
    state.agentUser = { id: "agent-1", role: "AI_AGENT", aiKind: "RESOLVER" };
    querySql = vi.spyOn(TOOLS.query_ops_database, "execute").mockResolvedValue("0 rows.");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.MCP_TOKEN;
  });

  it("records EXECUTED with the truncated result on a successful call", async () => {
    querySql.mockResolvedValue("x".repeat(RESULT_LIMIT + 500));

    const { result } = await rpc("tools/call", {
      name: "query_ops_database",
      arguments: { sql: "SELECT 1" },
    });

    expect(state.mcpCalls).toHaveLength(1);
    const [row] = state.mcpCalls;
    expect(row.decision).toBe("EXECUTED");
    expect(row.toolName).toBe("query_ops_database");
    expect(row.callerLabel).toBe("mcp-external");
    expect(JSON.parse(row.inputJson)).toEqual({ sql: "SELECT 1" });
    // Truncated for storage AND for the caller.
    expect(row.resultPreview).toHaveLength(RESULT_LIMIT);
    expect(result?.content?.[0]?.text).toHaveLength(RESULT_LIMIT);
  });

  it("records REFUSED_POLICY, with no execution, for a policy flipped after tools/list", async () => {
    // The caller listed query_ops_database while it was ungated; an admin then
    // turned approval on. The execute site re-reads the policy itself, so the
    // refusal does not depend on what the earlier tools/list returned.
    const listed = await rpc("tools/list");
    expect((listed.result?.tools ?? []).map((t) => t.name)).toContain("query_ops_database");

    const policy = state.policies.find((p) => p.toolName === "query_ops_database")!;
    policy.requiresApproval = true;

    const { result } = await rpc("tools/call", {
      name: "query_ops_database",
      arguments: { sql: "SELECT 1" },
    });

    expect(querySql).not.toHaveBeenCalled();
    expect(result?.isError).toBe(true);
    expect(result?.content?.[0]?.text).toMatch(/requires human approval/i);
    expect(state.mcpCalls).toHaveLength(1);
    expect(state.mcpCalls[0]).toMatchObject({
      toolName: "query_ops_database",
      decision: "REFUSED_POLICY",
    });
  });

  it("records REFUSED_POLICY for a disabled tool", async () => {
    const policy = state.policies.find((p) => p.toolName === "query_ops_database")!;
    policy.enabled = false;

    const { result } = await rpc("tools/call", {
      name: "query_ops_database",
      arguments: { sql: "SELECT 1" },
    });

    expect(querySql).not.toHaveBeenCalled();
    expect(result?.isError).toBe(true);
    expect(state.mcpCalls).toHaveLength(1);
    expect(state.mcpCalls[0].decision).toBe("REFUSED_POLICY");
  });

  it("records REFUSED_POLICY for a ticket-bound core tool", async () => {
    const { result } = await rpc("tools/call", { name: "post_comment", arguments: {} });

    expect(result?.isError).toBe(true);
    expect(state.mcpCalls).toHaveLength(1);
    expect(state.mcpCalls[0]).toMatchObject({
      toolName: "post_comment",
      decision: "REFUSED_POLICY",
    });
  });

  it("records REFUSED_UNKNOWN for a name Servo does not have", async () => {
    const { error } = await rpc("tools/call", { name: "not_a_tool", arguments: {} });

    expect(error?.code).toBe(-32602);
    expect(state.mcpCalls).toHaveLength(1);
    expect(state.mcpCalls[0]).toMatchObject({
      toolName: "not_a_tool",
      decision: "REFUSED_UNKNOWN",
    });
  });

  it("records ERROR when the tool throws, and still answers the caller", async () => {
    querySql.mockRejectedValue(new Error("connection refused"));

    const { result } = await rpc("tools/call", {
      name: "query_ops_database",
      arguments: { sql: "SELECT 1" },
    });

    expect(result?.isError).toBe(true);
    expect(result?.content?.[0]?.text).toBe("connection refused");
    expect(state.mcpCalls).toHaveLength(1);
    expect(state.mcpCalls[0]).toMatchObject({
      toolName: "query_ops_database",
      decision: "ERROR",
      resultPreview: "connection refused",
    });
  });

  it("writes exactly one row per call, never two", async () => {
    await rpc("tools/call", { name: "query_ops_database", arguments: { sql: "SELECT 1" } });
    await rpc("tools/call", { name: "not_a_tool", arguments: {} });

    expect(state.mcpCalls.map((c) => c.decision)).toEqual(["EXECUTED", "REFUSED_UNKNOWN"]);
  });

  it("leaves no tool.execute() call in the route — the executor owns the trail", async () => {
    const source = await readFile(
      new URL("../src/app/api/mcp/route.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toMatch(/\.execute\s*\(/);
  });
});
