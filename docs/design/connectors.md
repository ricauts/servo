<!-- Design rationale extracted from spec.md. spec.md remains the work order:
     the backlog, the tick protocol and the claims ledger live there. -->

# Connectors, skills and plugins

Servo's position in this area is one sentence: **adopt the standards that already won, and make every one of them terminate in the same tool-policy row.** MCP is the connector wire format in both directions; the Agent Skills open standard (agentskills.io) is the skill file format; Claude Code's `.claude-plugin/plugin.json` is the bundle manifest. Nothing here invents a parallel format, and nothing here creates a second execution path.

### 6.1 The safety invariant

Every tool, from every origin — built-in, admin-defined HTTP custom tool, external MCP server, plugin bundle, mined integration — exists for Servo only as a `ToolPolicy` row (`prisma/schema.prisma`, PK = `toolName`) and executes only through a path that enforces that row:

* the engine's per-call gate in `driveResolverLoop` (`src/lib/ai/engine.ts`), which creates an `Approval`, sets the run and ticket to `WAITING_APPROVAL`, and resumes from the persisted `AgentRun.conversation` via `Approval.toolUseId`; or
* `executeMcpToolCall()` (§6.2), which has no human attached and therefore refuses anything approval-gated outright.

**The quarantine rail (Ruling 6, the only rail).** Every tool from any non-core source is created with:

```
enabled: false     requiresApproval: true     riskLevel: "HIGH"
```

A risk level declared in an MCP annotation, a `plugin.json`, or an intake doc is **recorded and ignored** for policy purposes. There is no `max(declared, "MEDIUM")` floor anywhere in this spec. Only a human downgrade in `/settings` changes any of the three fields, and `ensureToolPolicies()` (`src/lib/ai/custom-tools.ts:109`) never overwrites an admin-edited row. `loop-06` makes this executable: a test walks every registered tool source and asserts the triple.

Two corollaries that bind every item in this section:

1. Sync code may **tighten** a policy and may never loosen one. The one sanctioned tightening is drift re-quarantine (§6.3).
2. Any diff that lowers a `riskLevel`, flips `requiresApproval` to `false`, or flips `enabled` to `true` on a default policy row is Tier C — an owner PR, in any file, including seeds and fixtures.

### 6.2 Servo as an MCP server, hardened (`p0-01`)

**What is already true, verified.** `getMcpTools()` (`src/lib/mcp.ts:104-121`) serves the registry minus `CORE_TOOLS` (`src/lib/agent-profile-format.ts:11`) minus any tool whose policy is missing, disabled, or `requiresApproval: true`. The route is stateless and re-resolves through `getMcpTools()` inside the `tools/call` branch on every request (`src/app/api/mcp/route.ts:91-92`). **There is therefore no list-then-call race, and closing one is not an acceptance criterion for anything.** A spec item claiming to fix it would ship nothing.

**The actual defect.** For the tools that *are* served, `tools/call` runs `tool.execute(args, ctx)` directly under a synthetic context `{ticketId: "mcp-external", runId: "mcp-external"}` (`mcp.ts:145-151`) — no `AgentRun`, no `AgentStep`, no policy assertion at the execute site, and **no audit row at all**. Enforcement lives entirely in one set-subtraction; any future drift in the set builder becomes a silent approval bypass that nothing records.

**The fix, one item, one model, one executor.** `p0-01` is the first item in the backlog and nothing runs before it lands.

```prisma
model McpCall {
  id            String   @id @default(cuid())
  toolName      String
  inputJson     String   // JSON string, parsed defensively on read
  resultPreview String   // truncated to RESULT_LIMIT (4000)
  decision      String   // McpCallDecision union in src/lib/types.ts
  callerLabel   String   @default("mcp-external")
  createdAt     DateTime @default(now())

  @@index([createdAt])
}
```

