// claims lint — spec items reb-07 and hyg-03, §1.3 and §13.
// `docs/POSITIONING.md` is the canon; this script is the machine that enforces
// it. Everything the scanner needs lives INSIDE the fenced ```banned-phrases
// block of that file — the two scan sets, the matching rules, the block's own
// self-exclusion, the allow list, and the phrase- and path-scoped exemptions.
// The prose around the fence explains the choices and carries no rule, so a
// scanner that reads only the fence is correct. This one reads only the fence.
//
//   node scripts/claims-audit.mjs        (npm run claims:audit)
//
// TWO HALVES, ONE SCRIPT. A claim can be false in two ways, and each half
// catches one of them:
//
//   PHRASE CHECK (reb-07)  — a surface says something that is not true today.
//   DEAD-PATH CHECK (hyg-03) — a surface points at a file that is not there.
//
// They share this script, `npm run claims:audit` and one CI step deliberately:
// there is one canon, so there is one machine. Their scan sets differ and the
// canon states both, because product copy and path citations do not live in
// the same files. The dead-path half has its own header further down.
//
// Exit 1 with one `file:line:column:` line per violation. Exit 1 also when the
// canon itself does not parse, names a section that resolves to no heading, or
// declares a surface that has gone missing — a lint that silently reads an
// empty policy passes vacuously, which is worse than failing.
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

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
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
 * @typedef {object} PathExemptEntry
 * @property {string[]} target   // globs over the referenced path
 * @property {string[]} paths    // globs over the scanned files it applies to
 * @property {string} reason
 * @property {string|null} until // the item that retires it
 *
 * @typedef {object} Canon
 * @property {string[]} scan
 * @property {string[]} unscanned
 * @property {{ wordBoundary?: boolean, caseInsensitive?: boolean }} matching
 * @property {{ fence?: string, appliesTo?: string }} selfExclude
 * @property {string[]} banned
 * @property {string[]} allow
 * @property {ExemptEntry[]} exempt
 * @property {string[]} pathsScan
 * @property {string[]} pathsUnscanned
 * @property {{ path: string, reason: string }[]} pathsUnscannedEntries
 * @property {number} pathsExemptMalformed
 * @property {{ separatorRequired?: boolean, anchored?: boolean }} pathsMatching
 * @property {PathExemptEntry[]} pathsExempt
 * @property {string[]} [problems]
 *
 * @typedef {object} PathCandidate
 * @property {string} raw
 * @property {number} line
 * @property {number} column
 * @property {"code"|"link"} kind
 *
 * @typedef {object} PathFinding
 * @property {string} file
 * @property {number} line
 * @property {number} column
 * @property {string} target
 * @property {"code"|"link"} kind
 * @property {number} [exemptIndex]
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
    // CommonMark: a fence marker may be indented at most THREE spaces. At four
    // it is an indented code block, not a fence. `^\s*` accepted any depth,
    // which let a pair of 4-space-indented ``` lines silently un-scan whatever
    // sat between them — exit 0, counters unmoved — while every markdown
    // renderer still showed the content as live prose. The tree contains no
    // indented fence at all, so this rule costs nothing here.
    const m = /^ {0,3}(`{3,}|~{3,})[ \t]*(.*)$/.exec(line);
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
    // The dead-path check (hyg-03) reads its own three keys. Its scan set is
    // deliberately NOT `scan:`: it covers THIRD_PARTY.md and recurses into
    // docs/design/, neither of which carries user-visible product copy, and it
    // does not cover package.json, which holds no prose path reference.
    pathsScan: asStrings(raw["paths-scan"]),
    pathsUnscanned: asList(raw["paths-unscanned"]).map((e) =>
      e && typeof e === "object" ? String(e.path) : String(e),
    ),
    // Kept with their reasons: an exclusion is how a file leaves the check, so
    // an unexplained one is exactly the edit nobody should be able to make
    // quietly.
    pathsUnscannedEntries: asList(raw["paths-unscanned"]).map((e) =>
      e && typeof e === "object"
        ? { path: String(e.path ?? ""), reason: e.reason == null ? "" : String(e.reason) }
        : { path: String(e), reason: "" },
    ),
    // Entries that were not maps at all are counted, not silently dropped.
    pathsExemptMalformed: asList(raw["paths-exempt"]).filter((e) => !e || typeof e !== "object").length,
    pathsMatching:
      raw["paths-matching"] && typeof raw["paths-matching"] === "object" ? raw["paths-matching"] : {},
    pathsExempt: asList(raw["paths-exempt"])
      .filter((e) => e && typeof e === "object")
      .map((e) => ({
        target: asStrings(e.target),
        paths: asStrings(e.paths),
        reason: e.reason == null ? "" : String(e.reason),
        until: e.until == null ? null : String(e.until),
      })),
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
  // The dead-path half of the canon (hyg-03), held to the same standard: a
  // policy that parsed to nothing must fail loudly rather than pass vacuously.
  const pathsMatching = canon.pathsMatching ?? {};
  if (!(canon.pathsScan ?? []).length) {
    errors.push("canon: `paths-scan:` is empty — the dead-path check would scan nothing");
  }
  if (pathsMatching.anchored !== true) {
    errors.push("canon: `paths-matching.anchored` is not true — this scanner implements only that mode");
  }
  if (pathsMatching.separatorRequired !== true) {
    errors.push(
      "canon: `paths-matching.separatorRequired` is not true — this scanner implements only that mode",
    );
  }
  for (const key of Object.keys(pathsMatching)) {
    // A misspelled mode reads as "not set", which would silently select a
    // matching behaviour nobody asked for.
    if (key !== "anchored" && key !== "separatorRequired") {
      errors.push(`canon: \`paths-matching.${key}\` is not a mode this scanner knows`);
    }
  }
  for (const e of canon.pathsUnscannedEntries ?? []) {
    if (!e.path) errors.push("canon: a `paths-unscanned` entry has no path");
    else if (!e.reason) {
      errors.push(`canon: \`paths-unscanned\` entry \`${e.path}\` has no reason — an unexplained exclusion`);
    }
  }
  if (canon.pathsExemptMalformed) {
    errors.push(
      `canon: ${canon.pathsExemptMalformed} \`paths-exempt\` entr(ies) are not maps and were dropped`,
    );
  }
  (canon.pathsExempt ?? []).forEach((e, n) => {
    if (!e.target.length) errors.push(`canon: paths-exempt[${n}] has no target`);
    // A root-level catch-all silences the whole check while only the exempt
    // counter moves — the one malformed shape every other validator missed.
    for (const t of e.target) {
      if (t === "*" || t === "**" || t === "**/*") {
        errors.push(`canon: paths-exempt[${n}] target \`${t}\` is a catch-all — it would exempt everything`);
      }
    }
    if (!e.paths.length) errors.push(`canon: paths-exempt[${n}] (${e.target.join(", ")}) has no paths`);
    if (!e.reason) errors.push(`canon: paths-exempt[${n}] (${e.target.join(", ")}) has no reason`);
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

/**
 * `docs/*.md` matches one segment and does not recurse. A whole segment of
 * `**` is the one recursive form, and it spans zero or more segments, so
 * `docs/**` + `/*.md` reaches both `docs/ARCHITECTURE.md` and
 * `docs/design/ux.md`. A `*` anywhere else stays single-segment — the
 * banned-phrase scan set depends on that and must not widen here.
 */
export function globToRegExp(pattern) {
  const segs = String(pattern).split("/");
  const parts = [];
  for (let i = 0; i < segs.length; i++) {
    if (segs[i] === "**") {
      // Trailing `**` may also match nothing, so `a/**` covers `a/b` and `a`.
      parts.push(i === segs.length - 1 ? "(?:[^/]+(?:/[^/]+)*)?" : "(?:[^/]+/)*");
      continue;
    }
    parts.push(segs[i].replace(ESCAPE_RE, "\\$&").replace(/\\\*/g, "[^/]*"));
    if (i < segs.length - 1) parts.push("/");
  }
  return new RegExp(`^${parts.join("")}$`);
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

/**
 * dcl-08: the UNCONDITIONAL-OCR rule. Every "OCR" on a scanned surface must
 * be conditioned — tied to the optional high-fidelity extractor being
 * configured, reachable, or under its cap. An install without the sidecar
 * must never read a claim that Servo does OCR, and an install WITH it must
 * never read that it does not. The phrase rides the SAME exemption
 * machinery as banned phrases: an `exempt` entry whose phrase is
 * "OCR (unconditional)" can scope legitimate prose (licence records,
 * design docs discussing other tools' OCR) by path and section.
 */
const OCR_OCCURRENCE = /\bOCR\b/g;
const OCR_CONDITIONAL =
  /\b(optional|when|if|configured|unconfigured|sidecar|opt-in|high.fidelity|unavailable|not available|cannot|never|capped|page cap|cap\b|conditional|not attempted|not in|not triggered|only)\b/i;
const OCR_CONTEXT_CHARS = 220;

export function scanOcrClaims(relPath, text, canon) {
  const body = String(text ?? "");
  const excluded =
    canon.selfExclude.appliesTo === "all-scanned-files"
      ? selfExcludedLines(body, canon.selfExclude.fence ?? FENCE_NAME)
      : new Set();
  const sections = headingPathsByLine(body);
  const violations = [];
  const seen = new Set();
  for (const m of body.matchAll(OCR_OCCURRENCE)) {
    const { line, column } = offsetToLineCol(body, m.index);
    if (excluded.has(line)) continue;
    const after = body.slice(m.index, Math.min(body.length, m.index + OCR_CONTEXT_CHARS));
    const before = body.slice(Math.max(0, m.index - OCR_CONTEXT_CHARS), m.index);
    if (OCR_CONDITIONAL.test(before) || OCR_CONDITIONAL.test(after)) continue;
    const key = `${line}:${column}`;
    if (seen.has(key)) continue;
    seen.add(key);
    violations.push({
      file: relPath,
      line,
      column,
      phrase: "OCR (unconditional)",
      text: m[0],
      sectionPath: sections[line] ?? [],
    });
  }
  return violations.sort((a, b) => a.line - b.line || a.column - b.column);
}

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
 * The dead-path check — spec item hyg-03
 * ------------------------------------------------------------------ *
 *
 * A claim can be false in two ways. It can say something untrue, which the
 * banned-phrase half catches; or it can point at a file that is not there,
 * which is what this half catches. `hyg-02` repaired four such references by
 * hand; this is the check that keeps them repaired.
 *
 * WHAT COUNTS AS A REFERENCE. Two forms, both from the item: a path written
 * inside single-backtick inline code, and a markdown link or image target.
 * They resolve differently and that difference is the rule, not a detail:
 *
 *   - A LINK TARGET is resolved relative to the document that contains it,
 *     because that is what markdown does. `[the contract](CONTRACT.md)` inside
 *     docs/ARCHITECTURE.md means docs/CONTRACT.md, and reading it as
 *     repo-relative would report three healthy links as dead.
 *   - AN INLINE-CODE PATH is resolved from the repository root, because that
 *     is how every one of them is written in this tree.
 *
 * WHAT IS NOT A REFERENCE, and why each exclusion has to exist. Prose is full
 * of backticked strings that are not repo paths, and admitting them would bury
 * a real finding under noise:
 *
 *   1. FENCED BLOCKS ARE SKIPPED. A ``` block is a sample, not an assertion.
 *      The canon's own fence names `docs/migrating-to-postgres.md` as exemption
 *      DATA; scanning it would make the policy trip the check it defines.
 *   2. A URI SCHEME in the first segment: `node:sqlite`, `https://…`,
 *      `mailto:`, and Windows `C:/…`. Tested on the first segment only, so a
 *      trailing `:12` line reference does not look like a scheme.
 *   3. A LEADING `@` is an npm scope (`@modelcontextprotocol/sdk`); a leading
 *      `/` is an absolute path or an HTTP route (`POST /api/inbound/email`);
 *      a leading `#` is an anchor.
 *   4. PLACEHOLDERS — anything holding `<`, `>`, `{`, `}` or `…`. The tree
 *      writes `skills/<slug>/SKILL.md` and means the shape, not a file.
 *   5. SEPARATOR REQUIRED (`paths-matching.separatorRequired`). A bare
 *      basename in backticks — `engine.ts`, `SKILL.md`, `readme.md` — is a
 *      NAME, not a location. Reading it as repo-root-relative reported nine
 *      false positives on this tree, `SKILL.md` five times over.
 *   6. ANCHORED (`paths-matching.anchored`), WITH A FILE-EXTENSION ESCAPE.
 *      An inline-code path counts as repo-relative when its first segment
 *      names something at the repository root — OR when it ends in an
 *      extension this repository uses. The anchor alone is not enough:
 *      `neverexisted/some/file.ts` would slip through it, which is exactly
 *      the shape this check exists for, so an extension admits a candidate
 *      whatever its first segment says. The anchor still does the work for
 *      extension-less references, where a GitHub coordinate
 *      (`paperclipai/paperclip`), a container image (`pgvector/pgvector:pg17`)
 *      and a JSON-RPC method (`tools/call`) are indistinguishable from a
 *      directory path by shape alone.
 *      THE RESIDUE IS REAL AND IS NOT HIDDEN: a reference to a DIRECTORY that
 *      was never created, whose first segment is also absent, is invisible to
 *      this check. It is printed as a skipped-unanchored count every run, so
 *      the gap is legible rather than silent.
 *
 * A trailing location suffix (`src/lib/mcp.ts:104-121`, `:37,80`, `:19/41`)
 * and a `#fragment` are stripped before resolution: the file is the reference,
 * the line number is a coordinate inside it.
 *
 * A GLOB TARGET IS RESOLVED BY GLOBBING and matching nothing is a failure —
 * `agents/*.md` passes because four files match, and it would fail the day the
 * directory emptied, which is the whole point of writing it as a glob.
 *
 * WHAT A CLEAN RUN DOES AND DOES NOT PROVE. The summary line reports every
 * number a reader needs to judge it — references checked, how many RESOLVED
 * (which is not the same as checked, because exemptions suppress the rest),
 * how many were exempt, how many were skipped as not repo-relative, and how
 * many inline spans were not path-shaped at all. A clean run means no
 * unexempted reference in the scanned set is dead. It is NOT by itself proof
 * that any particular historical reference was repaired: three of the four
 * `hyg-02` fixed are out of this check's reach by design — two are bare
 * basenames (`THIRD-PARTY.md`, `tailwind.config.ts`, rule 5) and one lives in
 * package.json, which holds no prose path reference and is not in
 * `paths-scan`. Those four are proved repaired by a direct test in
 * tests/claims-audit.test.ts that resolves each against the tree, not by this
 * script's exit code.
 *
 * KNOWN LIMITS, disclosed rather than discovered later. Each was found by an
 * adversarial pass over this code and each is a MISS, never a false alarm:
 *
 *   - Candidates are matched PER LINE, so a markdown link whose target sits on
 *     the next line, or an inline-code span wrapped across a line break, is not
 *     seen. Per-line matching is also what makes the reported line and column
 *     exact, which is the trade taken.
 *   - The tree is built from the filesystem, not from `git ls-files`, so a
 *     reference to an untracked or gitignored file resolves on a working
 *     checkout and would fail in CI. The direction is safe — CI is the strict
 *     one — but the two are not identical.
 *   - An unanchored, extension-less DIRECTORY reference is skipped (rule 6),
 *     as is an unanchored path carrying an extension this repository does not
 *     use (`.rb`, `.py`), and any unanchored TWO-SEGMENT path, because
 *     `owner/repo.js` and `dir/file.js` cannot be told apart and this tree
 *     cites the first kind constantly. All land in the printed unanchored
 *     counter.
 *   - Wrapping a region in a BALANCED pair of unindented fences still masks
 *     it. That is what a fence is for, and unlike the indented form it is a
 *     visible edit; `openFenceErrors` only catches an unbalanced one.
 *   - Only the five surfaces in `paths-scan` are covered. Source comments, UI
 *     copy and `package.json` are not, and `package.json`'s `prisma.seed` is a
 *     JSON value rather than prose, so no prose scanner would reach it.
 *
 * The per-line limit is the only one of these that is SILENT — it moves no
 * counter — and it is the one to close first if this check is ever widened.
 */

/** Directories never walked when building the tree the check resolves against. */
export const TREE_SKIP = new Set([".git", "node_modules", ".next", ".claude", ".spec-build"]);

/**
 * Every repo-relative path in the tree, files AND directories, so a reference
 * to `prisma/migrations/` resolves as readily as one to a file.
 *
 * `.claude/` is skipped for the reason `hyg-01` records: it holds two full
 * worktree copies, and a stale copy inside it would make a deleted file look
 * present.
 *
 * @param {(dir: string) => { name: string, isDir: boolean }[]} listDir
 * @returns {Set<string>}
 */
export function collectTree(listDir) {
  const out = new Set();
  // A runaway guard, not a policy: the tree is 9 deep today. `isDirectory()`
  // is false for a symlink, so a symlinked directory is never descended and
  // there is no cycle to guard against; this cap only bounds a pathological
  // tree. Truncating would make a real file look MISSING, which fails loudly.
  const walk = (dir, depth) => {
    if (depth > 32) return;
    for (const entry of listDir(dir)) {
      if (dir === "" && TREE_SKIP.has(entry.name)) continue;
      const rel = dir === "" ? entry.name : `${dir}/${entry.name}`;
      out.add(rel);
      if (entry.isDir) walk(rel, depth + 1);
    }
  };
  walk("", 0);
  return out;
}

/** The top-level entries a repo-relative inline-code path may be anchored on. */
export const topLevelNames = (tree) => new Set([...tree].filter((p) => !p.includes("/")));

/**
 * File extensions this repository actually holds. A candidate ending in one is
 * a FILE reference and is checked even when it is not anchored — otherwise
 * `neverexisted/some/file.ts` would be skipped for the same reason
 * `paperclipai/paperclip` is, and the check would miss the very shape it is
 * for. Extension-less unanchored references stay skipped, and that residue is
 * counted and printed.
 */
export const REPO_FILE_EXT =
  /\.(md|markdown|txt|ts|tsx|js|jsx|mjs|cjs|json|jsonc|sql|prisma|css|scss|ya?ml|sh|bash|svg|html|htm|toml|lock|xlsx|xls|csv|pdf|png|jpe?g|gif|webp|ico|mp4|woff2?)$/i;

/**
 * Inline-code spans and markdown link/image targets, outside fenced blocks.
 * Pure: text in, candidates out.
 * @returns {PathCandidate[]}
 */
export function pathCandidates(text) {
  const body = String(text ?? "");
  const fenced = new Set();
  // Only a TERMINATED block masks lines. An unterminated ``` would otherwise
  // run to EOF and silently un-scan the rest of the file — the same hole
  // `unterminatedFences` closes for the phrase half, and `openFenceErrors`
  // below is what makes it loud here rather than merely harmless.
  for (const b of fencedBlocks(body)) {
    if (!b.terminated) continue;
    for (let n = b.start; n <= b.end; n++) fenced.add(n);
  }
  const out = [];
  body.split(/\r?\n/).forEach((line, i) => {
    const n = i + 1;
    if (fenced.has(n)) return;

    // Inline code first, and its spans MASK the link forms below: markdown
    // link syntax written inside backticks — `[x](y.md)` — is a sample of
    // syntax, not a link, and reading it as one is a false positive.
    const codeSpans = [];
    for (const m of line.matchAll(/(`+)([^`]+?)\1/g)) {
      const start = m.index + m[1].length;
      codeSpans.push({ start, end: start + m[2].length });
      out.push({ raw: m[2], line: n, column: start + 1, kind: "code" });
    }
    const inCode = (idx) => codeSpans.some((s) => idx >= s.start && idx < s.end);
    const push = (raw, at) => {
      if (inCode(at)) return;
      out.push({ raw, line: n, column: line.indexOf(raw, at) + 1, kind: "link" });
    };

    // Inline links and images, with an optional <target> and a "title".
    for (const m of line.matchAll(
      /!?\[[^\]\n]*\]\(\s*<?([^)>\s]+)>?\s*(?:"[^"]*"|'[^']*'|\([^)]*\))?\s*\)/g,
    )) {
      push(m[1], m.index);
    }
    // Reference-style definitions: `[ref]: path "title"`. The definition line
    // is where the target actually lives, so this is the line to report.
    const def = /^\s{0,3}\[[^\]\n]+\]:\s*<?([^>\s]+)>?/.exec(line);
    if (def) push(def[1], 0);
    // HTML in markdown. README ships six <img src> screenshots, and without
    // this a deleted screenshot keeps the lint green.
    for (const m of line.matchAll(
      // Attributes before src/href are skipped as either bare characters or
      // whole quoted values, so a `>` inside an earlier value (alt="a>b")
      // does not end the tag early and hide the reference.
      /<(?:img|a)\s(?:[^>"']|"[^"]*"|'[^']*')*?\b(?:src|href)\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s"'>]+))/gi,
    )) {
      push(m[1] ?? m[2] ?? m[3], m.index);
    }
  });
  return out;
}

