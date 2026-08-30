// Servo as an MCP CLIENT (spec cnp-02): connects to external MCP servers,
// lists what they offer, and mints one quarantined ToolPolicy row per remote
// tool. This file lists and snapshots; cnp-03 turns the snapshot into
// executable ToolDefs.
//
// ADOPT-FIRST (§0.4, verified verdict): the protocol client is
// @modelcontextprotocol/sdk (MIT — verified from
// node_modules/@modelcontextprotocol/sdk/LICENSE, "Copyright (c) 2024
// Anthropic, PBC", recorded in THIRD_PARTY.md). No JSON-RPC framing and no
// SSE parsing is written here; the SDK owns the wire.
//
// Three pre-existing contracts bind every line below:
//
//  1. EGRESS. The SDK is handed `fetch: safeFetch(...)`, so the initialize
//     POST, the standalone GET stream and every tools/list POST are checked
//     by src/lib/egress.ts — including each redirect hop. There is no raw
//     fetch() in this file. Reaching a private-network MCP server therefore
//     needs the deliberate literal allowlist entry, exactly like a custom
//     HTTP tool.
//  2. SECRETS. McpServer.secret is sealed at the write boundary (the
//     $extends hook in src/lib/db.ts) and opened HERE, once, at header
//     substitution time — the single use site, because nested `include`
//     reads bypass the extension.
//  3. QUARANTINE (§0.8 rail 4). Every remote tool's policy row is born
//     { enabled: false, requiresApproval: true, riskLevel: "HIGH" }. A risk
//     level a manifest declares is snapshotted for the audit trail and
//     IGNORED for policy — there is no floor, no downgrade, no exception.
//     Sync may tighten a row and may never loosen one.

import { createHash } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { McpServer } from "@prisma/client";
import { db } from "@/lib/db";
import { EgressBlockedError, getEgressConfig, safeFetch } from "@/lib/egress";
import { open } from "@/lib/secret-store";

/** The reserved namespace: every tool derived from an MCP server starts here. */
export const MCP_TOOL_PREFIX = "mcp__";

/** Slugs become the `mcp__<slug>__` prefix, so they are tightly shaped. */
export const MCP_SLUG_PATTERN = /^[a-z][a-z0-9-]{1,30}$/;

/** Streamable HTTP only in v1. stdio is Roadmap: spawning subprocesses breaks
 *  the single-process assumption behind the engine's activeResolverTickets. */
export const MCP_TRANSPORTS = ["http"] as const;

/** Long enough for a cold remote server, short enough that a stuck sync
 *  fails rather than pins a request handler. */
const SYNC_TIMEOUT_MS = 15_000;

// Caps on what a remote server may put into Servo's own tables. A tools/list
// response is attacker-shaped data: the server chooses the count, the names,
// the descriptions and the schemas, and every one of them lands in a
// ToolPolicy row (whose PRIMARY KEY is the name) or in McpServer.toolsJson,
// permanently — the reconcile below never deletes a policy. Unbounded, one
// sync of a hostile or merely buggy server is a permanent pollution of the
// tool registry and of every admin page that renders it.
//
// What these caps do NOT bound: the SDK buffers the whole JSON-RPC response
// in memory before listTools() resolves, so a multi-gigabyte body is still a
// memory spike. Bounding THAT means a streaming byte counter inside
// src/lib/egress.ts, which is a permanent Tier-C surface this item does not
// name — it is filed as owner questions 51 and 52 rather than changed here.

/** Tools accepted from one server in one sync. */
const TOOL_LIMIT = 200;

/** A remote tool's description is snapshotted, not shown to a model here;
 *  the cap keeps one chatty server from bloating every toolsJson read. */
const DESCRIPTION_LIMIT = 1000;

/** The serialised input schema stored per tool. */
const SCHEMA_LIMIT = 20_000;

/** Remote tool names become a ToolPolicy PRIMARY KEY, so they are shaped, not
 *  merely trimmed. A name outside this is SKIPPED rather than mangled:
 *  mangling two different names into one is how a collision is minted. */
const REMOTE_TOOL_NAME_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/;

/**
 * The quarantine triple, §0.8 rail 4 — the ONLY policy shape this file may
 * write. Frozen because a mutation here is a silent approval bypass;
 * tests/tool-policy-invariant.test.ts pins it to policy-guard.mjs's
 * QUARANTINE_TRIPLE so the two cannot drift apart.
 */
export const MCP_QUARANTINE = Object.freeze({
  enabled: false,
  requiresApproval: true,
  riskLevel: "HIGH",
} as const);

/** One tool as last seen on a remote server. `declaredRiskLevel` is recorded
 *  for the audit trail and never consulted when a policy row is written. */
