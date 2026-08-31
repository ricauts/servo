// PATCH / DELETE for one MCP server, plus the sync action (cnp-02).
//
// POST /api/mcp-servers/[id]?action=sync runs `tools/list` and mints the
// quarantined policy rows — the same query-action shape the webhooks route
// uses for its test ping.
//
// Deleting a server deliberately leaves its `ToolPolicy` rows in place: they
// carry an admin's decisions, they are invisible without a registry entry,
// and the sync contract in docs/design/connectors.md §6.3 says policies are
// never auto-deleted.

import type { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { forbid } from "@/lib/permissions";
import { MCP_TRANSPORTS, syncMcpServerTools } from "@/lib/mcp-client";
import { isHttpUrl, MAX_HEADERS, validHeaderObject, view } from "@/lib/mcp-server-view";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** The slug is immutable: it is baked into every `mcp__<slug>__<tool>` policy
 *  row already minted, and renaming it would orphan them silently. */
const patchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  transport: z.enum(MCP_TRANSPORTS).optional(),
  url: z.string().max(1000).refine(isHttpUrl, "A valid http(s) URL is required").optional(),
  headers: z
    .string()
    .max(MAX_HEADERS, `Headers must be at most ${MAX_HEADERS} characters`)
    .refine(validHeaderObject, "Headers must be a JSON object of string values")
    .optional(),
  /** Omitted leaves the stored secret untouched; "" clears it. */
  secret: z.string().max(500).optional(),
  enabled: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, { params }: Params) {
  const user = await getCurrentUser();
  const denied = forbid(user, "settings.manage");
  if (denied) return denied;

  const { id } = await params;
  const existing = await db.mcpServer.findUnique({ where: { id } });
  if (!existing) return Response.json({ error: "MCP server not found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request body" },
      { status: 400 },
    );
  }
  const data = parsed.data;

  const server = await db.mcpServer.update({
    where: { id },
    data: {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.transport !== undefined ? { transport: data.transport } : {}),
      ...(data.url !== undefined ? { url: data.url } : {}),
      ...(data.headers !== undefined ? { headers: data.headers } : {}),
      ...(data.secret !== undefined ? { secret: data.secret } : {}),
      ...(data.enabled !== undefined ? { enabled: data.enabled } : {}),
    },
  });
  return Response.json({ server: view(server) });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const user = await getCurrentUser();
  const denied = forbid(user, "settings.manage");
  if (denied) return denied;

  const { id } = await params;
  const existing = await db.mcpServer.findUnique({ where: { id } });
  if (!existing) return Response.json({ error: "MCP server not found" }, { status: 404 });

  await db.mcpServer.delete({ where: { id } });
  return Response.json({ ok: true });
}

export async function POST(req: NextRequest, { params }: Params) {
  const user = await getCurrentUser();
  const denied = forbid(user, "settings.manage");
  if (denied) return denied;

  const { id } = await params;
  if (req.nextUrl.searchParams.get("action") !== "sync") {
    return Response.json({ error: "Unknown action" }, { status: 400 });
  }
  const existing = await db.mcpServer.findUnique({ where: { id } });
  if (!existing) return Response.json({ error: "MCP server not found" }, { status: 404 });

  const result = await syncMcpServerTools(id);
  if (!result.ok) {
    // A refused destination or an unreachable server is an expected failure,
    // reported as copy the admin can act on — never a 500 with a stack.
    return Response.json({ error: result.error ?? "Sync failed" }, { status: 502 });
  }
  const server = await db.mcpServer.findUnique({ where: { id } });
  return Response.json({
    server: server ? view(server) : null,
    created: result.created,
    requarantined: result.requarantined,
  });
}
