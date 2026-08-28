// Claims lint — spec item reb-07. The policy is NOT in this file: it is the
// fenced `banned-phrases` block inside docs/POSITIONING.md (written by
// reb-03), which declares its own scan set, matching rules, self-exclusion,
// allow list and path/section-scoped exemptions. This script is only the
// engine that executes it, so the owner edits the canon and the lint follows.
//
//   node scripts/claims-audit.mjs [--root <dir>] [--policy <file>] [--json]
//
// Exit 0 when the scanned surfaces carry no banned phrase; exit 1 with one
// `file:line:col` line per hit.
//
// Two semantics worth stating because the canon leaves them to the engine:
//
//   * `until: <item-id>` on an exemption is metadata, not an expiry. The canon
//     says db-01 *retires that entry* — the entry leaves docs/POSITIONING.md in
//     the item that fixes the copy. So the exemption stays active while it is
//     written down, and the audit lists it under "pending retirement" instead
//     of turning red on a day nobody edited the docs.
//   * `enforced: false` makes an entry inert: it grants no exemption. It is a
//     recorded rule for a file that is not scanned today (spec.md), and the
//     safe reading of "not enforced" is "does not silently widen the ban's
//     exceptions".
//
// A third: the canon declares that a hyphen is a word boundary, which is the
// mechanism that makes "self-hosted" contain a hit for "hosted" (rescued by
// `allow:`). The same rule means "multi-cloud version" contains "cloud
// version". That is the declared semantics, not an accident, and `allow:` is
// the escape hatch the canon provides for it.
//
// Node builtins only — no new dependency, per the loop's scope discipline.

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";

export const DEFAULT_POLICY_FILE = "docs/POSITIONING.md";
export const FENCE_LABEL = "banned-phrases";

/**
 * @typedef {object} Matching
 * @property {boolean} wordBoundary
 * @property {boolean} caseInsensitive
 */

/**
 * @typedef {object} ExemptEntry
 * @property {number} index          position in the canon's `exempt:` list
 * @property {string} phrase
 * @property {string} reason
 * @property {string|null} until     the item that retires this entry, or null
 * @property {boolean} enforced      false = recorded but grants no exemption
 * @property {string[]} paths
 * @property {string[]} sections     heading titles; empty = the whole file
 * @property {number|null} maxOccurrences
 */

/**
 * @typedef {object} Policy
 * @property {string[]} scan
 * @property {string[]} unscanned
 * @property {Matching} matching
 * @property {{fence: string, appliesTo: string}|null} selfExclude
 * @property {string[]} banned
 * @property {string[]} allow
 * @property {ExemptEntry[]} exempt
 */

/**
 * @typedef {object} Hit
 * @property {string} file
 * @property {number} line           1-based; 0 for a whole-file finding
 * @property {number} column         1-based
 * @property {string} phrase         the banned phrase as the canon spells it
 * @property {string} match          the text as the file spells it
 * @property {string} source         the trimmed source line
 * @property {string} [note]         why an otherwise-exempt hit still counts
 * @property {string} [allowedBy]    the allow: phrase that rescued it
 * @property {number} [exemptIndex]  the exemption that covered it
 * @property {string} [reason]       that exemption's stated reason
 * @property {string|null} [until]   that exemption's retiring item
 */

/**
 * @typedef {object} AuditResult
 * @property {Hit[]} violations
 * @property {Hit[]} exempted
 * @property {Hit[]} rescued
 * @property {string[]} warnings
 */

/**
 * Normalize CRLF (the dev host is Windows) and drop a leading BOM (the same
 * editors emit one) so line and column maths is stable.
 */
function normalize(text) {
  return String(text ?? "").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
}

// ---------------------------------------------------------------------------
// Fences
// ---------------------------------------------------------------------------

/**
 * Every fenced region in `text`, as character offsets covering the opening
 * delimiter line through the closing delimiter line. An unterminated fence
 * runs to end of file — that is what a markdown renderer does too.
 *
 * @param {string} text
 * @param {string} [label] only fences whose info string is exactly this label
 * @returns {{ start: number, end: number, label: string, startLine: number, endLine: number }[]}
 */