export interface McpToolSnapshot {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** sha256 of name + description + inputSchema — the drift signal. */
  hash: string;
  declaredRiskLevel: string | null;
}

/** The full tool name a remote tool takes inside Servo. */
export function mcpToolName(slug: string, toolName: string): string {
  return `${MCP_TOOL_PREFIX}${slug}__${toolName}`;
}

/** Whether a tool name belongs to the MCP namespace. */
export function isMcpToolName(name: string): boolean {
  return name.startsWith(MCP_TOOL_PREFIX);
}

/**
 * Object keys sorted recursively, so an input schema that only changed key
 * order does not read as drift and re-quarantine a tool an admin enabled.
 */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) out[key] = canonical(source[key]);
    return out;
  }
  return value;
}

/** The drift hash: sha256 over name, description and the canonical schema. */
export function toolHash(
  name: string,
  description: string,
  inputSchema: unknown,
): string {
  return createHash("sha256")
    .update(JSON.stringify([name, description, canonical(inputSchema)]))
    .digest("hex");
}

/** Parse a stored toolsJson snapshot defensively — a corrupt column is an
 *  empty snapshot, never a thrown sync. */
export function parseSnapshot(toolsJson: string): McpToolSnapshot[] {
  try {
    const parsed = JSON.parse(toolsJson) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (row): row is McpToolSnapshot =>
        !!row && typeof row === "object" && typeof (row as McpToolSnapshot).name === "string",
    );
  } catch {
    return [];
  }
}

/**
 * The request headers for a server: the admin's JSON object with `{secret}`
 * substituted. This is the ONLY place McpServer.secret is opened.
 */
export function buildHeaders(server: Pick<McpServer, "headers" | "secret">): Record<string, string> {
  const secret = open(server.secret);
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(server.headers) as Record<string, unknown>;
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    headers[key] = String(value ?? "").replace(/\{secret\}/g, secret);
  }
  return headers;
}

export type ListResult =
  | { ok: true; tools: McpToolSnapshot[] }
  | { ok: false; error: string };

/**
 * tools/list against a remote server, through the SDK, over the egress guard.
 * Never throws: a refused host, an unreachable server or a protocol error all
 * come back as a readable `error` the admin sees next to the connection.
 */
export async function listRemoteTools(
  server: McpServer,
  // A seam, not a setting: the default is the only value production uses, and
  // a test needs a short one to prove the timeout actually fires.
  opts: { timeoutMs?: number } = {},
): Promise<ListResult> {
  const timeout = opts.timeoutMs ?? SYNC_TIMEOUT_MS;
  if (!MCP_TRANSPORTS.includes(server.transport as (typeof MCP_TRANSPORTS)[number])) {
    return {
      ok: false,
      error: `Transport "${server.transport}" is not supported — Servo speaks Streamable HTTP in v1.`,
    };
  }
  let url: URL;
  try {
    url = new URL(server.url);
  } catch {
    return { ok: false, error: `"${server.url}" is not a valid URL.` };
  }

  // Inside the try from here on. getEgressConfig() reads the database and
  // buildHeaders() opens a sealed secret — with a rotated or missing
  // SERVO_ENCRYPTION_KEY, open() throws BY DESIGN, and a throw escaping this
  // function would break the "never throws" contract its callers rely on.
  let client: Client | null = null;
  let secret = "";
  try {
    const egress = await getEgressConfig();
    const headers = buildHeaders(server);
    secret = open(server.secret);
    client = new Client({ name: "servo", version: "1.0.0" }, { capabilities: {} });
    const transport = new StreamableHTTPClientTransport(url, {
      requestInit: { headers },
      // Every hop the SDK makes goes through the guard, redirects included.
      fetch: (target, init) => safeFetch(String(target), init ?? {}, egress),
    });

    // Both requests are bounded. The initialize handshake needs its own
    // timeout: a server that accepts the connection and then says nothing
    // would otherwise pin the admin's request until something else gave up.
    await client.connect(transport, { timeout });
    const listed = await client.listTools(undefined, { timeout });

    const tools: McpToolSnapshot[] = [];
    const seenNames = new Set<string>();
    for (const tool of listed.tools ?? []) {
      if (tools.length >= TOOL_LIMIT) break;
      const name = String(tool.name ?? "").trim();
      // Shape, not just non-empty: this becomes a primary key.
      if (!REMOTE_TOOL_NAME_PATTERN.test(name)) continue;
      // A server that lists the same tool twice would otherwise make the
      // createMany below raise a unique-constraint error and throw the sync.
      if (seenNames.has(name)) continue;
      seenNames.add(name);
      // Hashed BEFORE bounding, stored after — for BOTH the description and
      // the schema. Hashing what was stored would let a server pad past a cap
      // and then rewrite the tool's meaning beyond it forever without ever
      // reading as drift; with the schema that is worse than with the
      // description, because every oversized schema bounds to the SAME
      // placeholder and would therefore hash identically.
      const fullDescription = sanitiseDescription(String(tool.description ?? ""));
      const description = fullDescription.slice(0, DESCRIPTION_LIMIT);
      const fullSchema = (tool.inputSchema ?? {}) as Record<string, unknown>;
      const inputSchema = boundSchema(fullSchema);
      tools.push({
        name,
        description,
        inputSchema,
        hash: toolHash(name, fullDescription, fullSchema),
        // Recorded from the declaration, never applied. See MCP_QUARANTINE.
        declaredRiskLevel: readDeclaredRisk(tool),
      });
    }
    return { ok: true, tools };
  } catch (err) {
    const message =
      err instanceof EgressBlockedError
        ? err.message
        : err instanceof Error
          ? err.message
          : String(err);
    // The remote server controls this text and it is shown to an admin and
    // written to logs. A server that echoes the bearer token back inside an
    // error body must not get it rendered on the connection panel.
    return { ok: false, error: redactSecret(message, secret) };
  } finally {
    await client?.close().catch(() => undefined);
  }
}

