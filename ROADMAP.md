# Roadmap

Servo grows one **real, tested integration** at a time — nothing lands as a
mock of itself. Have an opinion on priorities? Open an issue.

## Shipped

- Tickets from email (any SMTP; Gmail/Workspace IMAP relay), the web and the
  API, with reply threading
- AI reply drafts with human approval and acceptance metrics on the dashboard
- Tool-using resolver with risk levels, human-approval gates and QA review;
  unmet objectives escalate to a human, never fake-resolved
- Real GitHub (repos, feature branches, PRs, gated commits and merges) and
  Azure read-only tools; `fetch_url` and screenshots behind an SSRF-safe
  egress guard with an optional per-host allowlist
- Specialized agents as `.md` personas with per-agent tool allowlists and
  per-agent API keys (BYOK pool with usage metering)
- Desk skills as `.md` procedures the resolver loads on demand; QA reviews
  the run against the skills that applied; an admin turns a resolved ticket
  into a skill from its timeline
- Desk memory: agents search past tickets and their recorded resolutions,
  with other requesters' identities withheld
- **Knowledge base:** PDF, Excel, Word, Markdown and text uploads extracted
  offline, chunked with page / sheet / line locators, typed facts, and
  retrieval filtered by entitlement inside the SQL statement; optional
  embeddings endpoint; optional Docling sidecar for layout and OCR
- **External data sources** (S3, PostgreSQL) crawled into indexed records
  and catalog cards, gated by a source ceiling
- **The library:** deterministic keywords, filters by text / visibility /
  shelf, an interactive graph of documents, shelves and sources, and opt-in
  AI enrichment (topics, summary, automatic filing)
- **Packs:** the catalog of connectors, extraction lanes, models, tools and
  local bundles, with the install's state on every card
- MCP server and client (every imported tool quarantined), local plugin
  bundles, custom HTTP tools, outbound signed webhooks
- SSO via any OIDC IdP, domain allowlist, requester data isolation; secrets
  encrypted at rest with a key the container generates on first boot;
  first-run wizard; groups with JUNIOR→MID→SENIOR escalation; SLA targets
  with auto-escalation; one-command Docker deploy on PostgreSQL + pgvector

## In progress

- More data sources on the same connector model: Azure Blob / Data Lake
  Gen2, MySQL / MariaDB, Google BigQuery, SharePoint / OneDrive, Google
  Drive (listed as *planned* cards in Packs)
- WhatsApp & Telegram intake — chat conversations become tickets with the
  same draft-approve loop

## Next

- Distilling a resolved ticket into a draft skill automatically, behind the
  same human gate an admin uses today
- Fetching, verifying and pinning bundles from a remote location (the
  design rationale under `docs/design/` fixes the shape)
- Document attachments on tickets feeding the same knowledge pipeline
- AWS & GCP tooling behind the same approval gates
- Slack & Teams companion apps (notify + approve from chat)
- Built-in rate limiting on the HTTP surface; immutable audit log export
- Multi-tenant workspaces

## Ideas under evaluation

- Auto-triage confidence thresholds (route low-confidence straight to humans)
- Scheduled reports (weekly desk digest to admins)
- Knowledge gap mining: cluster tickets the AI could not answer into
  "write this runbook" suggestions
