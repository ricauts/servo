// no-hardcoded-hex lint — spec item ds-01, §0.5. Every colour in src/app and
// src/components must resolve to a design-system token: a raw hex literal,
// an rgb()/hsl()/oklch() literal, or a Tailwind arbitrary colour value is a
// violation, reported as file:line. Token definitions inside
// servo_design_system/ are exempt by PATH (this file never walks there);
// servo_design_system/tokens/*.css is instead the SOURCE of the definitions
// the companion check validates against: every var(--x) referenced under
// src/ must resolve to a --x defined in globals.css or the design system, so
// a colour that silently falls back to nothing fails the build, not the eye.
//
// A line carrying `no-hex-lint:allow` is skipped — the escape hatch is
// greppable and reviewable, and exists for (a) vendored upstream code whose
// attribute selectors match third-party literal values they do not set, and
// (b) copy where `#1234` is a ticket number, not a colour.
//
//   node scripts/no-hex-lint.mjs

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const SCANNED_DIRS = ["src/app", "src/components"];
const SOURCE_EXT = /\.(ts|tsx|css|js|jsx|mjs)$/;
export const ALLOW_MARKER = "no-hex-lint:allow";

const HEX_RE = /#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/g;
const FUNC_COLOR_RE = /\b(?:rgba?|hsla?)\(\s*(?:\d|#)|\boklch\(\s*[\d.]/g;
const ARBITARY_TAILWIND_RE =
  /\b(?:bg|text|border|ring|fill|stroke|from|via|to|outline|divide|shadow|accent|caret|decoration|placeholder)-(?:color-)?\[([^\]\s][^\]]*)\]/g;
const NON_COLOR_DATATYPES = /^(length|percentage|size|position|url|leading|tracking|font|weight|z|opacity|line-height| rem| px|duration|ease):/i;
const COLOR_LITERAL_IN_ARBITRARY = /#|\b(?:rgb|rgba|hsl|hsla|oklch)\(/i;

/**
 * @typedef {object} HexViolation
 * @property {string} file   // repo-relative
 * @property {number} line
 * @property {string} text   // the offending snippet
 * @property {string} rule   // hex | color-function | tailwind-arbitrary-color
 */

/** Scan one source file's text. Pure: paths and strings in, violations out. */
export function scanSource(relPath, text) {
  const violations = [];
  const lines = String(text ?? "").split(/\r?\n/);
  lines.forEach((line, i) => {
    if (line.includes(ALLOW_MARKER)) return;
    const hit = (rule, snippet) =>
      violations.push({ file: relPath, line: i + 1, text: snippet.trim().slice(0, 100), rule });
    for (const m of line.matchAll(HEX_RE)) hit("hex", m[0]);
    for (const m of line.matchAll(FUNC_COLOR_RE)) hit("color-function", m[0]);
    for (const m of line.matchAll(ARBITARY_TAILWIND_RE)) {
      const value = m[1];
      if (value.startsWith("var(")) continue; // token reference — the point
      if (NON_COLOR_DATATYPES.test(value)) continue;
      if (COLOR_LITERAL_IN_ARBITRARY.test(value)) hit("tailwind-arbitrary-color", m[0]);
    }
  });
  return violations;
}

/** Collect `--name:` definitions from CSS (or any) text. */
export function collectVarDefinitions(text) {
  const names = new Set();
  for (const m of String(text ?? "").matchAll(/--([A-Za-z0-9_-]+)\s*:/g)) names.add(m[1]);
  return names;
}

/** Collect `var(--name)` references from source text. */
export function collectVarReferences(text) {
  const names = new Set();
  for (const m of String(text ?? "").matchAll(/var\(\s*--([A-Za-z0-9_-]+)/g)) names.add(m[1]);
  return names;
}

/**
 * Companion check: every var(--x) referenced under src/app + src/components
 * must be defined in the app's CSS or the design-system tokens, in EITHER
 * theme — an undefined token renders as a silent fallback in one mode only.
 * @returns {{ file: string, name: string }[]}
 */
export function unresolvedVarReferences(sources, definitions) {
  const defined = new Set(definitions);
  const unresolved = [];
  for (const { path: rel, text } of sources) {
    for (const name of collectVarReferences(text)) {
      if (!defined.has(name)) unresolved.push({ file: rel, name });
    }
  }
  return unresolved;
}

function walk(dir) {
  const out = [];
  const root = path.join(REPO_ROOT, dir);
  try {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      const full = path.join(root, entry.name);
      const rel = path.relative(REPO_ROOT, full).replace(/\\/g, "/");
      if (entry.isDirectory()) out.push(...walk(rel));
      else if (SOURCE_EXT.test(entry.name)) out.push({ abs: full, rel });
    }
  } catch {
    /* absent directory — nothing to scan */
  }
  return out;
}

function main() {
  const sources = SCANNED_DIRS.flatMap(walk);
  let violations = [];
  for (const { abs, rel } of sources) {
    violations.push(...scanSource(rel, readFileSync(abs, "utf8")));
  }

  // Definitions: the app stylesheet plus every design-system token file.
  const definitions = new Set();
  const defFiles = [
    path.join(REPO_ROOT, "src/app/globals.css"),
    ...walk("servo_design_system/tokens").map((f) => f.abs),
  ];
  for (const file of defFiles) {
    try {
      for (const name of collectVarDefinitions(readFileSync(file, "utf8"))) definitions.add(name);
    } catch {
      /* absent file — its definitions simply do not exist */
    }
  }
  const unresolved = unresolvedVarReferences(
    sources.map(({ abs, rel }) => ({ path: rel, text: readFileSync(abs, "utf8") })),
    definitions,
  );

  for (const v of violations) {
    console.error(`no-hex-lint: ${v.file}:${v.line}: ${v.rule}: ${v.text}`);
  }
  for (const u of unresolved) {
    console.error(`no-hex-lint: ${u.file}: var(--${u.name}) resolves to no defined token`);
  }
  if (violations.length + unresolved.length > 0) process.exit(1);
  console.log(
    `no-hex-lint: OK (${sources.length} sources; every colour a token, every token defined)`,
  );
}

// CLI only — not when the tests import the module.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
