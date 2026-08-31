// The MCP-servers route's view/validation helpers (cnp-02): extracted so
// the ROUTE file exports only handlers and config — the Next.js build's
// route-type check rejects any other runtime export (the failure two
// branches of this fix have now caught twice).

import { z } from "zod";
import { McpToolSnapshot, parseToolsJson, MCP_SLUG_RE, MCP_TRANSPORTS } from "@/lib/mcp-client";

export interface McpServerView {
  id: string;
  slug: string;
  name: string;
  transport: string;
  url: string;
  headers: string;
  enabled: boolean;
  secretSet: boolean;
  lastSyncAt: Date | null;
  tools: McpToolSnapshot[];
}

/** The wire shape. `secret` is destructured out and never spread back. */
export function view(server: {
  id: string;
  slug: string;
  name: string;
  transport: string;
  url: string;
  headers: string;
  secret: string;
  enabled: boolean;
  toolsJson: string;
  lastSyncAt: Date | null;
}): McpServerView {
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
    tools: parseToolsJson(server.toolsJson),
  };
}

/** A JSON object whose every value is a string — anything else would be
 *  String()-coerced onto the wire as "[object Object]" or "42", which is a
 *  silently wrong header rather than a rejected one. */
export function validHeaderObject(text: string): boolean {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return false;
    return Object.values(parsed as Record<string, unknown>).every(
      (v) => typeof v === "string",
    );
  } catch {
    return false;
  }
}

/** Every sibling field is bounded; this one is too. */
export const MAX_HEADERS = 4000;

/** zod's .url() only proves URL-parseability — `javascript:` and `file:`
 *  parse. The transport speaks http(s) and nothing else, so say so here
 *  rather than only at sync time. */
export function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export const createSchema = z.object({
  slug: z
    .string()
    .regex(
      MCP_SLUG_RE,
      "Slug must start with a letter and use 2-31 characters of a-z, 0-9 or - (it becomes the mcp__<slug>__ tool prefix)",
    ),
  name: z.string().trim().min(1, "Name is required").max(120),
  transport: z.enum(MCP_TRANSPORTS).default("http"),
  url: z.string().max(1000).refine(isHttpUrl, "A valid http(s) URL is required"),
  headers: z
    .string()
    .max(MAX_HEADERS, `Headers must be at most ${MAX_HEADERS} characters`)
    .refine(validHeaderObject, "Headers must be a JSON object of string values")
    .default("{}"),
  secret: z.string().max(500).default(""),
});

