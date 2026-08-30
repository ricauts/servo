// Servo as an MCP server: exposes the tool registry (minus the ticket-bound
// core tools and anything gated on human approval) plus the Servo-native tools
// over the Model Context Protocol, so external MCP clients — Claude Code/
// Desktop, other agents — can operate the service desk. Transport is
// Streamable HTTP in stateless JSON mode.
//
// Auth follows the integration pattern: env MCP_TOKEN wins over the token
// stored in Settings; without any token the endpoint refuses to serve.

import { db } from "@/lib/db";
import { ensureToolPolicies, getToolRegistry } from "@/lib/ai/custom-tools";
import { CORE_TOOLS } from "@/lib/agent-profiles";

/** The federation tools are engine-only (fed-04): absent from tools/list,
 *  absent from tools/call — the run's retrieval budget has no meaning for
 *  an external MCP client. */
const FEDERATION_TOOLS = ["find_sources", "open_dataset", "discard_source", "query_dataset"];
import { getAiSettings } from "@/lib/ai/settings";
import { applySlaToTicket } from "@/lib/sla";
import { emitTicketEvent } from "@/lib/webhooks";
import { notifyTicketCreated } from "@/lib/notify";
import { runTriage } from "@/lib/ai/engine";
import { nextTicketNumber } from "@/lib/tickets";
import { RESULT_LIMIT } from "@/lib/ai/tools/types";
import type { ToolContext, ToolDef } from "@/lib/ai/tools";
import type { McpCallDecision } from "@/lib/types";

export const MCP_SETTING_KEYS = {
  token: "integration.mcp.token", // never returned by the API
} as const;

export interface McpConfig {
  token: string;
  tokenSource: "env" | "db" | "none";
}

export async function getMcpConfig(): Promise<McpConfig> {
  const row = await db.setting.findUnique({ where: { key: MCP_SETTING_KEYS.token } });
  const envToken = process.env.MCP_TOKEN ?? "";
  const dbToken = row?.value ?? "";
  return {
    token: envToken || dbToken,
    tokenSource: envToken ? "env" : dbToken ? "db" : "none",
  };
}

/**
 * Servo-native MCP tools — the ones with no counterpart in the resolver's own
 * registry. Searching and reading tickets are registry tools (search_tickets,
 * read_ticket, requester_history) and are served from there, so an MCP client
 * gets the same ranked, redaction-aware results the agents get.
 */
const NATIVE_TOOLS: Record<string, ToolDef> = {
  create_ticket: {
    name: "create_ticket",
    description:
      "Create a ticket in the Servo service desk. It is triaged automatically (category, priority, routing).",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short ticket title." },
        description: { type: "string", description: "What happened / what is needed." },
      },
      required: ["title", "description"],
    },
    async execute(input) {
      const title = String(input.title ?? "").trim();
      const description = String(input.description ?? "").trim();
      if (!title || !description) return "Error: title and description are required.";
      const requester = await db.user.findFirst({
        where: { role: "ADMIN" },
        orderBy: { createdAt: "asc" },
      });
      if (!requester) return "Error: no users exist yet — run the setup first.";
      const ticket = await db.ticket.create({
        data: {
          number: await nextTicketNumber(),
          title: title.slice(0, 200),
          description,
          status: "OPEN",
          channel: "MCP",
          priority: "MEDIUM",
          category: "OTHER",
          requesterId: requester.id,
        },
      });
      await applySlaToTicket(ticket.id);
      void notifyTicketCreated(ticket.id);
      void emitTicketEvent("ticket.created", ticket.id);
      const { autoTriage } = await getAiSettings();
      if (autoTriage) {
        try {
          await runTriage(ticket.id);
        } catch {
          /* triage failure must not fail creation */
        }
      }
      const fresh = await db.ticket.findUnique({ where: { id: ticket.id } });
      return `Ticket #${ticket.number} created (status ${fresh?.status ?? "OPEN"}, priority ${fresh?.priority ?? "MEDIUM"}, category ${fresh?.category ?? "OTHER"}).`;
    },
  },

};

/**
 * Tools served over MCP: registry minus the run-bound core tools, plus the
 * Servo-native ones. A registry tool is served only if its policy row exists,
 * is enabled, and does not require approval — MCP has no human in the loop, so
 * an approval-gated tool must never be reachable here. Deny-by-default on a
 * missing policy row mirrors the agent loop, which treats it as unavailable.
 */
/** KB tools are never served over MCP in v1 (kb-11): the shared bearer
 *  token carries no user identity, so there is no human principal — deny or
 *  invent a fallback are the only options, and inventing is the leak. */
export const KB_TOOLS = ["search_knowledge", "read_document", "list_collections"] as const;

export async function getMcpTools(): Promise<Record<string, ToolDef>> {
  await ensureToolPolicies(); // backfill built-ins added by an upgrade
  const [registry, policies] = await Promise.all([
    getToolRegistry(),
    db.toolPolicy.findMany({
      select: { toolName: true, enabled: true, requiresApproval: true },
    }),
  ]);
  const byName = new Map(policies.map((p) => [p.toolName, p]));
  const served: Record<string, ToolDef> = {};
  for (const [name, tool] of Object.entries(registry)) {
    if (CORE_TOOLS.includes(name)) continue;
    // The federation four never cross MCP (fed-04): they operate a
    // per-run ledger and per-run principals that an external caller has
    // neither — the run IS the budget.
    if (FEDERATION_TOOLS.includes(name)) continue;
    if ((KB_TOOLS as readonly string[]).includes(name)) continue;
    const policy = byName.get(name);
    if (!policy || !policy.enabled || policy.requiresApproval) continue;
    served[name] = tool;
  }
  return { ...served, ...NATIVE_TOOLS };
}

