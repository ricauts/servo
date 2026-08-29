# Third-party notices

Servo is MIT licensed (see [`LICENSE`](LICENSE)). This file is the register of
**everything in this repository that someone else wrote and we kept**, together
with the upstream copyright notice and licence that came with it.

## The rule this file exists to enforce

**Vendored code must appear here.** If a change copies source code from another
project into this tree — in whole, in part, or lightly adapted — that change
adds a section below in the same commit, carrying the upstream copyright notice
verbatim, the licence, and the exact upstream path it came from. A copy with no
entry here is a defect, not an oversight.

Two things are deliberately *not* in scope, so the register stays meaningful:

- **Ordinary npm dependencies are not vendored code.** A package installed from
  the registry ships its own licence inside `node_modules/`, is declared in
  `package.json`, and is not copied into this tree. It earns an entry here only
  when the adopt-first gate records a verdict worth keeping — a licence that
  differs from the code around it, an obligation that attaches on
  redistribution, or an upstream we pin rather than track.
- **Reimplementing an observed design is not copying.** Reading how another
  project solved something and writing our own version needs no entry here, and
  `docs/PORTING-LEDGER.md` is where that distinction is recorded per capability.

## Which licences may be adopted at all

The gate is applied *before* code is written, and its verdict is recorded in the
changelog row for that piece of work whether or not anything is adopted.

| Licence | Verdict |
|---|---|
| MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, CC0-1.0, Unlicense | **Adoptable.** Copy is permitted with attribution recorded here. |
| GPL, AGPL, SSPL | **Rejected.** Not adoptable into this tree in any form. |
| No `LICENSE` file in the upstream repository | **Ideas only.** Read it, learn from it, never copy a line. |

A licence is established by **reading the upstream `LICENSE` file**, not by
recalling what a project is usually licensed under, and an entry below records
the date that reading happened.

## Entry format

Each adopted or vendored component gets one section, in this shape:

```markdown
### <component name>

- **Upstream:** <url>
- **Licence:** <SPDX identifier>, verified from <url of the LICENSE file> on <YYYY-MM-DD>
- **Copyright:** <the upstream notice, verbatim>
- **What we use:** <the file(s) or the scope, and where they live in this tree>
- **Obligations:** <what the licence requires of us, or "attribution only">
```

Where a component's *code* and its *data* (model weights, corpora, icon sets)
carry different licences, both are recorded, each with its own verified source —
a permissive code licence says nothing about what ships beside it.

## Entries

### exceljs (kb-06)

