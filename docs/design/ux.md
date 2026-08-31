<!-- Design rationale extracted from spec.md. spec.md remains the work order:
     the backlog, the tick protocol and the claims ledger live there. -->

# Role-scoped UX

### 9.1 What v1 ships, and what this section is

Servo's screens were built desk-first: one nav for everyone, one table for every queue. This section defines the per-persona information architecture. **In v1 the backlog ships exactly three items from it — `ds-01` (design-system adoption + the hex lint), `ux-01` (the nav registry) and `ux-03` (`Ticket.channel` provenance).** Everything else below — the kanban board, operator home, the runs console, chat — is **Roadmap**, specified here so that the design is settled before a tick touches it, and so that no future item redesigns the nav or the column mapping from scratch.

What is broken today, repo-verified, and what `ux-01` fixes:

* `src/components/shell/SidebarNav.tsx:42-69` hardcodes Dashboard, Tickets, Approvals, Settings for **every** role. A `REQUESTER` sees three items that dead-end in Lock empty-states.
* `src/components/shell/Sidebar.tsx:21-23` shows **global** pending-approval and open-ticket counts to every role, including requesters — an information leak inconsistent with the isolation rule enforced at `tickets/page.tsx:58`.
* `src/components/shell/CommandPalette.tsx:41-50` is a **second** hardcoded page list with the same problem. Two nav truths, both role-blind.

### 9.2 Navigation: `nav-items.ts` is the single owner

`ux-01` creates `src/components/shell/nav-items.ts`, exporting `NavEntry[]` and the pure function `navForUser(user)`, and **deletes both** the `SidebarNav.tsx` static array and the `CommandPalette.tsx` `PAGES` array.

```ts
export interface NavEntry {
  href: string;
  label: string;
  icon: LucideIcon;
  section: "work" | "fleet" | "admin";
  /** Omitted = visible to every signed-in human role. */
  action?: Action;          // from src/lib/permissions.ts
  adminOnly?: boolean;      // for pages gated by role, not action (e.g. /integrations)
}
export function navForUser(user: Pick<User, "role">, items?: NavEntry[]): NavEntry[]
```

`Sidebar.tsx` (server) computes the filtered list once and passes it to `SidebarNav` and, through the layout, to `CommandPalette`. `navForUser` is pure and unit-testable. This is a static in-repo list, not a dynamic route registry — the pattern is extended, not reinvented.

**After `ux-01` lands, no item may add a navigation entry by editing a component.** Any item that adds a page adds one `NavEntry` to `nav-items.ts` and declares `depends-on: ux-01`. This binds the KB UI items (`kb-12a`, `kb-12b`) and every Roadmap item in this section.

Sidebar counts become **scoped**: a requester sees their own open-ticket count and no approvals chip at all.

**Personas and their roles.** No new roles in v1 (§8.1); persona names are UI copy only. Where the drafts disagreed on which enum the word "Operator" labels, Ruling 3 makes the UX draft's stance the winner, so this spec binds it as follows and nothing may re-bind it:

| Persona (UI copy) | Stored role | What it is |
|---|---|---|
| **Operator** | `REQUESTER` | An employee who requests work and support, and later chats with entitled agents |
| **Desk agent** | `AGENT` | Works the queue; decides LOW/MEDIUM approvals |
| **Agent-admin** | `ADMIN`, nav section "Fleet" | Agents, runs, skills, tool policies, credentials |
| **Sys-admin** | `ADMIN`, nav section "Admin" | Settings, integrations, groups/team, knowledge-base administration |
| — | `AI_AGENT` | Never signs into the UI; no nav tree |

**Nav trees, v1:**

* **Operator (`REQUESTER`)** — My tickets (`/tickets`) · New request (`/tickets/new`). Everything else disappears: no Dashboard, Approvals, Groups, Agents, Skills, Integrations, Settings. Home (`/home`) joins this tree when operator home ships.
* **Desk agent (`AGENT`)** — Dashboard · Tickets · Approvals (count chip) · Groups · Agents · Skills · Knowledge (`kb.view`).
* **Admin (`ADMIN`)** — everything above, plus sections **Fleet:** Agents, Skills, Knowledge admin · **Admin:** Integrations, Settings. Section headers are mono-uppercase labels in the existing sidebar style.

### 9.3 The design-system rule (OWNER-DECISION D3) — binding on every UI tick

`servo_design_system/` lives in this repo. It contains an invocable `SKILL.md` (skill name `servo-design`), `readme.md`, `tokens/*.css` (8 files: `base`, `colors`, `effects`, `fonts`, `motion`, `spacing`, `themes`, `typography`), 17 `guidelines/*.card.html`, `ui_kits/`, `components/` and `docs/`.

