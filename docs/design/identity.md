<!-- Design rationale extracted from spec.md. spec.md remains the work order:
     the backlog, the tick protocol and the claims ledger live there. -->

# Identity, hierarchy and access control

### 8.1 What v1 changes: one item

**The role vocabulary does not change in v1.** `Role = "ADMIN" | "AGENT" | "REQUESTER" | "AI_AGENT"` (`src/lib/types.ts:5`) is untouched. **No item may add, rename, or remove a value of the `Role` union.** There is no role migration in v1, so there is no ordering problem to get wrong, and no grant written between now and the rename becomes a dead string.

**`permissions.ts` stays flat by design.** The 16-action global `MATRIX` (`src/lib/permissions.ts:22-39`), `can()`, `forbid()` and `canDecideApproval()` keep their present shape. The two hard isolation rules are preserved by every item in this spec:

1. A `REQUESTER` sees only their own tickets (`src/app/tickets/page.tsx:58`, `src/app/tickets/[id]/page.tsx:74`, `src/app/api/tickets/route.ts:26`).
2. HIGH-risk approvals are ADMIN-only (`permissions.ts:46`).

The single v1 item is **`rbac-01`**, and it exists solely because the knowledge base needs grant subjects and permission actions:

* four new actions in `MATRIX` — `kb.view`, `kb.upload`, `kb.share`, `kb.manage` — each granting a subset of `["ADMIN","AGENT"]`, never `REQUESTER`, never `AI_AGENT`;
* one shared helper `principalsForUser(user)` resolving a user to their principal set: the user themselves plus their `GroupMember` group memberships.

That is the whole item. One tick, not eight. It lands Tier B on green if `scripts/permissions-guard.mjs` proves no existing action's grant array changed.

### 8.2 Org units in v1: the flat `Group`

v1 uses the `Group` + `GroupMember` that already exists (`prisma/schema.prisma:41`) as a knowledge-base grant subject. Nothing more. Groups already route tickets by category (`groupForCategory`, `src/lib/escalation.ts`), already carry member tiers (`GroupMember.seniority`), and already contain AI agents for free — because AI agents are `User` rows (`bootstrap.ts:16`) and `GroupMember` references `User`.

**Grant subjects, which is what the KB's grants join to,** are therefore three kinds in v1: a **user**, a **group**, and an **agent profile**. The knowledge-base section owns the `KbGrant` model and its polymorphic `targetType`/`targetId` + `subjectType`/`subjectId` shape; this section owns the fact that all three subject kinds exist today and none of them needs a tree.

Two consequences the KB section depends on and this section states once:

* **`agent:default`** is a named built-in principal. When `AgentRun.profileId` is null — TRIAGE runs and default resolver runs — the run's agent principal is `agent:default`, which is granted **nothing** by default and must be granted explicitly like any other subject.
* **"Personal agent" is Roadmap wording.** `AgentProfile` has no owner column in v1. KB grants target company agent profiles. The Roadmap entry notes that personal agents need `AgentProfile.ownerId` alongside RBAC v2.

### 8.3 Roadmap: the role rename

Fixed now so that when it ships it ships once:

```ts
export type Role = "SYS_ADMIN" | "AGENT_ADMIN" | "AGENT" | "OPERATOR" | "AI_AGENT";
```

| Old (valid on disk forever) | New | Semantics |
|---|---|---|
| ADMIN | SYS_ADMIN | Everything, including `settings.manage` and HIGH approvals |
| — | AGENT_ADMIN | Manages the agent fleet — profiles, credential pool, tool policies, custom tools (new action `fleet.manage`); decides LOW/MEDIUM approvals; **not** global settings, **not** HIGH approvals |
| AGENT | AGENT | Unchanged |
| REQUESTER | OPERATOR | Own tickets only, plus approvals explicitly routed to them |
| AI_AGENT | AI_AGENT | Unchanged |