/**
 * ANY unterminated fence in a dead-path-scanned file is an error, not just an
 * unterminated `banned-phrases` one: a stray ``` changes how every line after
 * it reads, and a reader who cannot see the block boundaries cannot trust the
 * clean run. Reported loudly so the cause is named rather than inferred.
 * @returns {string[]}
 */
export function openFenceErrors(relPath, text) {
  return fencedBlocks(text)
    .filter((b) => !b.terminated)
    .map(
      (b) =>
        `${relPath}:${b.start}: unterminated \`\`\` fence — every line after it reads as prose, ` +
        `and the block boundaries in this file cannot be trusted`,
    );
}

/**
 * Strip a `#fragment` or `?query`, a trailing location suffix, then trailing
 * punctuation. `docs/POSITIONING.md?plain=1` is GitHub-idiomatic and names a
 * file that exists; without the `?` arm it was reported missing — a false
 * positive, which is worse than a miss because it fails CI on healthy copy.
 */
export function normalizePathRef(raw) {
  let s = String(raw ?? "").trim();
  // `./docs/x.md` is `docs/x.md`. Without this the leading `.` segment made it
  // look like an escape out of the repository and it was dropped uncounted.
  s = s.replace(/^(?:\.\/)+/, "");
  s = s.replace(/[#?].*$/, "");
  // `:12`, `:12:34`, `:37,80`, `:22-39`, `:19/41` — a coordinate, not the file.
  s = s.replace(/:(?=\d).*$/, "");
  s = s.replace(/[.,;:]+$/, "");
  return s.trim();
}

/**
 * Decide whether a candidate is a repo path reference this check owns, and
 * return it normalized. `null` means "not a reference"; the second element of
 * the tuple says WHY, so an unanchored skip can be counted rather than lost.
 * @returns {{ path: string|null, skip: string|null }}
 */
export function classifyPathRef(raw, kind, topLevel) {
  const s = String(raw ?? "").trim();
  if (!s || /\s/.test(s)) return { path: null, skip: null };
  if (s.startsWith("@") || s.startsWith("#") || s.startsWith("/")) return { path: null, skip: null };
  if (/[<>{}|]|\.\.\.|…/.test(s)) return { path: null, skip: null };
  // A scheme lives in the FIRST segment; `src/lib/mcp.ts:104` has none.
  const firstRaw = s.split("/")[0];
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(firstRaw)) return { path: null, skip: null };
  const clean = normalizePathRef(s);
  if (!clean || clean === "." || clean === "..") return { path: null, skip: null };
  if (kind === "link") return { path: clean, skip: null };
  if (!clean.includes("/")) return { path: null, skip: null }; // a name, not a location
  const first = clean.split("/")[0];
  if (first === "." || first === "..") return { path: null, skip: null };
  // Anchored, OR naming a file by an extension this repository uses. The
  // second route is what stops the anchor rule from swallowing a dangling
  // file reference whose directory was never created.
  //
  // It does NOT fire on a TWO-SEGMENT unanchored path, because `owner/repo.js`
  // and `dir/file.js` are the same shape and this repository's documents are
  // full of the first kind: `vercel/next.js`, `mrdoob/three.js`,
  // `lodash/merge.js`. THIRD_PARTY.md exists to cite upstream projects, so
  // resolving those would fail CI on a healthy citation — a false positive,
  // which costs more than the miss it prevents. The miss (a two-segment
  // dangling file reference under a directory that does not exist) lands in
  // the printed unanchored counter like every other one.
  const deepEnough = clean.split("/").length > 2;
  if (topLevel.has(first) || (deepEnough && REPO_FILE_EXT.test(clean))) {
    return { path: clean, skip: null };
  }
  return { path: null, skip: "unanchored" };
}

/**
 * Resolve a classified reference to a repo-relative target: link targets
 * against the containing document, inline-code paths against the root.
 * Returns null when the target escapes the repository.
 */
export function resolvePathRef(clean, kind, containingFile) {
  const base = kind === "link" ? path.posix.dirname(containingFile) : ".";
  const joined = path.posix.normalize(path.posix.join(base, clean));
  const target = joined.replace(/\/+$/, "");
  if (!target || target === "." || target.startsWith("..")) return null;
  return target;
}

/**
 * Does `target` resolve in the tree? A glob resolves when at least one path
 * matches it; matching nothing is the failure the item names.
 */
export function treeResolves(tree, target) {
  if (!target.includes("*")) return tree.has(target);
  const re = globToRegExp(target);
  for (const p of tree) if (re.test(p)) return true;
  return false;
}

/**
 * Every reference in one file that does not resolve.
 * @returns {{ findings: PathFinding[], skippedUnanchored: number, skippedNotPathShaped: number, skippedOutsideRepo: number, unresolved: number, checked: number }}
 */
export function scanFilePaths(relPath, text, tree, topLevel) {
  const findings = [];
  const seen = new Set();
  let skippedUnanchored = 0;
  let skippedNotPathShaped = 0;
  let skippedOutsideRepo = 0;
  let unresolved = 0;
  let checked = 0;
  for (const c of pathCandidates(text)) {
    const { path: clean, skip } = classifyPathRef(c.raw, c.kind, topLevel);
    if (skip === "unanchored") skippedUnanchored += 1;
    // Every dropped candidate is counted, not only the interesting ones: an
    // undisclosed skip class is how a lint looks thorough while doing little.
    if (clean === null && skip === null) skippedNotPathShaped += 1;
    if (clean === null) continue;
    const target = resolvePathRef(clean, c.kind, relPath);
    if (target === null) {
      // `../../elsewhere` resolves outside the tree. Counted, not lost: the
      // contract is that EVERY dropped candidate lands in some counter.
      skippedOutsideRepo += 1;
      continue;
    }
    checked += 1;
    if (treeResolves(tree, target)) continue;
    // Counted BEFORE the dedup below. `docs/design/postgres.md:242` writes
    // `prisma/*.db` twice on one line: both are checked and both fail, so
    // deriving "resolved" from the deduped finding list would report the
    // second dead reference as healthy.
    unresolved += 1;
    const key = `${c.line}:${target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    findings.push({ file: relPath, line: c.line, column: c.column, target, kind: c.kind });
  }
  return { findings, skippedUnanchored, skippedNotPathShaped, skippedOutsideRepo, unresolved, checked };
}

/**
 * A `paths-exempt` entry covers a finding when both its globs match.
 * @param {PathExemptEntry} entry
 * @param {PathFinding} finding
 */
export function pathExemptionCovers(entry, finding) {
  return matchesAnyPath(finding.file, entry.paths) && matchesAnyPath(finding.target, entry.target);
}

/**
 * Split dead-path findings into reported and exempt, and report which
 * exemptions matched nothing. A dead exemption is a NOTE, not an error: the
 * day `db-07` creates `docs/migrating-to-postgres.md` its entry goes quiet,
 * and failing CI inside an unrelated tick would be a booby trap. It is still
 * printed, because a silent dead exemption is exactly the gap owner question
 * 39(g) records against the phrase half.
 * @param {PathFinding[]} findings
 * @param {Canon} canon
 * @returns {{ reported: PathFinding[], exempted: PathFinding[], notes: string[] }}
 */
export function applyPathExemptions(findings, canon, duplicatesDropped = 0) {
  const reported = [];
  const exempted = [];
  const used = new Set();
  const usedTargets = new Set();
  for (const f of findings) {
    const idx = canon.pathsExempt.findIndex((e) => pathExemptionCovers(e, f));
    if (idx === -1) {
      reported.push(f);
      continue;
    }
    used.add(idx);
    // Liveness is tracked PER TARGET, not per entry: an entry holding twelve
    // targets of which one still matches would otherwise report nothing, and
    // eleven dead exemptions would accumulate invisibly inside a live entry.
    for (const t of canon.pathsExempt[idx].target) {
      if (matchesAnyPath(f.target, [t])) usedTargets.add(`${idx}:${t}`);
    }
    exempted.push({ ...f, exemptIndex: idx });
  }
  const exemptedOccurrences = exempted.length + duplicatesDropped;
  const notes = canon.pathsExempt.flatMap((e, i) => {
    if (!used.has(i)) return [`paths-exempt entry ${i} (${e.target.join(", ")}) matched nothing`];
    const dead = e.target.filter((t) => !usedTargets.has(`${i}:${t}`));
    return dead.length ? [`paths-exempt entry ${i}: target(s) ${dead.join(", ")} matched nothing`] : [];
  });
  // One summary line rather than one per entry: the useful signal is WHICH
  // items still owe a file, not the target list, which is in the canon.
  const items = [...new Set([...used].map((i) => canon.pathsExempt[i].until).filter(Boolean))].sort();
  const transitional = items.length
    ? [`paths-exempt: ${items.length} exemption group(s) transitional until ${items.join(", ")}`]
    : [];
  return { reported, exempted, exemptedOccurrences, notes: [...new Set([...transitional, ...notes])] };
}

/**
 * A declared dead-path surface that has gone missing must fail, for the same
 * reason `scanSetErrors` exists: a rename that quietly un-enforces a file
 * while the lint still prints OK is the silent pass this script swears off.
 */
export function pathScanSetErrors(canon, present) {
  const errors = [];
  for (const pattern of canon.pathsScan) {
    const hit = pattern.includes("*")
      ? present.some((f) => globToRegExp(pattern).test(f))
      : present.includes(pattern);
    if (!hit) {
      errors.push(`canon: paths-scan entry \`${pattern}\` matched no file — a declared surface is missing`);
    }
  }
  if (!present.length) errors.push("canon: the dead-path scan set is empty — nothing would be checked");
  return errors;
}

