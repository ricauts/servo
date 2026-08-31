# Porting ledger

A running record of capabilities brought into Servo from other projects —
mainly [Paperclip](https://github.com/paperclipai/paperclip) (MIT) and the
Claude Code ecosystem — so no run repeats work already done, and so every
rejection stays rejected for a stated reason.

**How to read this file** *(header added 2026-08-28 by `hyg-02`)*

This ledger is part live rules and part history, and the two halves are read
differently.

- **`## Shipped` and `## Rejected` are the history sections.** Every entry in
  them is true **as of its own entry date**, which is the date in its heading,
  and entries are **never rewritten** to match how the repository looks later.
  An entry describing what Servo was in August 2026 stays as written even once
  that is no longer the case; correcting it would destroy the only record of
  what a past run actually decided and why. These two headings are what
  `docs/POSITIONING.md`'s banned-phrase exemptions and the `db-10` backlog item
  cite as "the marked history section of the porting ledger", by these exact
  names. Rename either heading and the exemption stops resolving —
  loudly, not silently: `scripts/claims-audit.mjs` validates that every section
  an exemption names exists, and fails the build naming the heading it could
  not find. Rename one only together with the canon entry that points at it.
- **Everything outside those two sections is live and present-tense**: the
  intro above, the rules block below, and `## Candidates for a future run`.
  Those are maintained, and a claim in them that stops being true is a defect.

One exception is on record, and it names itself in full. `hyg-02` made exactly
three edits inside the history sections, all on the same subject — a filename
this ledger cites:

1. `THIRD-PARTY.md` → `THIRD_PARTY.md`, the spelling the adopt-first gate uses,
   at both sites that reference it.
2. The removal of a parenthetical asserting that the file does not exist, which
   `hyg-02` itself falsified by creating it.
3. On that same sentence, the surrounding predicate was reworded from "is
   therefore unchanged" to "therefore gains no entry", because with the
   parenthetical gone the original read as a claim about a file that now
   exists. This one *is* a rewrite of a line that was accurate on its entry
   date, and it is recorded here rather than absorbed silently.

Nothing else in any dated entry was touched: the finding, the reasoning and the
attribution verdict of every entry stand exactly as written. A correction of
this kind names itself here; it is not a licence to revise history, and edit 3
is the outer bound of what "correcting a citation" is allowed to reach.

**Rules this ledger enforces**

- Read this file and `gh pr list --state all` before starting. Never redo an
  item recorded here, and never restart work an open PR already covers.
- One high-value item per run, shipped end to end (code + tests + docs).
- Copied code keeps its copyright notice and is recorded in `THIRD_PARTY.md`
  with the upstream path. Reimplementing an observed *design* needs no
  attribution — but say so here.
- Nothing lands that assumes Paperclip's pnpm monorepo, its Node+React split
  or its database. Servo is one Next.js app on Prisma + PostgreSQL.
- No new mandatory environment variables. Anything configurable is
  configurable from the existing Settings/Integrations UI, with defaults that
  work on a fresh install, and documented in `docs/USER-GUIDE.md`.

## Shipped

### 2026-08-14 — Desk memory: `search_tickets`, `read_ticket`, `requester_history`

**What.** Three read-only tools (`src/lib/ai/tools/history.ts`) that let a
resolver consult the tickets this desk has already handled before it invents
an answer, plus the pure ranking/redaction core in
`src/lib/ai/ticket-history.ts`.

**Where the idea came from.** Paperclip's MCP server and its
`packages/skills-catalog` progressive-disclosure pattern — a cheap catalogue
you search first, with the expensive full read behind a second call. Servo's
version is the same shape: `search_tickets` returns ranked one-liners with the
recorded outcome, `read_ticket` loads one in full. Claude Code's own
search-then-read tool pairing is the other half of the influence.

**Attribution.** None required — no upstream code was copied. Both the
ranking (term stemming, per-field weighting, settled-ticket bonus) and the
redaction rule are Servo's own, written against Servo's schema.

**Why this and not something else.** The resolver had no memory: every ticket
started from zero even when the same fault had been solved last month. This
is the ROADMAP's "knowledge for agents" goal at a fraction of the cost — no
embedding model, no vector store, no new dependency, and it works offline on
the SQLite that ships with the app.

**Design decisions worth keeping.**

- *Ranking in memory, not SQL.* SQLite has no relevance scoring and Servo
  ships without an FTS extension so self-hosting stays a one-liner. The tools
  fetch a bounded candidate window (60 rows) and score it in TypeScript, which
  also makes the ranking unit-testable.
- *Requester redaction.* Precedent is useful; other people's identities are
  not. `mayRevealRequester()` reveals a name/email only when the past ticket
  belongs to the same requester as the one being worked. With no ticket in
  context (an MCP caller) everything is withheld.
- *The MCP server lost its naive `search_tickets`.* `src/lib/mcp.ts` had its
  own unranked title/description LIKE search. It was deleted so the registry
  tool is served instead — external clients now get the same ranked,
  redaction-aware results the agents get.
- *Upgrades stay non-destructive.* `ensureToolPolicies()` backfills the three
  LOW-risk policy rows, so the default resolver gains the tools on upgrade.
  Specialists that an admin has edited are never rewritten, so their tool
  allowlists must be extended from **Agents → Tools** — documented in the user
  guide. The bundled `agents/*.md` were updated for fresh installs.
- *The mock provider exercises it.* `MockProvider` reads the tool list it is
  handed and opens its script with `search_tickets` when the tool is granted,
  so the offline demo shows precedent-checking without an API key.

**Validated.** `npm ci`, `npm run setup` (fresh + re-run on a populated
database: 21 policies backfilled, 0 profiles overwritten), `npm run typecheck`,
`npm test` (93 passing: 41 pre-existing + 52 new). End to end against a real
SQLite database through the deterministic mock provider: a resolved VPN ticket
from Ravi, a new one from Dana — the resolver called `search_tickets`, found
the precedent and its resolution note, and Ravi's name and email did not
appear in the result. The MCP surface was listed to confirm all three tools
are served.

### 2026-08-14 — Web reading behind an egress guard: `fetch_url`

**From:** Claude Code's `WebFetch` tool (fetch a URL, hand the model readable
text rather than markup) and the same search-then-read shape Paperclip uses in
`packages/mcp-server`. **Reimplemented, no code copied** — the HTML flattener,
the address classifier and the allowlist grammar are written against Servo's
own settings and tool contract, so `THIRD_PARTY.md` gains no entry.

