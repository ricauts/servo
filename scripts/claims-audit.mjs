// claims lint — spec item reb-07, §1.3 and §13. `docs/POSITIONING.md` is the
// canon; this script is the machine that enforces it. Everything the scanner
// needs lives INSIDE the fenced ```banned-phrases block of that file — the
// scan set, the matching rules, the block's own self-exclusion, the allow
// list and the path- and section-scoped exemptions. The prose around the
// fence explains the choices and carries no rule, so a scanner that reads
// only the fence is correct. This one reads only the fence.
//
//   node scripts/claims-audit.mjs        (npm run claims:audit)
//
// Exit 1 with one `file:line:` line per violation. Exit 1 also when the canon
// itself does not parse or names a section that resolves to no heading — a
// lint that silently reads an empty policy passes vacuously, which is worse
// than failing.
//
// THE FOUR RULES THAT ARE EASY TO GET WRONG
//
// 1. RESCUE IS CONTAINMENT, NOT LINE PROXIMITY. An `allow` phrase shields a
//    banned match only when it fully CONTAINS that match's span. "self-hosted"
//    therefore rescues the "hosted" inside it and nothing else: a bare
//    "hosted" elsewhere on the same line still fails. (Rescuing per line is
//    the shape that lets an overclaim ride along beside an allowed phrase.)
// 2. THE FENCE EXCLUDES ITSELF, IN EVERY SCANNED FILE. The canon has to write
//    the phrases it bans; without this it fails its own linter ten times over.
//    `selfExclude.appliesTo: all-scanned-files` is why the exclusion is keyed
//    on the fence name rather than on docs/POSITIONING.md's path.
// 3. WORD BOUNDARY IS ALPHANUMERIC, NOT \b. `\b` treats `_` as a word
//    character, so `\bsqlite\b` would miss `sqlite_master`. A boundary here is
//    "not preceded/followed by [A-Za-z0-9]", which makes both `-` and `_`
//    boundaries — the canon's own note ("a hyphen counts as a boundary, so
//    self-hosted DOES match hosted") is the rule this generalises.
// 4. A PHRASE'S INTERNAL SEPARATOR IS FLEXIBLE. Written spaces and hyphens
//    inside a phrase both compile to "whitespace-or-dash, one or more", so a
//    prose line wrapped mid-phrase still matches, and so does the hyphenated
//    compound form. This is rule 3 read forwards rather than a new rule: if a
//    hyphen is a boundary between words, "control-plane" is the banned phrase
//    with a boundary in it. Banned and allow phrases compile identically, so
//    the rescue survives the same normalisation.
//
// Node builtins only, by the adopt-first gate (§0.4): nothing available clears
// it. The fence is a bespoke format no linter can read, so every candidate
// would still need this extractor written first; and its scalars are arbitrary
// phrases, which a YAML parser would coerce (`12.10` -> 12.1, `null` -> null).

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
export const CANON_PATH = "docs/POSITIONING.md";
export const FENCE_NAME = "banned-phrases";

/**
 * @typedef {object} ExemptEntry
 * @property {string} phrase
 * @property {string} reason
 * @property {string[]} paths
 * @property {string[]} sections
 * @property {number|null} maxOccurrences   // null = uncapped
 * @property {string|null} until            // the item that retires it
 * @property {boolean} enforced             // false = recorded policy, inert
 *
 * @typedef {object} Canon
 * @property {string[]} scan
 * @property {string[]} unscanned
 * @property {{ wordBoundary?: boolean, caseInsensitive?: boolean }} matching
 * @property {{ fence?: string, appliesTo?: string }} selfExclude
 * @property {string[]} banned
 * @property {string[]} allow
 * @property {ExemptEntry[]} exempt
 *
 * @typedef {object} Violation
 * @property {string} file
 * @property {number} line
 * @property {number} column
 * @property {string} phrase
 * @property {string} text
 * @property {string[]} sectionPath
 * @property {string} [note]
 * @property {number} [exemptIndex]
 *
 * @typedef {object} SourceFile
 * @property {string} path
 * @property {string} text
 */

/* ------------------------------------------------------------------ *
 * Fences
 * ------------------------------------------------------------------ */

/**
 * Every fenced block in `text`, as 1-based inclusive line ranges covering the
 * delimiters themselves.
 * @returns {{ info: string, start: number, end: number, body: string[] }[]}
 */
