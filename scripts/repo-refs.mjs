// The one reference scanner — spec item hyg-01, §13.2 of docs/design/hygiene.md.
// It answers one question per thing in the repository: does anything point at
// it? Files, exported symbols and declared dependencies are all nodes in the
// same graph, because "dead" means the same thing for all three.
//
//   node scripts/repo-refs.mjs                       # human-readable summary
//   node scripts/repo-refs.mjs --evidence docs/hygiene/<item-id>-evidence.md
//   node scripts/repo-refs.mjs --check               # `npm run hygiene:check`
//
// It DELETES NOTHING. Without --check it never exits nonzero on findings: the
// deletion rule (§13.1) is "evidence or no deletion", and the plain report is
// only the evidence. `--check` (hyg-04) is the gate on top of the same report —
// it fails on a finding that has no row in the keep-list, and it still deletes
// nothing.
//
// Node builtins only, pure functions plus a thin CLI, in the same shape as
// loop-guard.mjs and spec-lint.mjs. Every trap below was hit by hand during
// the 2026-08-27 audit and is encoded here so no tick rediscovers it:
//
//  * .claude/ holds two full worktree copies. Any scan that does not exclude
//    it reports every file in the repository as referenced.
//  * spec.md names paths it PLANS to create, so counting it as a referencing
//    source produces false "referenced" verdicts. It is excluded as a source.
//    The cost is that a file only spec.md mentions reads as unreferenced —
//    correct today, wrong the day a tick creates it, and absorbed by hyg-04's
//    baseline. A tick must never delete on that signal alone.
//  * Dynamic imports and barrel files are REPORTED, never guessed. An import
//    target the scanner cannot resolve statically makes its candidates
//    INDETERMINATE, never unreferenced.
//  * Dependencies are part of the graph: declared-and-unused and
//    used-but-undeclared are both findings, and the lockfile is checked too
//    because a package absent from package-lock.json cannot survive npm ci.
//
// A grep-based scanner has false negatives by construction — a path built from
// a template literal or an env var is invisible to it. That is why the
// never-delete list below is DATA, and why every deletion still lands in front
// of a human (§13.1 clause 2).

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");

// ---------------------------------------------------------------------------
// Data. Not conventions — data, so a tick cannot reason its way around them.
// ---------------------------------------------------------------------------

/** Prefixes dropped from the scan set. `.claude/` is the mandatory one. */
export const EXCLUDED_PREFIXES = [
  "node_modules/",
  ".next/",
  ".git/",
  ".claude/", // two full worktree copies live here; without this everything looks referenced
  ".spec-build/",
];

/** Exact paths dropped from the scan set. */
export const EXCLUDED_PATHS = ["package-lock.json"];

/** Patterns dropped from the scan set. */
export const EXCLUDED_PATTERNS = [/^prisma\/[^/]*\.db.*$/];

/**
 * Files that are scanned (they get a verdict) but never counted as a source of
 * references.
 *
 *  * spec.md names paths it PLANS to create — the comment above says why.
 *  * The hyg-04 keep-list names a path precisely BECAUSE nothing points at it.
 *    Counting it would make every baselined file read `referenced`, the gate
 *    would cover nothing, and the first file to go dead would be recorded as
 *    alive by the very row that recorded it as dead. Found the hard way: the
 *    five `src/components/ui/*` rows flipped to `referenced` the moment the
 *    baseline was first `git add`ed.
 *
 * `NON_REFERENCING_PREFIXES` is the same rule for a whole directory.
 */
export const NON_REFERENCING_SOURCES = new Set(["spec.md", "tests/fixtures/repo-refs-baseline.json"]);

/**
 * Directories whose files are scanned but never counted as a source of
 * references.
 *
 * `docs/hygiene/` holds THIS SCRIPT'S OWN `--evidence` reports, and §13.1
 * requires a deletion item to COMMIT one before removing anything. An evidence
 * report names every dead path in the tree, so the moment one is committed
 * every one of those paths reads `referenced, prose only` and the gate passes
 * on files it had just proven dead — the tool laundering its own findings, one
 * commit after making them. Exactly the trap the keep-list line above closes,
 * one directory over.
 */
export const NON_REFERENCING_PREFIXES = ["docs/hygiene/"];

/** True when `relPath`'s mentions must not count as references. */
export function isNonReferencingSource(relPath) {
  return (
    NON_REFERENCING_SOURCES.has(relPath) ||
    NON_REFERENCING_PREFIXES.some((p) => relPath.startsWith(p))
  );
}

/**
 * Never in scope for any hygiene deletion, at any time (§13.1). These are
 * reported like everything else — a `keep` verdict is still information — but
 * they can never be reported as deletable.
 */
export const NEVER_DELETE = [
  { prefix: "agents/", reason: "runtime data read by src/lib/bootstrap.ts and prisma/seed-demo.ts" },
  { prefix: "skills/", reason: "runtime data read by syncSkills (src/lib/bootstrap.ts)" },
  { prefix: "servo_design_system/", reason: "design truth — spec.md §0.5 and §14 q19" },
  { prefix: "prisma/migrations/", reason: "migration history is never rewritten" },
  { prefix: "prisma/", reason: "schema, seeds and migrations" },
  { prefix: "tests/fixtures/", reason: "fixtures are read by path, often without an import" },
  { prefix: "docs/hygiene/", reason: "evidence reports — the proof a deletion happened lawfully" },
];

/** Module extensions whose contents are parsed for imports/requires. */
export const MODULE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"]);

/** Extensions whose contents are scanned for repo-relative path mentions. */
export const MENTION_EXT = new Set([
  ".md",
  ".json",
  ".yml",
  ".yaml",
  ".sh",
  ".mjs",
  ".cjs",
  ".js",
  ".ts",
  ".tsx",
  ".prisma",
  ".html",
]);

/**
 * Everything a bundler can pull in through an `import()`. Wider than
 * MODULE_EXT on purpose: under an acknowledged unresolvable import, a .json or
 * .css target is exactly as reachable as a .ts one, and reporting it
 * `unreferenced` would be the guess this tool refuses to make.
 */
export const IMPORTABLE_EXT = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts", ".json", ".css", ".scss", ".wasm",
]);

/** Resolution order for an extensionless or directory import. */
const EXT_CANDIDATES = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".css"];
const INDEX_CANDIDATES = ["/index.ts", "/index.tsx", "/index.js", "/index.jsx", "/index.mjs"];

/**
 * Exports the framework calls by name. A Next.js route file's `default`,
 * `metadata` or `GET` is referenced by the router, not by an import, and
 * reporting them dead would drown every real finding.
 */
export const FRAMEWORK_EXPORTS = new Set([
  "default",
  "metadata",
  "generateMetadata",
  "generateStaticParams",
  "viewport",
  "dynamic",
  "revalidate",
  "runtime",
  "fetchCache",
  "preferredRegion",
  "maxDuration",
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
  "config",
  "middleware",
]);

/**
 * Files nothing imports because something else calls them by convention: the
 * Next.js App Router's file names, vitest's include glob, the tool configs and
 * the repository's front-door documents. Without this list a report about a
 * Next.js app is 60 route files long and its real findings are unreadable.
 * Each entry names the mechanism, so a wrong one is arguable rather than
 * invisible.
 */
export const ENTRY_POINTS = [
  {
    re: /^src\/app\/(.*\/)?(page|layout|route|loading|error|not-found|template|default|global-error|sitemap|robots|manifest|opengraph-image|twitter-image|icon|apple-icon)\.(tsx?|jsx?)$/,
    reason: "Next.js App Router file convention — the router imports it by path",
  },
  { re: /^src\/app\/favicon\.ico$/, reason: "Next.js App Router file convention" },
  { re: /^src\/middleware\.(ts|js)$/, reason: "Next.js middleware convention" },
  { re: /^tests\/.*\.test\.ts$/, reason: "vitest.config.ts include glob tests/**/*.test.ts" },
  { re: /^(next|postcss)\.config\.mjs$/, reason: "tool config loaded by name" },
  { re: /^vitest\.config\.ts$/, reason: "tool config loaded by name" },
  { re: /^(tsconfig|package|package-lock|components)\.json$/, reason: "tool config loaded by name" },
  { re: /^\.github\/workflows\/.*\.ya?ml$/, reason: "GitHub Actions workflow" },
  { re: /^(Dockerfile|docker-compose[^/]*\.yml|\.dockerignore)$/, reason: "container build entry point" },
  { re: /^(\.gitignore|\.gitattributes|\.npmrc|\.env\.example)$/, reason: "tool config read by name" },
  { re: /^(README|SECURITY|ROADMAP|LICENSE)(\.md)?$/, reason: "repository front-door document" },
  { re: /^spec\.md$/, reason: "the loop's work order — spec.md §0.1" },
];

/** The entry-point reason for a path, or null. */
export function entryPointReason(relPath) {
  for (const e of ENTRY_POINTS) if (e.re.test(relPath)) return e.reason;
  return null;
}

/**
 * Packages that are used without ever being imported, each with the config or
 * command that uses it. This list is DATA for the same reason the never-delete
 * list is: without it every build tool reads as dead, and a report where the
 * true findings are buried is a report nobody acts on. A package here is
 * reported `tooling`, never `unreferenced` — and adding one is a claim that
 * has to name where it is used.
 */
export const TOOLING_DEPENDENCIES = new Map([
  ["typescript", "package.json scripts.typecheck runs tsc"],
  ["vitest", "package.json scripts.test runs vitest; vitest.config.ts"],
  ["prisma", "package.json scripts.setup/demo run the prisma CLI"],
  ["tsx", "package.json scripts.setup/demo run tsx"],
  ["next", "package.json scripts.dev/build/start run next; next.config.mjs"],
  ["postcss", "postcss.config.mjs is the PostCSS entry point"],
  ["@tailwindcss/postcss", "postcss.config.mjs plugin"],
  ["tailwindcss", "loaded by @tailwindcss/postcss from src/app/globals.css"],
  ["tw-animate-css", "imported by src/app/globals.css as a stylesheet"],
  ["shadcn", "components.json — the `shadcn add` generator"],
  ["@types/node", "ambient type declarations consumed by tsc"],
  ["@types/react", "ambient type declarations consumed by tsc"],
  ["@types/react-dom", "ambient type declarations consumed by tsc"],
  ["@types/nodemailer", "ambient type declarations consumed by tsc"],
  ["@types/js-yaml", "ambient type declarations consumed by tsc (js-yaml is imported by tests/docling-compose.test.ts)"],
  ["react-dom", "the DOM renderer Next.js loads at runtime; never imported by app code"],
]);

