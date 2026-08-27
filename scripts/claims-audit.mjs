// Claims lint — spec item reb-07. Reads the machine-readable banned-phrases
// block from docs/POSITIONING.md (the canon reb-03 created) and scans the
// user-visible surfaces — README.md, docs/*.md, SECURITY.md, ROADMAP.md,
// package.json — exiting nonzero with file:line on any hit.
//
// Matching is WORD-BOUNDARY and CONTEXT aware:
//   - an `allow:` phrase shields its own span even when it contains a banned
//     phrase ("self-hosted" never trips "hosted"; "Self-host it" neither;
//     "SaaS endpoint" describes what a custom tool may call, not what we are);
//   - the fenced banned-phrases block excludes itself from its own scan;
//   - `exempt:` entries scope a phrase away from named paths — each carries
//     the item (`until:`) that will retire it.
//
//   node scripts/claims-audit.mjs

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const CANON = "docs/POSITIONING.md";

/** Pull the ```banned-phrases fenced block out of the canon file. */
export function extractBannedBlock(canonText) {
  const m = String(canonText ?? "").match(/```banned-phrases\n([\s\S]*?)```/);
  return m ? m[1] : "";
}

/** The canon with its own banned block blanked — it never scans itself. */
export function withoutBannedBlock(canonText) {
  return String(canonText ?? "").replace(/```banned-phrases\n[\s\S]*?```/, "```[banned-phrases block excluded from its own scan]```");
}

/**
 * Parse the block into { banned: string[], allow: string[], exempt:
 * {phrase, paths, until?}[] }. Comments (`#`) and blank lines ignored.
 */
export function parseBannedBlock(blockText) {
  const banned = [];
  const allow = [];
  const exempt = [];
  let section = null;
  let currentExempt = null;
  for (const raw of String(blockText ?? "").split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trimEnd();
    if (!line.trim()) continue;
    const sectionMatch = line.match(/^(banned|allow|exempt):\s*$/);
    if (sectionMatch) {
      section = sectionMatch[1];
      continue;
    }
    if (section === "banned" || section === "allow") {
      const item = line.match(/^\s*-\s*(.+?)\s*$/);
      if (item) (section === "banned" ? banned : allow).push(item[1].trim());
      continue;
    }
    if (section === "exempt") {
      const phrase = line.match(/^\s*-\s*phrase:\s*(.+?)\s*$/);
      if (phrase) {
        currentExempt = { phrase: phrase[1], paths: [], until: undefined };
        exempt.push(currentExempt);
        continue;
      }
      const paths = line.match(/^\s*paths:\s*$/);
      if (paths) continue;
      const onePath = line.match(/^\s*-\s*(?!phrase|until)([\w./-]+)\s*$/);
      if (onePath && currentExempt) {
        currentExempt.paths.push(onePath[1]);
        continue;
      }
      const until = line.match(/^\s*until:\s*(\S+)\s*$/);
      if (until && currentExempt) currentExempt.until = until[1];
    }
  }
  return { banned, allow, exempt };
}

/** A phrase becomes a word-boundary regex tolerant of whitespace variance. */
function phraseRegex(phrase) {
  const body = phrase
    .trim()
    .split(/\s+/)
    .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s+");
  return new RegExp(`(^|\\W)(${body})(\\W|$)`, "gi");
}

/**
 * @typedef {object} ClaimViolation
 * @property {string} file
 * @property {number} line
 * @property {string} phrase
 * @property {string} text
 */

/** Scan one file's text against the parsed rules. Pure. */
export function scanFile(relPath, text, { banned, allow, exempt }) {
  const exemptions = exempt.filter((e) => e.paths.includes(relPath)).map((e) => e.phrase);
  const activeBanned = banned.filter((p) => !exemptions.includes(p));
  const violations = [];
  const lines = String(text ?? "").split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const phrase of activeBanned) {
      const re = phraseRegex(phrase);
      let m;
      while ((m = re.exec(line)) !== null) {
        // Context: a banned match fully inside an allowed phrase's span is
        // capability language, not an identity claim.
        const insideAllow = allow.some((allowed) => {
          const ar = phraseRegex(allowed);
          ar.lastIndex = 0;
          let a;
          while ((a = ar.exec(line)) !== null) {
            if (a.index <= m.index && a.index + a[0].length >= m.index + m[0].length) return true;
          }
          return false;
        });
        if (!insideAllow) {
          violations.push({
            file: relPath,
            line: i + 1,
            phrase,
            text: line.trim().slice(0, 110),
          });
          break;
        }
        re.lastIndex = m.index + 1;
      }
    }
  });
  return violations;
}

function scannedFiles() {
  const files = ["README.md", "SECURITY.md", "ROADMAP.md", "package.json"];
  const docsDir = path.join(REPO_ROOT, "docs");
  for (const entry of readdirSync(docsDir)) {
    if (entry.endsWith(".md")) files.push(`docs/${entry}`);
  }
  return files;
}

function main() {
  const canonText = readFileSync(path.join(REPO_ROOT, CANON), "utf8");
  const rules = parseBannedBlock(extractBannedBlock(canonText));
  if (rules.banned.length === 0) {
    console.error(`claims-audit: no banned-phrases block found in ${CANON}`);
    process.exit(1);
  }
  const violations = [];
  for (const rel of scannedFiles()) {
    const text = readFileSync(path.join(REPO_ROOT, rel), "utf8");
    // The canon quotes its banned phrases to rule on them: its block (and
    // only its block) is excluded from its own scan.
    const effective = rel === CANON ? withoutBannedBlock(text) : text;
    violations.push(...scanFile(rel, effective, rules));
  }
  for (const v of violations) {
    console.error(`claims-audit: ${v.file}:${v.line}: banned phrase "${v.phrase}": ${v.text}`);
  }
  if (violations.length > 0) process.exit(1);
  console.log(
    `claims-audit: OK (${rules.banned.length} banned phrases; scanned ${scannedFiles().length} surfaces)`,
  );
}

// CLI only — not when the tests import the module.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
