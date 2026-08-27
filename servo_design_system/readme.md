# Servo Design System

Servo is an **open-source, self-hostable ticket system with AI integrated into it**.
Tickets arrive by email, form or API; assignment groups own categories and members
carry junior→senior tiers, so work lands on the right person instead of in a pile.
Roles and a permission matrix decide who sees and who signs off, and approval gates
stop anything risky until a named human decides — the run then resumes exactly where
it paused. AI is one participant in that queue, not the product: it triages, drafts
replies and operates real tools (SQL against a sandboxed ops database, device
inventory, GitHub repos/branches/PRs, live Azure queries, screenshots), always
behind the same gates. SLA targets, automatic escalation and a readable audit trail
exist for one reason: **less time lost to handoffs, sign-offs and status chasing.**

The positioning line: **ticketing your whole team works in — with nobody waiting.**
"Asks before it acts" stays as the promise attached to the approval gates, not as
the headline.

This design system is a **new brand direction** for Servo — servo blue on cool
graphite, technical and clean — applied to the product's real structure. Component inventory, screen
layouts, status vocabulary, tone and copy all come from the codebase; the
typography, colour treatment and surface language are new.

## Surfaces in this system

| Surface | What it is | Kit |
|---|---|---|
| **Desk app** | The service desk itself: dashboard, ticket queue, ticket detail with agent runs, approvals queue, agents | `ui_kits/desk/` |
| **Marketing site** | servoai.org — the single landing page | `ui_kits/site/` |

## Sources

