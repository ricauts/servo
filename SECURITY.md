# Security

Servo is a self-hosted service desk that stores credentials for the systems
it integrates with and lets AI agents act on them behind human approval
gates. This document describes the security model, what you must configure
for production, and what is intentionally out of scope today.

## Reporting a vulnerability

Open a GitHub security advisory on this repository (Security → Advisories →
Report a vulnerability) rather than a public issue.

## Secrets

**Where they live.** Integration credentials (model API keys, GitHub PAT,
Azure client secret, SMTP URL, OIDC client secret, MCP/inbound tokens,
credential-pool keys, custom-tool secrets, webhook signing secrets) are
stored in the application database. They are **never returned by any API** — the
settings endpoints redact them structurally (`tokenSet: true`, never the
value).

**Encryption at rest.** Set `SERVO_ENCRYPTION_KEY` (64 hex chars, 32-byte
base64, or a long passphrase) and every secret is sealed with AES-256-GCM
before it is written; values are decrypted only at the moment of use.
Rows written before the key existed stay readable (legacy plaintext passes
through) — migrate them once with:

```bash
node scripts/encrypt-secrets.cjs
```

Losing the key means re-entering the secrets; it is never stored anywhere by
Servo. Environment-variable credentials (`ANTHROPIC_API_KEY`, `GITHUB_TOKEN`,
`SMTP_URL`…) always win over stored ones and never touch the database.

**Least privilege for integration credentials:**

- GitHub: a **fine-grained PAT** with Contents (and Administration only if
  the resolver should create repositories) on the specific repositories.
- Azure: a service principal with the **Reader** role only — the mutating
  cloud tools are simulated by design.
- Mail: an **app password** for a dedicated mailbox, not a user's password.
- Rotate anything you ever pasted into a chat, a ticket or a terminal.

## Authentication & authorization

- **Real sign-in** is any OIDC IdP (Google, Entra ID, Okta, Keycloak…).
  Set `AUTH_SECRET` in production — session cookies are signed with it.
- **`AUTH_ALLOWED_DOMAINS`**: with a public IdP, any account can complete
  OAuth; this server-side allowlist (plus explicit admin emails) is what
  keeps strangers out. Set it unless your IdP is org-internal.
- **Demo mode** (no OIDC config) is an authentication-free user switcher for
  local evaluation. Never expose a demo-mode install to a network you do not
  trust.
- **Roles**: REQUESTERs only see their own tickets (pages and API). Agents
  and admins see the queue; HIGH-risk approvals and settings are admin-only.
- Locked out by a bad SSO config: `node scripts/reset-sso.cjs`.

## AI agents & tools

- Every tool carries a risk level and an optional **human-approval gate**
  (defaults in `src/lib/ai/tool-policies.ts`, editable per install); HIGH-risk
  approvals are admin-only, and QA reviews risky runs.
- Read-only SQL is enforced by PostgreSQL, not just by keyword filtering:
  every read runs inside a read-only transaction, and with
  `OPS_DATABASE_READONLY_URL` set it runs as `servo_ops_ro`, a role granted
  `SELECT` and nothing else. Without that variable the transaction is the
  whole enforcement — set it. Mutating SQL defaults to requiring approval.
  The sandbox is its own database (`servo_ops`) whose roles have `CONNECT` on
  the desk database revoked, so a query that escapes the read path still
  cannot reach ticket data.
- Agents that cannot complete an objective **escalate to a human** — an
  unmet objective is never marked resolved.
- The MCP endpoint and the inbound-email webhook are disabled until you set
  their bearer/shared secrets; use long random values.
- The MCP endpoint has no human in the loop, so it **never serves a tool whose
  policy requires approval** (nor disabled or ticket-bound ones): they are
  absent from `tools/list` and refused by `tools/call`. An external agent that
  needs one files a ticket instead, where the approval gate applies.
- **Outbound requests are guarded (SSRF).** `fetch_url`, `take_screenshot`
  and admin-defined HTTP integrations resolve the host first and refuse
  loopback, private, CGNAT, link-local (including the `169.254.169.254`
  cloud-metadata endpoint), multicast and reserved addresses, as well as
  non-http(s) schemes and URLs carrying credentials; every redirect hop is
  re-checked. An optional allowlist (Integrations → Outbound web access)
  narrows this to named hosts, and a literal entry there is the only way to
  permit an internal address on purpose. Residual risk: the address is
  checked before the request and the request is then made by hostname, so
  DNS rebinding between the two is not caught.
- Prompt-injection caution: ticket text reaches the models. The approval
  gates on risky tools are the mitigation — do not disable them for tools
  that can mutate systems, and treat the tool allowlist per agent as a
  security boundary. A URL in a ticket is attacker-controlled input in the
  same way — that is what the egress guard above is for.

## Transport & deployment

- Run behind HTTPS (reverse proxy); set `APP_URL` so links are correct.
- The PostgreSQL volume (`servo-db` in Docker) holds your tickets and sealed
  secrets — restrict access to it, and back it up with `pg_dump` against the
  `db` service, covering **both** databases the app uses: `servo` (everything)
  and `servo_ops` (the sandbox the agent's SQL tools operate on). Restore
  with `pg_restore`/`psql` into a fresh
  database — the procedure is proven by `tests/backup-restore.test.ts`. A
  dump contains sealed secrets and is only as safe as your
  `SERVO_ENCRYPTION_KEY`: the dump is ciphertext for those values, so treat
  the dump file with the same care as the key itself.
- Coming from a pre-Postgres install? [docs/migrating-to-postgres.md](docs/migrating-to-postgres.md)
  is the one-command import — and until it has run, the `servo-data` volume
  holds the only copy of your data.
- Webhook payloads are HMAC-SHA256 signed (`x-servo-signature`); verify on
  the receiving end.

## Known limitations (roadmap)

- No rate limiting on the HTTP surface yet — front with a proxy/WAF if
  exposed publicly.
- Audit trail is the ticket/run timeline; there is no separate immutable
  audit log.
- Single-tenant by design today.
