# Positioning canon

The single source of truth for what Servo may claim in public.

`spec.md` §13 owns the *rule* — public claims are code-verified, and a claim
changes in the same item as the behaviour it describes. This file is the
*canon* that rule points at: the one-liner, the boilerplate paragraph, the
claims ledger, the machine-readable banned-phrases block that
`scripts/claims-audit.mjs` (`reb-07`) reads, and the verbatim landing-page
drop-in blocks.

**Every TRUE-TODAY row below was re-verified against the source on
2026-08-28 by readers that were instructed to disprove it.** Several rows are
deliberately narrower than the README's phrasing of the same feature; where
the two disagree, this file is right and the README is the thing to fix. The
gap is recorded as a dated owner question in `spec.md` §14.

**The landing page lives in a separate repository (`servoai-site`) and its
changes are OWNER-APPLIED MANUALLY. The autonomous loop never commits
there.** Pages serves `main` in that repository and its deploy flow has
silently reverted a `main`-side commit before. When an item changes a claim
that reaches the landing page, it ships the exact replacement text under
"Landing drop-ins" below and files a dated owner action under "Open
questions for the owner" in `spec.md`; the item stays `review` until the
owner has applied it by hand.

---

## The one-liner

> The open-source desk where humans and AI agents work one queue — and every
> resolved ticket can become a skill your AI runs next time.

That is the canonical form. The three surfaces carrying it today carry three
different strings, and this file does not pretend otherwise:

- `package.json` has the whole sentence with an ASCII hyphen for the dash, plus
  a second sentence — "Self-host it, bring your own key."
- The README's opening paragraph ends with the second half of it: "Humans and
  AI agents work one queue — and every resolved ticket can become a skill your
  AI runs next time." The opening clause is not there.
- The banner tagline in `docs/assets/banner.svg` is shortened to fit the
  artwork: it drops the "and" and stops at "can become a skill".

The load-bearing half is the second one, and specifically the word *can* — the
ROADMAP row below turns on it, because the ticket-to-skill path is manual. A
surface with room for the whole sentence should carry the canonical form; the
three are not verbatim-aligned today, which is filed as an owner question
rather than fixed here (this item's scope is this file).

The title of `spec.md` is the **destination**, not a claim. It describes what
the backlog is building toward and **must not appear on any user-visible
surface** until the behaviour behind it exists; the phrase is on the banned
list below for exactly that reason.

## Boilerplate paragraph

> Servo is where your company's operational knowledge surfaces (tickets, from
> email, the web or the API), where it gets applied (AI agents working real
> tools, with a named human deciding the actions the desk has gated), and
> where it gets captured — procedures written as `SKILL.md` documents the
> resolver loads before it acts, and a QA pass that is told which of them the
> run actually opened. The result is a map of how your company works, built
> one ticket at a time.

Note the two deliberate hedges. "the actions the desk has gated" — not
"anything risky", because risk level and the approval flag are independent
(see the ledger). "is told which of them the run actually opened" — not
"catches every ignored procedure", because reading a skill is advisory.

---

## Claims ledger

TRUE-TODAY rows cite the code that proves them. A claim moves from ROADMAP to
TRUE-TODAY only in the same commit that ships the behaviour, never a day
earlier.

### TRUE-TODAY