const NODE_BUILTINS = new Set([
  "assert", "async_hooks", "buffer", "child_process", "cluster", "console", "constants", "crypto",
  "dgram", "diagnostics_channel", "dns", "domain", "events", "fs", "http", "http2", "https",
  "inspector", "module", "net", "os", "path", "perf_hooks", "process", "punycode", "querystring",
  "readline", "repl", "stream", "string_decoder", "sys", "timers", "tls", "trace_events", "tty",
  "url", "util", "v8", "vm", "wasi", "worker_threads", "zlib",
]);

// ---------------------------------------------------------------------------
// Pure functions. Inputs are plain strings, arrays and maps.
// ---------------------------------------------------------------------------

/**
 * The scan set: tracked files minus the exclusions above.
 * @param {string[]} trackedFiles repo-relative paths, e.g. from `git ls-files`
 * @returns {string[]}
 */
export function scanSet(trackedFiles) {
  return (trackedFiles ?? [])
    .map((f) => String(f).trim().replace(/\\/g, "/"))
    .filter((f) => f !== "")
    // Matched at ANY depth: a vendored node_modules or a nested worktree copy
    // is the same trap one level down as it is at the root.
    .filter((f) => !EXCLUDED_PREFIXES.some((p) => f === p.slice(0, -1) || f.startsWith(p) || f.includes("/" + p)))
    .filter((f) => !EXCLUDED_PATHS.includes(f))
    .filter((f) => !EXCLUDED_PATTERNS.some((re) => re.test(f)))
    .sort();
}

/**
 * Strip // and /* *\/ comments from JSONC, tracking string state. A regex
 * cannot do this here: tsconfig.json's own `"@/*": ["./src/*"]` contains both
 * a `/*` and a `*\/`, and a naive block-comment regex deletes the paths map.
 * @param {string} text
 * @returns {string}
 */
export function stripJsonComments(text) {
  const src = String(text ?? "");
  let out = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inString) {
      out += c;
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      out += "\n";
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i++;
      continue;
    }
    out += c;
  }
  return out;
}

/**
 * Read the `paths` map out of a tsconfig, tolerating comments and trailing
 * commas the way tsc does.
 * @param {string} text
 * @returns {{ alias: string, targets: string[] }[]} e.g. [{alias:"@/", targets:["src/"]}]
 */
