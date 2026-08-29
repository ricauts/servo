# Servo — Build Contract

This document is the source of truth for every module builder. Read it fully
before writing code. The foundation (configs, schema, shared libs, UI
primitives, shell, seed) already exists — build on top of it, never modify it.

## What Servo is

An open-source, self-hostable service desk where tickets can be assigned to
humans **or AI agents**. AI agents triage tickets, resolve them using tools
(SQL against a sandboxed ops database, device inventory, simulated
GitHub/cloud integrations), pause for **human approval** on risky actions, get
an automated **QA review**, and everything feeds a **KPI dashboard**. BYOK:
an Anthropic API key (env or Settings) enables real model calls; with no key,
a deterministic **mock provider** makes the entire demo work offline.

## Stack & hard rules

- Next.js 15 (App Router) + React 19 + TypeScript strict. Prisma 6 + PostgreSQL (pgvector).
  Tailwind 3.4. zod **v4** (basic `z.object/z.string/z.enum` usage only).
  `@anthropic-ai/sdk` 0.115. `lucide-react` for icons. `clsx` via `cn()`.
- **Do NOT** edit: `package.json`, `prisma/schema.prisma`, `prisma/seed.ts`,
  anything under `src/lib/` or `src/components/` that already exists,
  `src/app/layout.tsx`, `src/app/globals.css`, `tailwind.config.ts`. Do not
  add dependencies. If you need a helper, create it inside your own files.
- Enum-like values are strings by choice, not by dialect — extensibility wants
  them to be data. The unions in `src/lib/types.ts` are the source of truth.
  Always import types from there.
- **Next 15 gotchas:** `params` is a Promise in pages and route handlers —
  `const { id } = await params;` with signature
  `{ params }: { params: Promise<{ id: string }> }`. `cookies()` is async.
  Route handlers return `Response.json(...)`. Server components are the
  default; add `"use client"` only where interactivity is needed.
- Money/latency: keep pages server-rendered; client components fetch via
  relative URLs (`fetch("/api/...")`) and refresh with `router.refresh()`.
- Errors: API routes return `{ error: string }` with proper status codes.
  Wrap engine calls in try/catch; never leave a run stuck in RUNNING — set
  status FAILED with `error` on exceptions.

## Existing foundation (import, don't rebuild)

| Module | Exports |
|---|---|
| `@/lib/db` | `db` (PrismaClient) |
| `@/lib/opsdb` | `OPS_SCHEMA_QUERY`, `opsSelect(sql, params?)`, `opsExecute(sql, params?)`, `opsDisconnect()` — the sandbox ops database, a separate PostgreSQL database behind its own roles. `ensureOpsSchema()` creates devices, employees and software_licenses; employees_backup and campaign_tracking arrive with `npm run demo` |
| `@/lib/auth` | `getCurrentUser(): Promise<User>` (cookie-based demo auth), `USER_COOKIE` |
| `@/lib/permissions` | `can(user, action)`, `canDecideApproval(user, riskLevel)`, `forbid(user, action)` → `Response \| null`, `Action` type |
| `@/lib/types` | All unions (`TicketStatus`, `Priority`, `Category`, `RiskLevel`, `RunStatus`, `StepType`, `ApprovalStatus`…), `ContentBlock`, `ConversationMessage`, `SETTING_KEYS`, `KpiResponse`, `TICKET_STATUSES`, `PRIORITIES`, `CATEGORIES` |
| `@/lib/labels` | `STATUS_LABEL/TONE`, `PRIORITY_LABEL/TONE`, `CATEGORY_LABEL`, `RISK_LABEL/TONE`, `RUN_STATUS_LABEL/TONE`, `APPROVAL_STATUS_TONE`, `BadgeTone` |
| `@/lib/utils` | `cn`, `formatDate`, `formatDateTime`, `timeAgo`, `jsonSafe` (BigInt-safe stringify), `initials` |
| `@/components/ui/*` | `Badge` (`tone` prop), `Button` (`variant`: primary/secondary/danger/ghost, `size`: sm/md), `Card` + `CardTitle`, `Field` (`Label`, `Input`, `Select`, `Textarea`), `Avatar` (`name,color,size,isAi`), `Spinner`, `EmptyState` (`icon,title,hint,action`) |
| `@/components/shell/PageHeader` | `title`, `description?`, `actions?` — use at the top of every page |

