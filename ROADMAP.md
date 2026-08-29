# Roadmap

Servo grows one **real, tested integration** at a time — nothing lands as a
mock of itself. Have an opinion on priorities? Open an issue.

## Shipped

- Email in/out (any SMTP; Gmail/Workspace IMAP relay) with reply threading
- AI reply drafts with human approval + acceptance metrics on the dashboard
- Tool-using resolver with risk levels, human-approval gates and QA review;
  unmet objectives escalate to a human, never fake-resolved
- Real GitHub (repos, feature branches, PRs) and Azure read-only tools
- Specialized agents as versionable `.md` personas with per-agent tool
  allowlists and per-agent API keys (BYOK pool with usage metering)
- Desk skills as versionable `.md` procedures: the resolver sees a catalogue,
  loads a body on demand with `read_skill`, and QA reviews the run against the
  skills that applied
- SSO via any OIDC IdP, domain allowlist, requester data isolation
- Secrets encrypted at rest (AES-256-GCM); first-run wizard; clean installs
- Desk memory: agents search past tickets and their recorded resolutions for
  precedent before acting, with other requesters' identities withheld
- MCP server: external agents can file/search tickets and run the tools that
  need no human approval (approval-gated ones stay behind a ticket)
- Groups with JUNIOR→MID→SENIOR escalation, SLA targets with auto-escalation
- Outbound signed webhooks; custom HTTP tools; Docker one-liner deploy
- `fetch_url` reads public pages as text, behind an SSRF-safe egress guard
  with an optional per-host allowlist (also covers screenshots and HTTP tools)

## In progress

- **Knowledge for agents (RAG):** upload documents (runbooks, FAQs, policies)
  into a knowledge base, embed them into a vector store, and give every
  agent retrieval so triage, drafts and resolutions cite *your* docs instead
  of guessing. Design goals: BYO embedding model (same BYOK philosophy),
  pgvector storage inside the app's own PostgreSQL so self-hosting stays a
  one-liner, citations
  rendered in replies, and per-source access control.
- WhatsApp & Telegram intake — chat conversations become tickets with the
  same draft-approve loop
- MySQL connector for the ops tools (the ops sandbox is already its own
  database on the main PostgreSQL server, `db-05`)

## Next

- Document attachments on tickets (requester uploads feed the same knowledge
  pipeline)
- AWS & GCP tooling behind the same approval gates
- Slack & Teams companion apps (notify + approve from chat)
- Built-in rate limiting on the HTTP surface
- Immutable audit log export
- Multi-tenant workspaces

## Ideas under evaluation

- Auto-triage confidence thresholds (route low-confidence straight to humans)
- Scheduled reports (weekly desk digest to admins)
- Knowledge gap mining: cluster tickets the AI couldn't answer into
  "write this runbook" suggestions
