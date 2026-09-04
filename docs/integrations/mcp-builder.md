# mcp-builder — intake

The first mining tick, run 2026-09-03 against rotation source 1 of 4,
`anthropics/skills` (SKILL.md libraries). One candidate, per the procedure in
this directory's README.

Upstream pinned at commit `41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f`, read
from a clone taken shallow and then deepened by a bounded fetch; it now
reaches a parentless root commit, so the history figures below are complete
rather than truncated. Every licence statement below was read from the bytes
of the file it names on 2026-09-03. None was recalled.

## Stage 0 — the adopt-first gate (ALWAYS FIRST)

**The repository root carries no licence file.** Its tracked top-level entries
are `.claude-plugin`, `.gitignore`, `README.md`, `THIRD_PARTY_NOTICES.md`,
`skills`, `spec`, `template` — there is no `LICENSE`, `LICENSE.txt`,
`LICENSE.md`, `COPYING` or `NOTICE`. A licence for this source therefore
cannot be established at the root at all, and
[`ecosystem.md`](../design/ecosystem.md) §10.1 anticipated exactly this:
"Individual skills in public skill libraries carry **per-skill licences that
must be checked individually**, never assumed from the repo root." That
sentence is now evidence rather than caution.

- **Licence (this candidate):** Apache-2.0. Read from
  <https://github.com/anthropics/skills/blob/41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f/skills/mcp-builder/LICENSE.txt>
  — 11345 bytes, md5 `0ee6429f4c66920b6744d818225fb58f`, the full Apache
  License 2.0 text with the appendix filled in, shared byte-for-byte with
  twelve sibling skills. (The file has no trailing newline, so `wc -l` reports
  201 where the text is 202 lines; the byte count and the checksum are the
  unambiguous figures.)
- **Copyright notice, verbatim:** `Copyright 2026 Anthropic, PBC.`
- **Verdict: IDEAS ONLY.** The licence is on the allowlist and would permit
  more, but nothing is taken as code — see "Reuse class" below. Because
  nothing is vendored, no `THIRD_PARTY.md` entry is due; the register's own
  scope note routes reimplementation to `docs/PORTING-LEDGER.md` instead. Were
  a later item to vendor any of these bytes, the entry would be due in that
  item's own commit.

### Library-wide licence facts, so no later tick re-litigates them

Nineteen skill directories, each checked individually. Grouped by the md5 of
the licence file actually present:

| Licence | Skills | Gate verdict |
|---|---|---|
| Apache-2.0, full text with the appendix filled in, carrying `Copyright 2026 Anthropic, PBC.` (md5 `0ee6429f…`, 11345 bytes) | academy-guide, algorithmic-art, brand-guidelines, canvas-design, claude-api, discernment-nudge, internal-comms, mcp-builder, skill-creator, slack-gif-creator, theme-factory, web-artifacts-builder, webapp-testing — thirteen | ADOPTABLE |
| Apache-2.0 terms, ending at `END OF TERMS AND CONDITIONS` (md5 `2ee41112…`, 10174 bytes) | frontend-design | ADOPTABLE, **with one caveat recorded** — see below |
| Proprietary, "All rights reserved" (md5 `f8515c36…`, 1467 bytes) | docx, pdf, pptx, xlsx | **REJECTED** |
| No licence file of any name | doc-coauthoring | **IDEAS ONLY** |

Thirteen plus one plus four plus one accounts for all nineteen directories.

**The frontend-design caveat, because it is not merely cosmetic.** Its licence
file is a byte-exact 10174-byte prefix of its siblings' — the terms are
identical and end at `END OF TERMS AND CONDITIONS`. What the missing 25 lines
contain is not only the "how to apply this licence" boilerplate: they are also
the *only* place the sibling files name a licensor. That file therefore
carries **no copyright notice and no "Licensed under the Apache License,
Version 2.0" statement**, and nothing else in that skill supplies one. Apache-2.0
by strong inference — identical terms, sibling skills, the repository's own
README — but not by an attached grant. A later tick that wants to vendor from
frontend-design specifically should ask upstream first rather than rely on
this row.

The proprietary rejection is not a close call and is worth stating plainly,
because these four are the ones whose subject matter overlaps Servo's own
extraction work: the text forbids retaining copies outside Anthropic's
services, reproducing the materials, creating derivative works, distributing
them, and reverse engineering them. Licence beats fit. Servo's document
extraction stays where `kb-06` and `kb-07` put it — exceljs and unpdf, both
already recorded in `THIRD_PARTY.md`.

Two clearances, both checked rather than assumed:

- Upstream's own `THIRD_PARTY_NOTICES.md` carries four licence sections:
  **GPL-3.0 for FFmpeg 7.0.2 alone**, BSD-2-Clause for imageio and
  imageio-ffmpeg, MIT-CMU/HPND for Pillow, and SIL OFL 1.1 for 27 bundled
  typefaces. The mapping matters, so it was derived rather than assumed: the
  GPL exposure is reached only through **slack-gif-creator**, the one skill
  whose files reference ffmpeg or imageio, and the bundled fonts belong to
  canvas-design under **OFL 1.1, not GPL**. This candidate's ten files were
  enumerated and contain no font, no media asset and no ffmpeg reference, so
  nothing GPL reaches this tree by adopting it. The clearance stops applying
  the moment anyone eyes slack-gif-creator.
- Upstream's `README.md` says "Many skills in this repo are open source
  (Apache 2.0)" and separately calls the document skills "source-available,
  not open source". The bytes agree with the README on both counts — checked,
  because the gate does not accept a README's word for a licence.

Verdicts cited from `spec.md` §0.4 and **not** re-litigated here: Agent
Skills / `SKILL.md` is FORMAT-ONLY (an open standard, no licence barrier);
`@modelcontextprotocol/sdk` is MIT and remains the adopted client.

## The candidate

- **Name:** mcp-builder
- **Source URL:** <https://github.com/anthropics/skills/tree/41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f/skills/mcp-builder>
- **Licence:** Apache-2.0 (Stage 0 above)
- **Proposed tool names:** **none.** This candidate proposes no tool, and the
  next section says what that does and does not mean.
- **Reuse class:** ideas, and quotable text with attribution. Explicitly
  **not** "install as a desk skill" — the reason is measured, not asserted,
  under "Validation evidence".

## The fixed triple — NOT fields an intake may change

Every adopted tool ships a `DEFAULT_TOOL_POLICIES` row carrying exactly:

    enabled: false
    requiresApproval: true
    riskLevel: HIGH

Stated verbatim because the template requires it. For this candidate the
triple is **moot, not satisfied**, and the difference matters: a SKILL.md
creates no tool. Adding a tool means editing a domain module under
`src/lib/ai/tools/` and adding a policy row in `src/lib/ai/tool-policies.ts`;
`src/lib/bootstrap.ts`'s skill sync writes `Skill` rows and never touches
`ToolPolicy`. The only tool in the neighbourhood already exists and is already
policied — `read_skill`, LOW risk and no approval, on the stated grounds that
a skill tells an agent what to do and never does it, so the gate still applies
to whatever the procedure names.

Two precision points, recorded because an intake that claimed the triple was
"satisfied" here would be wrong in both directions:

1. `DEFAULT_TOOL_POLICIES` rows carry four fields — tool name, description,
   risk level, approval flag. There is no `enabled` key in that literal;
   `enabled` lives on the Prisma model with a default of true. The triple as
   written is expressible at the row level (that is what the non-core intake
   mint does), not in the seed literal as it stands today.
2. The quarantine posture that *would* apply to a third-party skill lives on
   the plugin lane, not the bundled lane: plugin-supplied skills arrive
   disabled, while `skills/` is synced with no enabled value and takes the
   schema default. Adopting a third-party SKILL.md by dropping it into
   `skills/` would therefore bypass the disabled-by-default treatment the same
   file gives the plugin path. That asymmetry is a finding of this tick, filed
   as a numbered question rather than acted on.

## Egress notes

Every model-steerable outbound URL goes through `safeFetch` — host
resolution, loopback/private/CGNAT/link-local refusal, redirect re-checks,
optional allowlist. Restated here because the template requires it, and not as
an independent audit finding: question 134 in `spec.md` records one path whose
documented allowlist promise the code does not keep, and nothing in this
intake re-verified that. What follows is about this candidate only.

- The markdown taken as ideas is inert: a skill body is text a resolver reads.
  It opens no socket.
- The candidate's `scripts/` directory is **not taken**, and egress is one of
  the reasons. Those two Python files construct an Anthropic API client and an
  MCP transport against an operator-supplied URL, in a Python process. Servo
  enforces egress at the `fetch` boundary inside Node — the pattern that keeps
  a third-party client honest is `src/lib/mcp-client.ts` injecting `safeFetch`
  as the SDK's fetch, and there is no equivalent injection point for a
  pip-installed client. Vendoring those scripts would not be a "wire it
  through `safeFetch`" task; it would be an unguarded egress surface by
  construction.
- Worth noting for accuracy rather than alarm: the candidate's own prose
  steers a reader toward fetching upstream READMEs over the network. In Servo
  that steering would land on `fetch_url`, which does ride the guard. The
  consequence is functional, not a hole — on any install with a non-empty
  allowlist those instructions dead-end.

## Validation evidence