- **Upstream:** <https://github.com/exceljs/exceljs>
- **Licence:** MIT, verified from the `LICENSE` file shipped in the installed
  package (`node_modules/exceljs/LICENSE`, identical to
  <https://github.com/exceljs/exceljs/blob/master/LICENSE>) on 2026-08-28.
- **Copyright:** `Copyright (c) 2014-2019 Guyon Roche`
- **What we use:** an ordinary npm dependency (4.4.0), not vendored code —
  no file from it lives in this tree. It parses uploaded .xlsx workbooks
  inside the forked extraction worker (`src/lib/kb/extract-worker.cjs`,
  spec kb-06). The entry exists to record the adopt-first verdict, because
  this was a new RUNTIME dependency choice rather than a default:
  **SheetJS (`xlsx`) was considered and REJECTED** — its npm package has
  been frozen at 0.18.5 since 2022-03 with two unfixed high-severity CVEs
  (prototype pollution and ReDoS), and upstream distributes fixes only
  through its own CDN rather than the registry, which would make Docker
  builds non-reproducible. exceljs is registry-maintained and MIT.
- **Obligations:** attribution only, and discharged by `package.json`
  shipping the dependency: its licence travels inside `node_modules` to
  every install. Nothing of it is copied into this tree.

### unpdf (kb-07)

- **Upstream:** <https://github.com/unjs/unpdf>
- **Licence:** MIT, verified from the `LICENSE` file shipped in the installed
  package (`node_modules/unpdf/LICENSE`, identical to
  <https://github.com/unjs/unpdf/blob/main/LICENSE>) on 2026-08-28.
- **Copyright:** `Copyright (c) 2023-PRESENT Johann Schopplich`
- **What we use:** an ordinary npm dependency (1.8.1), not vendored code. It
  wraps Mozilla's pdf.js (Apache-2.0, unbundled by upstream) as pure ESM
  with **zero runtime dependencies**, and extracts a PDF's text layer per
  page inside the forked extraction worker (`src/lib/kb/extract-worker.cjs`,
  spec kb-07) — dynamically imported, since the worker is CommonJS and the
  package is ESM-only. The entry records the adopt-first verdict for the
  new RUNTIME dependency: **pdf-parse v2 was considered and REJECTED** —
  it drags `@napi-rs/canvas` (a native module) into the image for no
  benefit here, where only text is read.
- **Obligations:** attribution only, discharged by `package.json` shipping
  the dependency: its licence travels inside `node_modules` to every
  install. Nothing of it is copied into this tree.

### shadcn/ui

- **Upstream:** <https://github.com/shadcn-ui/ui> — two layers of its component
  registry, both added to this tree by the `shadcn` CLI rather than installed
  at build time: the `radix` base (`apps/v4/registry/bases/radix/`) supplies the
  component source, and the `nova` style
  (`apps/v4/registry/styles/style-nova.css`) supplies the utility classes the
  CLI inlines into it. `components.json` records the pairing as
  `"style": "radix-nova"`.
- **Licence:** MIT, verified from
  <https://raw.githubusercontent.com/shadcn-ui/ui/main/LICENSE.md> on
  2026-08-28. The file's first lines read `MIT License` / `Copyright (c) 2023
  shadcn`, and it carries the standard MIT notice clause.
- **Copyright:** `Copyright (c) 2023 shadcn`
- **What we use:** the 23 primitives under `src/components/ui/` — alert, avatar,
  badge, button, card, chart, command, dialog, dropdown-menu, input, input-group,
  label, scroll-area, select, separator, sheet, skeleton, sonner, switch, table,
  tabs, textarea, tooltip — and the `cn` helper at the top of `src/lib/utils.ts`.
  They are close copies. The differences are almost entirely the CLI's own
  output: import specifiers rewritten to this repo's `@/` alias, and the `nova`
  style's utility classes inlined in place of upstream's `cn-*` class names. The
  only Servo-authored edit inside the 23 files is a lint-suppression comment at
  `src/components/ui/chart.tsx:68`. Every export in `src/lib/utils.ts` other than
  `cn` is Servo's own.
- **Obligations:** attribution only. MIT requires the copyright notice *and* the
  permission notice to travel with copies of the software. The copied files
  carry no header of their own — and re-heading 23 CLI-managed files would be
  undone by the next `shadcn` run — so both notices travel here, reproduced in
  full rather than linked:

  > MIT License
  >
  > Copyright (c) 2023 shadcn
  >
  > Permission is hereby granted, free of charge, to any person obtaining a copy
  > of this software and associated documentation files (the "Software"), to deal
  > in the Software without restriction, including without limitation the rights
  > to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
  > copies of the Software, and to permit persons to whom the Software is
  > furnished to do so, subject to the following conditions:
  >
  > The above copyright notice and this permission notice shall be included in all
  > copies or substantial portions of the Software.
  >
  > THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
  > IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
  > FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
  > AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
  > LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
  > OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
  > SOFTWARE.

**A note on why this entry exists.** Upstream's documentation says the code the
CLI writes into your project is yours to own and change, and that is true of
customisation and of upgrade mechanics. It is not a waiver of the MIT notice
clause, and upstream publishes no such waiver. Recording the notice costs one
section and settles the question; omitting it would leave copied files with no
attribution anywhere in the tree.

---

## What has and has not been checked

This register is only as good as the search behind it, so the search is stated
rather than implied.

**Established.** A scan of every tracked file for SPDX identifiers, `@license`
headers and copyright notices returns no SPDX identifier and no `@license`
header anywhere. The copyright notices it does return fall into three groups:
Servo's own (`LICENSE`, `README.md`); notices *quoted inside* licence audits in
`spec.md` and `docs/design/` — descriptions of components under consideration,
not code in this tree; and the shadcn/ui notice in this file, which is the one
genuine third-party notice in the repository and is here by design.

**The limit of that method, stated plainly.** A header scan cannot prove absence
of vendoring, because vendored code need not carry a header — the shadcn/ui
entry above is exactly that case, and the scan does not find it. Anything
recorded here was found by knowing where to look.

**Open, and not resolved by this register.** Three tracked files under
`servo_design_system/` declare an origin outside this repository in their own
first lines:

- `servo_design_system/support.js:1` — `GENERATED from dc-runtime/src/*.ts`.
  No `dc-runtime` exists anywhere in this repository.
- `servo_design_system/ui_kits/site/doc-page.js:2` and
  `.../image-slot.js:2` — `Copied omelette starter`.

Whether those upstreams are the owner's own tooling or someone else's is not
something this tree records, and it is not a question to guess at: an attribution
register that invents a provenance is worse than one that names the gap. The
gap is filed as **owner question 41** in `spec.md`, and an entry is added here
the moment it is answered.

**The two starters are also compiled into a fourth file.**
`servo_design_system/_ds_bundle.js` opens with a manifest listing 31
`components/*.jsx` sources, but the manifest does not describe the whole file:
the bundle additionally embeds `ui_kits/desk/*` and `ui_kits/site/*`, and lines
3300 and 4021 are `doc-page.js` and `image-slot.js` verbatim, "Copied omelette
starter" headers and all — roughly 2,000 of its 5,295 lines. So `_ds_bundle.js`
inherits whatever answer question 41 gets; it is not cleared by its own
manifest, and an earlier draft of this file wrongly said it was.

What *is* established about the bundles: none of them embeds a third-party
library. React is taken from a runtime global rather than compiled in, and the
only licence-shaped strings inside are marketing copy.

`docs/PORTING-LEDGER.md` records the complementary result for the porting
programme specifically: desk memory, the egress-guarded web read and the skills
format were each reimplemented against Servo's own contracts with no code
lifted, and each entry there says so. That ledger is scoped to capabilities
ported deliberately; this register is scoped to the whole tree.

Several planned changes bring in further third-party components. Each adds its
section here in the same commit that adds the code — never afterwards.