- `src/lib/ai/tools/web.ts` — `fetch_url` (LOW, no approval; it reads and
  never writes) returns status, title and the page as text.
- `src/lib/html-text.ts` — HTML → text keeping headings, list items and link
  targets; dependency-free.
- `src/lib/egress.ts` — the guard: http(s) only, no embedded credentials,
  DNS resolution with private/loopback/CGNAT/link-local/multicast refusal,
  per-hop redirect re-checking, and an optional admin allowlist where a
  *literal* entry is the deliberate opt-in for an internal host.
- The guard also covers `take_screenshot` and admin-defined HTTP
  integrations, which previously called `fetch()` on any host the model
  produced — a real SSRF path, since ticket text arrives by email.
- Configured at Integrations → **Outbound web access**; empty by default
  (any public host), no new env vars.

Closes the ROADMAP item "Egress allowlist for custom HTTP tools".
### 2026-08-14 — Desk skills: versionable `SKILL.md` procedures + `read_skill`

**What.** A skill is what this desk has decided to **always do** about a class
of problem, written as `skills/<slug>/SKILL.md` (frontmatter `name`,
`description`, `categories`; body = the procedure) and seeded into a `Skill`
table. The resolver's system prompt carries only the catalogue — slug, scope
and description — and the body costs one call to the new **`read_skill`** tool.
Four procedures ship bundled: account lockouts, ops-database changes, shipping
a code change, and when to escalate instead of resolving.

