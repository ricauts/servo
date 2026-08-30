# Servo documentation — the index

One screen: what to read first, what each document is for, and what is
history. This index makes no product claim — `docs/POSITIONING.md` owns
claims.

**Read first**

| Document | What it is |
|---|---|
| [USER-GUIDE.md](USER-GUIDE.md) | The day-to-day guide: setup, integrations, the AI reply loop, approvals, troubleshooting |
| [ARCHITECTURE.md](ARCHITECTURE.md) | The engine design: the resolver loop, tools, policies, approvals, the ops sandbox |
| [migrating-to-postgres.md](migrating-to-postgres.md) | Upgrading an install from the pre-Postgres era, one command |

**Reference**

| Document | What it is |
|---|---|
| [DEMO.md](DEMO.md) | A 5-minute guided tour of the seeded desk |
| [DESIGN.md](DESIGN.md) | The color system: WCAG-audited light/dark tokens |
| [POSITIONING.md](POSITIONING.md) | The claims canon — what Servo may and may not say about itself, machine-checked by `scripts/claims-audit.mjs` |
| [integrations/](integrations/) | Per-integration connection guides |
| [assets/](assets/) | Screenshots and diagrams used by the READMEs |

**History — accurate about the past, not the present**

| Document | What it is |
|---|---|
| [PORTING-LEDGER.md](PORTING-LEDGER.md) | The dated record of the move to Postgres: what shipped, what was rejected, and why |
| [history/CONTRACT.md](history/CONTRACT.md) | The superseded module-builder work order, kept for provenance; the header names what replaced it |
| [design/](design/) | Design rationale per area — the reasoning the backlog sections cite |