Design language: warm paper surfaces, petrol-teal brand, **mono uppercase
badges** for operational data (ids, statuses), `font-display` only for page
titles. Page body pattern: `<PageHeader …/>` then `<div className="p-8">…`.
Ticket numbers render as `#1042` in `font-mono`. Use design-token Tailwind
colors (`bg-surface`, `text-ink-2`, `border-line`, `text-brand`…) — never
raw hex in the UI (charts may use `--chart-*` CSS vars).

## File ownership

| Builder | Owns (create these; touch nothing else) |
|---|---|
| **api-core** | `src/app/api/tickets/route.ts`, `src/app/api/tickets/[id]/route.ts`, `src/app/api/tickets/[id]/comments/route.ts`, `src/app/api/users/route.ts`, `src/app/api/kpis/route.ts`, `src/lib/tickets.ts` |
| **engine** | `src/lib/ai/provider.ts`, `src/lib/ai/mock.ts`, `src/lib/ai/tools.ts`, `src/lib/ai/prompts.ts`, `src/lib/ai/engine.ts`, `src/lib/ai/settings.ts`, `src/app/api/tickets/[id]/runs/route.ts`, `src/app/api/runs/[id]/route.ts`, `src/app/api/approvals/route.ts`, `src/app/api/approvals/[id]/route.ts`, `src/app/api/settings/route.ts`, `src/app/api/settings/tools/route.ts` |
| **ui-tickets** | `src/app/tickets/page.tsx`, `src/app/tickets/new/page.tsx`, `src/app/tickets/[id]/page.tsx`, `src/components/tickets/*` (new files only) |
| **ui-dashboard** | `src/app/dashboard/page.tsx`, `src/components/dashboard/*` |
| **ui-admin** | `src/app/approvals/page.tsx`, `src/app/settings/page.tsx`, `src/components/admin/*` |
| **docs** | `README.md`, `docs/ARCHITECTURE.md`, `docs/DEMO.md`, `LICENSE` |

If you need something from another builder, code against the contract below —
do not create files outside your list.

## API routes (exact contract)

All routes: current user via `getCurrentUser()`; permission checks via
`forbid(user, action)`; validation via zod; 404 as `{error}` status 404.

### api-core

- `GET /api/users` → `{ users: User[] }` (exclude nothing; UI filters).
- `GET /api/tickets?status=&category=&assigneeId=&q=` → `{ tickets: TicketListItem[] }`
  where `TicketListItem` = Ticket incl. `requester`, `assignee` (both
  `{id,name,color,role}`), ordered by `createdAt desc`. `q` searches
  title/description (contains). `status=OPEN_ALL` means not RESOLVED/CLOSED.
- `POST /api/tickets` body `{title, description}` (requires `ticket.create`).
  Creates ticket: `number` = (max number)+1, status OPEN, priority MEDIUM,
  category OTHER. Then, if setting `ai.autoTriage` is `"true"`, calls
  `runTriage(ticket.id)` from `@/lib/ai/engine` in a try/catch (triage failure
  must not fail creation). Returns `{ ticket }` (fresh copy after triage).
- `GET /api/tickets/[id]` → `{ ticket }` incl. `requester`, `assignee`,
  `comments` (with `author`, asc), `runs` (with `steps` asc + `approvals`,
  run order asc), `approvals` (with `decider`).
- `PATCH /api/tickets/[id]` body `{status?, priority?, category?, assigneeId?}`
  (requires `ticket.update`; `assigneeId` may be null to unassign; validate
  values against unions; set `resolvedAt` when status→RESOLVED, clear when
  reopening; set `firstResponseAt` if null and status leaves OPEN). If
  `assigneeId` is set to a user whose `role === "AI_AGENT"` and
  `aiKind === "RESOLVER"` and ticket is not RESOLVED/CLOSED, the route ALSO
  starts `runResolver(ticket.id)` (await it; wrap in try/catch). → `{ ticket }`.
- `POST /api/tickets/[id]/comments` body `{body}` → `{ comment }` (with
  author). Sets `firstResponseAt` if null and author is not the requester.
- `GET /api/kpis` → `KpiResponse` exactly as typed in `@/lib/types`
  (requires `kpi.view`). Implement aggregations in `src/lib/tickets.ts`.
  `createdByDay` covers the last 30 calendar days inclusive, zero-filled,
  local dates as `YYYY-MM-DD`. `avgFirstResponseMinutes` over tickets with
  `firstResponseAt` (last 30d, rounded int). `avgResolutionHours` over
  resolved (last 30d, 1 decimal). `aiResolutionRate` = resolved last 30d whose
  assignee is an AI_AGENT / resolved last 30d (0 when none). `aiVsHuman` from
  the same definition. `topRequesters` top 5 by created last 30d.

