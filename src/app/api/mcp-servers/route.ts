// Admin CRUD for external MCP servers (cnp-02), behind settings.manage. The
// secret never leaves this process: every response goes through view(), which
// redacts it to `secretSet: true`, the same shape the custom-tool and webhook
// APIs already use.

import { McpServerView, view, validHeaderObject, MAX_HEADERS, isHttpUrl, createSchema } from "@/lib/mcp-server-view";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { forbid } from "@/lib/permissions";
import {
  MCP_SLUG_RE,
  MCP_TRANSPORTS,
  parseToolsJson,
  type McpToolSnapshot,
} from "@/lib/mcp-client";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  const denied = forbid(user, "settings.manage");
  if (denied) return denied;

  const servers = await db.mcpServer.findMany({ orderBy: { createdAt: "asc" } });
  return Response.json({ servers: servers.map(view) });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  const denied = forbid(user, "settings.manage");
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request body" },
      { status: 400 },
    );
  }
  const data = parsed.data;

  const existing = await db.mcpServer.findUnique({ where: { slug: data.slug } });
  if (existing) {
    return Response.json(
      { error: `An MCP server with the slug "${data.slug}" already exists.` },
      { status: 409 },
    );
  }

  // enabled is NOT settable at creation: a server arrives off, and turning it
  // on is a separate, deliberate PATCH.
  const server = await db.mcpServer.create({
    data: {
      slug: data.slug,
      name: data.name,
      transport: data.transport,
      url: data.url,
      headers: data.headers,
      secret: data.secret,
    },
  });
  return Response.json({ server: view(server) }, { status: 201 });
}