export function fencedBlocks(text) {
  const lines = String(text ?? "").split(/\r?\n/);
  const blocks = [];
  let open = null;
  lines.forEach((line, i) => {
    const m = /^\s*(`{3,}|~{3,})\s*(.*)$/.exec(line);
    if (!m) return;
    if (!open) {
      open = { fence: m[1][0], len: m[1].length, info: m[2].trim(), start: i + 1, body: [] };
      return;
    }
    // A closing delimiter is the same character, at least as long, with no info.
    if (m[1][0] === open.fence && m[1].length >= open.len && m[2].trim() === "") {
      blocks.push({ info: open.info, start: open.start, end: i + 1, body: open.body });
      open = null;
    }
  });
  for (const b of blocks) b.terminated = true;
  if (open) {
    // Recorded, but NOT terminated. The canon excludes a fenced BLOCK; an
    // unterminated delimiter is not one, and treating it as if it ran to EOF
    // would let a single stray ```banned-phrases line un-scan a whole file.
    blocks.push({ info: open.info, start: open.start, end: lines.length, terminated: false, body: [] });
  }
  // Bodies are the interior lines, filled in after the ranges are known.
  for (const b of blocks) b.body = lines.slice(b.start, b.end - (b.terminated ? 1 : 0));
  return blocks;
}

/** The single fenced block whose info string is `name`, or null. */
export function extractFence(text, name = FENCE_NAME) {
  return fencedBlocks(text).find((b) => b.info === name) ?? null;
}

/**
 * An unterminated `name` fence in a scanned file hides everything after it, so
 * it is an error rather than an exclusion.
 * @returns {string[]}
 */
export function unterminatedFences(relPath, text, name = FENCE_NAME) {
  return fencedBlocks(text)
    .filter((b) => b.info === name && !b.terminated)
    .map(
      (b) =>
        `canon: ${relPath}:${b.start}: unterminated \`${name}\` fence — it excludes nothing, ` +
        `and everything after it stays in scope`,
    );
}

/**
 * 1-based line numbers covered by any TERMINATED fence whose info string is
 * `name`. An unterminated one excludes nothing — see `unterminatedFences`.
 * @returns {Set<number>}
 */
export function selfExcludedLines(text, name = FENCE_NAME) {
  const excluded = new Set();
  for (const b of fencedBlocks(text)) {
    if (b.info !== name || !b.terminated) continue;
    for (let n = b.start; n <= b.end; n++) excluded.add(n);
  }
  return excluded;
}

/* ------------------------------------------------------------------ *
 * The canon block parser
 * ------------------------------------------------------------------ */

const KEY_RE = /^([A-Za-z_][A-Za-z0-9_.-]*)\s*:\s*(.*)$/;

/** Scalars stay strings unless they are exactly a boolean or an integer. */
function parseScalar(raw) {
  const s = String(raw).trim();
  if (/^".*"$/.test(s) || /^'.*'$/.test(s)) return s.slice(1, -1);
  if (s === "true") return true;
  if (s === "false") return false;
  if (/^-?\d+$/.test(s)) return Number(s);
  return s;
}

/**
 * Drop a trailing `# comment`, by YAML's rule: a `#` opens a comment only when
 * it follows whitespace and sits outside quotes. Anything stricter would eat a
 * `#` that is part of a banned phrase.
 */
export function stripTrailingComment(line) {
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      continue;
    }
    if (c === "#" && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i);
  }
  return line;
}

function significantLines(bodyLines) {
  const out = [];
  bodyLines.forEach((raw, i) => {
    const line = stripTrailingComment(raw.replace(/\s+$/, "")).replace(/\s+$/, "");
    if (line.trim() === "") return; // blank, or a whole-line comment
    out.push({ indent: line.length - line.trimStart().length, content: line.trim(), src: i });
  });
  return out;
}

function parseBlock(lines, i, indent, problems) {
  if (i < lines.length && lines[i].indent === indent && /^-(\s|$)/.test(lines[i].content)) {
    return parseSequence(lines, i, indent, problems);
  }
  return parseMapping(lines, i, indent, problems);
}

