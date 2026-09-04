# Setup

Installing Servo, signing in, choosing a model, and what to set before real
people use it. The [README](../README.md) has the two-command quickstart;
this page has everything behind it.

## Run with Docker

```bash
docker compose up --build
```

Two containers: the app and its PostgreSQL (pgvector) database, both on
persistent volumes (`servo-db` for the data, `servo-data` for the
encryption key). On boot the app applies the numbered migrations, runs the
create-only core bootstrap (system agents, default policies, bundled
skills), seals any secret written before a key existed, and serves on
[http://localhost:3000](http://localhost:3000). The first visit opens the
**setup wizard**: your name and email become the first admin, and you can
connect an SSO tenant right there or later from Integrations.

- `SERVO_DEMO=1` on first boot loads the fictional showcase dataset instead
  of a clean desk (never combine with real use).
- `ANTHROPIC_API_KEY`, `ZAI_API_KEY` or `OPENAI_API_KEY` in the environment
  picks a model provider without touching Settings; without any key Servo
  runs in mock mode.
- Podman works the same way through `podman compose`.

Back up with `pg_dump` against the `db` service — both databases, `servo`
and `servo_ops` — **together with `/data/encryption.key`**: a dump holds
sealed secrets that only that key opens ([SECURITY.md](../SECURITY.md)).
Upgrading an install from the pre-Postgres era is a one-command import:
[migrating-to-postgres.md](migrating-to-postgres.md).

## Run locally

Requires **Node.js 20+** and Docker or Podman for the database container.

```bash
docker compose up -d db   # the PostgreSQL database (pgvector image)
npm install
npm run setup             # prisma generate + migrate deploy + core bootstrap
npm run dev
```

Copy `.env.example` to `.env` and set at least `SERVO_ENCRYPTION_KEY`: a
bare local run without it stores secrets in plain text. `npm run demo`
loads the showcase dataset (~28 tickets, completed AI runs, pending
approvals) — it **wipes the database**, so evaluation only.

Run the unit tests with `npm test` (they need the throwaway test database:
`docker compose -p servo-test -f docker-compose.test.yml up -d`), the RBAC
matrix with `node scripts/dev/permissions-audit.mjs`, and the responsive
check with `node scripts/dev/responsive-audit.mjs` (both need the dev
server running).

## Sign-in (SSO / OIDC)

Connect any OIDC identity provider — Entra ID, Google, Okta, Keycloak,
Auth0 — from the wizard, from **Integrations → Single sign-on**, or with
`OIDC_ISSUER`, `OIDC_CLIENT_ID` and `OIDC_CLIENT_SECRET`. Register the
redirect URI `<servo-url>/api/auth/callback/oidc` with the provider. Users
are provisioned on first sign-in as REQUESTER; `AUTH_ADMIN_EMAILS` names the
accounts that keep the ADMIN role; roles are managed from **Settings →
Team**.

- **Allowed email domains** (`AUTH_ALLOWED_DOMAINS` or Integrations → SSO):
  when set, only accounts on those domains — plus the explicit admin emails
  — can sign in. Set it whenever the provider will authenticate accounts
  outside your organization; rejected sign-ins land on `/login` with a clear
  message and are never provisioned.
- **Locked out by a bad SSO config?** `node scripts/ops/reset-sso.cjs` clears
  the tenant (keeping admin emails and domains) and drops Servo back to the
  demo user switcher so you can fix it from `/integrations`.
- **Local development IdP:** `node scripts/dev/mock-idp.mjs you@x.com`
  starts a throwaway provider.

Google Workspace example: create an OAuth client (type *Web application*)
in the Google Cloud Console with the redirect URI above, keep the consent
screen **Internal**, then save issuer `https://accounts.google.com` plus the
client ID and secret in Integrations.

Without an OIDC tenant Servo stays in the **offline demo mode** with the
user switcher in the sidebar — every role, the whole agent loop on the mock
provider, no auth provider, no key, no network. Fine for evaluating; never
expose it to a network you do not trust.

## Bring your own key

Servo ships in **mock mode**: a deterministic provider that scripts
realistic tool-using conversations from the ticket text, so triage,
resolution, approvals, QA and the knowledge tools all work with no API key.
For real model calls, pick a provider in **Settings → AI provider** (with
presets and a **Test connection** button) or through the environment:

| Provider kind | Works with | Env var | Notes |
|---|---|---|---|
| `anthropic` | Anthropic API and Anthropic-compatible endpoints | `ANTHROPIC_API_KEY` | base URL override for any compatible endpoint |
| `zai` | Z.AI GLM models, first-class | `ZAI_API_KEY` | endpoint preconfigured, no base URL needed |
| `openai` | Any OpenAI-compatible Chat Completions endpoint | `OPENAI_API_KEY` | OpenAI, Azure OpenAI, vLLM, keyless local servers such as Ollama (`http://localhost:11434/v1`) |

- The env var for the selected provider always wins over a key stored in
  Settings.
- `openai` endpoints with a base URL but no key are allowed — that is how
  keyless local servers work.
- If the selected provider has no usable credentials, Servo falls back to
  mock mode and Settings shows a warning, so the app never breaks.
- The agent loop, approval gates and QA are provider-agnostic: tool use is
  translated to Anthropic `tool_use` blocks or OpenAI function `tool_calls`.
- **API key pool:** register several named credentials of any provider mix,
  assign one per specialized agent from the Agents page, and read tokens,
  latency and cost per key and agent on the throughput panel.
- **Embeddings** are separate and optional: any OpenAI-compatible embeddings
  endpoint from **Knowledge admin** turns keyword-only retrieval into
  keyword + vector search ([knowledge-base.md](knowledge-base.md)).

Every key saved through Settings is encrypted at rest; see
[SECURITY.md](../SECURITY.md).

## The demo dataset

`SERVO_DEMO=1` (Docker) or `npm run demo` (local) seeds a fictional company
and these switchable users:

| User | Role | What they can do |
|---|---|---|
| Ana Rodríguez | ADMIN | Everything, including Settings, groups and HIGH-risk approvals |
| Bruno Chen | AGENT | Work tickets, run the AI, decide LOW/MEDIUM-risk approvals; SENIOR in Engineering |
| Elena Duarte, Farid Khan, Gabriela Torres, Hiro Tanaka | AGENT | Group members across Development / Analytics / Engineering at junior→senior tiers |
| Iris Volkov | AGENT | STANDALONE security specialist in Engineering, outside the tier ladder |
| Carla Méndez, Diego Fontaine | REQUESTER | Create tickets, comment |
| Servo Triage / Resolver / QA / Drafter / Catalog | AI_AGENT | The system agents — not switchable personas; they act through runs |

[DEMO.md](DEMO.md) is the 5-minute guided tour over that dataset.

## Production checklist

Before exposing an install to real users ([SECURITY.md](../SECURITY.md) has
the full model):

- `AUTH_SECRET` — session signing (any long random string).
- An encryption key: the container makes one, or set `SERVO_ENCRYPTION_KEY`
  yourself; either way back it up with the database.
- An OIDC tenant plus `AUTH_ALLOWED_DOMAINS` — real sign-in scoped to your
  organization.
- HTTPS in front (a reverse proxy) and `APP_URL` set to the public URL.
- Scoped credentials for integrations: a fine-grained GitHub PAT, a
  Reader-role Azure service principal, an app password for the mailbox.
- Decide the egress allowlist (Integrations → Outbound web access) and who
  is an admin: custom HTTP tools can reach whatever an admin points them at.
- No built-in rate limiting yet — front a public install with a proxy or
  WAF.
