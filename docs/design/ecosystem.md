<!-- Design rationale extracted from spec.md. spec.md remains the work order:
     the backlog, the tick protocol and the claims ledger live there. -->

# Ecosystem mining targets

Mining is the loop's **fallback activity**, not its default. Per Ruling 6 a mining tick is allowed only when the backlog has **no unblocked `todo` item** *and* `p0-01`, `loop-05` and `loop-06` are `done`.

One procedure, one location: `loop-07` creates `docs/integrations/README.md` (the rotation and the intake template) and `docs/integrations/<slug>.md` (one intake doc per candidate). There is no `docs/integrations.md` and no second location. The `validate-integration` CLI and the external fixture corpus are Roadmap.

**The adopt-first gate (D2) is the first stage of the intake template, and it is also step 0 of every tick:** before building any component, the loop records in its changelog line either the adopted OSS component and its licence, or one sentence on why nothing cleared the gate.

* **Licence allowlist:** MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, CC0-1.0, Unlicense.
* **Rejected:** GPL, AGPL, SSPL — a hosted offering is planned, and these foreclose it.
* **No licence = ideas only.** Never code, never vendored text.
* Vendored code keeps its upstream copyright notice in `THIRD_PARTY.md`.
* **The verified verdicts below are cited, never re-litigated.**

**A correction the drafts carried and this spec fixes:** the research brief described Servo as having a Python backend. It does not — Servo is TypeScript throughout (Next.js 15, React 19, Prisma 6). This inverts one reusability verdict, and the tables below state the corrected one.

### 10.1 Claude Code ecosystem — SKILL.md, plugins, MCP, subagents, hooks

| | |
|---|---|
| **What it is** | The primitive set behind Claude Code: the **Agent Skills** open standard (`SKILL.md` — directory-per-skill, YAML frontmatter, six portable fields, description-in-context and body-on-invoke); **plugins** (`.claude-plugin/plugin.json`, only `name` required, component dirs `skills/`, `agents/`, `.mcp.json`, `hooks/`); **MCP** (JSON-RPC 2.0 over stdio or Streamable HTTP, tools/resources/prompts, `mcp__<server>__<tool>` naming, ~10k public servers); **subagent** definitions (markdown + frontmatter, body = system prompt, `tools:` allowlist); and **hooks** (`PreToolUse`/`PostToolUse`, stdin-JSON contract, exit 2 = block, `permissionDecision: allow \| deny`). |
| **Licence — VERIFIED** | **Agent Skills: open standard at agentskills.io — FORMAT-ONLY** (D2). No licence barrier; Servo writes its own parser. The plugin and `.mcp.json` manifest shapes are documented formats, adopted the same way. `@modelcontextprotocol/sdk` — **MIT, active — ADOPT** (D2). Reference MCP servers — MIT. Individual skills in public skill libraries carry **per-skill licences that must be checked individually**, never assumed from the repo root. |
| **Reusable as** | **Format** for SKILL.md, `plugin.json` and `.mcp.json`. **Code** for the MCP client, via `@modelcontextprotocol/sdk`. **Ideas** for hooks — Servo's approval gate is semantically `PreToolUse`, and adopting the stdin-JSON + `permissionDecision` contract would let an org's existing hook scripts run against Servo agent runs unchanged (Roadmap). |
| **First thing to mine** | Nothing to mine — this one is already scheduled as build work: `cnp-04` (SKILL.md spec compatibility), `cnp-02` (the SDK-based client), `cnp-06` (the plugin loader). The mining task proper is **a compatibility fixture corpus**: a handful of externally-authored `SKILL.md` files, each with its own licence recorded in its intake doc, that `cnp-04`'s lenient parser must accept. That is `cnp-09`, Roadmap. |
| **Do not adopt** | Hooks-in-plugins, LSP servers, themes, `bin/` (PATH injection), and `command`-source installs. `command` is code execution and is permanently out (§7). |

### 10.2 Paperclip — `paperclipai/paperclip`

| | |
|---|---|
| **What it is** | Open-source, self-hosted platform for managing *teams* of AI agents as a company: org chart, initiatives → projects → milestones → issues, heartbeat-based execution, cascading budgets, and a four-layer MCP access-governance model (Applications → Connections → Catalog Entries → Profiles & Bindings). Node.js + React + PostgreSQL, pnpm/TypeScript monorepo. |
| **Licence — VERIFIED** | **MIT, © 2025 Paperclip AI — ADOPT. Code is vendorable with attribution** (D2); copied portions keep the copyright notice and licence text in `THIRD_PARTY.md`. |
| **Reusable as** | **Ideas** primarily, and **code** where a specific service maps cleanly. The standout artefact is `doc/MCP-ACCESS-GOVERNANCE.md` (~30KB) and its distinction: "profile says can this agent *see* the tool; policy says is this exact *call* allowed right now." |
| **First thing to mine** | **Trust rules** — promoting a named-human approval into a standing allow keyed on schema + canonical argument hash, auto-reverting on drift. It removes repeat-approval fatigue without widening scope, and it layers onto Servo's named-approver spine rather than replacing it. Second: their **409 `approval_required` + retry-with-`approvedActionRequestId`** wire contract, which is the clean answer to "what should an MCP caller get back when a tool needs a human". Both are Roadmap items in §6.8; the intake doc is written when a mining tick is available. |
| **Do not adopt** | Their **skill posture**: skills are open by default with permissions as opt-in *restrictions*, and fine-grained policy is an enterprise upsell. Servo's deny-by-default is stronger and is not traded away. Also note their own `/mcp` endpoint explicitly bypasses their profile/policy stack — the exact class of defect `p0-01` closes here. Their plugin SDK runs out-of-process workers, which breaks Servo's single-process constraint. |