| Claim | Evidence |
|---|---|
| Humans and AI agents work one ticket queue. One `Ticket` model, one list, one timeline; assignment moves a ticket between a human and the AI in both directions. | `src/app/tickets/page.tsx` (`assigneeIsAi`), `src/app/api/tickets/[id]/route.ts`, `src/lib/ai/tools/ticket.ts` (`escalate_to_human`) |
| A tool whose policy sets *requires approval* pauses the run before it executes, raises an approval, and resumes from persisted state once a human decides. The deciding user's id is recorded on the approval, and HIGH-risk decisions are admin-only. | `src/lib/ai/engine.ts`, `src/app/api/approvals/[id]/route.ts`, `src/lib/permissions.ts` |
| Risk level and the approval flag are **independent** policy columns. Four built-ins ship gated — `execute_ops_sql`, `cloud_apply_deployment`, `github_edit_file`, `github_merge_pr`. `reset_password`, `github_create_repo` and `github_open_pr` ship MEDIUM-risk and **ungated by default**, and an admin can change any of it. | `src/lib/ai/tool-policies.ts`, `tests/fixtures/policy-baseline.json` |
| Approval-gated and disabled tools are withheld from the MCP server's `tools/list`, and refused again at the execute site by a policy read that does not trust that listing. Every `tools/call` writes exactly one `McpCall` row — executed, refused or thrown. | `src/lib/mcp.ts` (`getMcpTools`, `executeMcpToolCall`), `tests/mcp-approval-gate.test.ts` |
| Procedures are written as `SKILL.md` documents. Four ship git-tracked in `skills/` and seed the database once at bootstrap; the resolver's prompt lists the catalogue and instructs it to load the relevant body through the `read_skill` tool before acting. | `skills/`, `src/lib/skill-format.ts`, `src/lib/bootstrap.ts` (`syncSkills`), `src/lib/ai/tools/skills.ts` |
| When QA is enabled and a run executed at least one MEDIUM- or HIGH-risk tool, the reviewer is told which applicable skills the run did and did not open; a FAIL verdict reopens the ticket and reassigns it to a human. | `src/lib/ai/engine.ts` (`runQaReview`, `skillReviewSection`) |
| An admin can turn a resolved ticket into a skill by hand, and the resolver reads it on the next matching ticket. | `src/app/api/skills/route.ts`, `src/components/skills/SkillsManager.tsx` |
| The desk searches its own past tickets before acting: a lexical query plus in-memory ranking that favours tickets which reached an outcome. No embeddings, no vector store, no configuration beyond the default-enabled tool policy. Another requester's name and email are withheld unless the past ticket is the same person's. | `src/lib/ai/tools/history.ts`, `src/lib/ai/ticket-history.ts`, `src/lib/ai/prompts.ts` |
| Resolver runs record each model turn, tool call, tool result and approval request as an `AgentStep` row, and the ticket UI replays them verbatim. | `AgentRun` / `AgentStep` in `prisma/schema.prisma`, `src/lib/ai/engine.ts` |
| A role and permission matrix gates the app's API routes, and the requester-facing reads — the ticket list, the ticket detail and attachments — are scoped to the requester's own tickets. Scoping is applied per route, not by a global filter. | `src/lib/permissions.ts`, `src/app/api/tickets/route.ts`, `src/app/api/tickets/[id]/route.ts`, `src/app/api/attachments/[id]/route.ts` |
| An admin-managed egress allowlist constrains outbound tool traffic. The web tools (`fetch_url`, `take_screenshot`) and admin-defined HTTP integrations resolve the host first, refuse loopback, private, CGNAT and link-local addresses, and re-check each redirect. | `src/lib/egress.ts`, `src/lib/ai/tools/web.ts`, `src/app/api/settings/route.ts` |
| Self-hostable and MIT-licensed. Bring your own key (Anthropic, Z.AI GLM, or any OpenAI-compatible endpoint), or run entirely offline on the deterministic mock provider, which is the default when no key is configured. SSO against any OIDC provider. | `LICENSE`, `src/lib/ai/settings.ts`, `src/lib/ai/provider.ts`, `src/lib/ai/mock.ts`, `src/lib/authjs.ts` |
| Secrets stored through Settings are encrypted at rest with AES-256-GCM **when `SERVO_ENCRYPTION_KEY` is set**. Without that variable they are stored in plain text, and the docs say so. | `src/lib/secret-store.ts`, `SECURITY.md` |
| One container and one volume, holding two embedded databases: the application database and a separate sandboxed ops database that the AI SQL tools operate on. *(Transitional — `db-01` replaces this row in the same commit as the PostgreSQL cutover.)* | `docker-compose.yml`, `scripts/docker-entrypoint.sh`, `Dockerfile` |

### ROADMAP

Nothing here may be stated in the present tense on any user-visible surface.

