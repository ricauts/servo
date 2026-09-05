# Servo design — colour, and how it is verified

Every colour, face, radius, shadow and motion value the app renders comes from
the design system's token files, `servo_design_system/tokens/*.css`, imported
once by `src/app/globals.css` and mapped there onto the shadcn vocabulary and
onto Tailwind utilities (`@theme inline`). No component carries a literal
colour: `npm run lint:hex` (`scripts/no-hex-lint.mjs`) fails CI on a hex,
`rgb()`, `hsl()` or `oklch()` literal under `src/app/` or `src/components/`,
and on any `var(--x)` no token defines. The full rationale — mood, type,
spacing, motion, iconography — is `servo_design_system/readme.md`; the specimen
cards are `servo_design_system/guidelines/*.card.html`.

## The palette

Cool graphite neutrals and one brand colour, servo blue. Formal, not neon: the
status hues are pulled back so they read at a glance without fluorescing.

- **Two themes; light is the default and the showcase.** The tokens' `:root`
  block is dark and `.servo-light` is light. `src/app/layout.tsx` sets
  `defaultTheme="light"`, and `src/components/shell/ThemeProvider.tsx` maps
  light to the `servo-light` class and dark to Tailwind's `dark`. The README
  screenshots are light.
- **Surfaces.** A blue-cast graphite ramp (`--ink-950` … `--ink-500`) on
  dark; paper `--paper-50` for the page and white for cards on light. Use the
  semantic names — `--bg`, `--surface`, `--surface-2`, `--surface-hover`,
  `--surface-active`, `--surface-inset` — and the hairlines `--line`,
  `--line-strong`, `--line-brand`.
- **Servo blue is a fill.** `--brand`, always with `--brand-ink` (white) on
  it, paints buttons, active bars and count badges. Blue as **text or icon**
  is `--text-brand` (`text-text-brand`): a lighter step of the ramp on dark,
  a darker one on light, each chosen to pass on a card. Never set `--brand`
  as a text colour.
- **Text ramp.** `--text-strong`, `--text-body`, `--text-muted`,
  `--text-faint` (`text-text-strong` … `text-text-faint`). A quieter ink is
  a token, never an alpha tint.
- **Status is a fixed vocabulary:** `good` (green), `warn` (gold), `serious`
  (orange), `critical` (red), `info` (teal), `neutral` (graphite). The hues
  do not move between themes or accent themes. `violet` is the legacy alias
  of `info` kept in `src/app/globals.css`. The maps in `src/lib/labels.ts`
  translate ticket status, priority, risk and run status into those tones.
- **Chips are opaque triples.** A badge is `--<tone>-chip` (surface) +
  `--<tone>-chip-line` (hairline) + `--<tone>-chip-ink` (text); as
  utilities, `bg-good-chip border-good-chip-line text-good-chip-ink`.
  `src/components/common/Badge.tsx` renders that recipe and alerts and the
  danger button reuse it. Never an alpha wash for a chip.
- **Flat ink.** No gradient washes, no glow. A card is `--surface` plus a 1px
  `--line`; drop shadows (`--shadow-2`, `--shadow-3`) appear only on
  floating surfaces — popovers, dialogs, the command palette.
- **Charts.** Series colours are `--chart-1` … `--chart-5` in a fixed
  order: `--chart-1` is the resolved/positive green, `--chart-2` the brand
  series. Strokes 1.75px, area fills about 13% opacity, hairline gridlines
  (`stroke-chart-grid`) and mono axis labels (`text-chart-axis`). Series
  colours reach Recharts through `ChartConfig` (`color: "var(--chart-1)"`)
  and are never used as text.
- **Type and controls.** Chivo for the UI, IBM Plex Mono for ids, statuses,
  timestamps and data labels. Controls are 32px in the desk.

## base.css sits in the `base` layer

`servo_design_system/tokens/base.css` carries bare element rules (`h1`–`h6`,
`a`, `:focus-visible`). `src/app/globals.css` imports it with `layer(base)`
so Tailwind utilities keep outranking it. Imported unlayered, its `a{color}`
beat `text-primary-foreground` on link-styled buttons and the tickets page
CTA rendered at 1.3:1 (spec question 135). Keep the `layer(base)` when you
touch that import.

## Verifying

```bash
npm run lint:hex                       # every colour a token, every token defined (CI)
node scripts/dev/color-audit.mjs       # WCAG 2.1 contrast of the shipped pairs, both themes
node scripts/dev/responsive-audit.mjs  # horizontal overflow on every route (dev server running)
```

**`scripts/dev/color-audit.mjs`** reads `servo_design_system/tokens/colors.css`
— `:root` as dark, `:root` overlaid with `.servo-light` as light — resolves
`var()` chains and measures the pairs the desk renders: the text ramp on
`--surface` and `--bg` (body and muted at 4.5:1, faint at 3:1), `--brand-ink`
on `--brand`, `--text-brand` on `--surface`, every `--<tone>-chip-ink` on its
chip, every status tone as text on `--surface`, `--brand` as a fill on
`--surface` (3:1), `--chart-1` … `--chart-5` on `--surface` (3:1) and
`--line` on `--surface` (at least 1.3:1, so the hairline is visible). It
prints a table per theme and exits 1 on any FAIL; Node builtins only. Run it
whenever you touch a token, and add a row to its `PAIRS` list for any new
foreground/background pairing. On 2026-09-05 it measured 27 pairs per theme
with one miss each: light `--text-faint` on `--bg` at 2.87 and dark `--line`
on `--surface` at 1.19 — both token retunes in `colors.css`, not component
work.

**`scripts/dev/responsive-audit.mjs`** renders every desk route
(`/dashboard`, `/tickets`, `/tickets/new`, `/approvals`, `/groups`,
`/agents`, `/runs`, `/skills`, `/kb`, `/kb/graph`, `/kb/sources`, `/packs`,
`/integrations`, `/settings`) at 360, 375, 768, 1280 and 1440px and fails on
any document wider than its viewport; a directory as the second argument
keeps screenshots of the failures. It drives the system Chrome through
`puppeteer-core`, which downloads nothing: the binary comes from
`SERVO_CHROME` or `PUPPETEER_EXECUTABLE_PATH` when set, otherwise from a
Windows/Linux/macOS candidate list, and when none exists the script refuses
with that list rather than a `spawn ENOENT` (spec question 136). Neither
audit runs in CI; `lint:hex` does.

## Brand assets

`docs/assets/logo.svg` is the wordmark — "Servo" plus a period in `--brand`;
there is no icon mark. `docs/assets/banner.svg` is the repository banner:
graphite ground, servo-blue accents, the wordmark and tagline.
