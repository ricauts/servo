<!-- Design rationale extracted from spec.md. spec.md remains the work order:
     the backlog, the tick protocol and the claims ledger live there. -->

# Marketplace

**This entire section is Roadmap. The marketplace ships nothing in v1.**

It is also the one place the word is allowed. Per Ruling 7 the string `marketplace` (case-insensitive) may appear only in this Roadmap section of `spec.md` and in the single Roadmap row of `docs/POSITIONING.md`'s ledger. `reb-07`'s claims lint (`scripts/claims-audit.mjs`) treats §7 as a Roadmap section and everything else in the tree as banned. There is no `/marketplace` page, no nav entry, no `docs/marketplace.md`, no README section, no `marketplace.*` permission actions and no `MarketplaceSource` model. The reason is the standing constraint, not a preference: a hosted cloud offering is planned and does not exist, and this is the single word most likely to make a reader believe otherwise.

**When the surface eventually ships, it ships as "Packs" at `/packs`, with `packs.view` / `packs.manage`.** "Marketplace" is never a product-surface name in this repo — it implies a hosted registry, and no hosted anything exists.

The design is fixed now so a future tick does not redesign it:

* **One install path.** Packs install through `syncPlugins()` (§6.5). The Packs surface is a UI over that path, never a second installer. `PackInstall` / `MarketplaceSource` / `originPackId` are not resurrected; provenance is `Skill.origin` / `AgentProfile.origin`.
* **Trust model.** Admin-only (`packs.manage`). What is trusted is the admin's choice of source repo plus commit immutability on the git host. **Signatures are not verified** — no sigstore, no minisign — and the docs must say so plainly rather than implying a curated registry.
* **Permission surface shown before install.** The confirm dialog is computed before any write and lists: skills to add (slug, name, categories); agent profiles to add (slug, tools requested); tools to add with name, method, target **host**, `secretRequired`; and computed warnings — `MODEL_STEERABLE_HOST` when `{input.` appears in the host position of a tool URL, `HOST_PRIVATE_OR_BLOCKED` when `checkEgress` refuses the host today. A collision against an existing `Skill.slug`, `AgentProfile.slug`, `CustomTool.name` or built-in tool name **aborts the whole pack** — predictability over partial installs.
* **Risk levels in the manifest are advisory and ignored.** Everything a pack installs is created with the §6.1 triple. The `max(declared, "MEDIUM")` floor from the original draft is deleted.
* **Pinning.** A remote install resolves its ref to a commit SHA and pins it; the SHA and a per-item content hash are recorded at install time.
* **Updates** are an explicit SHA bump: fetch at the tracked ref, resolve a new SHA, diff against the recorded hashes, admin confirms. An item whose current content hash differs from the recorded one (an admin edited it) is skipped and reported. Drift re-quarantine applies — a tool whose host, method or input schema changed is disabled again. This exception only ever disables.
* **Removal** deletes pack-owned `CustomTool` + `ToolPolicy` rows but **disables** pack-owned `Skill` and `AgentProfile` rows rather than deleting them: `AgentRun.profileId` pins personas for resume and QA reads skills from history.
* **No code execution, ever.** `command` sources are permanently rejected. `npm` and `archive` sources are out unless a sandboxing story exists. Skills are text, profiles are prompt text, tools are HTTP declarations executed by Servo's own guarded runtime.
* **A hosted registry, if it ever exists, is just another source kind.** Nothing in the preview/quarantine/install pipeline changes. No copy anywhere may name an official Servo registry or hosted service, and none may foreclose one.

Everything above is Roadmap. Cut and roadmapped from the drafts: `mkt-02` … `mkt-09`; `mkt-01` was a fourth copy of the P0 and is deleted, not roadmapped; `mkt-10` (the README/docs/nav rollout of the word) is deleted outright.

---
