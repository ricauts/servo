// One external MCP server: edit, delete, and the tools/list sync.
//
// Deleting a connection deletes the McpServer row only. Its ToolPolicy rows
// are left in place on purpose (cnp-02): the sync never auto-deletes a
// policy, so a re-added server cannot silently inherit a fresh row while an
// admin's earlier decision about the same tool name is thrown away.

import type { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { forbid } from "@/lib/permissions";
import { syncMcpServerTools } from "@/lib/mcp-client";
import { view } from "../route";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

function validJsonObject(text: string): boolean {
  try {
    const parsed = JSON.parse(text) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed);
  } catch {
    return false;
  }
}

function validHttpUrl(text: string): boolean {
  try {
    const url = new URL(text);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    return !url.username && !url.password;
  } catch {
    return false;
  }
}

// The slug is immutable: it is baked into every mcp__<slug>__<tool> policy
// row already minted, and renaming it would orphan an admin's decisions.
const patchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  url: z.string().trim().min(1).max(1000).refine(validHttpUrl, "URL must be an http(s) URL without embedded credentials").optional(),
  headers: z.string().refine(validJsonObject, "Headers must be a JSON object").optional(),
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

  const body = (await req.json().catch(() => null)) as unknown;
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request body" },
      { status: 400 },
    );
  }
  const data = parsed.data;

  // Re-pointing a connection makes every earlier review meaningless: the
  // admin approved a tool ON A SERVER, and this is a different server wearing
  // the same slug. Dropping the snapshot is how that is said in data — the
  // next sync then has no baseline for those tools and re-quarantines any
  // that are still loose (see syncMcpServerTools). It can only ever tighten,
  // so it is not a policy write the admin has to approve.
  //
  // "Which server" is not the URL alone. buildHeaders() substitutes the
  // stored secret into the headers, and on a multi-tenant or header-routed
  // endpoint those values are what select the tenant, the identity and often
  // the backend behind an unchanged URL — swapping a sandbox key for a
  // production one is a full server swap wearing the same address. All three
  // therefore invalidate the snapshot.
  const identityChanged =
    (data.url !== undefined && data.url !== existing.url) ||
    (data.headers !== undefined && data.headers !== existing.headers) ||
    data.secret !== undefined;

  const server = await db.mcpServer.update({
    where: { id },
    data: {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.url !== undefined ? { url: data.url } : {}),
      ...(data.headers !== undefined ? { headers: data.headers } : {}),
      ...(data.secret !== undefined ? { secret: data.secret } : {}),
      ...(data.enabled !== undefined ? { enabled: data.enabled } : {}),
      ...(identityChanged ? { toolsJson: "[]", lastSyncAt: null } : {}),
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

/** POST /api/mcp-servers/[id]?action=sync — one tools/list pass, matching the
 *  query-action shape the webhooks route already uses. */
export async function POST(req: NextRequest, { params }: Params) {
  const user = await getCurrentUser();
  const denied = forbid(user, "settings.manage");
  if (denied) return denied;

  const { id } = await params;
  // Read from req.url rather than NextRequest.nextUrl: the two agree, and
  // req.url is present on a plain Request, which is what a test hands in.
  if (new URL(req.url).searchParams.get("action") !== "sync") {
    return Response.json({ error: "Unknown action" }, { status: 400 });
  }
  const existing = await db.mcpServer.findUnique({ where: { id } });
  if (!existing) return Response.json({ error: "MCP server not found" }, { status: 404 });

  const result = await syncMcpServerTools(id);
  if (!result.ok) {
    // A refused host or an unreachable server is a readable result, not a
    // 500: the admin needs the reason next to the connection.
    return Response.json({ error: result.error ?? "Sync failed." }, { status: 502 });
  }
  const server = await db.mcpServer.findUnique({ where: { id } });
  return Response.json({
    sync: { seen: result.seen, created: result.created, requarantined: result.requarantined },
    server: server ? view(server) : null,
  });
}