function parseSequence(lines, i, indent, problems) {
  const items = [];
  while (i < lines.length && lines[i].indent === indent && /^-(\s|$)/.test(lines[i].content)) {
    const content = lines[i].content;
    const rest = content.replace(/^-\s*/, "");
    const keyIndent = indent + (content.length - rest.length);
    if (rest === "") {
      if (i + 1 < lines.length && lines[i + 1].indent > indent) {
        const [value, next] = parseBlock(lines, i + 1, lines[i + 1].indent, problems);
        items.push(value);
        i = next;
      } else {
        items.push(null);
        i += 1;
      }
    } else if (KEY_RE.test(rest)) {
      // A mapping whose first key rides on the dash line.
      const view = [...lines];
      view[i] = { ...lines[i], indent: keyIndent, content: rest };
      const [value, next] = parseMapping(view, i, keyIndent, problems);
      items.push(value);
      i = next;
    } else {
      items.push(parseScalar(rest));
      i += 1;
    }
  }
  return [items, i];
}

function parseMapping(lines, i, indent, problems = []) {
  const map = {};
  while (i < lines.length && lines[i].indent === indent) {
    const m = KEY_RE.exec(lines[i].content);
    if (!m) break;
    const key = m[1];
    const inline = m[2].trim();
    // Last-wins on a duplicate key is how a bad merge silently halves a policy.
    if (Object.prototype.hasOwnProperty.call(map, key)) {
      problems.push(`canon: duplicate key \`${key}\` in the fence — the later one would silently win`);
    }
    i += 1;
    if (inline !== "") {
      // A plain scalar may fold onto deeper-indented continuation lines.
      let text = inline;
      while (i < lines.length && lines[i].indent > indent) {
        text += ` ${lines[i].content}`;
        i += 1;
      }
      map[key] = parseScalar(text);
    } else if (i < lines.length && lines[i].indent > indent) {
      const [value, next] = parseBlock(lines, i, lines[i].indent, problems);
      map[key] = value;
      i = next;
    } else {
      map[key] = null;
    }
  }
  return [map, i];
}

const asList = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);
const asStrings = (v) => asList(v).map((x) => String(x));

/**
 * Parse the fenced canon out of a markdown document.
 * Pure: markdown text in, a canon object out.
 * @param {string} markdown
 * @param {string} [name]
 * @returns {Canon}
 */
export function parseCanonBlock(markdown, name = FENCE_NAME) {
  const fence = extractFence(markdown, name);
  if (!fence) throw new Error(`no fenced \`${name}\` block found`);
  if (!fence.terminated) throw new Error(`the \`${name}\` fence is never closed`);
  const lines = significantLines(fence.body);
  /** @type {string[]} */
  const problems = [];
  const [raw] = parseMapping(lines, 0, lines.length ? lines[0].indent : 0, problems);
  const cap = (v, phrase) => {
    if (v == null) return null;
    if (typeof v === "number" && Number.isInteger(v) && v >= 0) return v;
    problems.push(
      `canon: exemption "${phrase}" has maxOccurrences \`${v}\`, which is not a non-negative integer — ` +
        `it would silently read as uncapped`,
    );
    return 0;
  };
  return {
    problems,
    scan: asStrings(raw.scan),
    unscanned: asList(raw.unscanned).map((e) => (e && typeof e === "object" ? String(e.path) : String(e))),
    matching: raw.matching && typeof raw.matching === "object" ? raw.matching : {},
    selfExclude: raw.selfExclude && typeof raw.selfExclude === "object" ? raw.selfExclude : {},
    banned: asStrings(raw.banned),
    allow: asStrings(raw.allow),
    exempt: asList(raw.exempt)
      .filter((e) => e && typeof e === "object")
      .map((e) => ({
        phrase: String(e.phrase ?? ""),
        reason: e.reason == null ? "" : String(e.reason),
        paths: asStrings(e.paths),
        sections: asStrings(e.sections),
        maxOccurrences: cap(e.maxOccurrences, String(e.phrase ?? "")),
        until: e.until == null ? null : String(e.until),
        enforced: e.enforced === false ? false : true,
      })),
  };
}

/**
 * A canon that parsed to nothing must fail loudly: an empty banned list turns
 * this lint into a no-op that reports success.
 * @param {Canon} canon
 * @returns {string[]} human-readable errors
 */