The rule is **normalize at read, never rewrite in place**: `normalizeRole(raw)` maps `ADMIN→SYS_ADMIN`, `REQUESTER→OPERATOR`, passes new values through, and maps unknown strings to the least-privileged role. Legacy strings stay valid indefinitely; only a manual `scripts/migrate-roles.ts` rewrites rows, and the loop never runs it.

This is **not a two-tick item** and is split into two Roadmap entries: **(a)** `normalizeRole` + the MATRIX rewrite; **(b)** the call-site sweep, which must cover `canDecideApproval`, `Sidebar.tsx`, `src/lib/mcp.ts:63` (the oldest-ADMIN requester attribution), the setup route, `authjs.ts` JIT provisioning, both seed files, the demo `UserSwitcher`, and every piece of UI copy. Role-literal DB filters become `role: { in: ["ADMIN", "SYS_ADMIN"] }`.

### 8.4 Roadmap: named-approver routing

Today any ADMIN/AGENT may decide any pending approval. The routed form adds one nullable column — and the column is **`approverId`**, not `assignedApproverId`:

```prisma
model Approval {
  // ... existing fields (schema.prisma:161) ...
  approverId String? // named approver; null = today's behaviour (any role-eligible decider)
}
```

Decide rule: when `approverId` is set, only that user — or a SYS_ADMIN as break-glass — may decide. An OPERATOR may decide only approvals routed to them, and never HIGH. Routing is manual: a `settings.manage` holder reassigns a PENDING approval via `PATCH /api/approvals/[id]`, logged as a SYSTEM comment. Auto-routing to a group lead requires the hierarchy and comes after it.

**Binding on that item:** it must ship the routed-approver nav entry (one `NavEntry` in `nav-items.ts`, §9.2) and the amended requester-redaction rule in the **same** item. A routed approver has to see the tool name and input they are approving; the redaction helper must distinguish "requester watching their own paused ticket" from "named approver deciding".

### 8.5 Roadmap: org hierarchy

Also Roadmap in full. v1 ships no tree, because the KB's access control is expressed through grants and grants do not need one; shipping a tree nobody reads is premature.

```prisma
model Group {
  // ... existing fields (schema.prisma:30) ...
  parentId   String?
  parent     Group?  @relation("GroupTree", fields: [parentId], references: [id])
  children   Group[] @relation("GroupTree")
  leadUserId String? // the unit's reporting line: who escalations land on
}

model AgentProfile {
  // ... existing fields (schema.prisma:205) ...
  groupId String? // entitlement scope; null = visible to everyone (today's behaviour)
}
```

Design, fixed: the groups API refuses self-parenting and cycles (walk parents, hard cap depth 10) and every tree walker carries the same cap. Ticket routing is unchanged; escalation gains one hop — when a group has no eligible member at or above the target tier, escalation assigns to the parent group via the existing `pickGroupAssignee`, recording the hop as a SYSTEM comment; at the root, current behaviour applies. `User.managerId` reporting lines are further Roadmap; the group lead is the reporting line.

**Agent entitlements** — which humans may see and use which agents — are `AgentProfile.groupId` plus the frontmatter key `group: <group-name>` (unresolvable name syncs as null with a warning; sync never fails). A scoped profile is listed at `/agents`, pickable in assignee lists, and selectable by `pickAgentProfile` only when the viewer, the ticket requester, or the ticket group belongs to that group's subtree. Admins see all. **When entitlement filtering leaves no match, triage falls back to unscoped profiles and then to the default resolver — a category can never end up unservable.** A many-to-many `AgentEntitlement` join table is later Roadmap still.

### 8.6 Roadmap: agent-to-agent delegation

Roadmap, and with a specific unresolved dependency that is the reason it is not v1: `runResolver` **throws** when `activeResolverTickets` already holds the ticket (`engine.ts:413-421`), so a synchronous sub-run inside a parent's tool call re-enters the guard. A2A needs a `driveSubRun` entry point that no draft specified, and the loop must not design that entry point on its own. The item that lands A2A designs `driveSubRun` first, by PR.

The rest of the design is fixed:

