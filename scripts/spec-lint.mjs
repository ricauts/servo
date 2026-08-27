// Whole-file validator for spec.md's backlog — spec item loop-03. Parses the
// fenced item blocks of §11 (the single work order; §0.3's template block
// and §11's own format exemplar are not items) and checks the invariants the
// pick rule in §0.2 depends on: unique ids, valid status/tier, depends-on
// ids that exist and point EARLIER in the list (which is what makes the
// graph acyclic and stops a tick picking a forward-dependent item), at most
// one doing and one review, dated non-todo items, and a dated owner question
// for every blocked item. Pure text analysis; exit 1 with one message per
// violation, exit 0 on a clean file.
//
//   node scripts/spec-lint.mjs [path]     # default: spec.md
//
// Node builtins only, per the loop-03 acceptance.

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";

const STATUSES = new Set(["todo", "doing", "blocked", "review", "done"]);
const TIERS = new Set(["A", "B", "C"]);
const FIELD_KEYS = ["status", "date", "size", "tier", "depends-on", "files"];
// An item id is <area>-<n*> shaped ("loop-02", "hyg-audit-01"). This also
// excludes the format exemplar's literal "<id>" placeholder.
const ID_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * @typedef {object} BacklogItem
 * @property {string} id
 * @property {number} index      // position in pick order, 0-based
 * @property {number} line       // 1-based line of the "### [id]" heading
 * @property {Record<string, string>} fields
 * @property {string[]} dependsOn
 */

/** Normalize CRLF (Windows checkouts) so `$`-anchored regexes see clean lines. */
function toLines(text) {
  return String(text ?? "").replace(/\r\n/g, "\n").split("\n");
}

