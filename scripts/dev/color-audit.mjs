// WCAG 2.1 contrast audit of the SHIPPED colour tokens, in both themes.
//
// Reads servo_design_system/tokens/colors.css — the file src/app/globals.css
// imports, so what is audited is what renders. The `:root` block is the dark
// theme; `:root` overlaid with `.servo-light` is the light theme. var(--x)
// chains are resolved (`--brand: var(--accent-600)` → `#3447B0`), 3/4/6/8-digit
// hex is understood, and an 8-digit (alpha) foreground is composited over its
// background before measuring. One table per theme, PASS/FAIL per pair, exit 1
// on any FAIL. Node builtins only — no dependency, nothing to install.
//
//   node scripts/dev/color-audit.mjs [path/to/colors.css]
//
// The pairs are the ones the desk actually renders, with WCAG 2.1 AA targets
// (4.5:1 body text, 3:1 large text and non-text UI, 1.4.3 / 1.4.11):
//
//   --text-body, --text-muted     on --surface and --bg   4.5   body, secondary text
//   --text-faint                  on --surface and --bg   3     captions, mono micro-labels
//   --brand-ink                   on --brand              4.5   label on the brand fill (buttons)
//   --text-brand                  on --surface            4.5   blue as text — --brand itself is a fill
//   --<tone>-chip-ink             on --<tone>-chip        4.5   good warn serious critical info neutral brand
//   --<tone>                      on --surface            4.5   good warn serious critical info, as text/icon
//   --brand                       on --surface            3     the primary fill against its card
//   --chart-1 … --chart-5         on --surface            3     series marks
//   --line                        on --surface            1.3   a hairline has to be visible (not an AA figure)
//
// Add a row to PAIRS when you introduce a new foreground/background pairing.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..", "..");
const TOKENS_PATH =
  process.argv[2] ?? path.join(REPO_ROOT, "servo_design_system", "tokens", "colors.css");

// ---- CSS custom-property parsing ---------------------------------------------

/** `selector -> Map(--name -> raw value)` for every `selector{...}` block. */
export function parseBlocks(css) {
  const stripped = String(css).replace(/\/\*[\s\S]*?\*\//g, "");
  const blocks = new Map();
  for (const m of stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = m[1].trim();
    const decls = blocks.get(selector) ?? new Map();
    for (const decl of m[2].split(";")) {
      const d = /^\s*(--[A-Za-z0-9_-]+)\s*:\s*(.+?)\s*$/.exec(decl);
      if (d) decls.set(d[1], d[2]);
    }
    blocks.set(selector, decls);
  }
  return blocks;
}

/** Follow `var(--x)` chains (honouring a fallback when the target is undefined). */
export function resolveVar(name, vars, seen = new Set()) {
  if (!vars.has(name)) throw new Error(`${name} is not defined`);
  if (seen.has(name)) throw new Error(`${name} is part of a var() cycle`);
  seen.add(name);
  const raw = vars.get(name).trim();
  const ref = /^var\(\s*(--[A-Za-z0-9_-]+)\s*(?:,\s*([^)]*))?\)$/.exec(raw);
  if (!ref) return raw;
  if (!vars.has(ref[1]) && ref[2] != null) return ref[2].trim();
  return resolveVar(ref[1], vars, seen);
}

// ---- colour maths ------------------------------------------------------------

/** #rgb, #rgba, #rrggbb or #rrggbbaa → { r, g, b, a, hex }; null if not hex. */
export function parseHex(value) {
  const m = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(String(value).trim());
  if (!m) return null;
  let h = m[1];
  if (h.length <= 4) h = [...h].map((c) => c + c).join("");
  const n = (i) => parseInt(h.slice(i, i + 2), 16);
  return {
    r: n(0),
    g: n(2),
    b: n(4),
    a: h.length === 8 ? n(6) / 255 : 1,
    hex: `#${h.toUpperCase()}`,
  };
}

const channel = (c) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

/** WCAG 2.1 relative luminance of an opaque sRGB colour. */
export const luminance = ({ r, g, b }) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);

/** WCAG 2.1 contrast ratio, 1 … 21. */
export const contrast = (l1, l2) => (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);

/** Alpha-composite `fg` over an opaque `bg` the way the browser paints CSS colours. */
export function over(fg, bg) {
  if (fg.a >= 1) return fg;
  const mix = (f, b) => Math.round(f * fg.a + b * (1 - fg.a));
  return { r: mix(fg.r, bg.r), g: mix(fg.g, bg.g), b: mix(fg.b, bg.b), a: 1, hex: fg.hex };
}

// ---- the pairs ---------------------------------------------------------------