/**
 * The dead-path audit over its own scan set.
 * @param {SourceFile[]} files
 * @param {Canon} canon
 * @param {Set<string>} tree
 */
export function auditPaths(files, canon, tree) {
  const topLevel = topLevelNames(tree);
  const errors = [
    ...pathScanSetErrors(canon, files.map((f) => f.path)),
    ...files.flatMap((f) => openFenceErrors(f.path, f.text)),
  ];
  const raw = [];
  let skippedUnanchored = 0;
  let skippedNotPathShaped = 0;
  let skippedOutsideRepo = 0;
  let unresolved = 0;
  let checked = 0;
  for (const f of files) {
    const r = scanFilePaths(f.path, f.text, tree, topLevel);
    raw.push(...r.findings);
    skippedUnanchored += r.skippedUnanchored;
    skippedNotPathShaped += r.skippedNotPathShaped;
    skippedOutsideRepo += r.skippedOutsideRepo;
    unresolved += r.unresolved;
    checked += r.checked;
  }
  raw.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column);
  // `checked` counts references; `raw` counts DEDUPED findings. The gap is
  // real — docs/design/postgres.md:242 writes `prisma/*.db` twice on one line
  // — and it is booked to the exempt column so the printed arithmetic
  // reconciles: checked = resolved + exempt occurrences + missing.
  const { reported, exempted, exemptedOccurrences, notes } = applyPathExemptions(
    raw,
    canon,
    unresolved - raw.length,
  );
  return {
    missing: reported,
    exemptedOccurrences,
    exempted,
    notes,
    errors,
    skippedUnanchored,
    skippedNotPathShaped,
    skippedOutsideRepo,
    unresolved,
    checked,
    // `checked` counts every reference put to the tree; only these RESOLVED.
    // Reporting `checked` as "resolved" would overstate a clean run by the
    // size of the exemption list, which is the number a reader most needs.
    // Derived from `unresolved`, NOT from the deduped finding list: two dead
    // references to the same target on one line are two failures and one
    // finding, and subtracting findings would report the second as healthy.
    resolved: checked - unresolved,
  };
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
  const raw = [
    ...files.flatMap((f) => scanFile(f.path, f.text, canon)),
    ...files.flatMap((f) => scanOcrClaims(f.path, f.text, canon)),
  ];
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

