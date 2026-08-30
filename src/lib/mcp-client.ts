// Servo as an MCP *client* (spec item cnp-02). External MCP servers are
// registered as `McpServer` rows; their tools become quarantined `ToolPolicy`
// rows named `mcp__<slug>__<tool>`. This file lists and syncs; it does not
// register executable tools — that is cnp-03.
//
// ADOPT-FIRST (§0.4, verified verdict): built on `@modelcontextprotocol/sdk`
// (MIT, (c) 2024 Anthropic PBC — read from node_modules/@modelcontextprotocol/
// sdk/LICENSE, recorded in THIRD_PARTY.md). No hand-rolled JSON-RPC, no
// hand-rolled SSE parsing: the SDK owns the wire, this file owns the policy.
//
// v1 scope, deliberately small (docs/design/connectors.md §6.3): Streamable
// HTTP only, tools only, static header auth only. stdio and OAuth 2.1 are
// Roadmap — `transport` is a String so adding one later is data, not a
// migration.
//
// Three rails this file exists to keep:
//   1. EGRESS — every byte leaves through `safeFetch`/`checkEgress`
//      (src/lib/egress.ts). The SDK transport takes a `fetch` implementation,
//      so the guard sits under the SDK rather than beside it. A loopback or
//      private-range MCP server needs the deliberate literal allowlist entry,
//      exactly like a custom HTTP tool.
//   2. QUARANTINE (§0.8 rail 4) — every synced tool row is created with
//      enabled:false / requiresApproval:true / riskLevel:"HIGH". A risk level
//      declared in an MCP annotation is snapshotted for the audit trail and
//      IGNORED for policy. There is no max(declared, MEDIUM) floor.
//   3. TIGHTEN-ONLY — the sync is create-only over admin-edited rows, with one
//      sanctioned exception that can only ever disable: a previously-enabled
//      tool whose snapshot hash changed is re-quarantined.
//
// The secret is opened here and nowhere else: `McpServer.secret` is sealed by
// the `$extends` write hook in src/lib/db.ts, and nested `include` reads
// bypass that extension, so the open happens at this single use site.

import { createHash } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { McpServer } from "@prisma/client";
import { db } from "@/lib/db";
import { EgressBlockedError, getEgressConfig, safeFetch } from "@/lib/egress";
import { open } from "@/lib/secret-store";

/** The reserved tool-name namespace. `src/app/api/tools/route.ts` refuses a
 *  custom tool starting with this so the two sources can never collide. */
export const MCP_TOOL_PREFIX = "mcp__";

/** Slug grammar, per the item: a letter, then 1–30 of [a-z0-9-]. */
export const MCP_SLUG_RE = /^[a-z][a-z0-9-]{1,30}$/;

/** The only transport v1 speaks. "stdio" is reserved and refused here. */
export const MCP_TRANSPORTS = ["http"] as const;

const LIST_TIMEOUT_MS = 10_000;
/** One tools/call round trip (cnp-03), inside the engine's tool budget. */
const CALL_TIMEOUT_MS = 20_000;

/** A tool name longer than this cannot be a `ToolPolicy` primary key: the
 *  column is the table's `@id`, and Postgres refuses a btree index entry over
 *  ~2704 bytes. A hostile server advertising a 3 kB name would otherwise turn
 *  a sync into an uncaught driver error. */
const MAX_TOOL_NAME = 200;

/**
 * Never let an opened secret reach a caller. Error text from `fetch`, from
 * `undici`'s header validation, or from the SDK can quote the request headers
 * verbatim — `Headers.append: "Bearer <token>" is an invalid header value` is
 * a real message — and this function is the last thing every failure path
 * goes through before the value becomes an API response and then UI copy.
 */
export function scrubSecret(message: string, secret: string): string {
  if (secret === "") return message;
  return message.split(secret).join("[redacted]");
}

/**
 * The §0.8 rail-4 triple, stated here rather than imported from
 * `scripts/policy-guard.mjs` so nothing in the runtime bundle depends on a
 * lint script. `tests/mcp-server-sync.test.ts` asserts this object is
 * deep-equal to that script's `QUARANTINE_TRIPLE`, so drift is a red test
 * rather than a silent divergence.
 */
export const MCP_QUARANTINE = Object.freeze({
  enabled: false,
  requiresApproval: true,
  riskLevel: "HIGH",
});