export function fenceRegions(text, label) {
  const src = normalize(text);
  const lines = src.split("\n");
  const regions = [];
  let offset = 0;
  let open = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineStart = offset;
    offset += line.length + 1;
    const fence = line.match(/^\s*(`{3,}|~{3,})(.*)$/);
    if (!fence) continue;
    if (!open) {
      open = {
        start: lineStart,
        label: fence[2].trim(),
        startLine: i + 1,
        marker: fence[1][0],
        length: fence[1].length,
      };
      continue;
    }
    // A closing fence is the same marker character, at least as long, with no
    // info string of its own.
    if (fence[1][0] !== open.marker || fence[1].length < open.length || fence[2].trim() !== "") {
      continue;
    }
    regions.push({ start: open.start, end: offset, label: open.label, startLine: open.startLine, endLine: i + 1 });
    open = null;
  }
  if (open) {
    regions.push({ start: open.start, end: src.length, label: open.label, startLine: open.startLine, endLine: lines.length });
  }
  return label === undefined ? regions : regions.filter((r) => r.label === label);
}

/** The body of the first fence with `label`, plus its delimiter line numbers. */
export function fencedBlock(text, label) {
  const regions = fenceRegions(text, label);
  if (regions.length > 1) {
    // The first would silently win as the policy while selfExclude hid the
    // second from the scan: a revised, wider ban list, invisible and inert.
    throw new Error(`the policy file carries ${regions.length} \`${label}\` fences (lines ${regions.map((r) => r.startLine).join(", ")}); exactly one is the policy`);
  }
  const [region] = regions;
  if (!region) return null;
  const lines = normalize(text).split("\n");
  return {
    body: lines.slice(region.startLine, region.endLine - 1).join("\n"),
    startLine: region.startLine,
    endLine: region.endLine,
  };
}

// ---------------------------------------------------------------------------
// The policy block: an indentation-scoped YAML subset, parsed with builtins
// ---------------------------------------------------------------------------

/** True where a quote character would begin a value rather than be prose. */
function startsValue(before) {
  const trimmed = before.trimEnd();
  return trimmed === "" || trimmed.endsWith(":") || trimmed.endsWith("-");
}

function stripComment(line) {
  let out = "";
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      out += ch;
      if (ch === quote) quote = null;
      continue;
    }
    // A quote only DELIMITS when it starts a value. Elsewhere it is an
    // apostrophe in ordinary prose ("your company's data"), and treating that
    // as an open string swallows the trailing comment into the value — which
    // on a `banned:` item silently drops the phrase from the ban.
    if ((ch === '"' || ch === "'") && startsValue(out)) {
      quote = ch;
      out += ch;
      continue;
    }
    if (ch === "#" && (i === 0 || /\s/.test(line[i - 1]))) break;
    out += ch;
  }
  return out.replace(/\s+$/, "");
}

/** Split a flow sequence body on commas that are not inside quotes. */
function splitFlow(inner) {
  const parts = [];
  let current = "";
  let quote = null;
  for (const ch of inner) {
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; current += ch; continue; }
    if (ch === ",") { parts.push(current); current = ""; continue; }
    current += ch;
  }
  parts.push(current);
  return parts.map((p) => p.trim()).filter((p) => p !== "");
}

function scalar(raw) {
  const t = String(raw).trim();
  if (t === "") return "";
  // A flow sequence is valid YAML and a plausible hand edit. Parsing it beats
  // storing `["hosted", "cloud version"]` as ONE nonsense phrase, which would
  // silently switch the ban off and leave the lint green.
  if (t.startsWith("[") && t.endsWith("]")) {
    const inner = t.slice(1, -1).trim();
    return inner === "" ? [] : splitFlow(inner).map(scalar);
  }
  if (t.startsWith("{")) throw new Error(`the policy block uses a flow mapping (${t}); write it as an indented block instead`);
  if (t[0] === '"' || t[0] === "'") {
    if (t.length > 1 && t.endsWith(t[0])) return t.slice(1, -1);
    // A value that opens a quote and never closes it would otherwise become a
    // phrase beginning with a quote character, which no document contains.
    throw new Error(`the policy block has an unclosed quote in ${JSON.stringify(t)}`);
  }
  if (t === "true") return true;
  if (t === "false") return false;
  if (t === "null" || t === "~") return null;
  if (/^-?\d+$/.test(t)) return Number(t);
  return t;
}

const KEY_RE = /^([A-Za-z_][A-Za-z0-9_.-]*):(\s+(.*))?$/;

function toEntries(body) {
  const entries = [];
  for (const raw of normalize(body).split("\n")) {
    const stripped = stripComment(raw);
    if (stripped.trim() === "") continue;
    if (/^ *\t/.test(stripped)) {
      throw new Error(`the policy block indents with a TAB, which YAML forbids: "${stripped.trim()}"`);
    }
    entries.push({ indent: stripped.match(/^ */)[0].length, content: stripped.trim() });
  }
  return entries;
}

/**
 * Parse the subset of YAML the canon uses: nested maps and sequences, scalar
 * values, `- key: value` sequence-of-maps items, and plain-scalar continuation
 * lines folded onto the previous value with a space. Comments and blank lines
 * are gone before this runs.
 *
 * @param {string} body
 * @returns {any}
 */
export function parseYamlSubset(body) {
  const entries = toEntries(body);
  const [value] = parseNode(entries, 0, entries.length ? entries[0].indent : 0);
  return value ?? {};
}

function isContinuation(content) {
  return !content.startsWith("- ") && content !== "-" && !KEY_RE.test(content);
}

function parseNode(entries, start, indent) {
  if (start >= entries.length) return [null, start];
  return entries[start].content.startsWith("- ") || entries[start].content === "-"
    ? parseSequence(entries, start, indent)
    : parseMapping(entries, start, indent);
}