/** Never let a remote server's own bytes carry the token back out. */
function redactSecret(text: string, secret: string): string {
  if (secret.length < 8) return text;
  return text.split(secret).join("[redacted]");
}

/**
 * A remote description is written verbatim into ToolPolicy.description, which
 * the engine interpolates into the resolver's SYSTEM PROMPT for every ENABLED
 * row (src/lib/ai/engine.ts, src/lib/ai/prompts.ts). Line structure is what
 * turns attacker text into something that reads as its own instruction block,
 * so it is flattened to exactly one line — the words survive, the shape does
 * not, and an admin can still read what was offered.
 *
 * The class is enumerated rather than left to `\s`, because the characters
 * that matter most here are the ones `\s` does NOT cover: NEL (U+0085), the
 * zero-width and bidi format characters (U+200B-U+200F, U+202A-U+202E), and
 * the BOM. LS/PS (U+2028/U+2029) are in `\s` but named anyway, so the intent
 * survives a future reader.
 */
function sanitiseDescription(text: string): string {
  return text
    .replace(
      // eslint-disable-next-line no-control-regex
      /[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u180e\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060-\u2064\u206a-\u206f\ufeff]/g,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
}

/** The schema as stored: dropped rather than truncated when oversized, since
 *  half a JSON Schema is not a JSON Schema. */
function boundSchema(schema: unknown): Record<string, unknown> {
  const value = (schema ?? {}) as Record<string, unknown>;
  let serialised: string;
  try {
    serialised = JSON.stringify(value) ?? "{}";
  } catch {
    return { type: "object", properties: {} };
  }
  if (serialised.length > SCHEMA_LIMIT) return { type: "object", properties: {} };
  return value;
}

/**
 * A server may declare a risk level for its own tool. It is snapshotted for
 * the audit trail and IGNORED when the policy row is written — see
 * MCP_QUARANTINE. Read from `_meta`, which is MCP's open extension record;
 * `annotations` is a closed schema (title and the four *Hint booleans) and
 * the SDK strips anything else out of it, so a declaration parked there
 * never reaches us in the first place.
 */
function readDeclaredRisk(tool: unknown): string | null {
  const meta = (tool as { _meta?: Record<string, unknown> } | null)?._meta;
  const declared = meta?.riskLevel ?? meta?.risk_level;
  return typeof declared === "string" ? declared : null;
}

export interface SyncResult {
  ok: boolean;
  /** Tools seen on the remote server this pass. */
  seen: number;
  /** Policy rows created, all carrying the quarantine triple. */
  created: string[];
  /** Previously-enabled tools whose hash drifted and were re-quarantined. */
  requarantined: string[];
  error?: string;
}

/**
 * List a server's tools and reconcile the policy rows.
 *
 * CREATE-ONLY for a row this server has already been synced against, with one
 * tighten-only exception in two shapes — both of which say the same thing:
 * **a policy row may only stay loose while Servo can show that a human
 * reviewed THIS tool, as it is now, on THIS server.**
 *
 *  1. DRIFT. The row is in this server's own prior snapshot but its hash
 *     changed. The contract moved under the admin who enabled it.
 *  2. ADOPTION. The row exists but is NOT in this server's prior snapshot, so
 *     there is no evidence any human reviewed it against this server at all.
 *     This is the state a deleted-and-recreated slug produces — DELETE drops
 *     the McpServer row and deliberately keeps the ToolPolicy rows, so
 *     without this case a brand-new connection at a brand-new URL would
 *     silently inherit an approval granted to the server it replaced. A
 *     changed `url` clears the snapshot for the same reason, so re-pointing a
 *     reviewed connection at another host lands here too.
 *
 * Both write the frozen triple, which is the tightest state a row can hold,
 * so neither can loosen anything. Nothing here deletes a policy: a tool that
 * vanishes from a server leaves its row in place, invisible without a
 * registry entry.
 */
export async function syncMcpServerTools(serverId: string): Promise<SyncResult> {
  const server = await db.mcpServer.findUnique({ where: { id: serverId } });
  if (!server) {
    return { ok: false, seen: 0, created: [], requarantined: [], error: "MCP server not found." };
  }

  const listed = await listRemoteTools(server);
  if (!listed.ok) {
    return { ok: false, seen: 0, created: [], requarantined: [], error: listed.error };
  }

  try {
    const previous = new Map(parseSnapshot(server.toolsJson).map((t) => [t.name, t.hash]));
    const policyNames = listed.tools.map((t) => mcpToolName(server.slug, t.name));
    const existing = await db.toolPolicy.findMany({ where: { toolName: { in: policyNames } } });
    const byName = new Map(existing.map((p) => [p.toolName, p]));

    const created: string[] = [];
    const requarantined: string[] = [];
    const redescribed: { toolName: string; description: string }[] = [];
    const missing: {
      toolName: string;
      description: string;
      enabled: boolean;
      requiresApproval: boolean;
      riskLevel: string;
    }[] = [];

    for (const tool of listed.tools) {
      const toolName = mcpToolName(server.slug, tool.name);
      const row = byName.get(toolName);
      if (!row) {
        missing.push({
          toolName,
          description: tool.description || `Tool "${tool.name}" from MCP server ${server.slug}.`,
          ...MCP_QUARANTINE,
        });
        created.push(toolName);
        continue;
      }
      const baseline = previous.get(tool.name);
      const unvouched = baseline === undefined; // adoption
      const drifted = baseline !== undefined && baseline !== tool.hash;
      // Only an already-tight row needs no policy write. Anything looser than
      // the triple, without a matching baseline, goes back into quarantine.
      const loose = row.enabled || !row.requiresApproval || row.riskLevel !== "HIGH";
      if (loose && (unvouched || drifted)) requarantined.push(toolName);
      // A row minted from one description must not still SHOW that
      // description once the server has changed it. The stored text is what
      // an admin reads in Settings → Tools before deciding, and the snapshot
      // baseline advances on every sync — so a description frozen at mint
      // time is a bait-and-switch that no later drift check can catch.
      // Refreshing text is not a policy loosening; it is what makes the
      // review honest.
      if ((drifted || unvouched) && row.description !== tool.description && tool.description) {
        redescribed.push({ toolName, description: tool.description });
      }
    }

    // skipDuplicates: a race with a concurrent sync (or a plugin install)
    // must not turn a reconcile into an unhandled unique-constraint throw.
    if (missing.length > 0) {
      await db.toolPolicy.createMany({ data: missing, skipDuplicates: true });
    }
    for (const toolName of requarantined) {
      await db.toolPolicy.update({ where: { toolName }, data: { ...MCP_QUARANTINE } });
    }
    for (const { toolName, description } of redescribed) {
      await db.toolPolicy.update({ where: { toolName }, data: { description } });
    }

    // CONDITIONAL, on the identity this sync actually talked to. Listing is a
    // network round trip of up to SYNC_TIMEOUT_MS, and an admin may re-point
    // the connection during it — a PATCH clears the snapshot precisely so the
    // next sync has no baseline, and an unconditional write here would
    // silently restore the old server's baseline over it and launder the
    // approval. Zero rows updated means the connection moved underneath us:
    // the tightening writes above stand (they only ever tighten), the
    // snapshot does not, and the next sync therefore sees adoption.
    const stamped = await db.mcpServer.updateMany({
      where: {
        id: server.id,
        url: server.url,
        headers: server.headers,
        secret: server.secret,
      },
      data: { toolsJson: JSON.stringify(listed.tools), lastSyncAt: new Date() },
    });
    if (stamped.count === 0) {
      return {
        ok: false,
        seen: listed.tools.length,
        created,
        requarantined,
        error:
          "The connection was changed while this sync was running, so nothing was recorded against it. Sync again.",
      };
    }

    return { ok: true, seen: listed.tools.length, created, requarantined };
  } catch (err) {
    // The reconcile is database work on rows other writers also touch. It
    // reports, like every other failure here; it never throws at the route.
    return {
      ok: false,
      seen: 0,
      created: [],
      requarantined: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