/** One entry of the `toolsJson` snapshot. */
export interface McpToolSnapshot {
  name: string;
  description: string;
  inputSchema: string;
  /** sha256(name + description + inputSchema) — drives the re-quarantine. */
  hash: string;
  /**
   * A vendor-declared risk level, read from the tool's MCP `_meta` bag (the
   * only passthrough the protocol has — `annotations` is a closed set the SDK
   * strips unknown keys from). RECORDED for the audit trail and never read
   * when a policy row is written. There is no max(declared, MEDIUM) floor.
   */
  declaredRiskLevel: string | null;
  /**
   * The standard MCP annotations verbatim (`readOnlyHint`, `destructiveHint`,
   * …), as JSON. Also recorded and also ignored: a server calling its own
   * tool read-only changes nothing about the quarantine.
   */
  declaredHints: string;
}

/** `mcp__<slug>__<tool>` — the Claude Code convention, so an agent-profile
 *  `tools:` allowlist in `agents/*.md` names them identically. */
export function mcpToolName(slug: string, tool: string): string {
  return `${MCP_TOOL_PREFIX}${slug}__${tool}`;
}

export function toolHash(name: string, description: string, inputSchema: string): string {
  return createHash("sha256").update(`${name}${description}${inputSchema}`).digest("hex");
}

/** Parse a stored snapshot defensively — a hand-edited row must not throw. */
export function parseToolsJson(raw: string): McpToolSnapshot[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: McpToolSnapshot[] = [];
  for (const entry of parsed) {
    if (typeof entry !== "object" || entry === null) continue;
    const row = entry as Record<string, unknown>;
    if (typeof row.name !== "string" || row.name === "") continue;
    out.push({
      name: row.name,
      description: typeof row.description === "string" ? row.description : "",
      inputSchema: typeof row.inputSchema === "string" ? row.inputSchema : "{}",
      hash: typeof row.hash === "string" ? row.hash : "",
      declaredRiskLevel:
        typeof row.declaredRiskLevel === "string" ? row.declaredRiskLevel : null,
      declaredHints: typeof row.declaredHints === "string" ? row.declaredHints : "{}",
    });
  }
  return out;
}

/** Replace `{secret}` in a header value. The only templating v1 supports —
 *  there is no `{input.…}` here, because a sync carries no model input. */
function fillHeaders(raw: string, secret: string): Record<string, string> {
  let parsed: Record<string, unknown>;
  try {
    const value = JSON.parse(raw) as unknown;
    if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
    parsed = value as Record<string, unknown>;
  } catch {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    // Strings only. A coerced object or number would go on the wire as
    // "[object Object]" or "42" — a silently wrong header rather than a
    // rejected one. The API schemas refuse non-strings; this is the backstop
    // for a row written any other way.
    if (typeof value !== "string") continue;
    out[key] = value.replace(/\{secret\}/g, secret);
  }
  return out;
}

/**
 * Every request the SDK makes, through the egress guard. `safeFetch` throws
 * `EgressBlockedError` for a refused destination; the SDK surfaces it as a
 * transport error and `syncMcpServerTools` turns it back into a readable
 * message. No raw `fetch` call site is introduced anywhere in this file.
 */
async function egressFetch(url: string | URL, init?: RequestInit): Promise<Response> {
  return safeFetch(String(url), init ?? {}, await getEgressConfig());
}

/**
 * `tools/list` over the SDK. Exported for the tests; `syncMcpServerTools` is
 * the path production uses.
 */
/**
 * Call ONE tool on a server (cnp-03). The same transport, egress and
 * header rules as listRemoteTools — one client, one session, closed in a
 * finally. The result content is rendered to a string: text blocks join
 * with newlines, anything else serializes once. Errors are the CALLER's
 * to translate: this throws, the derived tool's execute() returns
 * "Error: ..." instead.
 */