- **GitHub — [github.com/ricauts/Servo](https://github.com/ricauts/Servo)** (branch `main`). Read for this system: `src/app/globals.css` (the pre-existing OKLCH token set), `src/app/layout.tsx`, `docs/DESIGN.md` (colour rules), `README.md` (features + copy), `components.json` (shadcn config, `iconLibrary: "lucide"`), `src/components/ui/*` (shadcn primitives: button, badge, card, input), `src/components/legacy/*` (Badge, Avatar, Button, Card, EmptyState, Field, Spinner), `src/components/shell/{Sidebar,SidebarNav}.tsx`, `src/components/tickets/{TicketsTable,RunGroup,SlaBadge}.tsx`, `src/components/dashboard/{StatTile,AiVsHumanBar}.tsx`, `src/components/admin/ApprovalCard.tsx`, `src/lib/labels.ts` (the status/tone maps). **Worth exploring further** before designing anything new for Servo — the timeline, settings and integrations code has more detail than any screenshot.
- **Product screenshots** copied to `docs/assets/` from the repo (`screenshot-dashboard`, `-tickets`, `-ticket-detail`, `-approvals`, `-agents`). These show the *original* light-green identity — useful for layout, not for colour.
- **Reference images** the user supplied in `uploads/` (unrelated companies' sites: EQTY Lab, MiniMax, Guardbase, a Livo AI page, a Glyph Beers label). These set the requested *techy, clean* mood — mono labels, crop marks, dot grids, near-black surfaces, one signal colour. Nothing was copied from them.
- **Original brand asset:** the repo ships a wordmark only (`docs/assets/logo.svg`) — "Servo" + a green period, no icon mark. Preserved as `assets/wordmark-legacy.svg`.

## Content fundamentals

Servo's writing is **plain, technical and specific**. It describes what the
software does and does not do, in the fewest words that stay accurate.

- **The subject is the team, not the robot.** Copy leads with what people can do
  (assign, approve, escalate, see) and treats AI as one worker in the queue.
- **Voice:** matter-of-fact engineer. Claims are followed by their mechanism
  ("Rejections flow back to the agent, which adapts instead of retrying").
  Honest limits are stated out loud ("Without a token they stay simulated so the
  offline demo keeps working").
- **Person:** the product is described in the third person ("Servo speaks the
  Model Context Protocol"); UI copy addresses the user as *you* only where an
  action is theirs ("Why are you approving or rejecting this action?").
- **Casing:** sentence case everywhere — headings, buttons, labels. The only
  uppercase is mono micro-labelling (`AVG FIRST RESPONSE`, `PENDING`) and
  system enums quoted verbatim (`LOW/MEDIUM/HIGH`, `ADMIN`, `QA PASS`).
- **Machine words stay machine words.** Tool names, statuses and ids are never
  prettified: `github_edit_file`, `#1061`, `WAITING_APPROVAL`, `sla/scan`.
- **Numbers are exact and unitised:** `37 min`, `3.6 h`, `54 %`, `67% accepted as-is`.
- **Buttons are verbs:** *Approve & send*, *Regenerate*, *Discard*, *Escalate a
  tier*, *Run AI resolver*, *Star on GitHub*.
- **Explain the consequence next to the control:** "Approving posts this as a
  public comment and emails it to Dana Whitfield. Their reply threads back onto
  this ticket."
- **No emoji. No exclamation marks. No hype adjectives** ("revolutionary",
  "seamless"). Em dashes are used, sparingly, for the aside that carries the
  caveat.
- **Marketing copy** allows exactly one rhetorical move — the promise plus its
  guardrail: *"asks before it acts."* Time saved is stated as a mechanism, never as
  a percentage nobody measured.

## Visual foundations

**Mood.** Instrumented, not decorated — the palette is lifted straight off the
hardware the product is named after: a blue servo body, its gold spec label, the
orange signal and red power leads, the black gearbox. A cool graphite room, servo
blue as the only brand colour, the wire colours reserved for status. Everything
reads like a readout: mono labels, exact numbers, tight corners. **Nothing neon** —
saturated enough to read at a glance, never fluorescent.

- **Colour.** Cool graphite ink ramp (`--bg #0D0F14` → `--surface-active #2F3644`),
  one brand accent: **servo blue** `--brand #4E66E4` on dark, `#2F44C9` on light,
  always with white ink on it (`--brand-ink`). The wire colours carry status —
  gold `#E0B84E` waiting, orange `#F0894F` open, red `#E97C72` urgent or failed,
  teal `#62BFD1` in progress, green `#66C79A` resolved. Blue as *text or icon* uses `--text-brand`
  (`--accent-300` on dark, `--accent-700` on light) — `--brand` is a **fill only**,
  and never carries text at display sizes. Status is a fixed vocabulary
  (`good / warn / serious / critical / info / neutral`). A badge is a **deep tinted
  chip**: a dark tone-on-tone surface, a tinted hairline and bright text
  (`--*-chip` / `--*-chip-line` / `--*-chip-ink`) — instrumentation, not a
  coloured sticker. Alerts and the danger button use the same recipe. `quiet` drops the chip and leaves the tone as
  text, for dense rows carrying several badges at once. Never a raw hex, never an alpha tint. Light surfaces exist for
  in-product use via `.servo-light` — and that is where the **desk app** lives: a
  neutral paper page (`#F5F6FA`) with pure-white cards, so the working screens
  have real contrast between page and card. In light mode the **sidebar stays a
  dark graphite panel** (`.svo-sidepanel` scopes the ink tokens), the way the
  original app kept a brand panel; the sun/moon toggle flips the whole desk.
  Marketing stays dark.
- **Type.** Two faces. **Chivo** for everything visible (display 40–104px at
  weight 600 and −0.03em; UI base 13.5px; the wordmark at weight 900, −0.04em).
  **IBM Plex Mono** for labels, ids, tool names, timestamps, code and transcripts
  — uppercase at 10.5px with 0.14em tracking when it labels, sentence case at
  12.5px when it carries data. No serif anywhere (the previous identity used
  Merriweather for body; this one drops it).
- **Spacing & layout.** 4px base with 2 and 6 available for dense desk chrome.
  Controls are 32px in the app, 44px on marketing. Sidebar is a fixed 240px,
  sticky full height; page content sits in a 24px gutter; marketing centres on a
  1200px container. Page headers are a hairline-separated band, not a card.
- **Backgrounds.** Flat ink. The only texture is a 1px dot grid at 24px
  (`--dot-grid`), used behind the hero and screenshot frames. No photography, no
  illustration, no gradient washes — the one permitted glow is `--glow-brand`
  around a primary action. No AI-gradient blobs.
- **Borders, cards, elevation.** Cards are `--surface` + a 1px `--line` +
  10px radius + a 1px top inset highlight (`--inset-top`). That inset *is* the
  elevation on dark; drop shadows only appear on floating things (popover
  `--shadow-2`, dialog/palette `--shadow-3`). Insets (`--surface-inset`) are used
  for code blocks and transcripts. Dashed hairlines mark empty states and
  machine-written timeline notes.
- **Corners.** 4/6/8/10/14px. Buttons and inputs 8px, cards 10px, marketing
  panels 14px. Pills (`--radius-full`) are reserved for badges, counts and
  avatars.
- **Transparency & blur.** Status and brand chips are opaque. Only two places use it: the sticky site nav
  (`#050706e6` + `--blur-panel`) and modal scrims (`--scrim` +
  `--blur-scrim`). Status tints are alpha over ink so they survive both themes.
- **Motion.** 120ms for hover and colour, 180ms for menus and tooltips, 280ms
  for sheets and panels, 600ms for marketing reveals; easing
  `cubic-bezier(0.2,0,0,1)`. No bounce, no spring, no parallax. Reduced-motion
  zeroes every duration.
- **Hover / press / focus.** Hover recolours: fills step one stop lighter
  (`--brand-hover`), quiet controls take `--surface-hover` and brighten their
  text. Press drops the control 1px (`--press-shift`) and darkens the fill —
  taken from the app's `active:translate-y-px`. Focus is a 3px blue ring
  (`--focus-ring`) plus a blue border; nothing relies on colour alone.
- **Imagery.** No stock photography and no illustration. Real product footage and
  real screenshots only, dropped into **asset slots** framed as a window: mono
  chrome bar (three dots + `servo — ticket #1061 · frontend agent`), hairline
  border, 14px radius, graphite surface behind. The landing kit ships one
  full-width film slot plus three screenshot slots (`ui_kits/site/image-slot.js`) —
  drop your own files onto them. Corner crop marks (10px, servo blue, 1px) are the
  secondary framing device.
- **Charts.** Fixed series order, green always the resolved/positive series,
  1.75px strokes, 13% fills, mono axis labels, hairline gridlines.

## Iconography

- **Lucide, exclusively** — the app declares `iconLibrary: "lucide"` and uses it
  everywhere. This system loads Lucide from CDN
  (`unpkg.com/lucide@0.469.0/dist/umd/lucide.min.js`) and wraps it in the
  **`Icon`** component (`<Icon name="shield-check" size={16} />`). No icons were
  found as files in the repo, so nothing was copied; if you vendor Lucide later,
  swap the CDN tag and `Icon` keeps working.
- **Sizes & weight:** 16px at UI scale, 14px inside buttons and badges, 20px in
  empty states; stroke 2, `currentColor` always.
- **The working set:** `inbox` (tickets), `shield-check` (approvals),
  `layout-dashboard`, `bot` (agents), `users-2` (groups), `plug` (integrations),
  `settings-2`, `search`, `sparkles` (run the AI), `clipboard-check` (QA),
  `git-branch` / `git-pull-request`, `pencil-line` (draft), `mail`,
  `refresh-cw`, `check`, `x`, `chevron-right`, `chevron-down`, `arrow-left`,
  `arrow-up-right`, `alert-triangle`, `moon`, `log-out`, `star`, `terminal`.
- **No emoji, ever.** The previous identity used a `⚙` glyph inside AI avatars;
  this one labels them `AI` in mono instead. Unicode is used only as typographic
  punctuation: `·` between meta items, `—` for an em dash, `×2` for repeat
  counts, `★` in the GitHub star button.
- **Never hand-draw an icon or a logo mark.** Servo has no icon mark — render the
  wordmark (`Wordmark`, or `assets/wordmark-light.svg`) wherever a mark belongs.

## Index

**Root:** `styles.css` (the single entry point — imports only), `readme.md`,
`SKILL.md`, `github.md`, `thumbnail.html`.

**Tokens** — `tokens/fonts.css`, `colors.css`, `typography.css`, `spacing.css`,
`effects.css`, `motion.css`, `themes.css`, `base.css`.

**Light and dark.** Both modes are first class. `:root` is dark; `.servo-light` on
`<body>` is light. The desk kit ships light with a working sun/moon toggle in the
sidebar; the marketing kit is dark. Components read semantic tokens only, so
nothing needs a mode-specific branch.

**Accent themes.** Servo blue is the default and needs no class. `tokens/themes.css`
adds three alternates — `.servo-theme-moss`, `.servo-theme-copper`,
`.servo-theme-graphite` — each swapping the accent *and* the ink cast. Put the class
on `<html>` or `<body>`; combine with `.servo-light`. Status tones never change.

**Assets** — `assets/wordmark-light.svg`, `wordmark-dark.svg`,
`wordmark-legacy.svg` (the original Lato mark, for reference).
Product screenshots of the previous identity live in `docs/assets/`.

**Guidelines / specimen cards** — `guidelines/*.card.html`: colours (servo blue,
graphite surfaces, light surfaces, text ramp, status tones, chart series, accent
themes),
type (display, UI, mono, wordmark), spacing (scale, control heights, radii,
elevation), brand (grid & crop marks, motion).

**Components** (`components/core/`, `components/product/`) — each with a
`.d.ts` props contract, a `.prompt.md` usage note, and one `@dsCard` demo per
directory:

- Core: `Alert`, `Avatar`, `Badge`, `Button`, `Card`, `Dialog`, `EmptyState`,
  `Field`, `Icon`, `Input`, `Select`, `Separator`, `Skeleton`, `Spinner`,
  `Switch`, `Table`, `Tabs`, `Textarea`, `Tooltip`, `Wordmark`
- Product: `ApprovalCard`, `CommandPalette`, `PageHeader`, `ReplyDraftCard`,
  `RunSummary` (with `RunStep`), `SidebarNav`, `SlaBadge`, `StatTile`,
  `TicketsTable`, `TimelineEntry`

**UI kits** — `ui_kits/desk/` (five click-through desk screens),
`ui_kits/site/` (the landing page). Each has its own README.

### Intentional additions

The source is a shadcn/ui app, so its primitive inventory is shadcn's. Three
things here have no 1:1 file upstream:

- **`Icon`** — a wrapper over Lucide, so icon usage is consistent and swappable.
- **`Wordmark`** — the brand mark as a component, to stop anyone drawing one.
- **`RunSummary` / `RunStep`** — a rename of the app's `RunGroup`, kept because
  the folded-run entry is Servo's most distinctive product pattern.

Not built (present upstream, out of scope here): `chart`, `command`
(as a full combobox), `dropdown-menu`, `input-group`, `scroll-area`, `sheet`,
`sonner` toasts, and the settings/integrations admin forms.

### Fonts — substitution to confirm

No font binaries ship with the repo. The previous identity used Lato +
Merriweather + Roboto Mono (Google Fonts, loaded via `next/font`). This system
replaces them with **Chivo** and **IBM Plex Mono**, also Google Fonts, loaded
from the Google CDN in `tokens/fonts.css` — so there are no self-hosted
`@font-face` files. **If Servo owns licensed brand faces, send them and this
becomes a two-line change.**