### engine

- `POST /api/tickets/[id]/runs` body `{}` (requires `agent.run`): assigns the
  ticket to the RESOLVER AI user if unassigned, then `runResolver(id)`.
  → `{ run }` (final state: COMPLETED, WAITING_APPROVAL or FAILED, incl.
  `steps`). 409 `{error}` if a run for this ticket is already
  RUNNING/WAITING_APPROVAL.
- `GET /api/runs/[id]` → `{ run }` incl. `steps` (asc) and `approvals`.
- `GET /api/approvals?status=PENDING|APPROVED|REJECTED|ALL` (default PENDING)
  → `{ approvals: (Approval & { ticket, run })[] }` desc by requestedAt.
- `POST /api/approvals/[id]` body `{decision: "APPROVED"|"REJECTED", reason?}`
  (requires `approval.decide` + `canDecideApproval(user, approval.riskLevel)`
  → 403 otherwise; 409 if not PENDING). Updates the approval, then calls
  `resumeAfterApproval(approvalId)`. → `{ approval, run }` (run in its final
  state after resuming).
- `GET /api/settings` (requires `settings.manage`) → `{ settings:
  Record<string,string>, keySource: "env"|"db"|"none", toolPolicies: ToolPolicy[] }`
  — NEVER return the stored API key; return `apiKeySet: boolean` instead
  (strip `ai.apiKey` from `settings`).
- `PUT /api/settings` body: any subset of `{provider, apiKey, baseUrl, model,
  autoTriage, qaEnabled}` → upserts Setting rows (booleans as "true"/"false").
  Empty-string apiKey means "clear". → same shape as GET.
- `PUT /api/settings/tools` body `{toolName, enabled?, requiresApproval?, riskLevel?}`
  → updates one ToolPolicy → `{ toolPolicies }`.

## AI engine (the heart — build exactly this)

### Settings access (`src/lib/ai/settings.ts`)

`getAiSettings(): Promise<AiSettings>` reading the Setting table +
`process.env.ANTHROPIC_API_KEY`. `AiSettings = { provider: "anthropic"|"mock",
apiKey: string, baseUrl?: string, model: string, autoTriage: boolean,
qaEnabled: boolean, keySource: "env"|"db"|"none" }`. Effective provider: if
provider setting is `anthropic` but no key anywhere → fall back to `mock`.
Env key wins over DB key.

### Provider (`src/lib/ai/provider.ts` + `src/lib/ai/mock.ts`)

```ts
export interface ToolSpec { name: string; description: string; inputSchema: Record<string, unknown>; }
export interface AssistantTurn { text: string; toolCalls: { id: string; name: string; input: Record<string, unknown> }[]; }
export interface ChatProvider {
  complete(p: { system: string; messages: ConversationMessage[]; tools: ToolSpec[]; maxTokens?: number }): Promise<AssistantTurn>;
}
export function getProvider(settings: AiSettings, ctx: MockContext): ChatProvider
```

- **AnthropicProvider**: `new Anthropic({ apiKey, baseURL: baseUrl || undefined })`,
  `client.messages.create({ model, max_tokens: 4096, system, messages, tools })`.
  Map our `ConversationMessage[]` directly (shape already matches). Map tools to
  `{name, description, input_schema}`. Parse response content blocks into
  `AssistantTurn`. No `temperature` (removed on modern models).