export function validateCanon(canon) {
  const errors = [...(canon.problems ?? [])];
  if (!canon.scan.length) errors.push("canon: `scan:` is empty — nothing would be scanned");
  if (!canon.banned.length) errors.push("canon: `banned:` is empty — the lint would pass vacuously");
  if (canon.matching.wordBoundary !== true) {
    errors.push("canon: `matching.wordBoundary` is not true — this scanner implements only that mode");
  }
  if (canon.matching.caseInsensitive !== true) {
    errors.push("canon: `matching.caseInsensitive` is not true — this scanner implements only that mode");
  }
  if (canon.selfExclude.fence !== FENCE_NAME) {
    errors.push(`canon: \`selfExclude.fence\` is not "${FENCE_NAME}" — the block would fail its own scan`);
  }
  if (canon.selfExclude.appliesTo !== "all-scanned-files") {
    errors.push("canon: `selfExclude.appliesTo` is not all-scanned-files — unsupported scope");
  }
  canon.exempt.forEach((e, n) => {
    if (!e.phrase) errors.push(`canon: exempt[${n}] has no phrase`);
    if (!e.paths.length) errors.push(`canon: exempt[${n}] (${e.phrase}) has no paths`);
    if (!e.reason) errors.push(`canon: exempt[${n}] (${e.phrase}) has no reason`);
  });
  return errors;
}

/* ------------------------------------------------------------------ *
 * Matching
 * ------------------------------------------------------------------ */

const ESCAPE_RE = /[.*+?^${}()|[\]\\]/g;
// Written spaces and dashes inside a phrase are the same separator (rule 4).
const SEPARATOR = "[\\s\\u2010-\\u2015-]+";
// A boundary is "not an alphanumeric" — wider than \b, which counts `_` as a
// word character and would miss `sqlite_master` (rule 3).
const LEFT = "(?<![A-Za-z0-9])";
const RIGHT = "(?![A-Za-z0-9])";

/** Compile one phrase into its case-insensitive, boundary-anchored matcher. */
export function compilePhrase(phrase) {
  const parts = String(phrase)
    .trim()
    .split(/[\s‐-―-]+/)
    .filter(Boolean)
    .map((p) => p.replace(ESCAPE_RE, "\\$&"));
  return new RegExp(`${LEFT}${parts.join(SEPARATOR)}${RIGHT}`, "gi");
}

/**
 * Every match of `phrase` in `text`, as absolute character spans.
 * @returns {{ start: number, end: number, text: string }[]}
 */
export function findSpans(text, phrase) {
  const spans = [];
  const re = compilePhrase(phrase);
  for (const m of String(text ?? "").matchAll(re)) {
    spans.push({ start: m.index, end: m.index + m[0].length, text: m[0] });
  }
  return spans;
}

/** Map an absolute character offset onto a 1-based line and column. */
export function offsetToLineCol(text, offset) {
  const before = String(text).slice(0, offset);
  const line = before.split(/\r?\n/).length;
  const lastBreak = before.lastIndexOf("\n");
  return { line, column: offset - lastBreak };
}

/* ------------------------------------------------------------------ *
 * Markdown sections
 * ------------------------------------------------------------------ */

/**
 * The heading ancestry in force at each 1-based line: index 0 is unused, and
 * entry N is the stack of heading texts covering line N. Fenced regions are
 * skipped so a `#` comment inside a code block is never read as a heading —
 * the canon's own fence is full of them.
 * @returns {string[][]}
 */
export function headingPathsByLine(text) {
  const lines = String(text ?? "").split(/\r?\n/);
  const inFence = new Set();
  for (const b of fencedBlocks(text)) for (let n = b.start; n <= b.end; n++) inFence.add(n);
  const paths = [[]];
  const stack = [];
  lines.forEach((line, i) => {
    const n = i + 1;
    const m = inFence.has(n) ? null : /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (m) {
      const level = m[1].length;
      while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
      stack.push({ level, text: m[2].trim() });
    }
    paths[n] = stack.map((h) => h.text);
  });
  return paths;
}

const sameSection = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

/* ------------------------------------------------------------------ *
 * The scan set
 * ------------------------------------------------------------------ */

/** `docs/*.md` matches one segment and does not recurse. */
export function globToRegExp(pattern) {
  const escaped = String(pattern)
    .split("/")
    .map((seg) => seg.replace(ESCAPE_RE, "\\$&").replace(/\\\*/g, "[^/]*"))
    .join("/");
  return new RegExp(`^${escaped}$`);
}

/** @type {(file: string, patterns: string[]) => boolean} */
export const matchesAnyPath = (file, patterns) =>
  patterns.some((p) => globToRegExp(p).test(file));

/**
 * Expand `scan:` against the tree, minus anything named in `unscanned:`.
 * @param {Canon} canon
 * @param {(dir: string) => string[]} listDir
 * @returns {string[]}
 */