Run offline against the pinned clone on 2026-09-03. A candidate without
evidence is not adoptable no matter how clean its licence is.

**1. The compatibility corpus.** Servo's own `parseSkillMarkdown` was run over
all nineteen upstream `SKILL.md` files in both strict and lenient mode.
Eighteen parse identically in both modes. Exactly one throws, in both modes:
claude-api, on "`description` must be at most 1024 characters; this one is
1068." That is the corpus `ecosystem.md` §10.1 names as "the mining task
proper" for this source, together with its one honest negative case. It is
recorded here as evidence; turning it into fixtures is `cnp-09`, which the
design document places on the Roadmap, and a mining tick writes documents.

**2. Ingestion is not the barrier; scope, truncation and dropped resources
are.** Also measured:

- **Zero of nineteen** upstream skills declare `categories`. Servo reads an
  empty category list as "every ticket", which is how the desk expresses
  desk-wide policy. An ingested upstream skill would therefore advertise
  itself on every ticket of every category, ahead of the desk's own scoped
  procedures, and count against the catalogue limit.
- **`read_skill` truncates at 4000 characters** minus a header. This
  candidate's body is 8708 characters, so an agent would receive 3959 of them
  — 45% — followed by a truncation marker and no second page. The largest
  upstream bodies fare worse: skill-creator's 32624 characters would arrive
  as 12%.
- **Bundled resources are dropped silently.** The `Skill` model stores the
  body and nothing else; a skill's `reference/`, `scripts/` and `assets/`
  directories have nowhere to go, and `read_skill` returns only the body. A
  skill that delegates to its bundled files ingests as a dangling pointer that
  still reads like a valid procedure.
- The desk's tool registry contains no shell and no code execution, so a
  procedure whose steps are "run this script" is not a procedure any Servo
  agent can follow.

Together these are why the reuse class is ideas rather than installation. The
verdict is not "the licence failed" — the licence passed cleanly. It is that
an upstream skill is a toolkit a model opens to acquire an ability, and a
Servo skill is a desk procedure the run is graded against afterwards.

**3. Two gaps in Servo's own MCP surface, named by the candidate's reference
material.** `mcp_best_practices.md` in the candidate specifies tool
annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`,
`openWorldHint`) and a pagination envelope (`has_more`, `next_offset`,
`total_count`). Servo's `tools/list` in `src/app/api/mcp/route.ts` returns
name, description and input schema only — neither annotations nor a pagination
envelope appear anywhere in `src/`, except as fields Servo *records* from
remote servers in `src/lib/mcp-client.ts` and deliberately ignores for policy.
The candidate agrees with Servo on that last point in its own words:
annotations are hints, not security guarantees. The gap is on Servo's server
side, is concrete and is testable. It is recorded as an owner question, not
appended as a backlog item — the loop does not write its own work orders.

**4. Upstream health.** 54 commits on the default branch — the complete
history, since the clone reaches a parentless root commit — the oldest being
the repository's initial commit of 2025-10-15 and the newest dated 2026-09-03,
across 16 authors. Two commits touch the candidate's *current* path, the more
recent being a licence-text fill on 2026-04-20; following the 2025-12-01 move
out of the repository's examples directory, five commits touch it in all, and
its last content change was 2025-11-17. Either way the reading is the same:
activity in the repository is concentrated in other skills. The
repository has no CI, tests, CONTRIBUTING or CODEOWNERS in its tree, and its
own README carries a disclaimer that the skills are provided for demonstration
and educational purposes. Read as a source of ideas that is what one expects;
read as a dependency it would be a reason for caution, which is one more
argument for the reuse class chosen.

**5. Packaging.** Taking ideas costs the image nothing. Taking the candidate's
`scripts/` would require adding a Python runtime and a second package manager
to a Node-only image that today installs no OS packages at all — and its
requirements file pins nothing, listing two open-ended `>=` floors with no
lockfile. That is the same reproducible-image objection that rejected SheetJS
in `spec.md` §0.4 and knip in `hyg-01`, in a stronger form. Splitting the
adoption at the markdown/scripts seam makes the objection disappear rather
than needing to be argued around.

## Verdict

**IDEAS ONLY.** Licence clean and verified; nothing vendored; no tool
proposed; no dependency added; no image change. What this tick banks is the
measured compatibility corpus, the per-skill licence map that stops a future
tick assuming a root licence that does not exist, the four-skill proprietary
rejection, and two named gaps in Servo's own MCP server surface.

**Explicitly not taken:** the candidate's `scripts/` (egress and packaging,
above); installation of any upstream skill into `skills/` (scope, truncation
and dropped resources, above); and anything from docx, pdf, pptx or xlsx, at
any time, on licence grounds.