/** Parse the fenced backlog item blocks of §11 out of spec.md text. */
export function parseBacklog(text) {
  const lines = toLines(text);
  const items = [];
  let section = null;
  let inFence = false;
  let current = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const h1 = line.match(/^## (\d+)\./);
    if (h1) section = Number(h1[1]);
    if (line.startsWith("```")) {
      if (current) items.push(current);
      current = null;
      inFence = !inFence;
      continue;
    }
    if (!inFence || section !== 11) continue;
    const head = line.match(/^### \[([^\]]+)\]/);
    if (head && ID_RE.test(head[1])) {
      if (current) items.push(current);
      current = { id: head[1], index: items.length, line: i + 1, fields: {}, dependsOn: [] };
      continue;
    }
    if (current) {
      const field = line.match(/^([a-z-]+):\s*(.*)$/);
      if (field && FIELD_KEYS.includes(field[1])) {
        current.fields[field[1]] = field[2].trim();
      }
    }
  }
  if (current) items.push(current);
  for (const item of items) {
    const deps = item.fields["depends-on"] ?? "-";
    item.dependsOn = deps
      .split(",")
      .map((d) => d.trim())
      .filter((d) => d !== "-" && d !== "");
  }
  return items;
}

/** The text between the "Questions for the owner" section and the next `## `. */
export function questionsSection(text) {
  const lines = toLines(text);
  const start = lines.findIndex((l) => /^## \d+\. .*[Qq]uestions for the owner/.test(l));
  if (start === -1) return "";
  const out = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^## \d+\./.test(lines[i])) break;
    out.push(lines[i]);
  }
  return out.join("\n");
}

/** Detect a dependency cycle (possible only if forward refs slipped in). */
function findCycle(items) {
  const byId = new Map(items.map((it) => [it.id, it]));
  const state = new Map(); // id -> "visiting" | "done"
  const stack = [];
  const visit = (id) => {
    if (state.get(id) === "done") return null;
    if (state.get(id) === "visiting") return id;
    state.set(id, "visiting");
    stack.push(id);
    for (const dep of byId.get(id)?.dependsOn ?? []) {
      if (!byId.has(dep)) continue;
      const hit = visit(dep);
      if (hit) return hit;
    }
    stack.pop();
    state.set(id, "done");
    return null;
  };
  for (const it of items) {
    const hit = visit(it.id);
    if (hit) return stack.slice(stack.indexOf(hit));
  }
  return null;
}

/**
 * Lint spec.md text. Returns one message per violation; an empty array means
 * the backlog is well-formed.
 * @param {string} text
 * @returns {string[]}
 */
export function lintSpecText(text) {
  const items = parseBacklog(text);
  const violations = [];
  if (items.length === 0) return ["spec-lint: no backlog items found under §11 — parser or file is wrong"];

  const seen = new Map();
  const doing = [];
  const review = [];
  for (const item of items) {
    if (seen.has(item.id)) {
      violations.push(`spec-lint: ${item.id}: duplicate id (lines ${seen.get(item.id)} and ${item.line})`);
    } else {
      seen.set(item.id, item.line);
    }
    for (const key of FIELD_KEYS) {
      const value = item.fields[key];
      if (value === undefined || value === "") {
        violations.push(`spec-lint: ${item.id}: missing or empty field "${key}" (line ${item.line})`);
      }
    }
    const status = item.fields.status;
    if (status && !STATUSES.has(status)) {
      violations.push(`spec-lint: ${item.id}: status "${status}" not in todo|doing|blocked|review|done`);
    }
    const tier = item.fields.tier;
    if (tier && !TIERS.has(tier)) {
      violations.push(`spec-lint: ${item.id}: tier "${tier}" not in A|B|C`);
    }
    if (status === "doing") doing.push(item.id);
    if (status === "review") review.push(item.id);
    if (status && status !== "todo") {
      const date = item.fields.date;
      if (!date || !DATE_RE.test(date)) {
        violations.push(`spec-lint: ${item.id}: status ${status} but date "${date ?? ""}" is not YYYY-MM-DD`);
      }
    }
  }
  if (doing.length > 1) {
    violations.push(`spec-lint: ${doing.length} items are doing (${doing.join(", ")}); at most one may be`);
  }
  if (review.length > 1) {
    violations.push(`spec-lint: ${review.length} items are review (${review.join(", ")}); at most one may be`);
  }

  // depends-on: exists, and points EARLIER in the list (no forward refs).
  for (const item of items) {
    for (const dep of item.dependsOn) {
      if (!seen.has(dep)) {
        violations.push(`spec-lint: ${item.id}: depends-on "${dep}" does not exist`);
      }
    }
  }
  const byId = new Map(items.map((it) => [it.id, it]));
  for (const item of items) {
    for (const dep of item.dependsOn) {
      const target = byId.get(dep);
      if (target && target.index >= item.index) {
        violations.push(
          `spec-lint: ${item.id}: depends-on "${dep}" appears LATER in the list (forward reference)`,
        );
      }
    }
  }
  const cycle = findCycle(items);
  if (cycle) {
    violations.push(`spec-lint: dependency cycle: ${cycle.join(" -> ")}`);
  }

  // Every blocked item carries a dated question under "Questions for the owner".
  const questions = questionsSection(text);
  for (const item of items) {
    if (item.fields.status !== "blocked") continue;
    const date = item.fields.date ?? "";
    if (!questions.includes(item.id) || (date && !questions.includes(date))) {
      violations.push(
        `spec-lint: ${item.id}: blocked but "Questions for the owner" carries no question naming it with its date (${date})`,
      );
    }
  }
  return violations;
}

function main() {
  const file = process.argv[2] ?? path.resolve("spec.md");
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch (err) {
    console.error(`spec-lint: cannot read ${file}: ${err.message}`);
    process.exit(1);
  }
  const violations = lintSpecText(text);
  for (const v of violations) console.error(v);
  if (violations.length > 0) process.exit(1);
  console.log(`spec-lint: OK (${parseBacklog(text).length} items)`);
}

// CLI only — not when the tests import the module.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