| Claim | Status | Note |
|---|---|---|
| A company knowledge base: uploading files, ACL-filtered retrieval, cited answers | ROADMAP (`kb-*`) | Nothing today ingests uploaded documents. There is no document, chunk or embedding model, no upload endpoint, no per-user grants and no citation machinery. The only documents read into the database are the repo's own Markdown procedures and agent profiles. |
| PostgreSQL with `pgvector`, and row-level security as a backstop | ROADMAP (`db-01`, `db-08`, `kb-15`) | The datasource has not been cut over. |
| Connecting to external MCP servers, and installing plugin bundles | ROADMAP (`cnp-02`, `cnp-06`) | Servo is an MCP **server**. It is not an MCP client, and there is no bundle loader. |
| Distilling a resolved ticket into a draft skill automatically | ROADMAP (`reb-05`) | Today an admin writes the skill from the ticket timeline. The one-liner's "can become a skill" describes that manual path, which is why it says *can*. |
| An interchange surface for sharing skills and bundles between installs | ROADMAP (`cnp-06`) | If it ever ships it ships under a neutral name. It is never described as a marketplace — not as a page, a nav entry, a permission action or a product noun. |
| Knowledge ingestion from Slack, Drive or a wiki; anything worded as "learns automatically" | ROADMAP (unscheduled) | No item schedules it. |
| A Servo-operated service that customers sign in to, run by us | ROADMAP (planned, unscheduled, unnamed) | **One is planned and it does not exist.** No surface may state or imply that it does, and no surface may be worded so that launching one would make the old wording a lie. |

### Claims that must not be made

These are not "not yet true" — they are wordings the code will not support even
after the roadmap lands, and they have appeared in drafts before.

- *"Every risky action waits for a human."* Risk level does not gate anything;
  the approval flag does, and three MEDIUM-risk built-ins ship ungated.
- *"Complete audit of every tool call."* Resolver steps and `McpCall` rows are
  two separate trails with different coverage, and neither is asserted to be
  exhaustive over every code path.
- *"Versioned procedures"* in the sense of retrievable history. Skill bodies
  live in a mutable row; the only history is git over the four seed files.
- *"Enforced procedures."* The resolver is *instructed* to read the relevant
  skill. Nothing makes it.
- Absolutes about where the data goes — the "never leaves your ..." family.
  Servo calls whatever model endpoint the operator configures, and the web
  tools fetch whatever the allowlist permits.

---

## Banned phrases

`scripts/claims-audit.mjs` does not exist yet — `reb-07` creates it, and this
block is the input it is written against. Everything
the scanner needs is **inside** the fence — the scan set, the matching rules,
the block's own self-exclusion, the allow list and the path- and
section-scoped exemptions. The prose after the fence explains the choices; it
carries no rule of its own, and a scanner that reads only the fence is
correct.

```banned-phrases
# The files this policy is enforced against. Anything not listed is out of
# scope. docs/*.md is NOT recursive: docs/design/*.md is design rationale, not
# user-visible copy.
scan:
  - README.md
  - SECURITY.md
  - ROADMAP.md
  - package.json
  - docs/*.md

# Files deliberately outside the scan, and why.
unscanned:
  - path: spec.md
    reason: the work order, not user-visible copy; it names what it is building
  - path: docs/design/*.md
    reason: design rationale, not user-visible copy

# How a phrase is matched.
matching:
  wordBoundary: true      # a hyphen counts as a boundary, so self-hosted DOES
                          # match "hosted" and is rescued by allow:, not by
                          # the prefix
  caseInsensitive: true   # "Self-hostable" matches the allow entry
                          # "self-hostable"

# The region between this fence's delimiters is excluded from the scan, in
# every file. The block has to name the phrases it bans; a canon that trips
# its own linter is useless. This is a rule, not a remark: without it,
# docs/POSITIONING.md (which is in scan:) fails on every phrase below.
selfExclude:
  fence: banned-phrases
  appliesTo: all-scanned-files

# Phrases banned on every user-visible surface: present-tense claims that are
# false today, service-offering implications, reverse lock-ins, and the
# storage engine we are moving off. "control plane" is banned in every tense,
# which is wider than the minimum the item asks for and deliberately so.
banned:
  - hosted
  - cloud version
  - sign up
  - SaaS
  - marketplace
  - control plane
  - sqlite
  - sqlite-vec
  - FTS5
  - never leaves your network

# Allowed despite containing a banned phrase: these describe how the operator
# runs Servo, or name a third party's endpoint. They are capability language,
# not identity language.
allow:
  - self-hosted
  - self-hostable
  - self-hosting
  - Self-host it
  - SaaS endpoint

# Path-scoped exemptions. Each is either retired by a named item, or permanent
# with a stated reason.
exempt:
  # One occurrence, in the ROADMAP row that names the anti-pattern. Counted
  # outside the fence, so the two occurrences inside it do not consume the
  # allowance.
  - phrase: marketplace
    reason: the canon states the one ROADMAP row that forbids it as a product noun
    paths:
      - docs/POSITIONING.md
    sections:
      - "ROADMAP"
    maxOccurrences: 1
  # Recorded for the day spec.md enters a scan set. It is in unscanned: today,
  # so this entry is policy, not enforcement - which is why it is scoped to the
  # one section rather than to the whole file.
  - phrase: marketplace
    reason: the roadmap section may name what v1 is not building
    paths:
      - spec.md
    sections:
      - "12. Roadmap — explicitly out of v1"
    enforced: false
  - phrase: sqlite
    until: db-01
    reason: transitional - db-01 rewrites the present-tense storage claim in
      every file below, including this ledger's own preamble
    paths:
      - README.md
      - SECURITY.md
      - ROADMAP.md
      - docs/ARCHITECTURE.md
      - docs/CONTRACT.md
      - docs/PORTING-LEDGER.md
  # Permanent, and scoped to sections rather than whole files: the porting
  # ledger's dated history is exempt, its present-tense preamble and its
  # forward-looking Candidates section are NOT - those are covered above and
  # expire with db-01.
  - phrase: sqlite
    reason: permanent - a migration guide and a marked history section describe
      what was, not what is
    paths:
      - docs/migrating-to-postgres.md
  - phrase: sqlite
    reason: permanent - the marked history section of the porting ledger
    paths:
      - docs/PORTING-LEDGER.md
    sections:
      - "Shipped"
      - "Rejected"
```