**One engine tool**, `delegate_to_agent { profile_slug, task }` (`src/lib/ai/tools/delegate.ts`), registered like every built-in. It joins the shared exclusion list alongside `CORE_TOOLS` that `getMcpTools()` filters unconditionally, so it is unreachable over MCP even if an admin relaxes its approval flag.

**Policy matrix, default deny:**

```prisma
model A2aPolicy {
  id            String  @id @default(cuid())
  fromProfileId String
  toProfileId   String
  allowed       Boolean @default(true)
  @@unique([fromProfileId, toProfileId])
}
```

No row means delegation is refused with a readable `"Error: …"` string. Wildcards scoped to org units are later Roadmap; the first version is explicit profile pairs.

**Lineage:**

```prisma
model AgentRun {
  // ... existing fields ...
  parentRunId String?
  depth       Int     @default(0)
}
```

**The no-pause rule, which mirrors MCP:** a sub-run has no human attached, so its tool set is `enabled ∧ profile allowlist ∧ NOT requiresApproval` — the same filter as `mcp.ts:104-121`. A sub-agent that needs a gated action returns that fact to the parent; the parent either performs the gated call itself, using its own pause/resume machinery, or escalates. **Nested `WAITING_APPROVAL` is deliberately not built.**

**Depth, budget and loop prevention.** `Setting` keys `a2a.maxDepth` (default 2) and `a2a.maxDelegationsPerTicket` (default 3). Delegation to a profile already present in the `parentRunId` ancestor chain is refused — that is the loop guard. Token-denominated budgets are further Roadmap because `AiUsage` (`schema.prisma:239`) has no `ticketId` today and per-ticket spend cannot be summed without a schema addition; the item that adds budgets adds that column.

**A chain MUST escalate to a human** (`escalate_to_human`) when any of these hold: depth or delegation count is exceeded; policy denies twice for the same goal; the sub-agent needed a gated tool the parent cannot perform itself; or the sub-run FAILED. Silent give-up is not an option — the ticket goes to a person.

### 8.7 Roadmap: the Servo admin agent

A default `agents/servo-admin.md` profile — an ordinary `AgentProfile`, synced create-only, running on the ordinary engine, with no privileged execution path of its own. Its tools live in `src/lib/ai/tools/admin.ts`:

| Tool | What it does | Notes |
|---|---|---|
| `read_settings` | Reads configuration | Redacted: `SENSITIVE_SETTING_KEYS` values reduce to `secretSet` booleans. Never a secret value. |
| `list_users` | id / name / email / role / memberships | |
| `list_groups` | The org units | |
| `manage_user` | create · set_role · add_to_group · remove_from_group | Mutates the access-control plane |
| `update_tool_policy` | Edits `ToolPolicy` rows | Mutates the access-control plane |

**All five ship with the §6.1 triple — `enabled: false`, `requiresApproval: true`, `riskLevel: "HIGH"` — including the read-only three.** That is what lets the item land Tier B on the policy guard. An admin who wants `read_settings` enabled and ungated downgrades it by hand in `/settings`; that is a human action in the UI, never a diff. Shipping the read tools as LOW-and-enabled in the seed is a Tier-C diff and requires an owner PR.

**Why the mutations stay gated like everything else:** they modify the access-control plane itself, and a prompt-injected ticket steering the admin agent must never escalate privileges without a named human decision. This is the same reasoning as `cloud_apply_deployment`'s gate. Defence in depth is enforced **inside the tools**, not only by policy — because policy is a thing the agent could otherwise propose changing:

* `manage_user` refuses to grant the top admin role and refuses to touch `AI_AGENT` rows (breaking `getAiUser` breaks the engine, `engine.ts:74`);
* `update_tool_policy` may tighten freely and **refuses any loosening** — enabling a disabled tool, flipping `requiresApproval` true→false, or downgrading a risk level. Loosening stays human-only in `/settings`.

All five also join the MCP exclusion list. MCP is a shared bearer token with no caller identity, so even the read tools would leak org structure to any token holder; HIGH + `requiresApproval` already makes them unreachable there by construction, and the exclusion list makes it explicit rather than incidental.

---