export async function callRemoteTool(
  server: Pick<McpServer, "slug" | "transport" | "url" | "headers" | "secret">,
  toolName: string,
  args: Record<string, unknown>,
): Promise<string> {
  if (!(MCP_TRANSPORTS as readonly string[]).includes(server.transport)) {
    throw new Error(`Transport "${server.transport}" is not supported. Servo speaks Streamable HTTP in v1.`);
  }
  const secret = open(server.secret);
  const headers = fillHeaders(server.headers, secret);
  const client = new Client({ name: "servo", version: "1.0.0" }, { capabilities: {} });
  const transport = new StreamableHTTPClientTransport(new URL(server.url), {
    fetch: egressFetch,
    requestInit: { headers },
  });
  try {
    await client.connect(transport, { timeout: CALL_TIMEOUT_MS });
    const result = await client.callTool({ name: toolName, arguments: args }, undefined, { timeout: CALL_TIMEOUT_MS });
    const content = (result as { content?: Array<{ type: string; text?: string }> }).content ?? [];
    const text = content
      .map((block) => (block.type === "text" && typeof block.text === "string" ? block.text : null))
      .filter((t): t is string => t !== null);
    if (text.length > 0) return text.join("\n");
    return JSON.stringify(result);
  } finally {
    await client.close().catch(() => undefined);
  }
}

export async function listRemoteTools(
  server: Pick<McpServer, "slug" | "name" | "transport" | "url" | "headers" | "secret">,
): Promise<McpToolSnapshot[]> {
  if (!(MCP_TRANSPORTS as readonly string[]).includes(server.transport)) {
    throw new Error(
      `Transport "${server.transport}" is not supported. Servo speaks Streamable HTTP in v1.`,
    );
  }
  // Sealed at rest by the src/lib/db.ts write hook; opened here, at the one
  // place the value is actually put on the wire.
  const secret = open(server.secret);
  const headers = fillHeaders(server.headers, secret);

  const client = new Client({ name: "servo", version: "1.0.0" }, { capabilities: {} });
  const transport = new StreamableHTTPClientTransport(new URL(server.url), {
    fetch: egressFetch,
    requestInit: { headers },
  });
  try {
    await client.connect(transport, { timeout: LIST_TIMEOUT_MS });
    const listed = await client.listTools(undefined, { timeout: LIST_TIMEOUT_MS });
    const out: McpToolSnapshot[] = [];
    // A remote server's tool list is untrusted input. Two shapes are dropped
    // here rather than carried into the policy table: a name that is empty or
    // over-long (it would mint a row the admin UI cannot show, or one Postgres
    // cannot index), and a repeat of a name already taken — first definition
    // wins, so the row that gets written and the snapshot that gets compared
    // against it on the next sync are the SAME definition.
    const seen = new Set<string>();
    for (const tool of listed.tools) {
      if (tool.name === "" || tool.name.length > MAX_TOOL_NAME) continue;
      if (seen.has(tool.name)) continue;
      seen.add(tool.name);
      const description = tool.description ?? "";
      const inputSchema = JSON.stringify(tool.inputSchema ?? {});
      const declared = tool._meta?.riskLevel;
      out.push({
        name: tool.name,
        description,
        inputSchema,
        hash: toolHash(tool.name, description, inputSchema),
        // Both of the following are recorded and never applied — the audit
        // trail of what the server claimed, kept beside the policy that
        // ignored it. Nothing downstream of here reads either field.
        declaredRiskLevel: typeof declared === "string" ? declared : null,
        declaredHints: JSON.stringify(tool.annotations ?? {}),
      });
    }
    return out;
  } finally {
    // Best-effort: a server that died mid-list must not turn into an
    // unhandled rejection on the way out.
    await client.close().catch(() => undefined);
  }
}

export interface SyncResult {
  ok: boolean;
  /** Tools the server reported, in the order it reported them. */
  tools: McpToolSnapshot[];
  /** Policy rows created by this sync, quarantined. */
  created: string[];
  /** Previously-enabled rows re-quarantined because their hash changed. */
  requarantined: string[];
  /** Present when ok is false; a readable message, never a stack. */
  error?: string;
}

/**
 * List a server's tools, snapshot them, and mint the missing policy rows.
 *
 * Create-only over admin-edited rows: an existing `ToolPolicy` is never
 * updated except by the one tighten-only exception below. Policies for tools
 * that vanish from a server are LEFT IN PLACE — they are invisible without a
 * registry entry — and never auto-deleted, so a server that briefly reports
 * an empty tool list cannot silently drop an admin's configuration.
 */