/**
 * Why a tool the caller asked for exists in Servo but is withheld from MCP,
 * or null when the name is genuinely unknown. Follows the tool contract:
 * a descriptive string the calling agent can read and adapt to.
 */
export async function mcpToolWithholdReason(name: string): Promise<string | null> {
  const registry = await getToolRegistry();
  if (!registry[name]) return null;
  if (CORE_TOOLS.includes(name)) {
    return `Error: "${name}" only runs inside a ticket's agent run and is not available over MCP.`;
  }
  const policy = await db.toolPolicy.findUnique({ where: { toolName: name } });
  if (!policy) return `Error: "${name}" has no tool policy, so it is not available over MCP.`;
  if (!policy.enabled) return `Error: "${name}" is disabled by policy.`;
  if (policy.requiresApproval) {
    return `Error: "${name}" requires human approval, which an MCP caller cannot obtain. File a ticket with create_ticket and let a Servo agent run it under the approval gate.`;
  }
  if ((KB_TOOLS as readonly string[]).includes(name)) {
    return `Error: knowledge tools require a per-user token; the MCP session has no human principal.`;
  }
  return null;
}

/** Context for MCP-invoked executions. Only the (excluded) core tools read
 * the ticket/run fields; the agent identity is the system resolver. */
export async function mcpToolContext(): Promise<ToolContext | null> {
  const agentUser = await db.user.findFirst({
    where: { role: "AI_AGENT", aiKind: "RESOLVER" },
  });
  if (!agentUser) return null;
  return { ticketId: "mcp-external", runId: "mcp-external", agentUser };
}

/** What one tools/call produced, plus the decision recorded on its audit row. */
export interface McpCallResult {
  decision: McpCallDecision;
  /** Tool result or refusal text, already truncated to RESULT_LIMIT. */
  text: string;
  isError: boolean;
  /** Set when the failure is protocol-level (unknown tool, unconfigured
   *  server) rather than a tool result the caller can read and adapt to. */
  rpcErrorCode?: number;
}

function truncate(text: string): string {
  return text.length > RESULT_LIMIT ? text.slice(0, RESULT_LIMIT) : text;
}

function inputToJson(args: Record<string, unknown>): string {
  try {
    return JSON.stringify(args ?? {}) ?? "{}";
  } catch {
    return "{}";
  }
}

/**
 * The single execute site for MCP tool calls, and the only place `tools/call`
 * may run a tool. Two things happen here that a caller-facing filter cannot
 * guarantee:
 *
 * 1. The policy is re-read at the execute site and enforced independently of
 *    what `getMcpTools()` returned — defence in depth, not an optimisation.
 * 2. Every call leaves exactly one `McpCall` row: executed, refused or thrown.
 *    External MCP clients run outside the engine loop and so have no
 *    AgentRun/AgentStep trail; this row is the trail.
 *
 * It never throws at the caller: a tool that crashes is an `ERROR` row and a
 * readable tool-error string.
 */
export async function executeMcpToolCall(
  name: string,
  args: Record<string, unknown>,
): Promise<McpCallResult> {
  const outcome = await resolveMcpToolCall(name, args);
  await db.mcpCall.create({
    data: {
      toolName: name,
      inputJson: inputToJson(args),
      resultPreview: outcome.text,
      decision: outcome.decision,
      callerLabel: "mcp-external",
    },
  });
  return outcome;
}

async function resolveMcpToolCall(
  name: string,
  args: Record<string, unknown>,
): Promise<McpCallResult> {
  const native = NATIVE_TOOLS[name];
  const registry = await getToolRegistry();
  const tool = native ?? registry[name];

  if (!tool) {
    return {
      decision: "REFUSED_UNKNOWN",
      text: `Unknown tool: ${name}`,
      isError: true,
      rpcErrorCode: -32602,
    };
  }

  // Native MCP tools have no registry policy row; every registry tool is
  // policy-checked here regardless of what tools/list served.
  if (!native) {
    const refusal = await mcpPolicyRefusal(name);
    if (refusal) return { decision: "REFUSED_POLICY", text: truncate(refusal), isError: true };
  }

  const ctx = await mcpToolContext();
  if (!ctx) {
    return {
      decision: "ERROR",
      text: "Servo has no system agents yet — run setup.",
      isError: true,
      rpcErrorCode: -32603,
    };
  }

  try {
    const text = truncate(await tool.execute(args, ctx));
    return { decision: "EXECUTED", text, isError: text.startsWith("Error:") };
  } catch (err) {
    return {
      decision: "ERROR",
      text: truncate(err instanceof Error ? err.message : "Tool crashed."),
      isError: true,
    };
  }
}

/**
 * Why this registry tool may not run over MCP, or null when it may. Reuses
 * `mcpToolWithholdReason()`'s texts and re-reads the policy row itself, so the
 * refusal does not depend on what `getMcpTools()` filtered.
 */
async function mcpPolicyRefusal(name: string): Promise<string | null> {
  if (CORE_TOOLS.includes(name)) {
    return (
      (await mcpToolWithholdReason(name)) ??
      `Error: "${name}" only runs inside a ticket's agent run and is not available over MCP.`
    );
  }
  const policy = await db.toolPolicy.findUnique({ where: { toolName: name } });
  if (policy?.enabled && !policy.requiresApproval) return null;
  return (
    (await mcpToolWithholdReason(name)) ??
    `Error: "${name}" is not available over MCP.`
  );
}