/** Collect the lines belonging to a child block: everything deeper than `indent`. */
function childSlice(entries, start, indent) {
  let end = start;
  while (end < entries.length && entries[end].indent > indent) end++;
  return end;
}

function parseSequence(entries, start, indent) {
  const items = [];
  let i = start;
  while (i < entries.length && entries[i].indent === indent && (entries[i].content.startsWith("- ") || entries[i].content === "-")) {
    const rest = entries[i].content === "-" ? "" : entries[i].content.slice(2).trim();
    const end = childSlice(entries, i + 1, indent);
    const childIndent = indent + 2;
    if (KEY_RE.test(rest)) {
      // `- key: value` — the item is a map whose first line is `rest`.
      const block = [{ indent: childIndent, content: rest }, ...entries.slice(i + 1, end)];
      const [value] = parseMapping(block, 0, childIndent);
      items.push(value);
    } else if (rest === "") {
      const [value] = parseNode(entries, i + 1, entries[i + 1]?.indent ?? childIndent);
      items.push(value);
    } else {
      let text = rest;
      for (const cont of entries.slice(i + 1, end)) {
        if (!isContinuation(cont.content)) break;
        text += ` ${cont.content}`;
      }
      items.push(scalar(text));
    }
    i = end;
  }
  return [items, i];
}

function parseMapping(entries, start, indent) {
  const map = {};
  let i = start;
  while (i < entries.length && entries[i].indent === indent) {
    const match = entries[i].content.match(KEY_RE);
    if (!match) {
      // Silently stopping here would drop every remaining key of this map —
      // which is how a wrapped `reason:` at its key's own indentation turns a
      // section-scoped, capped exemption into a whole-file, uncapped one.
      throw new Error(`the policy block has a line the parser cannot read as a key or a list item: "${entries[i].content}" (indent it further to continue the line above)`);
    }
    const key = match[1];
    if (Object.prototype.hasOwnProperty.call(map, key)) {
      throw new Error(`the policy block declares "${key}" twice; the second would silently replace the first`);
    }
    const inline = (match[3] ?? "").trim();
    const end = childSlice(entries, i + 1, indent);
    const next = entries[i + 1];
    if (inline !== "") {
      let text = inline;
      for (const cont of entries.slice(i + 1, end)) {
        if (!isContinuation(cont.content)) break;
        text += ` ${cont.content}`;
      }
      map[key] = scalar(text);
    } else if (end > i + 1) {
      const [value] = parseNode(entries, i + 1, entries[i + 1].indent);
      map[key] = value;
    } else if (next && next.indent === indent && (next.content.startsWith("- ") || next.content === "-")) {
      // A block sequence written at its key's own indentation is ordinary YAML
      // and the shape most editors produce. Reading it as `null` would drop
      // the list AND every later key of the same map — silently turning a
      // section-scoped, capped exemption into a whole-file, uncapped one.
      const [value, resumeAt] = parseSequence(entries, i + 1, indent);
      map[key] = value;
      i = resumeAt;
      continue;
    } else {
      map[key] = null;
    }
    i = end;
  }
  return [map, i];
}

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