const TEXT_TONES = ["good", "warn", "serious", "critical", "info"];
const CHIP_TONES = [...TEXT_TONES, "neutral", "brand"];

/** [foreground, background, minimum ratio, what the pairing is on screen] */
export const PAIRS = [
  ...["--surface", "--bg"].flatMap((bg) => [
    ["--text-body", bg, 4.5, "body text"],
    ["--text-muted", bg, 4.5, "secondary text"],
    ["--text-faint", bg, 3, "captions, mono micro-labels"],
  ]),
  ["--brand-ink", "--brand", 4.5, "label on the brand fill (buttons)"],
  ["--text-brand", "--surface", 4.5, "blue as text: links, icons"],
  ...CHIP_TONES.map((t) => [`--${t}-chip-ink`, `--${t}-chip`, 4.5, `${t} chip`]),
  ...TEXT_TONES.map((t) => [`--${t}`, "--surface", 4.5, `${t} as text/icon on a card`]),
  ["--brand", "--surface", 3, "primary fill against its card (non-text)"],
  ...[1, 2, 3, 4, 5].map((n) => [`--chart-${n}`, "--surface", 3, `chart series ${n} marks`]),
  ["--line", "--surface", 1.3, "hairline visible against the card"],
];

/**
 * Audit one theme. Pure: a `Map(--name -> raw)` in, rows out. A pair whose
 * token is undefined or not a hex colour is a FAIL, not a skip — an audited
 * token that silently vanished is exactly the regression this exists for.
 */
export function auditTheme(vars, pairs = PAIRS) {
  const colour = (name) => {
    const parsed = parseHex(resolveVar(name, vars));
    if (!parsed) throw new Error(`${name} resolves to "${resolveVar(name, vars)}", not a hex colour`);
    return parsed;
  };
  return pairs.map(([fgName, bgName, need, note]) => {
    try {
      const page = colour("--bg");
      const bg = over(colour(bgName), page);
      const fg = over(colour(fgName), bg);
      const ratio = contrast(luminance(fg), luminance(bg));
      return {
        pairing: `${fgName} on ${bgName}`,
        fg: fg.hex,
        bg: bg.hex,
        ratio,
        need,
        pass: ratio >= need,
        note,
      };
    } catch (err) {
      return { pairing: `${fgName} on ${bgName}`, fg: "-", bg: "-", ratio: 0, need, pass: false, note: err.message };
    }
  });
}

/** `:root` is dark; light is `:root` with `.servo-light` laid over it. */
export function themesFrom(css) {
  const blocks = parseBlocks(css);
  const root = blocks.get(":root");
  const light = blocks.get(".servo-light");
  if (!root) throw new Error("no :root block in the token file");
  if (!light) throw new Error("no .servo-light block in the token file");
  return { light: new Map([...root, ...light]), dark: root };
}

// ---- CLI ---------------------------------------------------------------------

function printTable(theme, rows) {
  const w = { pairing: 40, fg: 10, bg: 10 };
  console.log(`\n=== ${theme.toUpperCase()} ===`);
  console.log(
    `${"result".padEnd(6)}  ${"ratio".padStart(6)}  ${"need".padStart(4)}  ${"pairing".padEnd(w.pairing)}  ${"fg".padEnd(w.fg)}  ${"bg".padEnd(w.bg)}  note`,
  );
  for (const r of rows) {
    console.log(
      `${(r.pass ? "PASS" : "FAIL").padEnd(6)}  ${r.ratio.toFixed(2).padStart(6)}  ${String(r.need).padStart(4)}  ` +
        `${r.pairing.padEnd(w.pairing)}  ${r.fg.padEnd(w.fg)}  ${r.bg.padEnd(w.bg)}  ${r.note}`,
    );
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  let themes;
  try {
    themes = themesFrom(readFileSync(TOKENS_PATH, "utf8"));
  } catch (err) {
    console.error(`color-audit: cannot read tokens from ${TOKENS_PATH}: ${err.message}`);
    process.exit(1);
  }
  const shown = (path.relative(REPO_ROOT, TOKENS_PATH) || TOKENS_PATH).split(path.sep).join("/");
  console.log(`color-audit: ${shown}`);
  let failures = 0;
  const summary = [];
  for (const [theme, vars] of Object.entries(themes)) {
    const rows = auditTheme(vars);
    printTable(theme, rows);
    const failed = rows.filter((r) => !r.pass).length;
    failures += failed;
    summary.push(`${theme}: ${rows.length - failed} pass, ${failed} fail`);
  }
  console.log(`\n${summary.join(" · ")} — ${PAIRS.length} pairs per theme`);
  process.exit(failures === 0 ? 0 : 1);
}