Three rules, all enforced:

1. **All UI work consumes semantic tokens** from `servo_design_system/tokens/*.css` — `--brand`, `--surface`, `--critical-chip`, and the rest. **Never a raw hex value.**
2. **Every UI item's acceptance criteria include:** no hardcoded hex; every colour resolves to a design-system token. `ds-01` makes this mechanical — a `no-hardcoded-hex` lint over `src/app` and `src/components`, wired into the same green-gate as `typecheck` and `test`.
3. **Before any UI tick the loop reads `servo_design_system/SKILL.md` and `readme.md`, plus the guideline cards for the area it is touching** — the `colors-*` cards for anything chromatic, `spacing-*` and `radii` for layout, `type-*` for text, `motion` for transitions, `elevation`/`texture` for surfaces.

This exists because an autonomous loop touching UI every five hours with no design source of truth diverges within weeks. `ds-01` is the first UX item for exactly that reason: the lint has to exist before the loop writes UI.

### 9.4 Roadmap: the kanban board (`ux-02`)

**Column mapping** — columns derive from `TicketStatus` (`src/lib/types.ts:8-14`) through a pure helper `src/lib/board.ts`:

| Column | Statuses | Notes |
|---|---|---|
| New | `OPEN` | |
| Triaged | `TRIAGED` | |
| In progress | `IN_PROGRESS` | |
| Waiting approval | `WAITING_APPROVAL` | **Engine-owned.** Cards are not draggable in or out; each links to `/approvals`. |
| Resolved | `RESOLVED` | |
| Closed | `CLOSED` | Hidden behind a toggle by default. |

**Drag = status change, with the permission check already in place.** A drop issues `PATCH /api/tickets/[id]` with `{status}` — the existing route (`src/app/api/tickets/[id]/route.ts:41-137`) already enforces `forbid(user, "ticket.update")`, stamps `resolvedAt` / `firstResponseAt`, invalidates pending reply drafts on CLOSED, and fires the `ticket.resolved` webhook. **No new mutation endpoint.** Requesters get the same board read-only — no drag affordance, no move menu — because `ticket.update` excludes them.

**Engine-state honesty, a server guard shipped in the same item.** `WAITING_APPROVAL` is set only by `driveResolverLoop` when it creates an `Approval` row, and cleared only by `resumeAfterApproval`. Humans must not fake or break that state, so the PATCH route gains two refusals:

1. `status: "WAITING_APPROVAL"` in the body → `400` ("engine-owned status");
2. any `status` change while the ticket has a `PENDING` Approval → `409` ("decide the approval first"), leaving priority, category and assignee changes untouched.

The board and `PropertiesPanel.tsx` stop offering those transitions; the API guard protects every other caller.

**Drag mechanics — adopt, do not hand-roll.** Use **`@atlaskit/pragmatic-drag-and-drop` (Apache-2.0, active, verified in D2)**. It has no React peer dependency, so React 19 is safe. `dnd-kit` is MIT but dormant since 2024-12 and is not adopted. A per-card "Move to…" dropdown, built on the existing Radix primitives, is the keyboard and touch path — **the menu is the accessibility guarantee, drag is the convenience.** Adding the dependency is a Tier-C diff (`package.json` runtime dependency) and lands by PR with the item.

**SLA badges** reuse `src/components/tickets/SlaBadge.tsx`; the row shape already carries `responseDueAt` / `resolutionDueAt` (`tickets/page.tsx:94-95`). Overdue cards use the badge's existing attention tone — **no new colour tokens**, per §9.3. Per-column WIP count chips use the existing mono sidebar-chip style; configurable WIP limits are further Roadmap. A card assigned to an AI agent shows the existing bot avatar treatment from `TicketsTable`.

A "Mine | All" toggle on `/tickets` (`ux-08`) maps to the `assigneeId` filter the list API already supports (`api/tickets/route.ts:43-45`).

### 9.5 Roadmap: operator home (`/home`, `ux-04`)

A server component, requester-scoped exactly like `/tickets` (`where.requesterId = user.id`). ADMIN and AGENT hitting `/home` are redirected to `/dashboard`.