Why the block is shaped that way:

- **`selfExclude` is a key, not a convention.** This file is in `scan:` and the
  fence names every phrase it bans, so without an in-block exclusion rule the
  canon fails its own linter roughly ten times over. Putting it in the fence is
  what makes "the block excludes itself" checkable rather than aspirational.
- **The allowance is scoped AND counted.** With `selfExclude` applied, this
  file's occurrences of the interchange-surface word drop to one. `sections:
  ["ROADMAP"]` pins that one to the ROADMAP subsection of the ledger, so the
  same word in the boilerplate paragraph or a landing drop-in would still fail;
  `maxOccurrences: 1` then stops the ROADMAP section itself from growing more.
- **`spec.md` carries a section-scoped entry even though it is unscanned.** The
  policy is that the work order may name the anti-pattern only in its Roadmap
  section. Recording that as `enforced: false` keeps the rule visible and ready
  if `spec.md` ever enters a scan set, instead of implementing "only its Roadmap
  section" as "all of it, forever, because nobody looks."
- **The porting ledger is exempt by section, not as a file.** Only its `Shipped`
  and `Rejected` sections are marked history, and those are where all but one of
  its storage-engine mentions live. The remaining one is in its preamble, which
  states the storage engine in the present tense — that is not history, so it
  gets no permanent exemption; it is covered by the transitional entry and
  becomes a violation the day `db-01` retires that entry. That is the intended
  pressure: `db-01` has to rewrite that line. (Its `Candidates` section is
  forward-looking and likewise unexempted, but as of today it contains no banned
  phrase, so nothing there is pending.)
- **`docs/migrating-to-postgres.md` does not exist yet.** `db-07` creates it;
  until then the path matches nothing, which is harmless.
- **One deliberate widening.** The ban on the spec's title carries no tense
  qualifier, so it catches the phrase in any tense — wider than the minimum
  required, and safe. This file carries no occurrence of it outside the fence,
  so it needs no exemption.

---

## Landing drop-ins — OWNER-APPLIED MANUALLY

The loop never commits to `servoai-site`. Each block below is the exact
replacement text; apply them verbatim.

**`<title>`** — applies today:

```
Servo — the open-source AI service desk
```

**`<meta name="description">`** — applies today:

```
The open-source desk where humans and AI agents work one queue — and every resolved ticket can become a skill your AI runs next time. Self-host it, bring your own key.
```

**`og:title`** — applies today:

```
Servo — the open-source AI service desk
```

**`og:description`** — applies today:

```
Humans and AI agents work one ticket queue. Gated actions wait for a named human, every run keeps its audit trail, and every resolved ticket can become a skill your AI runs next time. Self-host it, bring your own key.
```

**Hero sub-line** — applies today:

```
Humans and AI agents work one queue. The actions you gate wait for a named human, and every resolved ticket can become a skill your AI runs next time.
```

*Pending drop-ins: none.* `db-01` will ship the replacement for the landing
page's infrastructure line ("two containers — the app and its PostgreSQL — on
one volume") together with a dated owner action in `spec.md` §14; it stays
`review` until the owner has applied it.
