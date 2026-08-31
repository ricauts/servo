import type { NextRequest } from "next/server";
import { executeMcpToolCall, getMcpConfig, getMcpTools } from "@/lib/mcp";

export const dynamic = "force-dynamic";

// Minimal, dependency-free MCP server over Streamable HTTP in stateless JSON
// mode (the spec allows plain application/json responses and servers that
// issue no session id). Validated for interop against the official
// @modelcontextprotocol/sdk client. Server-initiated streams are not
// offered, so GET returns 405 per spec.

const PROTOCOL_VERSION = "2025-06-18";

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

function rpcResult(id: string | number | null, result: unknown): Response {
  return Response.json({ jsonrpc: "2.0", id, result });
}

function rpcError(id: string | number | null, code: number, message: string): Response {
  return Response.json({ jsonrpc: "2.0", id, error: { code, message } });
}

async function authorized(req: NextRequest): Promise<Response | null> {
  const config = await getMcpConfig();
  if (!config.token) {
    return Response.json(
      { error: "MCP is disabled: no token configured (Settings or MCP_TOKEN)." },
      { status: 503 },
    );
  }
  const header = req.headers.get("authorization") ?? "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7) : "";
  const provided = bearer || req.headers.get("x-servo-token") || "";
  if (provided !== config.token) {
    return Response.json({ error: "Invalid MCP token." }, { status: 401 });
  }
  return null;
}

export async function POST(req: NextRequest) {
  const denied = await authorized(req);
  if (denied) return denied;

  const message = (await req.json().catch(() => null)) as JsonRpcRequest | null;
  if (!message || message.jsonrpc !== "2.0" || typeof message.method !== "string") {
    return rpcError(null, -32700, "Parse error: expected a JSON-RPC 2.0 message.");
  }

  // Notifications (no id) get a 202 with no body.
  if (message.id === undefined || message.id === null) {
    return new Response(null, { status: 202 });
  }
  const id = message.id;

  switch (message.method) {
    case "initialize": {
      const requested =
        (message.params?.protocolVersion as string | undefined) ?? PROTOCOL_VERSION;
      return rpcResult(id, {
        protocolVersion: requested === "2025-03-26" ? requested : PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "servo", version: "0.1.0" },
        instructions:
          "Servo service desk. Use create_ticket / search_tickets to file and find tickets; the remaining tools operate Servo's connected systems.",
      });
    }

    case "ping":
      return rpcResult(id, {});

    case "tools/list": {
      const tools = await getMcpTools();
      return rpcResult(id, {
        tools: Object.values(tools).map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
      });
    }

    case "tools/call": {
      // The route resolves nothing itself: executeMcpToolCall owns the policy
      // re-check at the execute site and the McpCall audit row, so no call can
      // reach a tool without leaving a trail.
      const name = String(message.params?.name ?? "");
      const args = (message.params?.arguments ?? {}) as Record<string, unknown>;
      const outcome = await executeMcpToolCall(name, args);
      if (outcome.rpcErrorCode !== undefined) {
        return rpcError(id, outcome.rpcErrorCode, outcome.text);
      }
      return rpcResult(id, {
        content: [{ type: "text", text: outcome.text }],
        isError: outcome.isError,
      });
    }

    default:
      return rpcError(id, -32601, `Method not found: ${message.method}`);
  }
}

/** No server-initiated stream is offered in stateless JSON mode. */
export async function GET() {
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}

export async function DELETE() {
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}