export function parseTsconfigPaths(text) {
  const src = stripJsonComments(String(text ?? "")).replace(/,(\s*[}\]])/g, "$1");
  let json;
  try {
    json = JSON.parse(src);
  } catch {
    return [];
  }
  const paths = json?.compilerOptions?.paths ?? {};
  const out = [];
  for (const [alias, targets] of Object.entries(paths)) {
    if (!alias.endsWith("*")) continue;
    out.push({
      alias: alias.slice(0, -1),
      targets: (targets ?? [])
        .filter((t) => typeof t === "string" && t.endsWith("*"))
        .map((t) => t.slice(0, -1).replace(/^\.\//, "")),
    });
  }
  return out;
}

/**
 * A deliberately small .gitignore matcher: directory prefixes, `*.ext` suffix
 * rules and `dir/glob*` patterns — every shape this repository's .gitignore
 * actually uses. Negations (`!pattern`) are NOT supported and are ignored,
 * which is the safe direction: a `!` rule un-ignores a path, and treating it
 * as ignored would only add a `keep`.
 * @param {string} text
 * @returns {(relPath: string) => boolean}
 */
export function gitignoreMatcher(text) {
  const rules = [];
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#") || line.startsWith("!")) continue;
    if (line.endsWith("/")) {
      rules.push({ kind: "dir", value: line.replace(/^\//, "") });
      continue;
    }
    const body = line.replace(/^\//, "");
    if (body.includes("*")) {
      const re = new RegExp(
        "^" + body.split("*").map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*") + "$",
      );
      rules.push({ kind: "glob", re, anchored: line.startsWith("/") || body.includes("/") });
      continue;
    }
    rules.push({ kind: "exact", value: body });
  }
  return (relPath) => {
    const p = String(relPath ?? "").replace(/\\/g, "/");
    const segments = p.split("/");
    for (const rule of rules) {
      if (rule.kind === "dir" && (p === rule.value || p.startsWith(rule.value))) return true;
      if (rule.kind === "exact" && (p === rule.value || segments.includes(rule.value))) return true;
      if (rule.kind === "glob") {
        if (rule.re.test(p)) return true;
        if (!rule.anchored && rule.re.test(segments[segments.length - 1])) return true;
      }
    }
    return false;
  };
}

/**
 * Mark every character that sits inside a string literal or a comment. The
 * scanner has to read its OWN source and its own tests, and those files are
 * full of sentences like `import()` and of fixture strings like
 * `'const c = await import("pkg-c");'`. Without this mask the scanner invents a
 * dependency on `pkg-c` and declares the whole tree INDETERMINATE because of a
 * sentence in a comment. Template substitutions (`${…}`) stay unmasked, since
 * that is where a dynamic import's static prefix ends.
 * @param {string} text
 * @returns {Uint8Array} 0 = code, STRING (1) = inside a string, COMMENT (2)
 */
export const STRING = 1;
export const COMMENT = 2;

export function maskCode(text) {
  const src = String(text ?? "");
  const n = src.length;
  const mask = new Uint8Array(n);
  let i = 0;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === "/" && d === "/") {
      while (i < n && src[i] !== "\n") mask[i++] = COMMENT;
      continue;
    }
    if (c === "/" && d === "*") {
      mask[i++] = COMMENT;
      mask[i++] = COMMENT;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) mask[i++] = COMMENT;
      if (i < n) mask[i++] = COMMENT;
      if (i < n) mask[i++] = COMMENT;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const open = i;
      i++; // the opening quote itself is code
      let unterminated = false;
      while (i < n) {
        if (src[i] === "\\") {
          mask[i++] = STRING;
          if (i < n) mask[i++] = STRING;
          continue;
        }
        if (src[i] === c) break;
        // Only a template literal may cross a line. A ' or " that reaches a
        // newline was never a string opener — a JSX apostrophe in `Don't`, a
        // quote inside a regex character class — and treating it as one masks
        // the whole rest of the file, hiding every import after it and putting
        // live files on the deletion list.
        if (c !== "`" && src[i] === "\n") {
          unterminated = true;
          break;
        }
        if (c === "`" && src[i] === "$" && src[i + 1] === "{") {
          i += 2;
          let depth = 1;
          while (i < n && depth > 0) {
            if (src[i] === "{") depth++;
            else if (src[i] === "}") depth--;
            i++;
          }
          continue;
        }
        mask[i++] = STRING;
      }
      if (unterminated) {
        mask.fill(0, open, i);
        i = open + 1; // resume as code just after the false opener
        continue;
      }
      i++; // closing quote
      continue;
    }
    i++;
  }
  return mask;
}

/**
 * The file's lines, with every line whose import/export/require keyword sits
 * inside a string or a comment blanked out. Both extractors below read this
 * rather than the raw text, so prose about imports is not an import.
 * @param {string} text
 * @returns {string[]}
 */
export function codeLines(text) {
  const src = String(text ?? "");
  const mask = maskCode(src);
  const out = [];
  let offset = 0;
  // A multi-line `import {\n  alpha,\n} from "x"` has no keyword on its NAME
  // lines. Blanking them leaves an import that binds nothing, and every symbol
  // it brings in reads as dead — which the real tree already demonstrated on
  // two live exports. So a brace list stays open across lines.
  let listOpen = false;
  for (const line of src.split("\n")) {
    let keep = listOpen;
    for (const m of line.matchAll(/\b(?:import|export|require|from)\b|@import/g)) {
      if (mask[offset + (m.index ?? 0)] === 0) {
        keep = true;
        break;
      }
    }
    if (keep) {
      if (listOpen) listOpen = !line.includes("}");
      else if (/^\s*(?:import|export)\b[^;]*\{/.test(line) && !line.includes("}")) listOpen = true;
    }
    out.push(keep ? line.replace(/\r$/, "") : "");
    offset += line.length + 1;
  }
  // `import X\n  from "./y";` is a valid ES import whose specifier is not on
  // the keyword's line. Fold a dangling `from` onto the next line so the
  // line-oriented extractors see one statement — otherwise the target reads
  // `unreferenced`, which is a false-dead rather than an INDETERMINATE.
  for (let i = 0; i < out.length - 1; i++) {
    if (/\bfrom\s*$/.test(out[i]) && /^\s*["']/.test(out[i + 1])) {
      out[i] = out[i] + " " + out[i + 1].trim();
    }
  }
  return out;
}

/**
 * Read the first argument of a call whose `(` has just been consumed, and say
 * what it is. Three outcomes, and the middle one is the one a regex kept
 * getting wrong:
 *
 *   `("./x")` / `("./x", {…})`  → a complete literal; `literal` is the target
 *   `` (`./locales/${l}.js`) `` / `("./dir/" + n)` → a static PREFIX and no more
 *   `(spec)` / an unterminated call → nothing static at all
 *
 * A prefix or nothing means the target is INDETERMINATE. `staticPrefix` is null
 * when even the prefix is unknown, which the caller escalates to a global
 * uncertainty flag.
 *
 * @param {string} line
 * @param {number} start index just past the opening paren
 * @returns {{ literal: string|null, staticPrefix: string|null }}
 */
function endOfArgument(rest) {
  // Skip whitespace and any inline comment — `import("./x" /* webpackChunk */)`
  // is still a complete literal, and demoting it would report a statically
  // resolvable target dead.
  return String(rest).replace(/^(?:\s|\/\*[\s\S]*?\*\/)+/, "");
}

export function readCallArgument(line, start) {
  const rest = line.slice(start);
  const quoted = rest.match(/^\s*(["'])((?:[^"'\\]|\\.)*)\1/);
  if (quoted) {
    // A complete string literal is the target only if the argument ENDS here:
    // a following `+` means concatenation, and only the prefix is knowable.
    const after = endOfArgument(rest.slice(quoted[0].length));
    if (after.startsWith(")") || after.startsWith(",")) return { literal: quoted[2], staticPrefix: null };
    return { literal: null, staticPrefix: quoted[2] };
  }
  const template = rest.match(/^\s*`([^`$]*)\$\{/);
  if (template) return { literal: null, staticPrefix: template[1] };
  const wholeTemplate = rest.match(/^\s*`([^`$]*)`/);
  if (wholeTemplate) {
    const after = endOfArgument(rest.slice(wholeTemplate[0].length));
    if (after.startsWith(")") || after.startsWith(",")) return { literal: wholeTemplate[1], staticPrefix: null };
    return { literal: null, staticPrefix: wholeTemplate[1] };
  }
  return { literal: null, staticPrefix: null };
}

/**
 * Every module specifier in one file's text, with the line it sits on.
 * `kind` is one of: static | side-effect | require | dynamic | css-import.
 * A dynamic import whose argument is not a string literal yields
 * `{ spec: null, staticPrefix }` — the caller must treat it as INDETERMINATE.
 * @param {string} text
 * @returns {{ kind: string, spec: string|null, line: number, staticPrefix?: string|null }[]}
 */
export function extractModuleSpecifiers(text) {
  const out = [];
  const lines = codeLines(text);
  lines.forEach((line, i) => {
    const at = i + 1;
    // A comment line is not a module edge. `// … "never set" from "just
    // deleted" …` and `/** @type {import('x')} */` both look like imports to a
    // line-oriented regex, so whole-line comments are skipped.
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
    // The lookbehind keeps `smtp-from" className="…"` and `["from", "sender"]`
    // out: a `from` glued to a word character, a dash or a quote is not the
    // import keyword.
    for (const m of line.matchAll(/(?<![\w$'"`.-])from\s*["']([^"']+)["']/g)) out.push({ kind: "static", spec: m[1], line: at });
    for (const m of line.matchAll(/(?<![\w$'"`.-])import\s+["']([^"']+)["']/g)) out.push({ kind: "side-effect", spec: m[1], line: at });
    for (const m of line.matchAll(/@import\s+(?:url\()?\s*["']([^"']+)["']/g)) out.push({ kind: "css-import", spec: m[1], line: at });
    // Call-shaped imports are classified by reading the whole argument, not by
    // a regex that assumes its shape. A regex that demanded `import("x")` with
    // the closing paren right after the quote silently dropped
    // `import("./x.json", { with: { type: "json" } })` — a fully resolvable
    // edge — and one that required the argument NOT to start with a quote
    // silently dropped `import("./dir/" + name)`, which is neither literal nor
    // reported. Both are false-dead verdicts on the deletion path.
    for (const call of ["import", "require"]) {
      const re = new RegExp(`\\b${call}\\s*\\(`, "g");
      for (const m of line.matchAll(re)) {
        const kind = call === "import" ? "dynamic" : "require";
        const arg = readCallArgument(line, m.index + m[0].length);
        if (arg.literal !== null) {
          out.push({ kind, spec: arg.literal, line: at });
        } else {
          out.push({ kind, spec: null, line: at, staticPrefix: arg.staticPrefix });
        }
      }
    }
  });
  return out;
}

/**
 * Resolve one specifier from one file.
 * @param {string} spec
 * @param {string} fromPath repo-relative path of the importing file
 * @param {Set<string>} fileSet the scan set
 * @param {{alias: string, targets: string[]}[]} aliases
 * @returns {{ kind: "file"|"package"|"builtin"|"unresolved", value: string }}
 */
export function resolveSpecifier(spec, fromPath, fileSet, aliases = []) {
  const s = String(spec ?? "");
  if (s === "") return { kind: "unresolved", value: s };
  if (s.startsWith("node:")) return { kind: "builtin", value: s.slice(5) };

  /** Try one repo-relative base path against the scan set. */
  const tryBase = (base) => {
    const clean = base.replace(/^\.\//, "");
    const candidates = [...EXT_CANDIDATES.map((e) => clean + e), ...INDEX_CANDIDATES.map((e) => clean + e)];
    // TypeScript ESM style: "./x.js" on disk is "./x.ts".
    if (/\.(js|jsx)$/.test(clean)) {
      candidates.push(clean.replace(/\.jsx?$/, ".ts"), clean.replace(/\.jsx?$/, ".tsx"));
    }
    for (const c of candidates) {
      if (c !== "" && fileSet.has(c)) return c;
    }
    return null;
  };

  if (s.startsWith(".")) {
    const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromPath), s));
    const hit = tryBase(base);
    return hit ? { kind: "file", value: hit } : { kind: "unresolved", value: s };
  }

  for (const { alias, targets } of aliases) {
    if (alias === "" || !s.startsWith(alias)) continue;
    const rest = s.slice(alias.length);
    for (const target of targets) {
      const hit = tryBase(path.posix.normalize(target + rest));
      if (hit) return { kind: "file", value: hit };
    }
    return { kind: "unresolved", value: s };
  }

  if (s.startsWith("/")) return { kind: "unresolved", value: s };
  // "@/..." is alias-shaped, never a package: a scoped package needs a scope
  // name. Without this a broken tsconfig turns every aliased import into an
  // invented "undeclared dependency".
  if (s.startsWith("@/")) return { kind: "unresolved", value: s };
  if (NODE_BUILTINS.has(s.split("/")[0])) return { kind: "builtin", value: s.split("/")[0] };
  return { kind: "package", value: packageNameOf(s) };
}

/**
 * Turn the static prefix of an unresolvable import into a repo-relative
 * directory, through the same alias table a static import uses. Returns null
 * when the prefix is unknown or reaches outside the alias/relative forms — and
 * a null prefix means "could be anywhere", which the caller treats as global
 * uncertainty rather than as no uncertainty.
 * @param {string|null|undefined} prefix
 * @param {string} fromPath
 * @param {{alias: string, targets: string[]}[]} aliases
 * @returns {string|null}
 */
export function resolvePrefixes(prefix, fromPath, aliases = []) {
  const p = prefix ?? null;
  if (p === null || p === "") return [];
  // The trailing part is KEPT: `import(`./locale-${lang}.js`)` has the prefix
  // "./locale-", and treating that as the directory "." would leave every
  // locale-*.ts reported deletable. Callers match it with startsWith, not as a
  // path boundary.
  const clean = (v) => path.posix.normalize(v).replace(/^\.\/?$/, "");
  if (p.startsWith(".")) {
    const hit = clean(path.posix.join(path.posix.dirname(fromPath), p));
    return hit ? [hit] : [];
  }
  for (const { alias, targets } of aliases) {
    if (alias !== "" && p.startsWith(alias) && targets.length > 0) {
      // EVERY target, not just the first: an alias with two targets can reach
      // files under either, and scoping to one leaves the rest deletable.
      return targets.map((t) => clean(t + p.slice(alias.length))).filter(Boolean);
    }
  }
  return [];
}

/** "@scope/pkg/sub" -> "@scope/pkg"; "pkg/sub" -> "pkg". */
export function packageNameOf(spec) {
  const parts = String(spec ?? "").split("/");
  return spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

/**
 * Repo-relative path mentions inside prose and config: any token that is
 * literally a path in the scan set counts as a reference. Tokenising and
 * looking the token up beats a path-shaped regex — it cannot invent a match.
 * @param {string} text
 * @param {Set<string>} fileSet
 * @returns {{ target: string, line: number }[]}
 */
export function extractPathMentions(text, fileSet) {
  const out = [];
  const lines = String(text ?? "").split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const raw of line.split(/[^A-Za-z0-9_@./-]+/)) {
      if (raw === "" || !raw.includes(".")) continue;
      const token = raw.replace(/^\.\//, "").replace(/^\/+/, "").replace(/[.,;:)]+$/, "");
      if (token === "" || !fileSet.has(token)) continue;
      out.push({ target: token, line: i + 1 });
    }
  });
  return out;
}

/**
 * The names one file actually binds from each module it imports. This is what
 * makes a verdict on a SYMBOL trustworthy: a whole-word text search cannot
 * tell `formatDate` imported from `@/lib/utils` apart from an unrelated
 * `formatDate` defined elsewhere, or from a document that names the symbol
 * while explaining that it is dead.
 * @param {string} text
 * @returns {{ spec: string, names: string[], namespace: boolean, star: boolean, line: number }[]}
 */
export function extractImportBindings(text) {
  const out = [];
  const lines = codeLines(text);
  // Join continuation lines so a multi-line `import {\n a,\n} from "x"` is one
  // record; the reported line is where the statement starts.
  const joined = [];
  let buffer = null;
  lines.forEach((line, i) => {
    const at = i + 1;
    if (buffer) {
      buffer.text += " " + line;
      buffer.closed = /\}/.test(line);
      if (buffer.closed) {
        joined.push(buffer);
        buffer = null;
      }
      return;
    }
    if (/^\s*(import|export)\b/.test(line) && /\{/.test(line) && !/\}/.test(line)) {
      buffer = { text: line, line: at, closed: false };
      return;
    }
    joined.push({ text: line, line: at });
  });
  if (buffer) joined.push(buffer);

  for (const { text: line, line: at } of joined) {
    // `const { a, b } = await import("x")` / `= require("x")`. The tests use
    // this shape almost exclusively (vi.mock forces the import to be lazy), so
    // missing it would report most of src/lib as dead.
    const destructured = line.match(
      /(?:const|let|var)\s*\{([^}]*)\}\s*=\s*(?:await\s+)?(?:import|require)\s*\(\s*["']([^"']+)["']/,
    );
    if (destructured) {
      const names = destructured[1]
        .split(",")
        .map((p) => p.trim().replace(/^type\s+/, "").match(/^([A-Za-z_$][\w$]*)/)?.[1])
        .filter(Boolean);
      out.push({ spec: destructured[2], names, namespace: false, star: false, line: at });
      continue;
    }
    const nsDynamic = line.match(
      /(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*(?:await\s+)?(?:import|require)\s*\(\s*["']([^"']+)["']/,
    );
    if (nsDynamic) {
      out.push({ spec: nsDynamic[1], names: [], namespace: true, star: false, line: at });
      continue;
    }
    const from = line.match(/\bfrom\s*["']([^"']+)["']/);
    if (!from) {
      // `import("./x").then(({ a }) => …)` and `(await import("./x")).a` bind
      // nothing this scanner can name, so the whole module counts as used —
      // the conservative direction, since the alternative is reporting live
      // symbols dead.
      for (const m of line.matchAll(/\bimport\s*\(\s*["']([^"']+)["']/g)) {
        out.push({ spec: m[1], names: [], namespace: true, star: false, line: at });
      }
      continue;
    }
    const spec = from[1];
    const head = line.slice(0, from.index);
    const namespace = /\*\s+as\s+[A-Za-z_$][\w$]*/.test(head);
    const star = /^\s*export\s+\*/.test(head);
    const names = [];
    const braces = head.match(/\{([^}]*)\}/);
    if (braces) {
      for (const piece of braces[1].split(",")) {
        const m = piece.trim().replace(/^type\s+/, "").match(/^([A-Za-z_$][\w$]*)/);
        if (m) names.push(m[1]);
      }
    }
    if (/^\s*import\s+[A-Za-z_$][\w$]*\s*(,|from)/.test(head)) names.push("default");
    out.push({ spec, names, namespace, star, line: at });
  }
  return out;
}

/**
 * Package names a file ASSERTS are on disk — `node_modules/<pkg>` written in
 * prose or a comment. This is not an import, and the report never calls it
 * one; it is here because such a sentence is a claim about the repository that
 * the lockfile can falsify. scripts/record-hero.mjs:8 says the repo "carries
 * one at node_" + "modules/<a package>"; package-lock.json has never heard of
 * it, so `npm ci` never creates that directory. (Written broken on purpose:
 * this scanner reads its own source, and a literal example here would be
 * reported as a finding about the tool's own documentation.)
 * @param {string} text
 * @returns {{ name: string, line: number }[]}
 */
export function extractNodeModulesClaims(text, { commentsOnly = false } = {}) {
  const src = String(text ?? "");
  const mask = commentsOnly ? maskCode(src) : null;
  const out = [];
  let offset = 0;
  for (const [i, line] of src.split("\n").entries()) {
    for (const m of line.matchAll(/node_modules\/((?:@[\w.-]+\/)?[\w.-]+)/g)) {
      // In source, only a COMMENT is a claim about the repository. The same
      // text inside a string literal is test data — this tool's own fixtures
      // name install-directory paths, and counting those had it report two
      // packages that have never existed. (This comment names no package
      // literally, for exactly the same reason.)
      if (mask && mask[offset + (m.index ?? 0)] !== COMMENT) continue;
      out.push({ name: m[1], line: i + 1 });
    }
    offset += line.length + 1;
  }
  return out;
}

/**
 * Exported names declared in one file, with their line.
 * `export default` is reported as the name "default".
 * @param {string} text
 * @returns {{ name: string, line: number }[]}
 */
export function collectExportedNames(text) {
  const out = [];
  const lines = String(text ?? "").split(/\r?\n/);
  lines.forEach((line, i) => {
    const at = i + 1;
    const decl = line.match(
      /^\s*export\s+(?:declare\s+)?(?:async\s+)?(?:function\*?|const|let|var|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/,
    );
    if (decl) out.push({ name: decl[1], line: at });
    if (/^\s*export\s+default\b/.test(line)) out.push({ name: "default", line: at });
    const list = line.match(/^\s*export\s*\{([^}]*)\}/);
    if (list) {
      for (const piece of list[1].split(",")) {
        const m = piece.trim().match(/(?:[A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)|^([A-Za-z_$][\w$]*)$/);
        const name = m?.[1] ?? m?.[2];
        if (name && name !== "default") out.push({ name, line: at });
      }
    }
  });
  return out;
}

/** True for an index.* file whose exports are all re-exports — a barrel. */
export function isBarrel(relPath, text) {
  if (!/(^|\/)index\.(ts|tsx|js|jsx|mjs)$/.test(relPath)) return false;
  const body = String(text ?? "");
  if (!/^\s*export\s+(\*|\{)[\s\S]*?\bfrom\b/m.test(body)) return false;
  const declared = /^\s*export\s+(?:declare\s+)?(?:async\s+)?(?:function|const|let|var|class)\s/m.test(body);
  return !declared;
}

/** The never-delete verdict for one path, or null. */
export function neverDeleteReason(relPath, isIgnored = () => false) {
  for (const rule of NEVER_DELETE) {
    if (relPath.startsWith(rule.prefix)) return rule.reason;
  }
  if (isIgnored(relPath)) return "matched by .gitignore";
  return null;
}

/**
 * @typedef {object} Ref
 * @property {string} file
 * @property {number} line
 * @property {string} [kind]
 */

/**
 * @typedef {object} FileFinding
 * @property {string} path
 * @property {"referenced"|"unreferenced"|"INDETERMINATE"} status
 * @property {boolean} keep
 * @property {string|null} keepReason
 * @property {string|null} entryPoint
 * @property {Ref[]} referencedBy
 * @property {number} referenceCount
 * @property {number} codeReferenceCount
 * @property {boolean} proseOnly
 * @property {boolean} onlyBarrelReferences
 */

/**
 * @typedef {object} ExportFinding
 * @property {string} file
 * @property {string} name
 * @property {number} line
 * @property {"referenced"|"unreferenced"|"INDETERMINATE"} status
 * @property {string|null} [scope]
 * @property {Ref[]} usedBy
 */

/**
 * @typedef {object} DependencyFinding
 * @property {string} name
 * @property {string|null} declaredIn
 * @property {"referenced"|"unreferenced"|"tooling"|"undeclared"|"claimed-absent"} status
 * @property {Ref[]} usedBy
 * @property {boolean} inLockfile
 * @property {string} [note]
 */

/**
 * @typedef {object} RepoRefsReport
 * @property {number} scanned
 * @property {string[]} excluded
 * @property {FileFinding[]} files
 * @property {ExportFinding[]} exports
 * @property {DependencyFinding[]} dependencies
 * @property {{file: string, line: number, spec: string|null, staticPrefix: string|null, call: string}[]} dynamicImports
 * @property {{file: string, reExports: string[]}[]} barrels
 * @property {{file: string, line: number, spec: string}[]} unresolvedImports
 * @property {{global: boolean, scopes: {file: string, line: number, prefix: string|null}[]}} indeterminate
 */

/**
 * hyg-09: the media rig's optional-dependency allow-list, read from
 * docs/MEDIA-GUIDE.md's fenced media-imports block (one bare module name
 * per line). Modules listed there may be imported by scripts/media/ files
 * without being declared in package.json: the scripts import them guarded
 * and dynamically (a missing module is a message, never a stack trace),
 * and CI never downloads them. The policy lives in the guide the operator
 * reads, not in this scanner's source.
 * @param {string} guideText
 * @returns {Set<string>}
 */
export function mediaImportAllowlist(guideText) {
  const text = String(guideText ?? "");
  const fence = text.match(/```media-imports\n([\s\S]*?)```/);
  if (!fence) return new Set();
  return new Set(
    fence[1]
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#")),
  );
}

/**
 * Build the whole graph and every finding.
 *
 * @param {object} input
 * @param {string[]} input.trackedFiles
 * @param {((relPath: string) => string)|Record<string,string>} input.read
 *        file contents: either a plain path->text record, or the callback the
 *        CLI uses to stream them off disk. analyze() itself never touches the
 *        filesystem either way.
 * @param {string} [input.tsconfigText]
 * @param {string} [input.packageJsonText]
 * @param {string} [input.packageLockText]
 * @param {string} [input.gitignoreText]
 * @returns {RepoRefsReport}
 */

export function analyze({
  trackedFiles = [],
  read = () => "",
  tsconfigText = "",
  packageJsonText = "",
  packageLockText = "",
  gitignoreText = "",
} = {}) {
  const files = scanSet(trackedFiles);
  const fileSet = new Set(files);
  const aliases = parseTsconfigPaths(tsconfigText);
  const isIgnored = gitignoreMatcher(gitignoreText);

  /** @type {Map<string, {file: string, line: number, kind: string}[]>} */
  const incoming = new Map(files.map((f) => [f, []]));
  /** @type {Map<string, {file: string, line: number}[]>} */
  const packageUses = new Map();
  const dynamicImports = [];
  const barrels = [];
  /** @type {Map<string, {file: string, line: number}[]>} */
  const packageClaims = new Map();
  const unresolvedImports = [];
  /** Directories a non-literal dynamic import could reach; null = anywhere. */
  const indeterminateScopes = [];

  const readText = typeof read === "function" ? read : (rel) => read?.[rel] ?? "";
  const texts = new Map();
  for (const f of files) {
    let text = "";
    try {
      text = readText(f) ?? "";
    } catch {
      text = "";
    }
    texts.set(f, text);
  }

  for (const from of files) {
    if (isNonReferencingSource(from)) continue;
    const text = texts.get(from) ?? "";
    const ext = path.posix.extname(from);

    if (MODULE_EXT.has(ext) || ext === ".css") {
      for (const ref of extractModuleSpecifiers(text)) {
        // Reported, never guessed — and a computed require() is exactly as
        // unresolvable as a computed import(), so it belongs in the same list.
        if (ref.kind === "dynamic" || (ref.kind === "require" && ref.spec === null)) {
          dynamicImports.push({
            file: from,
            line: ref.line,
            spec: ref.spec,
            staticPrefix: ref.staticPrefix ?? null,
            call: ref.kind === "require" ? "require" : "import",
          });
        }
        if (ref.spec === null) {
          // Never guessed: record the reach of the unresolvable target. The
          // prefix goes through the SAME alias table as a static import —
          // `import(`@/locales/${l}.js`)` reaches src/locales, not a directory
          // beside the importing file, and resolving it wrongly would report
          // its real candidates deletable.
          const prefixes = resolvePrefixes(ref.staticPrefix, from, aliases);
          if (prefixes.length === 0) {
            indeterminateScopes.push({ file: from, line: ref.line, prefix: null });
          } else {
            for (const prefix of prefixes) {
              indeterminateScopes.push({ file: from, line: ref.line, prefix });
            }
          }
          continue;
        }
        // A URL is not a module in this repository.
        if (/^(https?:|data:|\/\/)/.test(ref.spec)) continue;
        // CSS resolves a bare `@import url("tokens/base.css")` relative to the
        // stylesheet; `@import "tw-animate-css"` is still a package, so the
        // relative reading is tried first and falls back.
        let resolved = resolveSpecifier(ref.spec, from, fileSet, aliases);
        if (ref.kind === "css-import" && !ref.spec.startsWith(".") && resolved.kind !== "file") {
          const asRelative = resolveSpecifier("./" + ref.spec, from, fileSet, aliases);
          if (asRelative.kind === "file") resolved = asRelative;
        }
        if (resolved.kind === "file") {
          incoming.get(resolved.value)?.push({ file: from, line: ref.line, kind: ref.kind });
        } else if (resolved.kind === "package") {
          if (!packageUses.has(resolved.value)) packageUses.set(resolved.value, []);
          packageUses.get(resolved.value).push({ file: from, line: ref.line });
        } else if (resolved.kind === "unresolved") {
          unresolvedImports.push({ file: from, line: ref.line, spec: ref.spec });
        }
      }
      if (isBarrel(from, text)) {
        barrels.push({
          file: from,
          reExports: extractModuleSpecifiers(text).filter((r) => r.spec).map((r) => r.spec),
        });
      }
    }

    // Only file types the scanner reads at all: an unrecognised extension (a
    // .fixture, say) is test data, not a claim about the repository.
    const claimable = MODULE_EXT.has(ext) || MENTION_EXT.has(ext);
    for (const claim of claimable
      ? extractNodeModulesClaims(text, { commentsOnly: MODULE_EXT.has(ext) })
      : []) {
      if (!packageClaims.has(claim.name)) packageClaims.set(claim.name, []);
      packageClaims.get(claim.name).push({ file: from, line: claim.line });
    }

    if (MENTION_EXT.has(ext)) {
      for (const mention of extractPathMentions(text, fileSet)) {
        if (mention.target === from) continue; // a file mentioning itself proves nothing
        incoming.get(mention.target)?.push({ file: from, line: mention.line, kind: "path-mention" });
      }
    }
  }

  const barrelFiles = new Set(barrels.map((b) => b.file));
  const globallyIndeterminate = indeterminateScopes.some((s) => s.prefix === null);

  const fileFindings = files.map((relPath) => {
    const refs = incoming.get(relPath) ?? [];
    const keepReason = neverDeleteReason(relPath, isIgnored);
    const entryPoint = entryPointReason(relPath);
    const scoped = indeterminateScopes.some((s) => s.prefix !== null && relPath.startsWith(s.prefix));
    let status;
    if (refs.length > 0 || entryPoint) status = "referenced";
    else if (scoped || (globallyIndeterminate && IMPORTABLE_EXT.has(path.posix.extname(relPath)))) {
      status = "INDETERMINATE";
    } else status = "unreferenced";
    const onlyBarrel = refs.length > 0 && refs.every((r) => barrelFiles.has(r.file));
    // A path mention in prose is a reference (the acceptance says so) but it is
    // not the same evidence as an import: a document can name a file precisely
    // BECAUSE the file is dead. docs/design/hygiene.md's own DEAD-PROVEN table
    // does exactly that. So the kind is carried through to the report.
    const codeRefs = refs.filter((r) => r.kind !== "path-mention");
    return {
      path: relPath,
      status,
      keep: keepReason !== null,
      keepReason,
      entryPoint,
      referencedBy: refs.slice(0, 5),
      referenceCount: refs.length,
      codeReferenceCount: codeRefs.length,
      proseOnly: !entryPoint && refs.length > 0 && codeRefs.length === 0,
      onlyBarrelReferences: onlyBarrel,
    };
  });

  // Exported symbols, resolved through actual import BINDINGS rather than a
  // text search: a document that names a symbol while explaining that it is
  // dead must not be what keeps it alive. A namespace import (`* as x`) or a
  // star re-export marks every export of its target referenced, because what
  // the importer picks out of the namespace is not statically visible here.
  /** @type {Map<string, Map<string, {file: string, line: number}[]>>} */
  const namedUses = new Map(files.map((f) => [f, new Map()]));
  const wholeModuleUses = new Map(files.map((f) => [f, []]));
  for (const from of files) {
    if (isNonReferencingSource(from)) continue;
    if (!MODULE_EXT.has(path.posix.extname(from))) continue;
    for (const binding of extractImportBindings(texts.get(from) ?? "")) {
      const resolved = resolveSpecifier(binding.spec, from, fileSet, aliases);
      if (resolved.kind !== "file" || resolved.value === from) continue;
      if (binding.namespace || binding.star) {
        wholeModuleUses.get(resolved.value)?.push({ file: from, line: binding.line });
        continue;
      }
      const perName = namedUses.get(resolved.value);
      if (!perName) continue;
      for (const name of binding.names) {
        if (!perName.has(name)) perName.set(name, []);
        perName.get(name).push({ file: from, line: binding.line });
      }
    }
  }

  const exportFindings = [];
  for (const from of files) {
    const ext = path.posix.extname(from);
    if (!MODULE_EXT.has(ext)) continue;
    // Symbols inside never-delete paths can never be removed, so a verdict on
    // them is noise rather than information.
    if (neverDeleteReason(from, isIgnored)) continue;
    const inApp = from.startsWith("src/app/") || from.endsWith(".config.mjs") || from.endsWith(".config.ts");
    const namespaced = (wholeModuleUses.get(from) ?? []).slice(0, 5);
    // A file that only survives because an unresolvable import might reach it
    // cannot have its symbols judged either.
    const fileUncertain =
      globallyIndeterminate ||
      indeterminateScopes.some((sc) => sc.prefix !== null && from.startsWith(sc.prefix));
    const ownLines = (texts.get(from) ?? "").split(/\r?\n/);
    for (const { name, line } of collectExportedNames(texts.get(from) ?? "")) {
      if (name === "default") continue;
      if (inApp && FRAMEWORK_EXPORTS.has(name)) continue;
      const users = [...(namedUses.get(from)?.get(name) ?? []), ...namespaced].slice(0, 5);
      // A symbol used elsewhere in its own file is ALIVE — the export is merely
      // wider than it needs to be. Calling that "unreferenced" would put live
      // code on a deletion list, which is the one mistake this tool must not
      // make.
      const word = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
      const ownUse = ownLines.findIndex((l, i) => i + 1 !== line && word.test(l));
      let status = "unreferenced";
      let scope = null;
      if (users.length > 0) status = "referenced";
      else if (ownUse >= 0) {
        status = "referenced";
        scope = "own-file";
      } else if (fileUncertain) status = "INDETERMINATE";
      exportFindings.push({
        file: from,
        name,
        line,
        status,
        scope,
        usedBy: scope === "own-file" ? [{ file: from, line: ownUse + 1 }] : users,
      });
    }
  }

  // Dependencies. Declared-and-unused and used-but-undeclared are both
  // findings; the lockfile is checked because a package missing from it cannot
  // survive `npm ci` however it is declared.
  let pkg = {};
  try {
    pkg = JSON.parse(packageJsonText || "{}");
  } catch {
    pkg = {};
  }
  const declared = new Map();
  for (const block of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
    for (const name of Object.keys(pkg[block] ?? {})) declared.set(name, block);
  }
  const lockText = String(packageLockText ?? "");
  const inLockfile = (name) => lockText.includes(`"node_modules/${name}"`) || lockText.includes(`"${name}":`);

  const dependencyFindings = [];
  for (const [name, block] of declared) {
    const uses = packageUses.get(name) ?? [];
    if (uses.length > 0) {
      dependencyFindings.push({ name, declaredIn: block, status: "referenced", usedBy: uses.slice(0, 5), useCount: uses.length, inLockfile: inLockfile(name) });
    } else if (TOOLING_DEPENDENCIES.has(name)) {
      dependencyFindings.push({ name, declaredIn: block, status: "tooling", usedBy: [], useCount: 0, note: TOOLING_DEPENDENCIES.get(name), inLockfile: inLockfile(name) });
    } else {
      dependencyFindings.push({ name, declaredIn: block, status: "unreferenced", usedBy: [], useCount: 0, inLockfile: inLockfile(name) });
    }
  }
  const mediaAllowed = mediaImportAllowlist(readFileSync(path.join(REPO_ROOT, "docs", "MEDIA-GUIDE.md"), "utf8"));
  for (const [name, uses] of packageUses) {
    if (declared.has(name)) continue;
    // hyg-09: scripts/media/** may import the guide's allow-listed optional
    // modules without declaring them (guarded dynamic imports; a message,
    // never a stack trace). Uses OUTSIDE the media rig still report.
    const nonMediaUses = uses.filter((u) => !u.file.startsWith("scripts/media/"));
    if (mediaAllowed.has(name) && nonMediaUses.length === 0) continue;
    dependencyFindings.push({ name, declaredIn: null, status: "undeclared", usedBy: uses.slice(0, 5), useCount: uses.length, inLockfile: inLockfile(name) });
  }
  // A source comment claiming node_modules/<pkg> is on disk, where neither the
  // manifest nor the lockfile has ever heard of the package. Reported as a
  // claim, never as an import.
  for (const [name, where] of packageClaims) {
    if (declared.has(name) || packageUses.has(name) || inLockfile(name)) continue;
    dependencyFindings.push({
      name,
      declaredIn: null,
      status: "claimed-absent",
      usedBy: where.slice(0, 5),
      useCount: where.length,
      inLockfile: false,
      note: "named as node_modules/… in prose, but absent from package.json AND package-lock.json — npm ci never creates it",
    });
  }
  dependencyFindings.sort((a, b) => a.name.localeCompare(b.name));

  return {
    scanned: files.length,
    excluded: [...EXCLUDED_PREFIXES, ...EXCLUDED_PATHS, "prisma/*.db*"],
    files: fileFindings,
    exports: exportFindings,
    dependencies: dependencyFindings,
    dynamicImports,
    barrels,
    unresolvedImports,
    indeterminate: { global: globallyIndeterminate, scopes: indeterminateScopes },
  };
}

/** The resolver rules, in words, for the evidence report. */
export const RESOLVER_RULES = [
  "scan set: `git ls-files` minus node_modules/, .next/, .git/, .claude/, .spec-build/, package-lock.json and prisma/*.db*",
  "spec.md is scanned but never counted as a referencing source — it names paths it plans to create",
  "ES `import`/`export … from`, side-effect imports, CJS `require()`, literal `import()` and CSS `@import` are all edges",
  "extension resolution: exact, then .ts .tsx .js .jsx .mjs .cjs .json .css, then /index.*; a `.js` specifier also tries `.ts`/`.tsx`",
  "the `@/*` alias is read from tsconfig.json, never hardcoded",
  "any token in a .md/.json/.yml/.sh/.mjs/.cjs/.ts/.tsx/.prisma/.html file that is literally a path in the scan set is an edge",
  "a non-literal `import()` or `require()` makes its candidates INDETERMINATE, never unreferenced — globally when no static prefix can be read from it",
  "LIMIT: a prefix-scoped INDETERMINATE bounds the candidates by the static prefix, and a substitution containing `..` can reach outside it. The bound is a heuristic; the never-delete list and the human review on every deletion are the backstop",
  "barrel files are listed, and a file referenced ONLY by a barrel is flagged: the file is alive, the symbol may not be",
  "dependencies are nodes: declared-and-unimported, used-but-undeclared, and absent-from-package-lock.json are all findings",
  "never-delete paths (agents/, skills/, servo_design_system/, prisma/, tests/fixtures/, docs/hygiene/, anything .gitignore matches) are reported but always keep",
];

/**
 * Render the committed evidence report. `date` is a parameter so the tests are
 * deterministic; the CLI passes today.
 * @param {RepoRefsReport} report
 * @param {{ command: string, date: string }} meta
 * @returns {string}
 */
export function renderEvidence(report, { command, date }) {
  const L = [];
  /** A reference list that never hides how much it left out. */
  const refs = (list, total) => {
    if (total === 0) return "—";
    const shown = list.map((r) => `${r.file}:${r.line}`).join(", ");
    return total > list.length ? `${shown} (${total} total)` : shown;
  };
  L.push(`# Reference scan — ${date}`);
  L.push("");
  L.push(`Generated by \`${command}\` (scripts/repo-refs.mjs, spec item hyg-01).`);
  L.push("This file is the evidence §13.1 clause 1 requires before anything is deleted.");
  L.push("");
  L.push(`## Scan set`);
  L.push("");
  L.push(`${report.scanned} tracked files, after excluding: ${report.excluded.join(", ")}.`);
  L.push("");
  L.push("## Resolver rules applied");
  L.push("");
  for (const rule of RESOLVER_RULES) L.push(`- ${rule}`);
  L.push("");

  const unreferenced = report.files.filter((f) => f.status === "unreferenced");
  const indeterminate = report.files.filter((f) => f.status === "INDETERMINATE");
  L.push("## Every scanned file");
  L.push("");
  L.push("One row per file in the scan set — `referenced`, `unreferenced` or");
  L.push("`INDETERMINATE`, with what points at it. A verdict of `referenced` whose");
  L.push("only edges are prose mentions is marked so, and a file referenced only");
  L.push("through a barrel is marked so: both are alive, but neither is proof that");
  L.push("anything uses what they contain.");
  L.push("");
  L.push("| file | verdict | referenced by | keep |");
  L.push("|---|---|---|---|");
  for (const f of report.files) {
    const note = f.entryPoint
      ? `entry point — ${f.entryPoint}`
      : f.proseOnly
        ? `prose only: ${refs(f.referencedBy, f.referenceCount)}`
        : f.onlyBarrelReferences
          ? `barrel only: ${refs(f.referencedBy, f.referenceCount)}`
          : refs(f.referencedBy, f.referenceCount);
    L.push(`| \`${f.path}\` | ${f.status} | ${note} | ${f.keep ? "keep" : "—"} |`);
  }
  L.push("");
  L.push("## Files — unreferenced");
  L.push("");
  L.push("| file | verdict | keep | why |");
  L.push("|---|---|---|---|");
  for (const f of unreferenced) {
    L.push(`| \`${f.path}\` | unreferenced | ${f.keep ? "**keep**" : "—"} | ${f.keepReason ?? ""} |`);
  }
  L.push("");
  const proseOnly = report.files.filter((f) => f.proseOnly);
  L.push("## Files with no code reference — named only in prose");
  L.push("");
  L.push("A document can name a file precisely because the file is dead. These");
  L.push("rows are the DEAD-PROVEN candidates: nothing imports them, and the only");
  L.push("thing pointing at them is text.");
  L.push("");
  L.push("| file | named by | keep |");
  L.push("|---|---|---|");
  for (const f of proseOnly) {
    L.push(`| \`${f.path}\` | ${refs(f.referencedBy, f.referenceCount)} | ${f.keep ? "**keep**" : "—"} |`);
  }
  L.push("");
  if (indeterminate.length > 0) {
    L.push("## Files — INDETERMINATE (never treated as dead)");
    L.push("");
    L.push("| file | why |");
    L.push("|---|---|");
    for (const f of indeterminate) L.push(`| \`${f.path}\` | reachable by an unresolvable dynamic import |`);
    L.push("");
  }

  const uncertainExports = report.exports.filter((e) => e.status === "INDETERMINATE");
  if (uncertainExports.length > 0) {
    L.push("## Exported symbols — INDETERMINATE (never treated as dead)");
    L.push("");
    L.push("| file | symbol | line |");
    L.push("|---|---|---|");
    for (const e of uncertainExports) L.push(`| \`${e.file}\` | \`${e.name}\` | ${e.line} |`);
    L.push("");
  }
  const deadExports = report.exports.filter((e) => e.status === "unreferenced");
  L.push("## Exported symbols — unreferenced");
  L.push("");
  L.push("| file | symbol | line |");
  L.push("|---|---|---|");
  for (const e of deadExports) L.push(`| \`${e.file}\` | \`${e.name}\` | ${e.line} |`);
  L.push("");

  L.push("## Dependencies");
  L.push("");
  L.push("Every dependency finding: declared-and-never-imported, imported-but-");
  L.push("undeclared, named-in-prose-but-absent, and — however it is declared —");
  L.push("any package missing from package-lock.json, because that one cannot");
  L.push("survive `npm ci` no matter how healthy it looks. `claimed-absent` means");
  L.push("a source comment says the package is installed and the lockfile has");
  L.push("never heard of it; the location is the sentence, not an import.");
  L.push("");
  L.push("| package | declared in | verdict | where | in package-lock.json |");
  L.push("|---|---|---|---|---|");
  for (const d of report.dependencies) {
    if (d.status === "referenced" && d.inLockfile) continue;
    const used = d.usedBy.length > 0 ? refs(d.usedBy, d.useCount ?? d.usedBy.length) : d.note ?? "—";
    L.push(`| \`${d.name}\` | ${d.declaredIn ?? "**undeclared**"} | ${d.status} | ${used} | ${d.inLockfile ? "yes" : "**no**"} |`);
  }
  L.push("");

  L.push("## Dynamic imports (reported, never guessed)");
  L.push("");
  if (report.dynamicImports.length === 0) L.push("None.");
  for (const d of report.dynamicImports) {
    L.push(`- \`${d.file}:${d.line}\` (${d.call ?? "import"}) → ${d.spec ? `\`${d.spec}\`` : "**non-literal — INDETERMINATE**"}`);
  }
  L.push("");
  L.push("## Barrel files");
  L.push("");
  if (report.barrels.length === 0) L.push("None.");
  for (const b of report.barrels) L.push(`- \`${b.file}\` re-exports ${b.reExports.map((r) => `\`${r}\``).join(", ")}`);
  L.push("");
  const onlyBarrel = report.files.filter((f) => f.onlyBarrelReferences);
  if (onlyBarrel.length > 0) {
    L.push("Files referenced only through a barrel — alive as files, but the symbol may be dead:");
    L.push("");
    for (const f of onlyBarrel) L.push(`- \`${f.path}\``);
    L.push("");
  }
  if (report.unresolvedImports.length > 0) {
    L.push("## Import specifiers that did not resolve");
    L.push("");
    for (const u of report.unresolvedImports) L.push(`- \`${u.file}:${u.line}\` → \`${u.spec}\``);
    L.push("");
  }
  return L.join("\n");
}

// ---------------------------------------------------------------------------
// The baseline — spec item hyg-04.
//
// hyg-01's scanner reports; it never fails. This half is the gate, and it is a
// KEEP-LIST, not a to-delete list: every finding the repository has decided to
// live with carries a row saying why, and who owns undoing it. What fails is a
// finding with NO row — a file that just became unreferenced, a dependency that
// just stopped being imported, an import that appears in no manifest. The set
// of things nobody points at can then only shrink by decision, never grow by
// drift.
//
// Two rules keep the list honest and are enforced elsewhere on purpose:
//  * A row may only be REMOVED in the commit that removes the thing it
//    describes or adds a reference to it. --check cannot see that, so
//    tests/repo-refs-baseline.test.ts asserts every row still describes
//    something real. A stale row is reported here as a note and never fails
//    --check, because "it never fails for a baseline row" is the contract.
//  * A row's `owner` names the backlog item or the numbered §14 question that
//    will end it. The SHAPE is checked here; that the id actually exists in
//    spec.md is checked by the test, which is the file allowed to read spec.md.
// ---------------------------------------------------------------------------

/** Where the keep-list lives. */
export const BASELINE_PATH = "tests/fixtures/repo-refs-baseline.json";

/**
 * The media rig imports `sharp` and `ffmpeg-static` without declaring them.
 * hyg-09 archives those scripts and writes docs/MEDIA-GUIDE.md carrying a
 * machine-readable list of the modules they may import undeclared. Until that
 * file exists the same modules are ordinary baseline rows; its ABSENCE IS NOT
 * A FAILURE, because hyg-09 is what writes it.
 */
export const MEDIA_GUIDE_PATH = "docs/MEDIA-GUIDE.md";

/** The info string of the fenced block hyg-09 must write. */
export const MEDIA_FENCE_NAME = "media-tooling";

/**
 * An owner is a backlog item id, or a numbered question under §14. The
 * negative lookahead matters: without it `question-abc` parses as a plausible
 * item id and only the tree test catches it, which is one layer too late for a
 * typo in the field whose whole job is to name who ends the row.
 */
export const OWNER_RE = /^(?:question-\d+|(?!question-)[a-z][a-z0-9]*-[a-z0-9-]+)$/;

/**
 * The modules named in docs/MEDIA-GUIDE.md's fenced `media-tooling` block.
 *
 * The format is deliberately the smallest thing hyg-09 can write and this can
 * read: one module per line, optionally dash-prefixed, `#` opens a comment.
 * A missing file, a missing fence or an unterminated fence all yield [] —
 * never an exception, because the caller's contract is that absence is normal.
 *
 * @param {string} text  docs/MEDIA-GUIDE.md, or "" when it does not exist
 * @returns {string[]}
 */
export function parseMediaAllowlist(text) {
  const lines = String(text ?? "").split(/\r?\n/);
  const open = /^ {0,3}(`{3,}|~{3,})\s*(.*)$/;
  /** The fence currently open, at ANY nesting depth. */
  let outer = null;
  let fence = null;
  const out = [];
  for (const line of lines) {
    const m = open.exec(line);
    if (fence) {
      // ANY fence marker inside the block ends it. A `media-tooling` block is a
      // flat list of module names, so a nested opener is never data — treating
      // it as data let ```js and the lines under it become "modules".
      // Closing does not stop the scan: a guide may split the list over more
      // than one block, and silently reading only the first would drop
      // entries hyg-09 wrote in good faith.
      if (m) {
        fence = null;
        continue;
      }
      const body = line.replace(/(^|\s)#.*$/, "").replace(/^\s*-\s*/, "").trim();
      if (body) out.push(body);
      continue;
    }
    if (!m) continue;
    if (outer) {
      // Closing the enclosing block, or a fence nested inside it. A
      // `media-tooling` block shown as an EXAMPLE inside an outer ````-fence is
      // documentation, not configuration, and must not widen the gate.
      if (m[1][0] === outer.marker && m[1].length >= outer.len && m[2].trim() === "") outer = null;
      continue;
    }
    if (m[2].trim() === MEDIA_FENCE_NAME) fence = { marker: m[1][0], len: m[1].length };
    else outer = { marker: m[1][0], len: m[1].length };
  }
  // Unterminated: an open fence lists nothing, exactly as claims-audit.mjs
  // treats one. Returning the partial list would let a typo widen the gate.
  return fence ? [] : out;
}

/**
 * Parse and validate the keep-list. Pure: JSON text in, rows plus problems out.
 * A malformed row is a `problem`, not a row — a keep-list nobody can read is
 * not a keep-list, and that is a different failure from "a finding has no row".
 *
 * @param {string} text
 * @returns {{files: object[], dependencies: object[], problems: string[]}}
 */
export function parseBaseline(text) {
  const problems = [];
  let raw;
  try {
    raw = JSON.parse(String(text ?? ""));
  } catch (err) {
    return { files: [], dependencies: [], problems: [`${BASELINE_PATH}: not valid JSON — ${err?.message ?? err}`] };
  }
  // A top-level array, string or null parses fine and yields an EMPTY keep-list.
  // The failure direction is safe — everything goes uncovered and --check exits
  // 1 — but "0 findings covered" is the wrong diagnosis for "the keep-list is
  // malformed", and the wrong diagnosis is what sends someone editing rows.
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      files: [],
      dependencies: [],
      problems: [`${BASELINE_PATH}: must be a JSON object with \`files\` and \`dependencies\` arrays`],
    };
  }
  const rows = (key, idField) => {
    const list = raw?.[key];
    if (list === undefined) return [];
    if (!Array.isArray(list)) {
      problems.push(`${BASELINE_PATH}: \`${key}\` must be an array`);
      return [];
    }
    const seen = new Set();
    const kept = [];
    list.forEach((row, i) => {
      const at = `${BASELINE_PATH}: ${key}[${i}]`;
      const id = typeof row?.[idField] === "string" ? row[idField].trim() : "";
      if (!id) {
        problems.push(`${at}: missing \`${idField}\``);
        return;
      }
      if (seen.has(id)) problems.push(`${at}: duplicate row for \`${id}\` — the later one would silently win`);
      seen.add(id);
      // A row's path is compared against `git ls-files` output, which is always
      // repo-relative and forward-slashed. An absolute or escaping path can
      // never match one, so it is a typo, not a keep decision.
      if (idField === "path" && (id.startsWith("/") || id.startsWith("../") || id.includes("/../"))) {
        problems.push(`${at} (${id}): \`path\` must be repo-relative — it is matched against \`git ls-files\``);
      }
      if (typeof row.reason !== "string" || row.reason.trim() === "") {
        problems.push(`${at} (${id}): missing \`reason\` — a keep-list row with no reason is a to-delete list row`);
      }
      const owner = typeof row.owner === "string" ? row.owner.trim() : "";
      if (!owner) {
        problems.push(`${at} (${id}): missing \`owner\` — name the backlog item id or the question-<n> that ends this row`);
      } else if (!OWNER_RE.test(owner)) {
        problems.push(`${at} (${id}): \`owner\` must be a backlog item id or question-<n>, got \`${owner}\``);
      }
      if (row.finding !== undefined) {
        const f = typeof row.finding === "string" ? row.finding.trim() : "";
        if (!DEPENDENCY_VIOLATIONS.has(f)) {
          problems.push(
            `${at} (${id}): \`finding\` must be one of ${[...DEPENDENCY_VIOLATIONS.keys()].join(", ")}, got \`${row.finding}\``,
          );
        }
      }
      kept.push({ ...row, [idField]: id });
    });
    return kept;
  };
  // The package rows are keyed `packages` in the JSON, NOT `dependencies`, and
  // that is not cosmetic. scripts/landing-tier.mjs tracks package.json's
  // dependency blocks by header line across the WHOLE staged diff, not per
  // file, so a JSON file carrying a `"dependencies":` key makes every commit
  // that touches it read as a runtime dependency change and land Tier C. This
  // item's only package.json change is one added npm script; with the old key
  // it still classified C and sat waiting on a human merge. The field stays
  // `dependencies` in memory, so every reader below is unchanged.
  return { files: rows("files", "path"), dependencies: rows("packages", "name"), problems };
}

/** The dependency finding statuses the gate acts on, and what each one means. */
const DEPENDENCY_VIOLATIONS = new Map([
  ["unreferenced", "declared in package.json and imported by nothing"],
  ["undeclared", "imported, but declared in no manifest"],
  ["claimed-absent", "named as a node_modules path, but in neither package.json nor package-lock.json"],
]);

/**
 * The statuses the media allowlist may cover. It exists for modules the media
 * rig IMPORTS without declaring, so it stops there: a name in the guide must
 * not also excuse `unreferenced` — declared in package.json and imported by
 * nothing — which is the one class the keep-list format exists to make someone
 * write a reason and an owner for.
 */
const MEDIA_ALLOWLIST_STATUSES = new Set(["undeclared", "claimed-absent"]);

/**
 * Compare a report against the keep-list.
 *
 * @param {RepoRefsReport} report
 * @param {{files: object[], dependencies: object[], problems?: string[]}} baseline
 * @param {{mediaAllowlist?: string[]}} [opts]
 * @returns {{violations: {kind: string, id: string, message: string}[], stale: {kind: string, id: string, message: string}[], covered: number, unjudgeable: string[]}}
 */
export function checkBaseline(report, baseline, { mediaAllowlist = [] } = {}) {
  const violations = [];
  const stale = [];
  // Defensive: the CLI always arrives through parseBaseline, which rejects a
  // null or non-object row, but a caller driving this directly must get a
  // report rather than a TypeError — a gate that crashes is a gate that gets
  // switched off.
  const rowsOf = (v, key) =>
    new Map(
      (Array.isArray(v) ? v : [])
        .filter((r) => r && typeof r === "object" && typeof r[key] === "string")
        .map((r) => [r[key], r]),
    );
  const fileRows = rowsOf(baseline?.files, "path");
  const depRows = rowsOf(baseline?.dependencies, "name");
  const media = new Set(mediaAllowlist ?? []);
  let covered = 0;

  for (const p of baseline?.problems ?? []) {
    violations.push({ kind: "baseline", id: BASELINE_PATH, message: p });
  }

  const liveFiles = new Set();
  const unjudgeable = [];
  for (const f of Array.isArray(report?.files) ? report.files : []) {
    if (!f || typeof f.path !== "string") continue;
    // An INDETERMINATE file is not "unreferenced", so it is correctly not a
    // violation — but it is not judged either, and one non-literal import()
    // can move a whole directory into this class. Silence there would let the
    // gate read green while it had stopped looking, so it is COUNTED and said
    // out loud, without changing the exit code.
    if (f.status === "INDETERMINATE" && !f.keep) unjudgeable.push(f.path);
    if (f.status !== "unreferenced" || f.keep) continue;
    liveFiles.add(f.path);
    if (fileRows.has(f.path)) {
      covered += 1;
      continue;
    }
    violations.push({
      kind: "unreferenced-file",
      id: f.path,
      message: `${f.path} is unreferenced and has no baseline row — add one with a reason and an owner, or add a reference`,
    });
  }

  const liveDeps = new Set();
  for (const d of Array.isArray(report?.dependencies) ? report.dependencies : []) {
    if (!d || typeof d.name !== "string") continue;
    const why = DEPENDENCY_VIOLATIONS.get(d.status);
    if (!why) continue;
    liveDeps.add(d.name);
    // The media allowlist is a keep-list too, just one hyg-09 owns instead of
    // the baseline file. A module in it is covered without a row — but only
    // for the import-shaped statuses it exists for.
    if (media.has(d.name) && MEDIA_ALLOWLIST_STATUSES.has(d.status)) {
      covered += 1;
      continue;
    }
    const row = depRows.get(d.name);
    if (row) {
      // The row's `finding` is a claim about WHICH violation was accepted. A
      // row written for one kind must not silently cover a different kind that
      // later appears under the same name.
      if (typeof row.finding === "string" && row.finding.trim() && row.finding.trim() !== d.status) {
        violations.push({
          kind: "baseline",
          id: d.name,
          message:
            `${BASELINE_PATH}: the row for \`${d.name}\` accepts finding \`${row.finding}\`, ` +
            `but the live finding is \`${d.status}\` — re-read it and update the reason, or add a reference`,
        });
        continue;
      }
      covered += 1;
      continue;
    }
    const where = (d.usedBy ?? []).map((u) => `${u.file}:${u.line}`).join(", ");
    violations.push({
      kind: `${d.status}-dependency`,
      id: d.name,
      message: `${d.name} — ${why}${where ? ` (${where})` : ""} — and has no baseline row`,
    });
  }

  // Rows describing nothing. Reported, never fatal: --check "never fails for a
  // baseline row", and the removal rule is the test's to enforce.
  for (const row of fileRows.values()) {
    if (!liveFiles.has(row.path)) {
      stale.push({
        kind: "stale-file-row",
        id: row.path,
        message: `${row.path} is no longer an unreferenced-and-deletable file — the row may be removed in the commit that made that true`,
      });
    }
  }
  for (const row of depRows.values()) {
    if (!liveDeps.has(row.name)) {
      stale.push({
        kind: "stale-dependency-row",
        id: row.name,
        message: `${row.name} is no longer a dependency finding — the row may be removed in the commit that made that true`,
      });
    }
  }

  return { violations, stale, covered, unjudgeable };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

/** Tracked files, straight from git. */
export function listTrackedFiles(cwd = REPO_ROOT) {
  // -z, because `git ls-files` C-quotes any path holding a non-ASCII byte, a
  // quote or a backslash — and a quoted path silently falls off the
  // never-delete list, which is the one list that must never miss.
  return execFileSync("git", ["ls-files", "-z"], { encoding: "utf8", cwd, maxBuffer: 32 * 1024 * 1024 })
    .split("\0")
    .filter(Boolean);
}

function readRepoFile(rel) {
  try {
    return readFileSync(path.join(REPO_ROOT, rel), "utf8");
  } catch {
    return "";
  }
}

/**
 * Run the scan against the real repository.
 * @param {string} [root]
 * @returns {RepoRefsReport}
 */
export function analyzeRepo(root = REPO_ROOT) {
  return analyze({
    trackedFiles: listTrackedFiles(root),
    read: (rel) => {
      try {
        return readFileSync(path.join(root, rel), "utf8");
      } catch {
        return "";
      }
    },
    tsconfigText: readRepoFile("tsconfig.json"),
    packageJsonText: readRepoFile("package.json"),
    packageLockText: readRepoFile("package-lock.json"),
    gitignoreText: readRepoFile(".gitignore"),
  });
}

/** The keep-list and the media allowlist, read off disk. */
export function loadBaselineInputs(root = REPO_ROOT) {
  const readAt = (rel) => {
    try {
      return readFileSync(path.join(root, rel), "utf8");
    } catch {
      return "";
    }
  };
  const baselineText = readAt(BASELINE_PATH);
  const baseline = baselineText
    ? parseBaseline(baselineText)
    : { files: [], dependencies: [], problems: [`${BASELINE_PATH}: missing — the keep-list is what makes --check meaningful`] };
  // Absence is normal: hyg-09 writes the guide, and until it does the same
  // modules are ordinary baseline rows.
  return { baseline, mediaAllowlist: parseMediaAllowlist(readAt(MEDIA_GUIDE_PATH)) };
}

function main() {
  const argv = process.argv.slice(2);
  const evidenceAt = argv.includes("--evidence") ? argv[argv.indexOf("--evidence") + 1] : null;
  if (argv.includes("--evidence") && (!evidenceAt || evidenceAt.startsWith("--"))) {
    // Silently exiting 0 here would let a deletion item believe it had evidence.
    console.error("repo-refs: --evidence needs a path, e.g. --evidence docs/hygiene/hyg-05-evidence.md");
    process.exit(1);
  }
  // An unrecognised flag must not silently degrade the gate to a report that
  // exits 0: `--checked` or `--check=1` would otherwise look like it passed.
  const KNOWN_FLAGS = new Set(["--check", "--evidence"]);
  const unknown = argv.filter((a) => a.startsWith("--") && !KNOWN_FLAGS.has(a));
  if (unknown.length > 0) {
    console.error(`repo-refs: unknown flag(s): ${unknown.join(", ")}. Known flags: --check, --evidence <path>`);
    process.exit(1);
  }
  const checking = argv.includes("--check");
  const report = analyzeRepo();

  const dead = report.files.filter((f) => f.status === "unreferenced" && !f.keep);
  const keep = report.files.filter((f) => f.status === "unreferenced" && f.keep);
  const proseOnly = report.files.filter((f) => f.proseOnly && !f.keep);
  const deadExports = report.exports.filter((e) => e.status === "unreferenced");
  const undeclared = report.dependencies.filter((d) => d.status === "undeclared");
  const unusedDeps = report.dependencies.filter((d) => d.status === "unreferenced");

  console.log(`repo-refs: ${report.scanned} files scanned`);
  for (const f of dead) console.log(`repo-refs: unreferenced file       ${f.path}`);
  console.log(`repo-refs: ${keep.length} unreferenced files are on the never-delete list (listed in --evidence)`);
  for (const f of proseOnly) {
    const where = f.referencedBy.map((r) => `${r.file}:${r.line}`).join(", ");
    console.log(`repo-refs: referenced, prose only  ${f.path}  (named in prose: ${where})`);
  }
  for (const e of deadExports) console.log(`repo-refs: unreferenced export     ${e.file}:${e.line} ${e.name}`);
  for (const d of unusedDeps) console.log(`repo-refs: declared, never imported ${d.name} (${d.declaredIn})`);
  for (const d of undeclared) {
    const where = d.usedBy.map((u) => `${u.file}:${u.line}`).join(", ");
    console.log(`repo-refs: UNDECLARED dependency   ${d.name} imported by ${where}${d.inLockfile ? "" : " — and absent from package-lock.json"}`);
  }
  for (const d of report.dependencies.filter((x) => x.status === "claimed-absent")) {
    const where = d.usedBy.map((u) => `${u.file}:${u.line}`).join(", ");
    console.log(`repo-refs: ABSENT package claimed  ${d.name} named at ${where} — not in package.json and not in package-lock.json`);
  }
  for (const d of report.dynamicImports.filter((x) => x.spec === null)) {
    console.log(`repo-refs: non-literal ${d.call ?? "import"}()  ${d.file}:${d.line} — candidates are INDETERMINATE`);
  }

  if (evidenceAt) {
    const command = `node scripts/repo-refs.mjs --evidence ${evidenceAt}`;
    const date = new Date().toISOString().slice(0, 10);
    const abs = path.resolve(REPO_ROOT, evidenceAt);
    try {
      mkdirSync(path.dirname(abs), { recursive: true });
      writeFileSync(abs, renderEvidence(report, { command, date }) + "\n", "utf8");
    } catch (err) {
      // A directory, an unwritable path: say so, rather than a raw stack.
      console.error(`repo-refs: could not write ${evidenceAt}: ${err?.message ?? err}`);
      process.exit(1);
    }
    console.log(`repo-refs: evidence written to ${evidenceAt}`);
  }

  if (!checking) {
    // Without --check this script is evidence, not a gate: findings are never a
    // failure, because the deletion rule is "evidence or no deletion".
    console.log("repo-refs: report complete — nothing is deleted by this script");
    return;
  }

  // --check: the gate. A finding with a keep-list row passes; one without fails.
  const { baseline, mediaAllowlist } = loadBaselineInputs();
  const { violations, stale, covered, unjudgeable } = checkBaseline(report, baseline, { mediaAllowlist });
  for (const s of stale) console.log(`repo-refs: stale baseline row      ${s.message}`);
  if (unjudgeable.length > 0) {
    console.log(
      `repo-refs: ${unjudgeable.length} file(s) are INDETERMINATE and were NOT judged — ` +
        "a non-literal import() reaches them, so the gate cannot see whether they are dead: " +
        unjudgeable.slice(0, 10).join(", "),
    );
  }
  for (const v of violations) console.error(`repo-refs: ${v.kind}: ${v.message}`);
  console.log(
    `repo-refs: --check ${covered} finding(s) covered by ${BASELINE_PATH}` +
      (mediaAllowlist.length ? ` plus ${mediaAllowlist.length} module(s) from ${MEDIA_GUIDE_PATH}` : "") +
      `, ${violations.length} uncovered`,
  );
  if (violations.length > 0) {
    console.error(
      "repo-refs: --check failed. Add a reference, or add a baseline row carrying a one-line reason " +
        "and the backlog item id or question-<n> that owns it. This check deletes nothing.",
    );
    process.exit(1);
  }
  console.log("repo-refs: --check passed — nothing is unreferenced without a reason");
}

// CLI only — not when the tests import the module.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!existsSync(path.join(REPO_ROOT, ".git"))) {
    console.error("repo-refs: not a git checkout — the scan set comes from `git ls-files`");
    process.exit(1);
  }
  main();
}