/** Files and directories both, for `collectTree`. */
function listEntries(dir) {
  try {
    return readdirSync(path.join(REPO_ROOT, dir), { withFileTypes: true }).map((e) => ({
      name: e.name,
      isDir: e.isDirectory(),
    }));
  } catch {
    return [];
  }
}

/**
 * Expand the dead-path scan set. `docs/**\/*.md` recurses, so this walks the
 * tree rather than one directory, which is what `expandScanSet`'s file-only
 * lister cannot do. Exported so both of its rules — the directory filter and
 * the `paths-unscanned` filter — are driven by tests rather than only by the
 * CLI, where a deletion would go unnoticed.
 * @param {Canon} canon
 * @param {Set<string>} tree
 * @param {(rel: string) => boolean} isFile
 * @returns {string[]}
 */
export function expandPathScanSet(canon, tree, isFile) {
  const found = new Set();
  for (const pattern of canon.pathsScan) {
    if (!pattern.includes("*")) {
      if (tree.has(pattern)) found.add(pattern);
      continue;
    }
    const re = globToRegExp(pattern);
    for (const p of tree) if (re.test(p)) found.add(p);
  }
  return (
    [...found]
      // A glob such as `docs/**` matches directories too, and reading one is an
      // uncaught EISDIR rather than a diagnostic. Directories are dropped here;
      // `pathScanSetErrors` still fails a pattern that matched no FILE at all,
      // so a scan entry that resolves only to directories is loud, not silent.
      .filter((f) => isFile(f))
      .filter((f) => !matchesAnyPath(f, canon.pathsUnscanned))
      .sort()
  );
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

  // The dead-path check (hyg-03) runs in the SAME script, under the same
  // `npm run claims:audit` and the same CI step. Its scan set is its own.
  const tree = collectTree(listEntries);
  const isFile = (rel) => {
    try {
      return statSync(path.join(REPO_ROOT, rel)).isFile();
    } catch {
      return false;
    }
  };
  const pathFiles = expandPathScanSet(canon, tree, isFile).map((rel) => ({
    path: rel,
    text: readFileSync(path.join(REPO_ROOT, rel), "utf8"),
  }));
  const paths = auditPaths(pathFiles, canon, tree);

  for (const e of [...errors, ...paths.errors]) console.error(`claims-audit: ${e}`);
  for (const v of violations) {
    const suffix = v.note ? ` (${v.note})` : "";
    // A phrase matched across a line wrap carries the newline; keep one
    // violation on one terminal line.
    const matched = v.text.replace(/\s+/g, " ");
    console.error(`claims-audit: ${v.file}:${v.line}:${v.column}: banned phrase "${matched}"${suffix}`);
  }
  for (const m of paths.missing) {
    console.error(
      `claims-audit: ${m.file}:${m.line}:${m.column}: missing path "${m.target}" ` +
        `(${m.kind === "link" ? "markdown link target" : "inline code"})`,
    );
  }
  const failures = errors.length + paths.errors.length + violations.length + paths.missing.length;
  if (failures > 0) {
    console.error(
      `claims-audit: FAILED — ${violations.length} banned phrase(s), ${paths.missing.length} missing path(s), ` +
        `${errors.length + paths.errors.length} canon error(s)`,
    );
    process.exit(1);
  }
  for (const n of [...notes, ...paths.notes]) console.log(`claims-audit: ${n}`);
  console.log(
    `claims-audit: OK (${files.length} files, ${canon.banned.length} banned phrases, ` +
      `${canon.allow.length} allowed, ${exempted.length} exempt occurrence(s))`,
  );
  console.log(
    `claims-audit: OK (${pathFiles.length} files, ${paths.checked} path reference(s) checked, ` +
      `${paths.resolved} resolved, ${paths.exemptedOccurrences} exempt, ` +
      `${paths.skippedUnanchored} skipped as not repo-relative, ` +
      `${paths.skippedOutsideRepo} outside the repository, ` +
      `${paths.skippedNotPathShaped} spans that are not path-shaped)`,
  );
}

// CLI only — not when the tests import the module.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
