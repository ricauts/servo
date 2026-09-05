# Servo — User Guide

How to run a service desk with Servo day to day. For installation see the
[README](../README.md); for the security model see [SECURITY.md](../SECURITY.md).

**The core loop:** a request arrives (email, form or another agent via MCP) →
Servo triages it and an AI specialist drafts the reply and/or works the ticket
with tools → **a human approves anything that matters** → the answer goes out
and the conversation threads back onto the same ticket.

---

## 1. First-run setup

Open the app after `npm run setup` (or first Docker boot). The **setup
wizard** asks for:

- **Your name + email** — becomes the first ADMIN. That email keeps the admin
  role even after SSO is enabled.
- **SSO tenant (optional)** — any OIDC provider (Google, Entra ID, Okta,
  Keycloak…). You can also connect it later from **Integrations → Single
  sign-on**. Without SSO, Servo runs in the offline demo user-switcher mode —
  fine for evaluating, not for a network you don't trust.

After the wizard you land on a clean desk: no tickets, the three system AI
agents (Triage, Resolver, QA) and the bundled specialists ready.

## 2. Connect your environment

Everything lives in two places: **Integrations** (external systems) and
**Settings** (AI, policies, team).

### Integrations (left rail shows live status per integration)

| Integration | What it does | Minimum you need |
|---|---|---|
| **Single sign-on** | Real login for your org; requesters auto-provision on first sign-in | Issuer URL, client ID/secret; set **Allowed email domains** if your IdP accepts outside accounts |
| **Email notifications** | Ticket confirmations, resolutions, approval alerts, approved AI replies | An SMTP URL (`smtp://user:app-password@host:587`) + the enable switch |
| **Inbound email** | Mail becomes tickets; replies thread by the `#123` tag in subjects | A shared secret + your provider's webhook to `POST /api/inbound/email`, or the bundled Gmail/Workspace relay: `npm run relay` (runs `scripts/ops/imap-relay.mjs` via `scripts/ops/run-relay.ts`) |
| **GitHub** | Real repos, feature branches and PRs from tickets | A fine-grained PAT (Contents; Administration only if the AI may create repos) |
| **Azure** | Live read-only resource queries | A service principal with the Reader role |
| **Outbound webhooks** | Signed JSON events (`ticket.created`, `reply.sent`…) to your systems | An endpoint URL; verify the `x-servo-signature` HMAC |
| **Outbound web access** | Which hosts the agents' web tools and HTTP integrations may open | Nothing — public hosts are allowed and internal ones refused by default |
| **MCP server** | Lets external agents (Claude Code/Desktop…) file and search tickets and run tools | A long bearer token |

#### Outbound web access (the egress allowlist)

Tickets arrive by email, so a URL an agent opens may have been chosen by
whoever wrote in. Before any request — `fetch_url`, `take_screenshot` or a
custom HTTP integration — Servo resolves the host and refuses private,
loopback, link-local, CGNAT and cloud-metadata addresses, then re-checks every
redirect hop so a public URL cannot bounce onto an internal one.

- **Leave the list empty** (the default) and agents may read any *public*
  host. Nothing to configure.
- **Add hosts** to narrow it to those only: one per line,
  `status.example.com`, `*.docs.example.com` (the domain and its
  subdomains), or `intranet:8080` to pin a port.
- **To reach something internal on purpose**, write the host out exactly —
  a literal entry (no `*`) is also permitted to resolve to a private address.
  A wildcard never unlocks the private ranges.

Blocked calls come back to the agent as a readable refusal naming this
setting, so the run continues instead of failing.

> **Upgrading:** if a custom HTTP integration points at an internal host or
> `localhost`, add that host here or the integration starts returning
> "Blocked". Integrations aimed at public APIs are unaffected.

### Settings (same left rail — one section per concern, each with its live status)

- **AI provider (BYOK):** pick `anthropic`, `zai`, `openai`-compatible or
  `mock` (offline). Keys can come from env vars or be stored — stored secrets
  are encrypted at rest when `SERVO_ENCRYPTION_KEY` is set. **Test
  connection** validates before saving. If credentials are unusable Servo
  falls back to mock so nothing breaks.