New/changed: `src/lib/skill-format.ts` (pure parse + catalogue rendering),
`src/lib/skills.ts` (db helpers), `src/lib/ai/tools/skills.ts` (`read_skill`),
`syncSkills()` in `src/lib/bootstrap.ts`, `/api/skills` + `/api/skills/[id]`,
the **Skills** page, and the prompt/QA wiring in `src/lib/ai/{prompts,engine}.ts`.

**Where the idea came from.** Claude Code's own skills: a `SKILL.md` with
frontmatter, a name+description catalogue always in context, the body loaded on
demand. Paperclip's `skills/<name>/SKILL.md` layout and its
`packages/skills-catalog` progressive-disclosure pattern are the same shape and
confirmed it survives contact with a real product.

**Attribution.** None required — no upstream code was copied. The parser is
Servo's own (`gray-matter` + the `CATEGORIES` union), and the catalogue
ordering, the applicability rule and the QA review section were written against
Servo's schema. `THIRD_PARTY.md` therefore gains no entry.

**Why this and not something else.** It was the top "candidate for a future
run" left by the desk-memory PR, and it is the missing half of that feature:
memory is what the desk *did*, a skill is what the desk *decided to always do*.
It is also the cheapest way to make the core thesis enforceable — an admin can
now write "never reset an account for someone other than its owner" once, in a
file under version control, instead of re-editing four agent personas.

**Design decisions worth keeping.**

- *Progressive disclosure, not prompt stuffing.* Bodies never enter the prompt.
  The catalogue is `slug (scope): description`, capped at
  `SKILL_CATALOG_LIMIT` (40) with applicable skills ordered first, so the cap
  trims the irrelevant tail rather than the skill that mattered.
- *The catalogue is never advertised without the tool.* If an agent's allowlist
  withholds `read_skill`, `skillCatalogSection()` is skipped entirely — naming
  procedures an agent cannot open is worse than saying nothing.
- *`read_skill` is deliberately NOT a core tool.* Core tools are excluded from
  the MCP surface as ticket-bound; `read_skill` needs no ticket, so keeping it
  out of `CORE_TOOLS` means external MCP clients can follow the desk's
  procedures too. The cost is one checkbox per already-customized specialist on
  upgrade, documented in the user guide.
- *QA reviews against the skills that applied.* `runQaReview()` derives which
  applicable skills the run actually opened (from persisted `TOOL_CALL` steps,
  so it survives pause/resume) and hands QA that list. A procedure that gets
  ignored is caught before the ticket closes — which is the point of having
  agreed one. The section is empty when no skill applied, so QA's judgement on
  a skill-less desk is byte-for-byte unchanged.
- *A skill never overrides a gate.* Stated in the prompt section itself: the
  procedure says what to do, `tool-policies.ts` and the engine still decide
  whether the agent may.
- *Disabled means retracted.* `read_skill` refuses a disabled skill with "must
  not be followed" rather than 404-ing, and the UI steers admins to the switch
  instead of Delete, because a bundled skill returns on the next `npm run
  setup`.
- *The slug is immutable.* It is the handle `read_skill` takes and the key
  `syncSkills()` matches `skills/<slug>/SKILL.md` on; letting a rename move it
  would make the next upgrade re-create the original alongside the renamed one.
- *The mock provider exercises it.* `MockProvider` parses the catalogue out of
  the system prompt it is handed and opens its script with `read_skill`, so the
  offline demo shows procedure-checking without an API key — and a desk with no
  skills produces exactly the old script.