export function expandScanSet(canon, listDir) {
  const found = new Set();
  for (const pattern of canon.scan) {
    if (!pattern.includes("*")) {
      found.add(pattern);
      continue;
    }
    const dir = path.posix.dirname(pattern);
    const re = globToRegExp(pattern);
    for (const name of listDir(dir === "." ? "" : dir)) {
      const rel = dir === "." ? name : `${dir}/${name}`;
      if (re.test(rel)) found.add(rel);
    }
  }
  return [...found].filter((f) => !matchesAnyPath(f, canon.unscanned)).sort();
}

/**
 * A declared surface that has gone missing must fail, not shrink the scan set
 * in silence: a rename or a bad merge would otherwise un-enforce a whole file
 * while the lint still printed OK.
 * @param {Canon} canon
 * @param {string[]} present  paths that were actually found on disk
 * @returns {string[]}
 */
export function scanSetErrors(canon, present) {
  const errors = [];
  const found = new Set(present);
  for (const pattern of canon.scan) {
    if (!pattern.includes("*")) {
      if (!found.has(pattern)) {
        errors.push(`canon: scan entry \`${pattern}\` resolves to no file — a declared surface is missing`);
      }
    } else if (!present.some((f) => globToRegExp(pattern).test(f))) {
      errors.push(`canon: scan entry \`${pattern}\` matched no file — a declared surface is missing`);
    }
  }
  if (!present.length) errors.push("canon: the scan set is empty — nothing would be checked");
  return errors;
}

/* ------------------------------------------------------------------ *
 * Scanning one file
 * ------------------------------------------------------------------ */

/**
 * Raw violations in one file: every banned span that no allow span CONTAINS
 * and that does not start inside a self-excluded fence. Exemptions are not
 * applied here — they need whole-file counts, so `applyExemptions` owns them.
 * @param {string} relPath
 * @param {string} text
 * @param {Canon} canon
 * @returns {Violation[]}
 */
export function scanFile(relPath, text, canon) {
  const body = String(text ?? "");
  const excluded =
    canon.selfExclude.appliesTo === "all-scanned-files"
      ? selfExcludedLines(body, canon.selfExclude.fence ?? FENCE_NAME)
      : new Set();
  const sections = headingPathsByLine(body);
  const shields = canon.allow.flatMap((a) => findSpans(body, a));

  const violations = [];
  const seen = new Set();
  for (const phrase of canon.banned) {
    for (const span of findSpans(body, phrase)) {
      // Rescue is containment, never mere overlap (rule 1).
      if (shields.some((s) => s.start <= span.start && s.end >= span.end)) continue;
      const { line, column } = offsetToLineCol(body, span.start);
      if (excluded.has(line)) continue;
      const key = `${line}:${column}:${phrase}`;
      if (seen.has(key)) continue;
      seen.add(key);
      violations.push({
        file: relPath,
        line,
        column,
        phrase,
        text: span.text,
        sectionPath: sections[line] ?? [],
      });
    }
  }
  return violations.sort((a, b) => a.line - b.line || a.column - b.column);
}

/* ------------------------------------------------------------------ *
 * Exemptions
 * ------------------------------------------------------------------ */

function exemptionCovers(entry, violation) {
  if (entry.enforced === false) return false; // recorded policy, inert today
  if (!sameSection(entry.phrase, violation.phrase)) return false;
  if (!matchesAnyPath(violation.file, entry.paths)) return false;
  if (!entry.sections.length) return true;
  // Section scope is the heading AND its descendants, so any ancestor counts.
  return entry.sections.some((s) => violation.sectionPath.some((h) => sameSection(h, s)));
}

/**
 * Split raw violations into reported and exempt, honouring `maxOccurrences`
 * per entry and file. Occurrences are counted AFTER self-exclusion, which is
 * what lets the canon name a phrase inside its own fence without spending the
 * allowance.
 * @param {Violation[]} violations
 * @param {Canon} canon
 * @returns {{ reported: Violation[], exempted: Violation[], notes: string[] }}
 */