- **API key pool:** register several named keys and assign one per
  specialist agent; the Agents page shows tokens/latency per key ("Throughput").
- **Tool policies:** per tool — enabled, risk level, and whether it
  **requires human approval**. Treat approval gates on mutating tools as a
  security boundary.
- **SLA policies:** response/resolution targets per priority; breaches
  escalate a tier automatically (schedule `POST /api/sla/scan`).
- **Team:** promote/demote roles. REQUESTERs only ever see their own tickets.

## 3. Working tickets

### Where tickets come from

- **Email** to your connected mailbox — sender becomes a requester, subject
  is the title, triage runs automatically.
- **New ticket** button, or **MCP** from another agent.

### The AI reply loop (the everyday flow)

1. When an email opens a ticket (and *Draft replies for inbound email* is on),
   the right specialist writes a reply **in the requester's language**.
2. The draft appears on the ticket **and** in **Approvals → "Reply drafts
   awaiting review"** (oldest first).
3. Review it: **edit in place**, then **Approve & send** — it posts as a
   public comment under your name and emails the requester — or **Discard**,
   or **Regenerate** (e.g. after a requester follow-up; follow-ups refresh
   pending drafts automatically).
4. The requester's answer threads back onto the same ticket by subject tag.

The dashboard's **AI replies** tile shows the acceptance rate (sent as-is vs
edited vs discarded) — your measure of how much typing the AI is saving.

### Letting the AI work the ticket

**Run AI resolver** (ticket right rail) hands the ticket to the resolver: it
investigates with read-only tools first, acts, keeps the requester posted,
and finishes honestly:

- Objective met → `resolve_ticket`.
- Tool needs sign-off → the run **pauses** and the action lands in
  **Approvals** with its input; approve to resume or reject (the agent adapts,
  never retries a rejected action).
- Objective can't be met → the agent **escalates to a human** with what it
  tried; unmet objectives are never marked resolved.
- Risky runs get an automated **QA review**; failures reassign to a human.

### Desk memory (the agent checks precedent first)

A service desk repeats itself. Before acting, the resolver searches the
tickets **your** desk has already closed and reuses what worked:

- `search_tickets` — ranked search over past tickets (title, description and
  the recorded resolution), preferring ones that actually reached an outcome.
  Filter by `category`, or to resolved tickets only.
- `read_ticket` — one past ticket in full: the request, the replies sent, the
  tools the agent used and the resolution note.
- `requester_history` — the requester's other tickets, so a third replacement
  dock in two months reads as a hardware fault, not a new request.

All three are read-only (risk **LOW**, no approval) and need no configuration
— they work on a fresh install and are backfilled on upgrade. Two things are
worth knowing:

- **Other requesters stay anonymous.** Precedent comes back with names and
  emails withheld unless the past ticket belongs to the same requester, so an
  agent cannot repeat one person's details to another. Turn a tool off
  entirely in **Settings → Tools** if you want none of it.
- **Existing specialists must opt in.** Upgrades never overwrite an agent you
  have edited, so a specialist created before this feature keeps its old tool
  list. Open **Agents → Tools** and tick the three tools to grant them; new
  installs have them from the start.

External MCP clients get the same three tools (with the same redaction) from
the Servo MCP server.

### Approvals inbox

One queue for everything that needs a human: tool sign-offs (HIGH risk is
admin-only) and AI reply drafts. Everything decided is logged with who and
when.

### Groups & escalation

Create groups (e.g. Development / Analytics / Engineering) owning ticket
categories, with member tiers JUNIOR → MID → SENIOR (or STANDALONE
specialists). Priority sets the minimum tier; **Escalate** moves a ticket up
a tier or across groups, picking the least-loaded eligible member. SLA
breaches escalate automatically.

## 4. Specialized agents

**Agents** page. Each specialist is a Markdown file (frontmatter: `name`,
`description`, `categories`, `tools`; body = system prompt):