```ts
// src/lib/types.ts
export type McpCallDecision = "EXECUTED" | "REFUSED_POLICY" | "REFUSED_UNKNOWN" | "ERROR";
```

No `@db.Text` — Prisma maps `String` → `text` on Postgres already (Ruling 11). `ExternalToolCall`, `McpToolCall`, `originPackId`-style variants and the `ok` / `refusalReason` / `source` / `outcome` field sets are dead and may not be reintroduced.

The canonical executor is **`executeMcpToolCall(name, args)`**, exported from `src/lib/mcp.ts` — the file that already owns `getMcpTools`, `mcpToolWithholdReason` and `mcpToolContext`, so the executor sits beside the refusal texts it reuses. `executeExternalToolCall` is dead. It must:

* perform its **own** `db.toolPolicy.findUnique` at the execute site and refuse unless `enabled && !requiresApproval` — defense in depth, independent of what `getMcpTools()` returned;
* refuse `CORE_TOOLS`;
* truncate results to `RESULT_LIMIT` (4000) before storage and before return;
* write exactly one `McpCall` row for **every** call, executed or refused, including the `ERROR` case where the tool throws.

`src/app/api/mcp/route.ts` must contain zero `tool.execute()` calls afterwards; the route delegates entirely. Both the route and the `executeMcpToolCall` body are permanent Tier-C surfaces — every later diff to them opens a PR.

**Transport.** The server side stays the existing hand-rolled stateless Streamable-HTTP JSON-RPC handler in v1; `p0-01` changes the executor, not the transport. Replacing it with the SDK's server transport is Roadmap. Known inherited quirks, documented rather than fixed in v1: MCP is one shared bearer token with no caller identity, and native `create_ticket` attributes the ticket to the oldest ADMIN user (`mcp.ts:63`). `ux-03` stamps those tickets `channel: "MCP"` so the provenance is at least visible.

### 6.3 Servo as an MCP client (`cnp-02`, `cnp-03`)

External MCP servers become Servo agent tools, each mapped through the tool-policy layer so risk levels and the approval gate apply to every connector tool.

**Adopt-first (D2), verified:** `cnp-02` is built on **`@modelcontextprotocol/sdk` (MIT, active — ADOPT)**. No hand-rolled JSON-RPC client, no hand-rolled SSE parsing. The multi-event-SSE risk and the "buffered single response is acceptable degradation" criterion are deleted with the hand-rolled client that created them. The dependency itself is a Tier-C diff (`package.json` runtime dependency) and lands by PR with the item.

**v1 scope, deliberately small:** Streamable HTTP transport only, tools only (no resources, prompts, sampling, elicitation), static bearer/header auth only. **stdio is Roadmap** — spawning subprocesses breaks the single-process assumption behind `activeResolverTickets` (`engine.ts:419`). **OAuth 2.1 is Roadmap.**

```prisma
model McpServer {
  id         String    @id @default(cuid())
  slug       String    @unique // ^[a-z][a-z0-9-]{1,30}$ — becomes the mcp__<slug>__ prefix
  name       String
  transport  String    @default("http") // "http" in v1; "stdio" reserved for roadmap
  url        String
  headers    String    @default("{}") // JSON; values may contain {secret}
  secret     String    @default("")   // sealed at the write boundary, opened at the single use site
  enabled    Boolean   @default(false)
  toolsJson  String    @default("[]") // last tools/list snapshot: [{name, description, inputSchema, hash}]
  lastSyncAt DateTime?
}
```

Contracts this must honour, all of them pre-existing:

* **Secrets** — add `McpServer.secret` seal hooks to the Prisma `$extends` extension in `src/lib/db.ts`, open only inside the client, redact to `secretSet: true` in the API. Same shape as `CustomTool.secret` (`custom-tools.ts:53`). Nested `include` reads bypass the extension, so the open happens at the single use site.
* **Egress** — every JSON-RPC POST goes through `safeFetch` (`src/lib/egress.ts`). A private-network MCP server requires the deliberate literal allowlist entry, exactly like a custom tool. No new raw `fetch` call sites; the guard is never widened.
* **Naming** — tools materialise as `mcp__<slug>__<tool>`, the Claude Code convention, so agent-profile `tools:` allowlists in `agents/*.md` name them identically. The custom-tool create API (`src/app/api/tools/route.ts`) additionally refuses names starting `mcp__`, reserving the namespace; built-ins keep winning registry collisions (`custom-tools.ts:121`).
* **Quarantine sync** — `tools/list` sync creates missing `ToolPolicy` rows with the §6.1 triple, create-only. **One sanctioned, tighten-only exception:** if a previously-enabled tool's snapshot hash (sha256 of name + description + inputSchema) changes, the sync re-quarantines it. This exception only ever disables. Policies for tools that vanish from a server are left in place — invisible without a registry entry — and never auto-deleted.
* **Tool contract** — each MCP-derived `ToolDef` (`src/lib/ai/tools/types.ts`) returns strings, never throws for expected failures ("Error: …"), and caps results at `RESULT_LIMIT`.
* **The gate for free** — merged into `getToolRegistry()`, MCP tools flow through `buildLoopContext` and the engine's per-call policy check, so an enabled `requiresApproval` connector tool pauses the run exactly as `cloud_apply_deployment` does today. `cnp-03`'s acceptance is that end-to-end pause/resume on the mock provider.
* **No proxy chaining** — Servo's own MCP server excludes `mcp__*` tools. Servo does not re-serve other servers' tools in v1.

### 6.4 Agent Skills / SKILL.md compatibility (`cnp-04`)

The Agent Skills standard is an open format (agentskills.io, ~32 tools adopted). D2's verdict is **FORMAT-ONLY**: Servo writes its own parser, there is no licence barrier, and `src/lib/skill-format.ts` is already about 90% of the way there.

Changes to `parseSkillMarkdown` (`src/lib/skill-format.ts:48`):