- **MockProvider** (`mock.ts`): deterministic. Context = `{ ticket, kind }`.
  For `kind: "TRIAGE"` return JSON text (see prompts). For `RESOLVE`: derive a
  tool script from the ticket text (first match wins):
  - /password|mfa|locked|2fa/i → `reset_password {email: requester.email}`
  - /device|laptop|monitor|asset|warranty|phone/i → `get_device_info
    {assetTag: first /[A-Z]{2}-\d{3,4}/ match in text, else "LT-2043"}`
  - /table|database|sql|schema|query|report|license/i →
    `query_ops_database {sql: OPS_SCHEMA_QUERY}` — the schema-listing statement
    exported by `src/lib/opsdb.ts`: `SELECT table_name FROM
    information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;`
    then, if /create|add|drop|delete|update|insert|alter/i,
    `execute_ops_sql {sql: derived: "DROP TABLE employees_backup;" if /drop/i
    else a CREATE TABLE derived from slugified title}`
  - /deploy|repo|repository|pipeline|ci|cloud|azure|aws|gcp/i →
    `github_create_repo {name: slug(title)}` if /repo/i, else
    `cloud_plan_deployment {...}` then `cloud_apply_deployment {planId}`
  - always append: `post_comment {body: helpful summary}` then
    `resolve_ticket {resolution}`.
  Each `complete()` call returns the FIRST script step whose tool name has no
  `tool_use` yet in `messages` (compare against all assistant blocks), with a
  short planning `text`. If the last `tool_result` in `messages` has
  `is_error: true` (e.g. approval rejected), skip remaining risky steps and go
  straight to `post_comment` (acknowledging the rejection) + `resolve_ticket`
  (noting human follow-up needed). When script is exhausted → return final
  summary text with no toolCalls. Generate tool_use ids like `mock_${runId? no — use crypto.randomUUID()}`.

### Tools (`src/lib/ai/tools.ts`)

`interface ToolDef { name; description; inputSchema (JSON schema);
execute(input, ctx): Promise<string> }` with `ctx = { ticketId, runId,
agentUser }`. Registry `TOOLS: Record<string, ToolDef>` for the 10 seeded
tools (names must match ToolPolicy rows exactly):

- `query_ops_database {sql}`: reject non-SELECT (must start with SELECT/WITH,
  single statement, no semicolon followed by more text) → `opsSelect`, return
  `jsonSafe(rows)` truncated to 4000 chars. On SQL error return the error
  message as the result string (not a throw).
- `execute_ops_sql {sql}`: single statement; `opsExecute`; return
  `"Statement executed. N rows affected."`.
- `get_device_info {assetTag}`: SELECT from devices by asset_tag (use a
  parameterized `$queryRawUnsafe` with `?`); JSON or "not found" message.
- `reset_password {email}`: simulated; return success text.
- `github_create_repo {name, description?, private?}`: simulated; return
  `"Repository acme/${name} created with default branch protection and CI template."`.
- `github_open_pr {repo, title, description?}`: simulated; return PR url text.
- `cloud_plan_deployment {provider, service, description}`: simulated; return
  a small plan text incl. a generated `planId`.
- `cloud_apply_deployment {planId, provider?}`: simulated; return apply-success text.
- `post_comment {body}`: create Comment (author = ctx.agentUser.id); set
  ticket.firstResponseAt if null; return "Comment posted.".
- `resolve_ticket {resolution}`: set ticket RESOLVED + resolvedAt now + create
  a SYSTEM comment "Resolved by <agent>: <resolution>"; return confirmation.

### Prompts (`src/lib/ai/prompts.ts`)

- `triageSystem`/`triageUser(ticket)` — instruct the model to reply with ONLY
  JSON `{"category": Category, "priority": Priority, "assignTo": "AI"|"HUMAN",
  "rationale": string}` (assign AI when the request maps to available tools).
  MockProvider returns this JSON via keywords.