export function applyExemptions(violations, canon) {
  const reported = [];
  const exempted = [];
  const notes = [];
  const counts = new Map();
  const ordered = [...violations].sort(
    (a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column,
  );
  for (const v of ordered) {
    const idx = canon.exempt.findIndex((e) => exemptionCovers(e, v));
    if (idx === -1) {
      reported.push(v);
      continue;
    }
    const entry = canon.exempt[idx];
    const key = `${idx}:${v.file}`;
    const used = (counts.get(key) ?? 0) + 1;
    counts.set(key, used);
    if (entry.maxOccurrences != null && used > entry.maxOccurrences) {
      reported.push({
        ...v,
        note: `exemption allows ${entry.maxOccurrences} occurrence(s) in this file; this is #${used}`,
      });
      continue;
    }
    exempted.push({ ...v, exemptIndex: idx });
    if (entry.until) {
      const note = `exemption: "${entry.phrase}" in ${v.file} is transitional until ${entry.until}`;
      if (!notes.includes(note)) notes.push(note);
    }
  }
  return { reported, exempted, notes };
}

/**
 * A section named by an enforced exemption must resolve to a real heading in
 * every scanned file it claims. reb-03's own review caught an em-dash written
 * as an ASCII hyphen here: a string match that silently resolves to nothing
 * reads as a clean pass.
 * @param {Canon} canon
 * @param {SourceFile[]} files
 * @returns {string[]}
 */
export function validateSections(canon, files) {
  const byPath = new Map(files.map((f) => [f.path, f.text]));
  const errors = [];
  for (const entry of canon.exempt) {
    if (entry.enforced === false || !entry.sections.length) continue;
    for (const p of entry.paths) {
      for (const [file, text] of byPath) {
        if (!globToRegExp(p).test(file)) continue;
        const headings = new Set(headingPathsByLine(text).flat().map((h) => h.trim().toLowerCase()));
        for (const s of entry.sections) {
          if (!headings.has(String(s).trim().toLowerCase())) {
            errors.push(
              `canon: exemption "${entry.phrase}" names section "${s}" in ${file}, which has no such heading`,
            );
          }
        }
      }
    }
  }
  return errors;
}

/* ------------------------------------------------------------------ *
 * The whole audit
 * ------------------------------------------------------------------ */

/**
 * @param {SourceFile[]} files
 * @param {Canon} canon
 * @returns {{ violations: Violation[], exempted: Violation[], notes: string[], errors: string[] }}
 */
export function audit(files, canon) {
  const fenceName = canon.selfExclude.fence ?? FENCE_NAME;
  const errors = [
    ...validateCanon(canon),
    ...validateSections(canon, files),
    ...scanSetErrors(canon, files.map((f) => f.path)),
    ...files.flatMap((f) => unterminatedFences(f.path, f.text, fenceName)),
  ];
  const raw = files.flatMap((f) => scanFile(f.path, f.text, canon));
  const { reported, exempted, notes } = applyExemptions(raw, canon);
  return { violations: reported, exempted, notes, errors };
}

/* ------------------------------------------------------------------ *
 * CLI
 * ------------------------------------------------------------------ */

function listDir(dir) {
  try {
    return readdirSync(path.join(REPO_ROOT, dir), { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => e.name);
  } catch {
    return [];
  }
}

function main() {
  const canonAbs = path.join(REPO_ROOT, CANON_PATH);
  if (!existsSync(canonAbs)) {
    console.error(`claims-audit: ${CANON_PATH} is missing — there is no canon to enforce`);
    process.exit(1);
  }
  let canon;
  try {
    canon = parseCanonBlock(readFileSync(canonAbs, "utf8"));
  } catch (err) {
    console.error(`claims-audit: ${CANON_PATH}: ${err.message}`);
    process.exit(1);
  }

  const files = expandScanSet(canon, listDir)
    .filter((rel) => existsSync(path.join(REPO_ROOT, rel)))
    .map((rel) => ({ path: rel, text: readFileSync(path.join(REPO_ROOT, rel), "utf8") }));

  const { violations, exempted, notes, errors } = audit(files, canon);

  for (const e of errors) console.error(`claims-audit: ${e}`);
  for (const v of violations) {
    const suffix = v.note ? ` (${v.note})` : "";
    // A phrase matched across a line wrap carries the newline; keep one
    // violation on one terminal line.
    const matched = v.text.replace(/\s+/g, " ");
    console.error(`claims-audit: ${v.file}:${v.line}:${v.column}: banned phrase "${matched}"${suffix}`);
  }
  if (errors.length + violations.length > 0) {
    console.error(
      `claims-audit: FAILED — ${violations.length} violation(s), ${errors.length} canon error(s)`,
    );
    process.exit(1);
  }
  for (const n of notes) console.log(`claims-audit: ${n}`);
  console.log(
    `claims-audit: OK (${files.length} files, ${canon.banned.length} banned phrases, ` +
      `${canon.allow.length} allowed, ${exempted.length} exempt occurrence(s))`,
  );
}

// CLI only — not when the tests import the module.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