* Accept the six portable frontmatter fields: `name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools`. Unknown extra keys (Claude Code's `when_to_use`, `argument-hint`, …) are tolerated, never fatal.
* Categories move to `metadata.categories`; top-level `categories:` stays accepted as Servo legacy. The four bundled skills are rewritten spec-clean. `syncSkills` (`src/lib/bootstrap.ts:79-112`) stays create-only, so existing DB rows are untouched.
* Description hard limit rises to 1024 so imports do not fail on prose; the catalogue line (`skillCatalogSection`) still truncates at 300 and `SKILL_CATALOG_LIMIT = 40` is unchanged — the prompt budget does not move.
* Two parse modes: **strict** (existing UI/API path, unchanged errors) and **lenient** (import/plugin path: unknown categories dropped with a warning rather than rejecting the skill).
* `allowed-tools` is stored and surfaced, **not enforced in v1**, and the docs say so. Intersecting it with the profile allowlist in `profileAllowsTool` is Roadmap.

What this buys: any skill from a public library or a claude.ai export drops into `skills/` and Servo's agents read it through the existing `read_skill` progressive-disclosure flow unchanged — and Servo's own desk procedures load into Claude Code as-is. The public claim "compatible with the Agent Skills open standard" ships only in the same item as the round-trip test that proves it.

### 6.5 Plugin bundles — the one install path (`cnp-06`)

**Ruling 2: `syncPlugins()` in `src/lib/bootstrap.ts` is *the* installation system for `.claude-plugin/plugin.json`.** There is no second installer. `PackInstall`, `MarketplaceSource`, `marketplace.json`, `tools/*.tool.json` and `originPackId` do not exist in v1 (§7).

```
plugins/<name>/
  .claude-plugin/plugin.json   # name (required, kebab-case), version, description
  skills/<slug>/SKILL.md       # Agent Skills format, lenient parse
  agents/*.md                  # Servo agent-profile format (src/lib/agent-profile-format.ts)
  .mcp.json                    # optional; {mcpServers: {name: {type:"http", url, headers}}}
```

`syncPlugins()` joins the existing create-only bootstrap syncs, whose contract is that upgrades never clobber admin edits. Three deliberate properties:

1. **Everything a plugin ships arrives disabled** — skills, agent profiles, `McpServer` rows and their tool policies. Plugins are third-party; the admin enables piece by piece.
2. **`.mcp.json` is loaded**, and creates **disabled** `McpServer` rows through the `cnp-02` model. Nothing in this repo "ignores `.mcp.json`", and nothing claims Servo has no MCP client.
3. **Slugs are namespaced `<plugin>--<slug>`**, the URL-safe stand-in for Claude Code's `plugin:skill` display form.

Local bundles only. Remote git install, `userConfig` prompts and hooks are Roadmap; remote install must itself pass the egress guard when it lands.

### 6.6 Distillation — one mechanism, one provenance column (`reb-05`)

**The v1 mechanism is deterministic prefill. There is no model call.** `cnp-05` (AI-drafted SKILL.md through the provider chain) is Roadmap.

`POST /api/skills/distill {ticketId}`, gated by `can(user, "skills.manage")` (ADMIN-only). It gathers the resolved ticket, its comments and the persisted `AgentStep` rows — the audit trail is the raw material — and assembles a spec-clean SKILL.md draft from a fixed template: title and description from the ticket, the observed step sequence as the procedure skeleton, the resolution as the outcome. It validates the result through `parseSkillMarkdown` and creates a `Skill` row with `enabled: false`, slug `distilled-<ticketNumber>`, and `sourceTicketId` set. A "Distill skill" action appears on resolved tickets for admins.

**The human gate is absolute:** nothing distilled enters the resolver's catalogue until an admin reviews, edits and enables it at `/skills`. QA's existing skill-adherence review (`engine.ts:739-756`) is the feedback loop on whether an enabled distilled skill holds up.

Being deterministic is what makes this the v1 mechanism: it is offline-acceptance-testable today, and it is the flow whose provenance the KPIs already count. When the AI-drafted variant ships from Roadmap it layers onto the **same endpoint and the same column**, and its acceptance must include extending the deterministic mock (`src/lib/ai/mock.ts`) to emit parseable SKILL.md frontmatter — today's mock is scripted for ticket-resolution flows and would only ever exercise the failure path.

### 6.7 Provenance — exactly two columns on `Skill`, one on `AgentProfile`

| Column | Meaning | Set by |
|---|---|---|
| `Skill.origin String @default("local")` | packaging provenance | `syncPlugins()` (`cnp-06`) |
| `AgentProfile.origin String @default("local")` | packaging provenance | `syncPlugins()` (`cnp-06`) |
| `Skill.sourceTicketId String?` | distillation provenance | `reb-05` |

```ts
// src/lib/types.ts
export type OriginKind = "local" | `plugin:${string}`;
```

Both `origin` columns are born in `cnp-06`'s single migration. `originPackId` does not exist. Frontmatter `metadata` may *display* the source ticket; it is never the source of truth and nothing counts it. `reb-06` counts `Skill` rows where `sourceTicketId != null` — true by construction — alongside skill-informed runs and skill coverage in one merged KPI item.

### 6.8 Roadmap for this area

stdio transport behind an approved-template allowlist · OAuth 2.1 for MCP servers · MCP resources as ticket context · the SDK server transport replacing the hand-rolled route handler · trust rules (a named-human approval promoted to a standing allow keyed on schema + canonical argument hash, auto-reverting on drift) · a 409 `approval_required` + retry-with-approval-id contract for MCP callers · `allowed-tools` enforcement · AI-drafted distillation onto the same endpoint · remote plugin install, `userConfig`, hooks · `validate-integration` CLI (`cnp-07`) · an external SKILL.md fixture corpus (`cnp-09`).

---