- `resolverSystem(toolPolicies)` — the agent persona: work the ticket with
  tools, communicate via post_comment, always finish with resolve_ticket,
  never fabricate results, risky tools may require human approval (a rejected
  tool_result means adapt, don't retry the same call).
- `qaPrompt(run, ticket)` — reviewer returns ONLY JSON
  `{"verdict": "PASS"|"FAIL", "notes": string}`.

### Engine (`src/lib/ai/engine.ts`)

```ts
export async function runTriage(ticketId: string): Promise<AgentRun>
export async function runResolver(ticketId: string): Promise<AgentRun>
export async function resumeAfterApproval(approvalId: string): Promise<AgentRun>
```

- **runTriage**: create run (kind TRIAGE, agent = TRIAGE AI user). One
  provider call. Parse JSON (tolerate code fences). Update ticket: category,
  priority, status TRIAGED, and if `assignTo === "AI"` set assignee = RESOLVER
  AI user. Create a SYSTEM comment with the rationale ("Triage: …"). Steps:
  TEXT (rationale). Complete run with summary. On parse/provider error → run
  FAILED (ticket untouched).
- **runResolver** core loop (also used by resume):
  1. Load ticket + settings + enabled tool policies. Build system prompt +
     initial user message `Ticket #N: title\n\ndescription\n\nRequester: name <email>`.
  2. Set ticket status IN_PROGRESS (unless resuming), assignee stays.
  3. Loop (max 12 iterations): `provider.complete(...)` → persist TEXT step if
     text; for each toolCall: append assistant block to conversation; look up
     policy; if tool unknown/disabled → tool_result error block; if
     `policy.requiresApproval` → create Approval (PENDING, toolUseId =
     toolCall.id), APPROVAL_REQUEST step, run status WAITING_APPROVAL, ticket
     status WAITING_APPROVAL, persist conversation, **return** (paused).
     Otherwise execute → TOOL_CALL + TOOL_RESULT steps, append tool_result
     block, continue.
  4. When a turn has no toolCalls → run COMPLETED, summary = final text,
     `completedAt`. If any executed tool had risk MEDIUM/HIGH and
     `qaEnabled` → run QA (provider call, kind stays RESOLVE; store
     qaVerdict/qaNotes + QA_REVIEW step). On QA FAIL: reassign ticket to the
     human AGENT with a SYSTEM comment ("QA flagged this run…") and set
     status IN_PROGRESS.
  5. Errors anywhere → run FAILED + ERROR step + `error` field; ticket status
     back to TRIAGED.
  Conversation is persisted to `run.conversation` (JSON) on every state
  change (that's what makes resume work).
- **resumeAfterApproval**: load approval + run + conversation. If APPROVED:
  execute the tool now, steps TOOL_CALL/TOOL_RESULT, append `tool_result`
  block. If REJECTED: append `tool_result` with `is_error: true` and content
  `"Rejected by <decider>: <reason>"` + a SYSTEM comment on the ticket. Set
  run RUNNING + ticket IN_PROGRESS, then continue the same loop as
  runResolver step 3 (factor the loop into a shared helper).

### UI expectations (for ui-* builders)

- **/tickets**: filterable table (status, category, q). Columns: `#`,
  title (+ requester below), status badge, priority badge, category, assignee
  (Avatar + name; AI assignee shows `isAi`), updated (timeAgo). Row links to
  detail. "New ticket" button in the header.
- **/tickets/new**: form (title, description) → POST /api/tickets → redirect
  to the created ticket (client component + useRouter).
- **/tickets/[id]** (server page + client islands): header with number/title/
  badges; description card; **timeline** merging comments + run steps sorted
  by time; right column: properties panel (status/priority/category/assignee
  selects PATCHing the ticket), "Run AI resolver" button (POST
  /api/tickets/[id]/runs then refresh), run cards (status badge, steps with
  tool names in mono, QA verdict card), inline approval card when an approval
  is PENDING (Approve/Reject buttons POSTing to /api/approvals/[id], hidden
  for users where `canDecideApproval` fails — fetch decision perms via the
  approvals API response fields you need; simplest: render buttons and show
  the 403 error message on failure).
- **/approvals**: pending queue cards (ticket, tool, mono JSON input, risk
  badge, requested timeAgo, Approve/Reject with optional reason) + a history
  section (APPROVED/REJECTED list). Empty state when clean.
- **/dashboard**: KPI stat tiles (open, resolved 30d, avg first response, avg
  resolution, AI resolution rate, pending approvals) + charts from
  `GET /api/kpis` (fetch server-side calling `getKpis()` from
  `src/lib/tickets.ts` directly if simpler — but the API route must exist per
  contract). Charts are hand-rolled SVG per the dataviz skill (read it).
- **/settings**: BYOK card (provider select anthropic/mock, apiKey password
  input + "key set" indicator + keySource note, baseUrl, model, autoTriage +
  qaEnabled toggles) saving via PUT /api/settings; tool policy table
  (enabled + requiresApproval toggles, risk select) via PUT
  /api/settings/tools; users list card (read-only roles). Admin-only page:
  non-admins see an explanatory empty state.

## Seeded demo state (rely on it)

Users: Ana Rodríguez (ADMIN), Bruno Chen (AGENT), Carla Méndez / Diego
Fontaine (REQUESTER), Servo Triage/Resolver/QA (AI_AGENT with aiKind).
~28 tickets over 30 days; two runs WAITING_APPROVAL with PENDING approvals
(`execute_ops_sql` DROP TABLE, `cloud_apply_deployment`); several COMPLETED
runs with steps; ToolPolicy rows for all 10 tools; Settings default to mock
provider, model `claude-opus-5`, autoTriage+qaEnabled true.