- The enabled specialist covering the ticket's category handles it.
- **Tools** opens the visual picker (risk + approval badges per tool); core
  communication tools are always on.
- **API key** assigns a pool credential; **Edit .md** edits the persona
  in place. Files in `agents/` sync on setup; UI edits win afterwards.

## 5. Desk skills — what agents always do

**Skills** page. A specialized agent is *who* works the ticket; a skill is
*what this desk has decided to always do* about a class of problem — how to
handle a lockout, what to check before a database change, when to escalate
instead of resolving. Each one is a Markdown document (frontmatter: `name`,
`description`, `categories`; body = the procedure).

How an agent uses them:

- Its system prompt lists only the **name and description** of each enabled
  skill, so a desk can hold dozens without bloating every prompt.
- When one looks relevant, the agent calls `read_skill` to load the full
  procedure. Applicable skills are listed first.
- `categories: []` means the skill applies to **every** ticket — that is how
  desk-wide policy is written.
- A skill never overrides an approval gate. It tells the agent what to do; the
  gate still decides whether the agent may do it.
- **QA** is shown which skills applied and which the run actually read, so an
  agreed procedure that gets ignored is caught before the ticket closes.

Managing them:

- **New skill** writes one from a template; **Edit SKILL.md** edits it in
  place. Renaming is safe — the slug agents use never moves.
- The switch **retracts** a skill: agents are told a disabled skill must not
  be followed. Prefer this to deleting, since a bundled skill returns on the
  next upgrade.
- Files in `skills/<slug>/SKILL.md` sync on setup, exactly like `agents/`;
  existing rows are never overwritten, so UI edits win afterwards.

> **Upgrading an existing install:** specialists you have already edited keep
> the tool allowlist you gave them, so they will not have `read_skill` yet.
> Add it once from **Agents → Tools** on each specialist. Agents left on
> "all enabled tools" — and the default resolver — pick it up automatically.

External MCP clients can read skills too: `read_skill` is served over
`POST /api/mcp`, so an agent outside Servo can follow the same procedures.

## 6. Monitoring

The dashboard covers the last 30 days: open tickets, first-response and
resolution averages, SLA breaches, AI-vs-human resolutions, AI reply
acceptance, approvals. The Agents page adds per-key/per-agent token and
latency throughput.

## 7. Troubleshooting

| Symptom | Fix |
|---|---|
| Locked out after a bad SSO config | `node scripts/ops/reset-sso.cjs` → reconfigure from Integrations |
| "Sign-in failed / account not allowed" | The email's domain isn't in **Allowed email domains** (or the IdP rejected it) |
| AI answers look scripted | You're in mock mode — check Settings → AI provider (missing/invalid key falls back to mock) |
| Drafts not appearing for inbound mail | *Draft replies for inbound email* toggle (Settings → AI) and the inbound integration status |
| Mail not becoming tickets | Inbound enabled + secret matches the relay/webhook; for Gmail check the relay process is running |
| GitHub/Azure tools "simulated" | No token/credentials configured for that integration |
| `fetch_url`/integration says "Blocked" | Internal or unlisted host — add it under Integrations → **Outbound web access** (exactly, no `*`, to permit a private address) |
| An upgraded agent never uses `fetch_url` | Specialists you have edited keep their saved allowlist — add the tool under Agents → Tools |
| An agent ignores a desk skill | Its allowlist is missing `read_skill` — add it from **Agents → Tools** |
| `SERVO_ENCRYPTION_KEY is not set but…` errors | The DB holds encrypted secrets; set the original key in the environment |
| Secrets saved before enabling encryption | `node scripts/ops/encrypt-secrets.cjs` seals them once |

## 8. Good habits

- Keep approval gates on anything that mutates external systems.
- Keep the outbound allowlist as tight as your desk can stand, and treat
  each internal host you add to it as a deliberate exception.
- Scope integration credentials tightly and rotate anything ever shared.
- Set `AUTH_SECRET`, `SERVO_ENCRYPTION_KEY` and HTTPS before real users.
- Review the escalation groups so no category dead-ends.
- Write a skill the first time you correct an agent twice for the same thing.