1. **My tasks board, read-only, four merged columns** — Submitted (`OPEN` + `TRIAGED`) · In progress (`IN_PROGRESS`) · Needs approval (`WAITING_APPROVAL`) · Done (`RESOLVED` + `CLOSED`, last 7 days). Reuses `board.ts` with an operator column preset.
2. **Two CTAs** — "Request a task" → `/tickets/new?kind=task`, "Request support" → `/tickets/new?kind=support`. The new-ticket form reads `kind` to preset copy and default category; both create ordinary tickets through the existing `POST /api/tickets`, so triage, SLA and webhooks are unchanged.
3. **An approvals visibility strip, not an inbox.** `approval.decide` stays ADMIN/AGENT — operators never decide in this version. They see that *their own* ticket is paused: status, risk level, and once decided, the decider's name.

**Redaction rule, tested by key absence rather than by UI hiding:** `Approval.toolName` and `Approval.input` are never serialised to a `REQUESTER`. A pure view helper `src/lib/approval-views.ts#requesterApprovalView` returns only `{id, status, riskLevel, createdAt, decidedAt, decidedByName}`, and a test asserts the forbidden keys are absent. When named-approver routing ships (§8.4), that item amends this helper in the same commit — a routed approver must see what they are approving.

An **approvals inbox** proper — the desk-agent and admin surface at `/approvals` — already exists and is unchanged; the front-and-centre "needs my approval" queue on the desk home is a refinement of the existing `/dashboard`, not a new page.

### 9.6 Roadmap: the runs console (`ux-05`) and the consoles

* **Desk agent view** — `/tickets` (table and board), `/approvals`, the ticket detail page. Unchanged in v1 beyond the nav fix and the channel badge.
* **Agent-admin console** — Fleet section: `/agents` (profiles, entitlements when they exist), `/skills`, a cross-ticket runs console, and the tool-policy and credential-pool tabs of `/settings`.
* **Sys-admin console** — Admin section: `/settings` (AI provider, SLA, team/roles), `/integrations`, `/groups`, knowledge-base administration.
* **Runs console** — a cross-ticket list of `AgentRun` rows with three-layer progressive disclosure: human summary → steps and artifacts → raw tool calls. **Correction to the draft's citation:** `AgentRun` has `createdAt` and `completedAt`, not `startedAt`/`finishedAt`; the item's queries use the real columns.

### 9.7 Roadmap: chat with entitled agents (`ux-06`, `ux-07`)

**A chat is a ticket wearing a different skin.** No parallel object, no second execution path.

Starting a chat creates a `Ticket` with `channel: "CHAT"`, title derived from the first message, the message as the first `Comment`, assigned to the RESOLVER AI user. Every agent reply is produced by `runResolver` → `driveResolverLoop`, so tool-policy lookup, the approval gate, QA review, the `AgentRun`/`AgentStep` audit trail and usage metering all apply unchanged. **Chat adds zero new tool-execution paths.** A follow-up message re-triggers the resolver unless the ticket is `RESOLVED`, `CLOSED` or `WAITING_APPROVAL`; the in-process re-entrancy guard prevents double runs. When a run pauses on approval the chat shows "Waiting for a human to approve a privileged action" **with no tool detail** — the §9.5 redaction rule. Chats appear in the desk queue and board badged `CHAT`, so `escalate_to_human` and human takeover work for free.

**Entitlement gating** is where this section joins §8.5: `AgentProfile.chatEnabled` (default off) plus, when hierarchy lands, the profile's group scope. `GET /api/chat/agents` returns only `{id, name, description}` — never `tools`, never `credentialId`, never the prompt body. A `chat.start` action joins the MATRIX.

`ux-03` is the v1 down-payment on all of this: `Ticket.channel String @default("WEB")` with `TicketChannel = "WEB" | "EMAIL" | "MCP" | "CHAT"` in `src/lib/types.ts`, stamped at the three existing creation sites (`api/tickets/route.ts` → `WEB`, the inbound-email path → `EMAIL`, `create_ticket` in `src/lib/mcp.ts` → `MCP`) and surfaced as a mono badge. Historical rows default to `WEB` — an accepted, documented inaccuracy.

### 9.8 Safety invariants for this area

1. **No new execution path.** Every agent action, in chat or anywhere else, runs inside `driveResolverLoop`. Nothing in this section calls `tool.execute()` directly, and no item here may give a `REQUESTER` a path to tool execution outside the engine.
2. **Engine-owned status is engine-owned.** Humans cannot set `WAITING_APPROVAL` or move a ticket out of it while an Approval is `PENDING`.
3. **Requester redaction is tested by key absence** — `Approval.toolName`/`input`, profile `tools`, and credentials never reach a requester serialisation.
4. **Scoped counts.** No global queue or approval numbers reach a requester.
5. **Design tokens only.** No hardcoded hex; `ds-01`'s lint is part of green.

---
