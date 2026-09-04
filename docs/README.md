# Servo documentation — the index

One screen: what to read first, what each document is for, and what is
history. This index makes no product claim — `docs/POSITIONING.md` owns
claims.

**Read first**

| Document | What it is |
|---|---|
| [SETUP.md](SETUP.md) | Installing and configuring Servo: Docker and local, the first-run wizard, sign-in (SSO / OIDC), bring-your-own-key providers, the demo dataset, the production checklist |
| [USER-GUIDE.md](USER-GUIDE.md) | The day-to-day guide: integrations, the AI reply loop, approvals, agents, skills, troubleshooting |
| [ARCHITECTURE.md](ARCHITECTURE.md) | The engine design: the resolver loop, tools, policies, approvals, the ops sandbox, the project tree |
| [knowledge-base.md](knowledge-base.md) | The knowledge base: formats, the entitlement invariant, grants, the library view, AI enrichment, the graph, embeddings |
| [packs.md](packs.md) | Packs: the catalog of connectors and local bundles, and what "configured" means |
| [connectors.md](connectors.md) | MCP servers: adding one, the quarantine default, approval pauses, egress rules |
| [skills.md](skills.md) | Agent Skills compatibility, distillation, the human gate |
| [plugins.md](plugins.md) | Local plugin bundles: layout, disabled-by-default, namespacing |

**Reference**

| Document | What it is |
|---|---|
| [KB-DOCLING.md](KB-DOCLING.md) | The optional Docling sidecar: layout-aware PDF extraction and OCR |
| [migrating-to-postgres.md](migrating-to-postgres.md) | Upgrading an install from the pre-Postgres era, one command |
| [DEMO.md](DEMO.md) | A 5-minute guided tour of the seeded desk |
| [DESIGN.md](DESIGN.md) | The color system: WCAG-audited light/dark tokens |
| [MEDIA-GUIDE.md](MEDIA-GUIDE.md) | How the README's screenshots and films are made, and the privacy rules every take follows |
| [POSITIONING.md](POSITIONING.md) | The claims canon — what Servo may and may not say about itself, machine-checked by `scripts/claims-audit.mjs` |
| [integrations/](integrations/) | Per-integration connection guides |
| [assets/](assets/) | Screenshots and diagrams used by the READMEs |

**History — accurate about the past, not the present**

| Document | What it is |
|---|---|
| [PORTING-LEDGER.md](PORTING-LEDGER.md) | The dated record of the move to Postgres: what shipped, what was rejected, and why |
| [history/CONTRACT.md](history/CONTRACT.md) | The superseded module-builder work order, kept for provenance; the header names what replaced it |
| [hygiene/](hygiene/) | Dated hygiene audits and their evidence |
| [design/](design/) | Design rationale per area — the reasoning the backlog sections cite |