function asList(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * Every list the policy declares is a list of STRINGS. Coercing anything else
 * with String() is how `- Servo: the AI desk` (a map, because it is unquoted)
 * becomes the unmatchable phrase "[object Object]" and the ban silently stops
 * existing. Refuse instead, naming the fix.
 */
function stringList(value, where) {
  return asList(value).map((entry) => {
    if (typeof entry === "string") return entry;
    if (typeof entry === "number" || typeof entry === "boolean") return String(entry);
    throw new Error(`${where} contains a value the parser read as ${Array.isArray(entry) ? "a list" : "a map"} rather than text; quote it ("...") if it contains a colon`);
  });
}

/**
 * Read the canon's `banned-phrases` block into the shape the engine consumes.
 * Throws on a malformed block: a policy that cannot be parsed must fail the
 * lint loudly, never scan with an empty ban list.
 *
 * @param {string} positioningText
 * @returns {Policy}
 */
export function parsePolicy(positioningText) {
  const block = fencedBlock(positioningText, FENCE_LABEL);
  if (!block) throw new Error(`no \`\`\`${FENCE_LABEL} block found in the policy file`);
  const raw = parseYamlSubset(block.body);
  const banned = stringList(raw.banned, "`banned:`");
  const scan = stringList(raw.scan, "`scan:`");
  if (banned.length === 0) throw new Error("the banned-phrases block declares no `banned:` phrases");
  if (scan.length === 0) throw new Error("the banned-phrases block declares no `scan:` set");
  // A phrase with no word in it compiles to an empty regex, which matches at
  // every offset of every file.
  for (const phrase of banned) {
    if (phraseWords(phrase).length === 0) throw new Error(`\`banned:\` contains an empty phrase (${JSON.stringify(phrase)})`);
  }
  const matching = raw.matching ?? {};
  const selfExclude = raw.selfExclude ?? null;
  const exempt = asList(raw.exempt).map((entry, index) => {
    // Both of these fail SAFE only if a bad value is refused. `enforced: no`
    // read as truthy would activate an entry the author disabled, and a
    // maxOccurrences the parser could not read would silently mean "no cap".
    if (entry?.enforced !== undefined && entry?.enforced !== null && typeof entry.enforced !== "boolean") {
      throw new Error(`exemption #${index} has enforced: ${JSON.stringify(entry.enforced)}; write true or false`);
    }
    if (entry?.maxOccurrences !== undefined && entry?.maxOccurrences !== null && typeof entry.maxOccurrences !== "number") {
      throw new Error(`exemption #${index} has maxOccurrences: ${JSON.stringify(entry.maxOccurrences)}; write a plain integer`);
    }
    return {
      index,
      phrase: stringList(entry?.phrase ?? "", `exemption #${index} \`phrase:\``)[0] ?? "",
      reason: typeof entry?.reason === "string" ? entry.reason : "",
      until: entry?.until == null ? null : String(entry.until),
      enforced: entry?.enforced !== false,
      paths: stringList(entry?.paths, `exemption #${index} \`paths:\``),
      sections: stringList(entry?.sections, `exemption #${index} \`sections:\``),
      maxOccurrences: typeof entry?.maxOccurrences === "number" ? entry.maxOccurrences : null,
    };
  });
  return {
    scan,
    unscanned: asList(raw.unscanned).map((u) => (typeof u === "string" ? u : String(u?.path ?? u))),
    matching: {
      wordBoundary: matching.wordBoundary !== false,
      caseInsensitive: matching.caseInsensitive !== false,
    },
    selfExclude: selfExclude ? { fence: String(selfExclude.fence ?? FENCE_LABEL), appliesTo: String(selfExclude.appliesTo ?? "all-scanned-files") } : null,
    banned,
    allow: stringList(raw.allow, "`allow:`"),
    exempt,
  };
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// What may separate two words of ONE phrase, and nothing wider. Three forms:
// spaces/tabs on the same line; an UNSPACED dash ("control-plane" is the same
// claim, while "cloud — version" is two clauses and stays clean); or a single
// line wrap whose continuation starts with ordinary text. The wrap deliberately
// refuses to cross a blank line, a heading, a list marker or a rule — two
// bullets, or a heading and the paragraph under it, are not one sentence.
// Only the plain hyphens join words: an em or en dash, spaced or closed up,
// sets two clauses apart. Horizontal space includes the non-breaking spaces
// that arrive with copy pasted out of a word processor.
const DASH = "\\u002d\\u2010\\u2011";
const HSPACE = " \\t\\u00a0\\u202f";
const SEPARATOR =
  `(?:[${HSPACE}]*[${DASH}]?[${HSPACE}]*\\n[${HSPACE}]*(?![\\s#*+|=\\u0000\\u002d\\u2010-\\u2015])` +
  `|[${HSPACE}]*[${DASH}]+[${HSPACE}]*` +
  `|[${HSPACE}]+)`;
// A structural line's end is marked with LINE_STOP in the mask (one character,
// in the newline's place) so no phrase can wrap out of a heading, a table row
// or a rule into the line beneath it.
const LINE_STOP = String.fromCharCode(0);
const STRUCTURAL_LINE = /^[ \t]{0,3}(?:#{1,6}[ \t]|\|)|^[ \t]{0,3}(?:[-*_=][ \t]*){3,}$/;

// Attributes whose value is copy a reader sees (alt text is read aloud by a
// screen reader and rendered when the image fails), as against a URL or an id.
const PROSE_ATTRS = /^(?:alt|title|aria-label|aria-description|placeholder|content|value|label|summary)$/i;

/**
 * Blank an HTML tag but KEEP the prose inside its human-readable attributes:
 * this repo's README states its identity in `<img alt="…">`, and a claim
 * written there is as public as one in a paragraph. URLs and ids stay blanked.
 */
function maskHtmlTag(tag) {
  const keep = new Array(tag.length).fill(false);
  const stop = new Array(tag.length).fill(false);
  const attr = /([A-Za-z][A-Za-z0-9:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = attr.exec(tag)) !== null) {
    if (!PROSE_ATTRS.test(m[1])) continue;
    const value = m[2] ?? m[3] ?? "";
    const start = m.index + m[0].length - value.length - 1;
    for (let i = start; i < start + value.length; i++) keep[i] = true;
    // The quotes become stops, not spaces: an alt string, a title string and
    // the element's body are three separate pieces of copy, and a phrase must
    // not run out of one into the next any more than it may cross a heading.
    stop[start - 1] = true;
    stop[start + value.length] = true;
  }
  return [...tag].map((ch, i) => (keep[i] ? ch : stop[i] ? LINE_STOP : " ")).join("");
}

/** The words of a declared phrase: whitespace- and dash-separated tokens. */
export function phraseWords(phrase) {
  return String(phrase).trim().split(/[\s\u002d\u2010-\u2015]+/).filter(Boolean);
}

/**
 * A claim renders through its markdown, so the matcher reads the text the way
 * a reader sees it. Blanked out before matching: blockquote markers, inline
 * HTML tags (this repo's README writes its hero copy in raw `<p>`/`<em>`),
 * link markup and its destination, code-span backticks, and emphasis runs of
 * `*` or `_`. Each character becomes a space, so every offset — and so every
 * reported line and column — stays exactly where it was.
 *
 * Two things are deliberately NOT masked. Inside a fenced or indented code
 * block there is no markdown to see through: a `>` is a shell continuation
 * prompt and a `*` is an operator. And a `_` with word characters on both
 * sides is `snake_case`, not emphasis, so masking it would invent claims out
 * of identifiers.
 *
 * @param {string} text
 * @returns {string} same length as `text`
 */
export function maskDecoration(text) {
  const src = normalize(text);
  const blanks = (m) => " ".repeat(m.length);
  const fenced = new Set();
  for (const region of fenceRegions(src)) {
    for (let line = region.startLine; line <= region.endLine; line++) fenced.add(line);
  }
  const isWord = (ch) => ch !== undefined && /[A-Za-z0-9]/.test(ch);
  const lines = src.split("\n");
  // An HTML comment is invisible to every reader, and it is where a draft
  // claim gets parked before anyone approves it. Blanked whole, across lines.
  const uncommented = src.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, " ")).split("\n");
  // An indented code block is code too — the same shell transcript, four
  // spaces in instead of fenced. But four spaces inside a list is a NESTED
  // BULLET, which is ordinary prose and must keep its markdown masked, so the
  // indent only means code outside a list.
  const codeIndent = lines.map(() => false);
  let inList = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (fenced.has(i + 1)) continue;
    if (line.trim() === "") continue;
    if (/^[ \t]{0,3}(?:[-*+]|\d+[.)])[ \t]/.test(line)) {
      inList = true;
      continue;
    }
    if (/^ {4,}|^\t/.test(line)) {
      codeIndent[i] = !inList;
      continue;
    }
    inList = false;
  }
  const masked = lines.map((raw, i) => {
    if (fenced.has(i + 1) || codeIndent[i]) return raw;
    const line = uncommented[i];
    return (
      line
        .replace(/^[ \t]*(?:>[ \t]*)+/, blanks)
        .replace(/<\/?[A-Za-z][^<>]*>/g, maskHtmlTag)
        .replace(/&(?:[A-Za-z][A-Za-z0-9]{1,10}|#\d{1,6}|#x[0-9A-Fa-f]{1,5});/g, blanks)
        // `[text](destination "title")`: the reader sees `text` and the title
        // tooltip, but the destination is somebody else's URL, not a claim
        // Servo is making. The title is bounded the same way an attribute is.
        .replace(/\]\([^()\s]*(\s+"([^"]*)")?\)/g, (whole, titlePart, title) => {
          if (titlePart === undefined) return blanks(whole);
          const head = whole.length - titlePart.length;
          return `${" ".repeat(head + titlePart.length - title.length - 2)}${LINE_STOP}${title}${LINE_STOP} `;
        })
        .replace(/(?<!\])\[|\]\[[^\]]*\]/g, blanks)
        .replace(/`+/g, blanks)
        .replace(/[*_]+/g, (m, at) => {
          const before = at === 0 ? undefined : line[at - 1];
          const after = line[at + m.length];
          // A `*` or `_` with whitespace on both sides is a bullet, a footnote
          // mark or an operator; one with word characters on both sides is an
          // identifier. Neither is emphasis, and blanking either would fuse
          // two words into a phrase nobody wrote.
          if (m[0] === "_" && isWord(before) && isWord(after)) return m;
          const spaced = (before === undefined || /\s/.test(before)) && (after === undefined || /\s/.test(after));
          return spaced ? m : blanks(m);
        })
    );
  });
  // A heading, a table row or a rule ends its line for good: a NUL takes the
  // newline's place (same length) so no phrase can wrap out of it into the line
  // beneath — "## Mission control" over "Plane maintenance" is two separate
  // pieces of prose, blank line between them or not.
  let out = "";
  for (let i = 0; i < masked.length; i++) {
    out += masked[i];
    if (i < masked.length - 1) {
      out += STRUCTURAL_LINE.test(lines[i]) && !fenced.has(i + 1) ? LINE_STOP : "\n";
    }
  }
  return out;
}

/**
 * A phrase matcher. Words of a phrase are separated by whitespace or a dash,
 * so a phrase wrapped across two markdown lines and a hyphenated spelling both
 * match. Word boundaries are `[A-Za-z0-9_]` lookarounds, which is why a hyphen
 * counts as a boundary and "self-hosted" DOES contain a hit for "hosted" —
 * rescued by `allow:` (whose own entries tokenize the same way), never by a
 * prefix rule. An underscore is a word character, so an identifier like
 * `sqlite_master` inside a code sample is not a claim about the product.
 *
 * @param {string} phrase
 * @param {{wordBoundary?: boolean, caseInsensitive?: boolean}} [matching]
 * @returns {RegExp}
 */
export function phrasePattern(phrase, matching = {}) {
  const { wordBoundary = true, caseInsensitive = true } = matching;
  const words = phraseWords(phrase);
  const body = words.map(escapeRe).join(SEPARATOR);
  const lead = wordBoundary && /^[A-Za-z0-9_]/.test(words[0] ?? "") ? "(?<![A-Za-z0-9_])" : "";
  const last = words[words.length - 1] ?? "";
  const tail = wordBoundary && /[A-Za-z0-9_]$/.test(last) ? "(?![A-Za-z0-9_])" : "";
  return new RegExp(`${lead}${body}${tail}`, caseInsensitive ? "gi" : "g");
}

/**
 * Every occurrence of any phrase, longest-match-wins at a given start offset.
 * Matching runs over the decoration mask, so offsets are the caller's offsets.
 *
 * @param {string} text
 * @param {string[]} phrases
 * @param {{wordBoundary?: boolean, caseInsensitive?: boolean}} [matching]
 * @returns {{phrase: string, start: number, end: number, text: string}[]}
 */
export function findPhrases(rawText, phrases, matching) {
  const source = normalize(rawText);
  const text = maskDecoration(source);
  const hits = [];
  for (const phrase of phrases) {
    const re = phrasePattern(phrase, matching);
    let m;
    while ((m = re.exec(text)) !== null) {
      // The match text comes from the ORIGINAL, so a report shows what is
      // written ("**control** plane"), not the masked projection.
      hits.push({ phrase, start: m.index, end: m.index + m[0].length, text: source.slice(m.index, m.index + m[0].length) });
      if (m[0].length === 0) re.lastIndex++;
    }
  }
  hits.sort((a, b) => a.start - b.start || b.end - a.end);
  const kept = [];
  for (const hit of hits) {
    const previous = kept[kept.length - 1];
    if (previous && previous.start === hit.start) continue; // longest already kept
    kept.push(hit);
  }
  return kept;
}

// ---------------------------------------------------------------------------
// Headings, so an exemption can be scoped to a section
// ---------------------------------------------------------------------------

function normalizeTitle(title) {
  return String(title)
    .replace(/[`*_]/g, "")
    .replace(/#+\s*$/, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * For every line (1-based), the normalized titles of the headings that govern
 * it — the whole ancestor chain, so a line under `### ROADMAP` inside
 * `## Claims ledger` belongs to both. Headings inside fenced blocks are not
 * headings: the policy block itself is full of `#` comment lines.
 *
 * @param {string} text
 * @returns {string[][]} index 0 is line 1
 */
export function headingChains(text) {
  const src = normalize(text);
  const lines = src.split("\n");
  const fences = fenceRegions(src);
  const inFence = new Set();
  for (const region of fences) {
    for (let line = region.startLine; line <= region.endLine; line++) inFence.add(line);
  }
  const chains = [];
  const stack = [];
  for (let i = 0; i < lines.length; i++) {
    const heading = inFence.has(i + 1) ? null : lines[i].match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
      stack.push({ level, title: normalizeTitle(heading[2]) });
    }
    chains.push(stack.map((h) => h.title));
  }
  return chains;
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

/** `docs/*.md` matches docs/x.md but never docs/design/x.md. `*` never spans `/`. */
export function pathMatches(pattern, filePath) {
  const p = String(pattern).replace(/^\.\//, "");
  const f = String(filePath).replace(/^\.\//, "");
  if (!p.includes("*")) return p === f;
  const re = new RegExp(`^${p.split("*").map(escapeRe).join("[^/]*")}$`);
  return re.test(f);
}

/**
 * Expand the policy's `scan:` set against a repository root, minus `unscanned:`.
 * A literal path that does not exist is returned in `missing` — a scan set
 * pointing at a file nobody has any more is a silent green, not a pass.
 *
 * @param {string} root
 * @param {Policy} policy
 * @returns {{files: string[], missing: string[]}}
 */
export function collectScanSet(root, policy) {
  const files = new Set();
  const missing = [];
  for (const pattern of policy.scan) {
    if (!pattern.includes("*")) {
      if (existsSync(path.join(root, pattern))) files.add(pattern);
      else missing.push(pattern);
      continue;
    }
    const dir = path.posix.dirname(pattern);
    const base = path.posix.basename(pattern);
    const abs = path.join(root, dir === "." ? "" : dir);
    if (!existsSync(abs)) continue;
    for (const name of readdirSync(abs).sort()) {
      const rel = dir === "." ? name : `${dir}/${name}`;
      // A dirent we cannot stat (a broken symlink) stays IN the set, so it
      // surfaces as an unreadable-file violation instead of vanishing.
      const stat = statSync(path.join(root, rel), { throwIfNoEntry: false });
      if (stat && !stat.isFile()) continue;
      if (pathMatches(base, name)) files.add(rel);
    }
  }
  const kept = [...files].filter((f) => !policy.unscanned.some((u) => pathMatches(u, f)));
  return { files: kept.sort(), missing };
}

// ---------------------------------------------------------------------------
// The audit
// ---------------------------------------------------------------------------

function lineIndex(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") starts.push(i + 1);
  return starts;
}

function positionOf(starts, offset) {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (starts[mid] <= offset) low = mid;
    else high = mid - 1;
  }
  return { line: low + 1, column: offset - starts[low] + 1 };
}

/**
 * Audit one file's text against the policy.
 *
 * @param {{file: string, text: string, policy: Policy}} input
 * @returns {{violations: Hit[], exempted: Hit[], rescued: Hit[]}}
 */
export function auditFile({ file, text, policy, policyFile = DEFAULT_POLICY_FILE }) {
  const src = normalize(text);
  const starts = lineIndex(src);
  const lines = src.split("\n");
  const chains = /\.md$/.test(file) ? headingChains(src) : [];

  const selfExcludes =
    policy.selfExclude && (policy.selfExclude.appliesTo === "all-scanned-files" || file === policyFile);
  const excluded = selfExcludes ? fenceRegions(src, policy.selfExclude.fence).map((r) => [r.start, r.end]) : [];
  const allowHits = findPhrases(src, policy.allow, policy.matching);
  const hits = findPhrases(src, policy.banned, policy.matching);

  const violations = [];
  const exempted = [];
  const rescued = [];
  const counters = new Map();

  for (const hit of hits) {
    if (excluded.some(([start, end]) => hit.start >= start && hit.end <= end)) continue;
    const cover = allowHits.find((a) => a.start <= hit.start && hit.end <= a.end);
    const { line, column } = positionOf(starts, hit.start);
    const record = { file, line, column, phrase: hit.phrase, match: hit.text, source: (lines[line - 1] ?? "").trim() };
    if (cover) {
      rescued.push({ ...record, allowedBy: cover.phrase });
      continue;
    }
    const sections = chains[line - 1] ?? [];
    const applicable = policy.exempt.filter(
      (e) =>
        e.enforced &&
        e.phrase.toLowerCase() === hit.phrase.toLowerCase() &&
        e.paths.some((p) => pathMatches(p, file)) &&
        (e.sections.length === 0 || e.sections.some((s) => sections.includes(normalizeTitle(s)))),
    );
    // The MOST SPECIFIC applicable entry wins, not the first written. A
    // whole-file transitional entry would otherwise shadow a section-scoped
    // permanent one, and the transitional entry's "pending retirement" count
    // would overstate how much copy the retiring item has to rewrite.
    const entry = applicable.sort(
      (a, b) => (b.sections.length ? 2 : 0) + (b.until ? 0 : 1) - ((a.sections.length ? 2 : 0) + (a.until ? 0 : 1)) || a.index - b.index,
    )[0];
    if (entry) {
      const key = `${file}::${entry.index}`;
      const used = (counters.get(key) ?? 0) + 1;
      counters.set(key, used);
      if (entry.maxOccurrences === null || used <= entry.maxOccurrences) {
        exempted.push({ ...record, exemptIndex: entry.index, reason: entry.reason, until: entry.until });
        continue;
      }
      violations.push({
        ...record,
        note: `exemption #${entry.index} allows ${entry.maxOccurrences} occurrence(s) in this file; this is #${used}`,
      });
      continue;
    }
    violations.push(record);
  }
  return { violations, exempted, rescued };
}

/**
 * Policy problems that are not claim violations but make the lint lie: a
 * section-scoped exemption whose heading does not exist resolves to nothing
 * silently (an em-dash/hyphen mismatch is exactly this bug).
 *
 * @param {Policy} policy
 * @param {Record<string, string>} fileTexts
 * @returns {string[]}
 */
export function policyWarnings(policy, fileTexts, policyFile = DEFAULT_POLICY_FILE) {
  const warnings = [];
  // `selfExclude.appliesTo: all-scanned-files` is what the canon declares, so
  // the engine honours it — but it means ANY scanned file can hide copy inside
  // a fence with that label. Surfacing it keeps the hole visible instead of
  // silent.
  if (policy.selfExclude) {
    for (const [file, text] of Object.entries(fileTexts)) {
      if (pathMatches(policyFile, file)) continue;
      if (fenceRegions(text, policy.selfExclude.fence).length > 0) {
        warnings.push(`${file} carries a \`${policy.selfExclude.fence}\` fence; everything inside it is excluded from the scan`);
      }
    }
  }
  for (const entry of policy.exempt) {
    if (entry.enforced && entry.paths.length === 0) {
      warnings.push(`exemption #${entry.index} ("${entry.phrase}") names no paths, so it exempts nothing`);
    }
    if (entry.enforced && entry.phrase === "") {
      warnings.push(`exemption #${entry.index} names no phrase, so it exempts nothing`);
    }
    if (!entry.enforced || entry.sections.length === 0) continue;
    for (const p of entry.paths) {
      if (p.includes("*")) continue;
      const text = fileTexts[p];
      if (text === undefined) continue;
      const titles = new Set(headingChains(text).flat());
      for (const section of entry.sections) {
        if (!titles.has(normalizeTitle(section))) {
          warnings.push(`exemption #${entry.index} ("${entry.phrase}") names section "${section}" which is not a heading in ${p}`);
        }
      }
    }
  }
  return warnings;
}

/**
 * Audit an in-memory map of `{ path: text }` — the shape the tests drive.
 *
 * @param {Record<string, string>} fileTexts
 * @param {Policy} policy
 * @returns {AuditResult}
 */
export function auditFiles(fileTexts, policy, policyFile = DEFAULT_POLICY_FILE) {
  const violations = [];
  const exempted = [];
  const rescued = [];
  for (const [file, text] of Object.entries(fileTexts)) {
    const result = auditFile({ file, text, policy, policyFile });
    violations.push(...result.violations);
    exempted.push(...result.exempted);
    rescued.push(...result.rescued);
  }
  return { violations, exempted, rescued, warnings: policyWarnings(policy, fileTexts, policyFile) };
}

/**
 * Audit a repository checkout: read the canon, expand the scan set, scan.
 *
 * @param {string} root
 * @param {string} [policyFile]
 * @returns {AuditResult & {policy: Policy, files: string[]}}
 */
export function auditRepo(root, policyFile = DEFAULT_POLICY_FILE) {
  const policyPath = path.join(root, policyFile);
  const policy = parsePolicy(readFileSync(policyPath, "utf8"));
  const { files, missing } = collectScanSet(root, policy);
  const fileTexts = {};
  const unreadable = [];
  for (const file of files) {
    try {
      fileTexts[file] = readFileSync(path.join(root, file), "utf8");
    } catch (err) {
      unreadable.push({ file, message: err.message });
    }
  }
  const result = auditFiles(fileTexts, policy, policyFile);
  const missingViolations = [
    ...missing.map((file) => ({
      file,
      line: 0,
      column: 0,
      phrase: "-",
      match: "-",
      source: "",
      note: "the policy's scan: set names this file, but it does not exist",
    })),
    // A file that cannot be read is not a pass: an unreadable surface is an
    // unscanned surface.
    ...unreadable.map(({ file, message }) => ({
      file,
      line: 0,
      column: 0,
      phrase: "-",
      match: "-",
      source: "",
      note: `the policy's scan: set names this file, but it could not be read (${message})`,
    })),
  ];
  return { ...result, policy, files, violations: [...missingViolations, ...result.violations] };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main(argv) {
  const args = argv.slice(2);
  const flag = (name, fallback) => {
    const i = args.indexOf(name);
    if (i === -1) return fallback;
    const value = args[i + 1];
    if (value === undefined || value.startsWith("--")) {
      console.error(`claims-audit: ${name} needs a value`);
      process.exit(1);
    }
    return value;
  };
  const KNOWN = new Set(["--root", "--policy", "--json"]);
  for (let i = 0; i < args.length; i++) {
    if (!args[i].startsWith("--")) continue;
    if (!KNOWN.has(args[i])) {
      console.error(`claims-audit: unknown flag ${args[i]} (known: ${[...KNOWN].join(", ")})`);
      process.exit(1);
    }
    if (args[i] !== "--json") i++;
  }
  const root = path.resolve(flag("--root", process.cwd()));
  const policyFile = flag("--policy", DEFAULT_POLICY_FILE);
  const asJson = args.includes("--json");

  let result;
  try {
    result = auditRepo(root, policyFile);
  } catch (err) {
    console.error(`claims-audit: cannot read the policy from ${path.join(root, policyFile)}: ${err.message}`);
    process.exit(1);
    return;
  }

  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.violations.length > 0 ? 1 : 0);
    return;
  }

  for (const warning of result.warnings) console.error(`claims-audit: policy warning: ${warning}`);
  for (const v of result.violations) {
    if (v.line === 0) {
      console.error(`claims-audit: ${v.file}: ${v.note}`);
      continue;
    }
    const why = v.note ? ` — ${v.note}` : "";
    console.error(`claims-audit: ${v.file}:${v.line}:${v.column}: banned phrase "${v.phrase}"${why}${v.source ? `\n    ${v.source}` : ""}`);
  }
  if (result.violations.length > 0) {
    console.error(`claims-audit: ${result.violations.length} violation(s) across ${result.files.length} scanned file(s)`);
    process.exit(1);
    return;
  }
  const pending = result.exempted.filter((e) => e.until);
  console.log(
    `claims-audit: OK — ${result.files.length} file(s) scanned, ${result.rescued.length} allowed by allow:, ${result.exempted.length} exempted, 0 violations`,
  );
  if (pending.length > 0) {
    const items = [...new Set(pending.map((p) => p.until))].sort();
    console.log(`claims-audit: ${pending.length} exempted occurrence(s) pending retirement by ${items.join(", ")}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv);
}
