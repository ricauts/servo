# Positioning canon

The single source of truth for what Servo may claim in public. `spec.md` §13
owns the rule ("public claims are code-verified, and a claim changes in the
same item as the behaviour it describes"); this file is the canon it points
at: the one-liner, the boilerplate paragraph, the claims ledger, and the
machine-readable banned-phrases block `scripts/claims-audit.mjs` (`reb-07`)
reads.

**The landing page lives in a separate repo (`servoai-site`) and its changes
are OWNER-APPLIED MANUALLY. The autonomous loop never commits there.** When
an item changes a claim that reaches the landing page, it ships the exact
drop-in replacement block in this file (see "Landing drop-ins" below) and
files a dated owner action under "Questions for the owner" in `spec.md`.

## The one-liner

> The open-source desk where humans and AI agents work one queue — and every
> resolved ticket can become a skill your AI runs next time.

Ships as-is on every surface (README opening, `package.json` description,
banner tagline). The control-plane headline ("the AI control plane for your
company") is the destination and the title of the spec — it is **not
claimable in public**; the allowed interim sentence for the audit claim is
the ledger row below, verbatim.

## Boilerplate paragraph

Servo is where your company's operational knowledge already surfaces (tickets,
from email, web or API), where it gets applied (agents working real tools,
with a named human approving anything risky), and where it gets captured —
procedures versioned as `SKILL.md` files the AI reads before it acts, and a
QA pass that catches an agreed procedure being ignored. The result is a
living map of how your company works, built one ticket at a time.

## Claims ledger

Every TRUE-TODAY row cites the code path that proves it. A claim moves from
ROADMAP to TRUE-TODAY only in the same commit that ships the behaviour.

| Claim | Status | Evidence |
|---|---|---|
| Humans and AI agents work one ticket queue | TRUE-TODAY | core product; `src/app/tickets/` |
| Every risky action waits for a named human | TRUE-TODAY | `src/lib/ai/engine.ts` (approval gate); MCP serves no approval-gated tool, `src/lib/mcp.ts` |
| Every tool call — desk run or external MCP client — is policy-checked at the execute site and recorded | TRUE-TODAY | `executeMcpToolCall` in `src/lib/mcp.ts` (`McpCall` row per call, executed or refused); engine per-call gate, `src/lib/ai/engine.ts`; `tests/mcp-approval-gate.test.ts` |
| Procedures are versioned `SKILL.md` files the AI reads before acting | TRUE-TODAY | `skills/`, `src/lib/skill-format.ts`, `src/lib/ai/tools/skills.ts` |
| QA catches an agreed procedure being ignored | TRUE-TODAY | skill-adherence review, `src/lib/ai/engine.ts` |
| The desk searches its own resolved tickets before acting | TRUE-TODAY | `src/lib/ai/tools/history.ts` — no vector store, works offline |
| Full audit trail of engine runs | TRUE-TODAY | `AgentRun` / `AgentStep` in `prisma/schema.prisma` |
| Self-hostable, MIT, BYOK, offline mock mode, SSO, secrets encrypted at rest | TRUE-TODAY | `LICENSE`; `src/lib/ai/settings.ts`; `src/lib/ai/mock.ts`; `src/lib/authjs.ts`; `src/lib/secret-store.ts` |
| Admin egress allowlist for outbound tool traffic | TRUE-TODAY | `src/lib/egress.ts` |
| One container, one embedded database on a volume | TRUE-TODAY (transitional — until `db-01`) | `docker-compose.yml`, `scripts/docker-entrypoint.sh`; `db-01` replaces this row in the same commit as the cutover |
| Company knowledge base: upload files, ACL-filtered retrieval, cited answers | ROADMAP | the `kb-*` items — nothing ingests documents today |
| Knowledge ingestion from Slack / Drive / wikis; "learns automatically" | ROADMAP (unscheduled) | — |
| Automatic (model-drafted) ticket → skill distillation | ROADMAP | deterministic prefill is `reb-05`; the model-drafted variant stays Roadmap |
| MCP server connections and plugin bundles | ROADMAP | `cnp-02`, `cnp-06`; `src/lib/mcp.ts` is a server, not a client |
| Packs / skills interchange surface | ROADMAP | ships as "Packs" at `/packs` — never as a marketplace |
| A cloud offering of Servo, run as a service | ROADMAP (planned, unscheduled, unnamed) | one is planned and does not exist; nothing may state or imply otherwise |

## Banned phrases

`scripts/claims-audit.mjs` reads this block. Matching is word-boundary and
context-aware: an `allow` entry permits its phrase even when a `banned`
phrase is a substring of it ("self-hosted" never trips "hosted"). This
fenced block excludes itself from its own scan. `exempt` entries scope a
phrase's ban away from named paths — each carries the item that will retire
it.

```banned-phrases
# Banned on every user-visible surface: present-tense product claims that
# are false today, service-offering implications, and reverse lock-ins.
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

# Allowed despite containing a banned substring: capability language, not
# identity language; and third-party endpoints a custom tool may call.
allow:
  - self-hosted
  - self-hostable
  - Self-host it
  - SaaS endpoint

# Path-scoped exemptions, each retired by the item that owns the rewrite.
exempt:
  - phrase: marketplace
    paths:
      - docs/POSITIONING.md   # the canon quotes the one ledger row that may say it
  - phrase: sqlite            # transitional: db-01 rewrites every file below
    until: db-01
    paths:
      - README.md
      - SECURITY.md
      - ROADMAP.md
      - docs/ARCHITECTURE.md
      - docs/CONTRACT.md
      - docs/PORTING-LEDGER.md
      - docs/POSITIONING.md   # the transitional ledger row above
  - phrase: sqlite            # permanent: the migration guide and marked history
    paths:
      - docs/migrating-to-postgres.md
      - docs/PORTING-LEDGER.md
```

The `marketplace` allowance covers exactly one place outside this file's
banned block: the ROADMAP ledger row above ("Packs / skills interchange
surface — never as a marketplace"). It is never a product-surface name, a
nav entry, a permission action or a page. (`spec.md`'s own Roadmap section
is not scanned by the audit and may use the word.)

## Landing drop-ins — OWNER-APPLIED MANUALLY

The loop never commits to `servoai-site`. When a claim change reaches the
landing page, the exact replacement text lands here and the owner applies it
by hand. Current drop-ins:

**Title / og:title** (applies today):

```
Servo — the open-source AI service desk
```

**Meta description / og:description** (applies today):

```
The open-source desk where humans and AI agents work one queue — and every
resolved ticket can become a skill your AI runs next time. Self-host it,
bring your own key.
```

**Hero sub-line** (applies today):

```
Humans and AI agents work one queue. Every risky action waits for a named
human; every resolved ticket can become a skill your AI runs next time.
```

*Pending drop-ins: none. `db-01` will ship the "Two containers — the app
and its Postgres (pgvector) — on one volume" replacement for the landing
infrastructure line in this section, together with a dated owner action in
`spec.md`.*
