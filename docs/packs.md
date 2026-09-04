# Packs

**Packs** (`/packs`, nav entry under the fleet section) is the catalog of
everything Servo can connect to, extract with, call and load, with what is
configured on this install shown on every card. The catalog is curated in
this repository (`src/lib/packs/catalog.ts`); nothing on the page is
fetched from anywhere, and a card is one of three things:

- **configured** — in use here (two PostgreSQL sources, a model provider
  and its model, an OIDC tenant…);
- **available** — shipped in this tree, nothing set up yet; *Set up* opens
  the form that owns it (Sources, Integrations, Settings, Knowledge admin);
- **planned** — named so the direction is visible, with no install
  affordance at all. Azure Blob / Data Lake, MySQL, BigQuery, SharePoint
  and Google Drive sit here today.

Source cards name the **data type** they add to the knowledge graph (S3,
POSTGRES…), the same facet the graph page filters on.

## Bundles — local plugins

The bottom of the page lists the bundles `syncPlugins()` registered from
`plugins/<dir>/` ([plugins.md](plugins.md)): each with its skills, agent
profiles and MCP server entries and their enabled flags. Placing the
directory and restarting is the install; everything arrives **disabled**,
and an admin (`packs.manage`) promotes items one by one — the toggles call
the same routes the Skills, Agents and Integrations pages use, so there is
no second installer and no second permission model. Fetching a bundle from
a remote location, verifying it and pinning its commit is on the
[roadmap](../ROADMAP.md); the page says so rather than implying otherwise.

## Permissions

`packs.view` (admins and agents) browses; `packs.manage` (admins) is what
the item toggles check, in addition to each owning route's own gate.