export async function syncMcpServerTools(serverId: string): Promise<SyncResult> {
  const server = await db.mcpServer.findUnique({ where: { id: serverId } });
  if (!server) {
    return { ok: false, tools: [], created: [], requarantined: [], error: "No such MCP server." };
  }

  // Opened once here only so failures can be scrubbed of it — the value that
  // actually goes on the wire is opened inside listRemoteTools.
  let secret = "";
  try {
    secret = open(server.secret);
  } catch {
    // A sealed value with no key: secret-store throws on purpose. Nothing to
    // scrub, and listRemoteTools will surface the same failure below.
  }

  let tools: McpToolSnapshot[];
  try {
    tools = await listRemoteTools(server);
  } catch (err) {
    const message =
      err instanceof EgressBlockedError
        ? err.message
        : err instanceof Error
          ? err.message
          : String(err);
    // The snapshot and every policy row are left exactly as they were: a
    // failed sync must not look like a server that reports no tools.
    return {
      ok: false,
      tools: [],
      created: [],
      requarantined: [],
      error: scrubSecret(message, secret),
    };
  }

  const previous = new Map(parseToolsJson(server.toolsJson).map((t) => [t.name, t]));
  const policyNames = tools.map((t) => mcpToolName(server.slug, t.name));
  const existing = await db.toolPolicy.findMany({
    where: { toolName: { in: policyNames } },
    select: { toolName: true, enabled: true },
  });
  const existingByName = new Map(existing.map((p) => [p.toolName, p]));

  const created: string[] = [];
  const requarantined: string[] = [];

  for (const tool of tools) {
    const toolName = mcpToolName(server.slug, tool.name);
    const row = existingByName.get(toolName);
    if (!row) {
      created.push(toolName);
      continue;
    }
    // The ONE sanctioned tightening: a tool an admin had enabled is not the
    // same tool any more. Re-quarantine. This branch can only ever disable —
    // it never touches a row that is already disabled, and it never lowers
    // riskLevel or clears requiresApproval.
    //
    // It reads an ABSENT previous hash as a CHANGED one, because "unchanged"
    // is not something a missing record can establish. Three reachable ways
    // an enabled policy row outlives the snapshot that remembers what it was
    // enabled FOR, each of which a truthiness guard on `before` would wave
    // through: the server omits the tool for one sync (the row is kept on
    // purpose, but the snapshot below is rewritten unconditionally) and then
    // re-advertises it redefined; the server is deleted and re-added under
    // the same slug, whose fresh row starts at "[]" over the surviving
    // policies; or `toolsJson` is unparseable and parseToolsJson defensively
    // returns []. Fail-closed is the only reading that keeps create-only
    // safe, and it still only ever disables.
    const before = previous.get(tool.name);
    if (row.enabled && (before === undefined || before.hash !== tool.hash)) {
      requarantined.push(toolName);
    }
  }

  // The whole write is one transaction AND one try: a row deleted by a
  // concurrent sync between the read above and the update below is an
  // expected race, and it must surface as this function's documented
  // {ok:false} result rather than as a 500 with a Prisma stack in it.
  try {
    await db.$transaction([
      ...(created.length > 0
        ? [
            db.toolPolicy.createMany({
              data: created.map((toolName) => {
                const tool = tools.find(
                  (t) => mcpToolName(server.slug, t.name) === toolName,
                );
                return {
                  toolName,
                  description: tool?.description ?? "",
                  // The triple, verbatim. `declaredRiskLevel` is deliberately
                  // NOT spread in: it lives in the snapshot, not in policy.
                  ...MCP_QUARANTINE,
                };
              }),
              skipDuplicates: true,
            }),
          ]
        : []),
      ...requarantined.map((toolName) =>
        db.toolPolicy.update({
          where: { toolName },
          // Only the three quarantine fields, only ever in the tightening
          // direction. The description is left alone: it is admin-visible copy.
          data: { ...MCP_QUARANTINE },
        }),
      ),
      db.mcpServer.update({
        where: { id: serverId },
        data: { toolsJson: JSON.stringify(tools), lastSyncAt: new Date() },
      }),
    ]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Nothing was written — the transaction rolled back — so this reports the
    // same "previous state untouched" shape a refused destination does.
    return {
      ok: false,
      tools: [],
      created: [],
      requarantined: [],
      error: scrubSecret(message, secret),
    };
  }

  return { ok: true, tools, created, requarantined };
}