### 10.3 deepseek-harness — `deepseek-ai/deepseek-harness`

| | |
|---|---|
| **What it is** | "Everything is a Plugin" (`dsh`) — an agent harness where the agent loop itself is a plugin. TypeScript pnpm monorepo on a vendored copy of the Cordis plugin framework. Tools are plugins exposing plain JSON-Schema parameter objects, introspected at runtime rather than declared statically. Extensive docs: `tool-catalog.md`, `tool-execution-pipeline.md`, `capability-seams.md`, `defensive-patterns.md`. Explicitly a **developer preview** — "correctness over compatibility", no backward-compatibility guarantee for on-disk formats. |
| **Licence — VERIFIED** | **MIT, © 2026 — ADOPT-WITH-CARE. Pin a commit** (D2). The pinned SHA goes in the intake doc; unpinned tracking is not permitted given the promised breaking changes. |
| **Reusable as** | **Ideas**, and — with the language correction above — *potentially* code, since it is TypeScript like Servo. But it is tightly coupled to Cordis contexts and its tool schemas only exist after booting a plugin inside one, so there is no static integration-definition file to import and no cheap lift. Treat as ideas-first; any code lift is a separate, PR-reviewed decision with the SHA recorded. |
| **First thing to mine** | The **"model-visible ⟺ logged" invariant**: anything that reaches the model must be reconstructable from the session log. This is precisely the property `p0-01` establishes for the MCP surface (`McpCall` rows for executed *and* refused calls) and precisely the property the engine already has via `AgentStep`. The mining task is to audit Servo's remaining surfaces against the invariant and file what fails — the KB retrieval path is the obvious candidate. Second: their tool-execution pipeline's separation of resolve → authorise → execute → record, which is the shape `executeMcpToolCall` should keep as it grows. |
| **Do not adopt** | Cordis, the plugin-discovery-by-GitHub-topic mechanism, and any on-disk format from a developer preview that promises to break it. |

### 10.4 hermes-agent — `NousResearch/hermes-agent`

| | |
|---|---|
| **What it is** | A self-improving personal agent: creates skills from experience, searches its own past sessions, subagent delegation, cron scheduler, multiple terminal backends, model-agnostic. Python core with Node/TUI components; ~171 tool modules under `tools/` plus `registry.py` and `schema_sanitizer.py`. Full MCP support including OAuth manager, schema cache and a stdio watchdog. Its skills are explicitly compatible with the agentskills.io open standard, with a public skills hub. |
| **Licence — VERIFIED** | **MIT, © 2025 — ADOPT** (D2). Code lifting is permitted with attribution in `THIRD_PARTY.md`. |
| **Reusable as** | **Format** — direct and free: it targets the same SKILL.md standard `cnp-04` adopts, so Servo's desk procedures and its skills become interoperable with no work beyond `cnp-04`. **Ideas / ported patterns for code** — it is Python and Servo is TypeScript, so nothing lifts verbatim; the value is in the design of `approval.py` / `clarify_gateway.py` (human-gate patterns that match Servo's approval flow), `mcp_schema_cache.py` (which is the hash-and-re-quarantine story in §6.3), `mcp_stdio_watchdog.py` (relevant only when stdio transport leaves Roadmap), `path_security.py`, `schema_sanitizer.py`, and the skill linter / ledger / provenance modules. |
| **First thing to mine** | The **skill linter and provenance modules**, against `reb-05`. Servo's distillation writes `Skill.sourceTicketId` and nothing else; a lint that catches malformed or over-long distilled skills before an admin ever sees them is the natural next layer, and hermes has a working design for it. Second, once `cnp-04` lands: their **skills hub content** as compatibility fixtures — per-skill licence checked individually, as always. |
| **Do not adopt** | Its multi-backend terminal execution (Docker/SSH/Modal/sandbox spawning) — Servo is one container, one process. Its cron scheduler — Servo has no internal scheduler by design; background work is fire-and-forget or an external caller hitting an endpoint. |

### 10.5 gorkbot — **UNVERIFIED**

| | |
|---|---|
| **What it is** | **Not established.** The research pass could not confidently identify which project the owner means, and this spec does not invent one. Candidates found, recorded as candidates only: an exact-name GitHub repo with near-zero adoption and unknown authorship; and the possibility that "gorkbot" is a misspelling of a proprietary commercial assistant, which would be ideas-only and unusable as code either way. No description of any candidate is asserted here as Servo-relevant. |
| **Licence — UNVERIFIED** | Unknown, because the project is unidentified. A licence attached to a candidate repo is not a verdict about "gorkbot"; per D2 it **stays UNVERIFIED unless the research brief says otherwise**, and it does not. |
| **Reusable as** | Nothing, at present. |
| **First thing to mine** | **Nothing.** This target is **blocked pending an owner answer**: which repository is gorkbot? Until that line appears under "Questions for the owner", **no mining tick may be spent on it**, no intake doc is created for it, and no claim about it appears in any doc, commit message or user-visible surface. If the owner names a repo, it enters `docs/integrations/` through the ordinary intake template, starting with the adopt-first licence stage like every other candidate. |

### 10.6 Mining rotation

The rotation in `docs/integrations/README.md` orders the targets by expected yield against what is already built, and it is the order above minus the blocked one: **Claude Code ecosystem fixtures → Paperclip (trust rules, then the 409 contract) → hermes-agent (skill lint/provenance) → deepseek-harness (audit-invariant sweep)**. Each intake doc records, in this order: the adopt-first licence verdict with its source, what class of reuse is permitted (code / format / ideas), the specific first thing to mine, the pinned commit where one applies, and what is explicitly *not* being taken. An intake doc is not an implementation; it is the input to a future backlog item, and it never changes a policy default on its own.

---