**Validated.** `npm ci`, `npm run setup`, `npm run typecheck`, `npm run build`,
`npm test` (81 passing: 41 pre-existing + 40 new). End to end against a real
SQLite database through the deterministic mock provider, on a fresh install: an
ACCESS ticket ran `read_skill{slug: "locked-out-account"}` as its first call,
then reset, commented and resolved, and the QA section reported
`locked-out-account — READ by the run` / `when-to-escalate — NOT read`. Re-ran
`npm run setup` on a populated database with an edited + disabled skill: 0 new
skills, the edit and the retraction both preserved. Verified the upgrade path
too — with pre-existing specialists whose allowlists predate `read_skill`, the
catalogue is correctly withheld and the run proceeds as before. `/api/skills`
exercised for create, validation failure, duplicate slug (409), rename (slug
held), delete, and a REQUESTER 403. `read_skill` confirmed served over
`getMcpTools()`, including the refusal on a disabled skill. The Skills page was
rendered in a real browser at 1400×1000.

## Rejected

- **Paperclip `packages/adapters/*`** (claude-local, codex-local,
  cursor-cloud, gemini-local, hermes…). These adapt coding-agent CLIs and
  gateways, and assume Paperclip's mutable server+UI dual registry and its
  agent-hire model. Servo's BYOK layer (`src/lib/ai/provider.ts`) already
  covers Anthropic-compatible and OpenAI-compatible endpoints from Settings,
  which is the part that pays. Revisit only if a provider needs a genuinely
  different wire protocol.
- **Paperclip `packages/plugins/*` sandbox/worker plugin system.** Worker
  isolation, a manifest format and a plugin SDK are a large surface whose
  value in Servo is already served by custom HTTP tools plus the MCP server.
  Infrastructure, not breadth.
- **Paperclip `packages/db`.** Its own schema and migration story; Servo is
  Prisma + PostgreSQL with string unions in `src/lib/types.ts` as the source of
  truth.
- **Paperclip's pnpm monorepo, its Node+React split and its `PAPERCLIP_*`
  env-var contract.** Servo is one Next.js app configured from its own UI.
- **A headless-browser "browse" tool** (navigate, click, fill) on top of
  `fetch_url` — an agent driving a real browser session is a mutation path
  with no meaningful risk level to declare, and the approval card cannot show
  a reviewer what a click will do. If it lands, it lands as HIGH with
  approval, not as an extension of a read-only reader.

- **Paperclip's skill *scripts*.** Its skills ship executable helpers next to
  `SKILL.md`. Servo skills are text on purpose: running admin-authored code
  from the database would route around the tool policy layer entirely, which is
  the one thing this product must not do. A procedure that needs to *act* names
  a Servo tool, and that tool carries a risk level.
- **Paperclip's `PAPERCLIP_*` env-var contract for skills.** It assumes agents
  are external processes woken by heartbeats. Servo's agents run in-process
  inside the resolver loop and get their context from the run, not the
  environment — and a new mandatory env var is out of bounds anyway.

## Candidates for a future run

- **Skill authoring from a resolved ticket** — "turn this run into a skill"
  from the ticket view, pre-filling a `SKILL.md` draft from what the agent
  actually did. The natural sequel now that skills exist, and it closes the
  loop with desk memory: a precedent worth repeating becomes a procedure.
- **Knowledge-gap mining on top of desk memory** — cluster the tickets where
  `search_tickets` found nothing into "write this runbook" suggestions.
- **Per-agent skill scoping** — today every enabled skill is catalogued for
  every agent that holds `read_skill`. If a desk grows past a few dozen,
  scoping skills to profiles (as `categories` scopes them to tickets) is the
  next lever.
- **`search_web`** behind the same egress guard, once a provider that does not
  need a new mandatory key can be configured from Settings (BYO search
  endpoint, the way BYOK works today).
- **Attachment reading** — `read_attachment` so an agent can use the log file
  or screenshot a requester attached, reusing the text-extraction path.
- **Egress audit** — record blocked outbound attempts on the run timeline so
  an admin can see what the desk tried to reach and decide whether to
  allowlist it.
- **Per-agent egress scope** — an allowlist per specialist rather than one
  per desk, so the frontend agent's reach differs from the security agent's.
