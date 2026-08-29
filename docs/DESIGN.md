# Servo Design System — Color Schema

The single source of truth for Servo's colors is the design system's token
files — `servo_design_system/tokens/*.css` — imported once by
`src/app/globals.css` and exposed as Tailwind utilities through
`@theme inline`. **Dark mode is the tokens' `:root`** (the graphite ramp the
hardware's gearbox wears); **light mode is `.servo-light`** (the white
casing) and is the desk's default, applied by the ThemeProvider. This
document explains the system so every future feature uses it consistently —
and stays accessible in **both** modes.

The palette comes from the hardware the product is named for: the **blue
servo body** (the brand accent), its **gold spec label**, the **orange
signal** and **red power leads**, and the **black gearbox** with its
**white spline**. Blue does the branding, the wire colours do status, and
everything else is a cool blue-cast graphite (`--ink-950 … --ink-500`).
The retired green OKLCH palette this document used to describe is gone
from the product; if you hold an old screenshot, the sidebar is now the
graphite ramp with servo-blue accents.

Every pairing listed here is verified by `node scripts/color-audit.mjs`
(oklch → sRGB → WCAG 2.1 contrast). **Run it whenever you touch a token**;
the audit must report zero FAILs. Current status: ✅ 0 fails (light, dark,
banner).

## Palette at a glance

| Role | Dark (`:root`) | Light (`.servo-light`) | Rule |
|---|---|---|---|
| `--bg` / `--surface` | graphite `--ink-900` `#12151C` / `--ink-850` `#171B24` | paper `--paper-50` `#F5F6FA` / white | Page vs elevated surface |
| `--text-body` / `--text-muted` | body on graphite | body on paper | Body text; secondary text ≥ 4.5:1 on `--surface` in both modes |
| **`--brand`** | **servo blue `--accent-500` `#4E66E4`** | same | **Fills only**: buttons, active bars, count badges. `--brand-ink` (white) sits on it at 7:1 |
| `--brand-strong` (text form) | `--accent-300` | `--accent-700` | Blue used **as text** (links, hovers, icons on surfaces) ≥ 4.5:1 |
| `--good / --warn / --serious / --critical` | wire colours: green-400 / gold-400 / orange-400 / red-400 | darker steps of the same hues | Status text/icons; each passes on `--card` in both modes |
| `--*-soft` / `--*-chip` | deep tinted chip surfaces with their own `-ink` | pastel chip surfaces | Status chips: `chip-ink` on `chip` is the audited pairing |
| `--sidebar` | `--bg-elevated` (graphite) | same | The shell panel; `--sidebar-primary` is servo blue; foreground opacities audited to `/50` |
| `--chart-1..5` | blue / green / gold / orange / graphite steps | same hues, darkened for paper | Series colors, fixed order, ≥ 3:1 vs card. Use through shadcn `ChartConfig` only |
| Tone maps in `@/lib/labels` | `STATUS_TONE`, `PRIORITY_TONE`, `RISK_TONE`, `RUN_STATUS_TONE`… | same | Status badges via `@/components/legacy/Badge`. All ≥ 4.5:1 |

## Usage rules

1. **Two blues, two jobs.** `bg-primary` + `text-primary-foreground` for
   filled controls; `text-primary-strong` for blue text/icons on light or
   dark surfaces. Never use `text-primary` for copy — it is a fill colour.
2. **Status = tones, never raw colours.** Badges and status highlights go
   through the `BadgeTone` maps in `src/lib/labels.ts` so light/dark
   variants come free.
3. **Charts speak `--chart-N`.** Series colours only via `ChartConfig`
   (`color: "var(--chart-1)"`); identity keeps a fixed slot (blue = the
   brand series). Text in charts uses ink tokens, never series colours.
4. **No raw hex in components** — `scripts/no-hex-lint.mjs` enforces it
   across the tree. If a value isn't a token, add it to
   `servo_design_system/tokens/colors.css` (dark **and** `.servo-light`)
   and re-run the audit.
5. **The sidebar is graphite, brand-accented.** Use `--sidebar-*` tokens
   inside it; foreground opacities down to `/50` are audited safe — don't
   go lower for text.
6. **Alpha washes** (`bg-warn-soft/40`-style) are fine for large surfaces,
   but text sitting on them must still be a tone text token.

## Brand assets

`docs/assets/logo.svg` (wordmark only — no icon, per the brand decision)
and `banner.svg` (graphite ramp, wordmark + tagline, all text ≥ 4.5:1).
The wordmark is "Servo" + servo-blue period; the period always uses
`--brand`.

## Verifying

```bash
node scripts/color-audit.mjs   # WCAG pairings
node scripts/no-hex-lint.mjs   # every colour a token, every token defined
```

Add a row to the audit script's `pair(...)` checks whenever you introduce
a new foreground/background combination.
