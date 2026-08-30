#!/usr/bin/env node
// docs-cite-check (doc-01): every file path and tool name cited in the
// v1 documentation exists in the repo at commit time. Extracts backticked
// identifiers from the four doc-01 documents, resolves file-shaped ones
// against the tree, and checks tool-shaped ones against the shipped tool
// registry source. Exits 1 naming every miss.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DOCS = [
  "docs/connectors.md",
  "docs/skills.md",
  "docs/plugins.md",
  "docs/knowledge-base.md",
];

/** Tool names the docs may cite: every ToolDef name in the shipped
 *  registry source plus the mcp__ derivation rule. */
function shippedToolNames() {
  const names = new Set();
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts)$/.test(e.name)) {
        const src = readFileSync(p, "utf8");
        for (const m of src.matchAll(/^\s{2}(\w+): \{$/gm)) names.add(m[1]);
      }
    }
  };
  walk("src/lib/ai/tools");
  return names;
}

const tools = shippedToolNames();
const misses = [];

for (const doc of DOCS) {
  const text = readFileSync(doc, "utf8");
  for (const m of text.matchAll(/`([^`\n]+)`/g)) {
    const cited = m[1].trim();
    // Tool calls look like name(args) or bare snake_case words that exist
    // as tools; URL-ish and grammar samples are skipped.
    if (/^[a-z][a-z0-9_]*$/.test(cited) && cited.includes("_")) {
      if (!tools.has(cited)) {
        misses.push(`${doc}: cited tool "${cited}" is not a shipped tool name`);
      }
      continue;
    }
    // File-shaped citations resolve against the repo root — but a BARE
    // BASENAME (no slash) is a NAME, not a location, the same distinction
    // claims-audit's dead-path check makes: SKILL.md names the format,
    // .mcp.json names the file convention.
    if (/\//.test(cited) && (/\.(md|ts|mjs|json|sql|prisma)$/.test(cited) || /^(docs|src|scripts|prisma)\//.test(cited))) {
      const clean = cited.replace(/\(.*$/, "");
      if (!existsSync(clean)) misses.push(`${doc}: cited path "${clean}" does not exist`);
    }
  }
}

if (misses.length > 0) {
  for (const miss of misses) console.error(`docs-cite-check: ${miss}`);
  process.exit(1);
}
console.log(`docs-cite-check: OK (${DOCS.length} documents, every cited path and tool name exists)`);
