// External MCP server connections (cnp-02). Admin-only, behind
// settings.manage like every other integration surface. The secret is never
// returned — the payload carries `secretSet` and nothing else about it.

import type { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { forbid } from "@/lib/permissions";
import {
  MCP_SLUG_PATTERN,
  MCP_TRANSPORTS,
  mcpToolName,
  parseSnapshot,
} from "@/lib/mcp-client";
import type { McpServer } from "@prisma/client";

export const dynamic = "force-dynamic";

export interface McpServerPayload {
  id: string;
  slug: string;
  name: string;
  transport: string;
  url: string;
  headers: string;
  enabled: boolean;
  secretSet: boolean;
  lastSyncAt: Date | null;
  tools: { name: string; policyName: string; description: string }[];
}

/** Server payload with the secret redacted to a boolean. */
export function view(server: McpServer): McpServerPayload {
  return {
    id: server.id,
    slug: server.slug,
    name: server.name,
    transport: server.transport,
    url: server.url,
    headers: server.headers,
    enabled: server.enabled,
    secretSet: server.secret.length > 0,
    lastSyncAt: server.lastSyncAt,
    tools: parseSnapshot(server.toolsJson).map((tool) => ({
      name: tool.name,
      policyName: mcpToolName(server.slug, tool.name),
      description: tool.description,
    })),
  };
}

function validJsonObject(text: string): boolean {
  try {
    const parsed = JSON.parse(text) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed);
  } catch {
    return false;
  }
}

/** http/https only, and never a URL carrying credentials — the egress guard
 *  refuses both at request time; refusing at create time says so earlier. */
function validHttpUrl(text: string): boolean {
  try {
    const url = new URL(text);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    return !url.username && !url.password;
  } catch {
    return false;
  }
}

export async function GET() {
  const user = await getCurrentUser();
  const denied = forbid(user, "settings.manage");
  if (denied) return denied;

  const servers = await db.mcpServer.findMany({ orderBy: { createdAt: "asc" } });
  const policies = await db.toolPolicy.findMany({
    where: {
      toolName: {
        in: servers.flatMap((s) =>
          parseSnapshot(s.toolsJson).map((t) => mcpToolName(s.slug, t.name)),
        ),
      },
    },
  });
  return Response.json({ servers: servers.map(view), policies });
}

const createSchema = z.object({
  slug: z
    .string()
    .regex(
      MCP_SLUG_PATTERN,
      "Slug must be lowercase letters, digits and hyphens, starting with a letter (2-31 chars)",
    ),
  name: z.string().trim().min(1, "Name is required").max(120),
  transport: z.enum(MCP_TRANSPORTS).default("http"),
  url: z.string().trim().min(1, "URL is required").max(1000).refine(validHttpUrl, "URL must be an http(s) URL without embedded credentials"),
  headers: z.string().refine(validJsonObject, "Headers must be a JSON object").default("{}"),
  secret: z.string().max(500).default(""),
});

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  const denied = forbid(user, "settings.manage");
  if (denied) return denied;

  const body = (await req.json().catch(() => null)) as unknown;
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

  // enabled is deliberately absent from the create schema: a connection is
  // born dark, and so is every tool policy its first sync mints.
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
