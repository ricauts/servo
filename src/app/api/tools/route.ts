import type { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { forbid } from "@/lib/permissions";
import { HTTP_METHODS } from "@/lib/ai/custom-tools";
import { MCP_TOOL_PREFIX } from "@/lib/mcp-client";
import { TOOLS } from "@/lib/ai/tools";

export const dynamic = "force-dynamic";

/** Custom tool payload with the secret redacted to a boolean. */
function view(tool: {
  id: string;
  name: string;
  description: string;
  inputSchema: string;
  method: string;
  url: string;
  headers: string;
  bodyTemplate: string;
  secret: string;
}) {
  const { secret, ...rest } = tool;
  return { ...rest, secretSet: secret.length > 0 };
}

export async function GET() {
  const user = await getCurrentUser();
  const denied = forbid(user, "settings.manage");
  if (denied) return denied;

  const tools = await db.customTool.findMany({ orderBy: { createdAt: "asc" } });
  const policies = await db.toolPolicy.findMany({
    where: { toolName: { in: tools.map((t) => t.name) } },
  });
  const policyByName = new Map(policies.map((p) => [p.toolName, p]));
  return Response.json({
    tools: tools.map((t) => ({
      ...view(t),
      policy: policyByName.get(t.name) ?? null,
    })),
  });
}

function validJsonObject(text: string): boolean {
  try {
    const parsed = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed);
  } catch {
    return false;
  }
}

const createSchema = z.object({
  name: z
    .string()
    .regex(
      /^[a-z][a-z0-9_]{2,49}$/,
      "Tool name must be snake_case (a-z, 0-9, _), 3-50 chars",
    ),
  description: z.string().trim().min(1, "Description is required").max(300),
  inputSchema: z.string().refine(validJsonObject, "Input schema must be a JSON object"),
  method: z.enum(HTTP_METHODS),
  url: z.string().trim().min(1, "URL is required").max(1000),
  headers: z.string().refine(validJsonObject, "Headers must be a JSON object"),
  bodyTemplate: z.string().max(4000).default(""),
  secret: z.string().max(500).default(""),
  riskLevel: z.enum(["LOW", "MEDIUM", "HIGH"]),
  requiresApproval: z.boolean(),
});

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

  // Namespace reservation (cnp-02): `mcp__<slug>__<tool>` belongs to the MCP
  // client's sync. A custom tool squatting there would collide with a policy
  // row an admin believes describes a connector tool.
  if (data.name.startsWith(MCP_TOOL_PREFIX)) {
    return Response.json(
      {
        error: `Tool names starting with "${MCP_TOOL_PREFIX}" are reserved for tools synced from MCP servers. Choose another name.`,
      },
      { status: 400 },
    );
  }
  if (TOOLS[data.name]) {
    return Response.json(
      { error: `"${data.name}" is a built-in tool name.` },
      { status: 409 },
    );
  }
  const existing = await db.customTool.findUnique({ where: { name: data.name } });
  if (existing) {
    return Response.json(
      { error: `A custom tool named "${data.name}" already exists.` },
      { status: 409 },
    );
  }

  const [tool] = await db.$transaction([
    db.customTool.create({
      data: {
        name: data.name,
        description: data.description,
        inputSchema: data.inputSchema,
        method: data.method,
        url: data.url,
        headers: data.headers,
        bodyTemplate: data.bodyTemplate,
        secret: data.secret,
      },
    }),
    db.toolPolicy.upsert({
      where: { toolName: data.name },
      create: {
        toolName: data.name,
        description: data.description,
        riskLevel: data.riskLevel,
        enabled: true,
        requiresApproval: data.requiresApproval,
      },
      update: {
        description: data.description,
        riskLevel: data.riskLevel,
        requiresApproval: data.requiresApproval,
      },
    }),
  ]);

  return Response.json({ tool: view(tool) }, { status: 201 });
}
