// Tier classifier for a src/lib/permissions.ts diff — spec item loop-03, the
// §0.6 Tier B "additive permissions" proof. Additive only when no existing
// Action key's grant array changed (or was removed), and every newly added
// key grants a subset of ["ADMIN", "AGENT"] — never REQUESTER (an
// auto-provisioned requester must not reach a new admin surface) and never
// AI_AGENT. Pre-existing REQUESTER grants on ticket.create/ticket.comment
// predate this rule and may stay; the rule governs what the DIFF adds.
// Pure text analysis over a unified diff; Node builtins only.
//
//   node scripts/permissions-guard.mjs <diff.txt>   # prints additive|destructive

// A MATRIX entry line:  "action.name": ["ADMIN", "AGENT"],
const ENTRY_RE = /^\s*"([a-z][a-z0-9.]*)"\s*:\s*\[([^\]]*)\]/;

/**
 * Parse "action": [roles] entries out of source lines.
 * @param {string[]} lines
 * @returns {Map<string, string[]>}
 */
export function parseMatrixEntries(lines) {
  const out = new Map();
  for (const line of lines) {
    const m = line.match(ENTRY_RE);
    if (!m) continue;
    const roles = [...m[2].matchAll(/"([A-Z_]+)"/g)].map((r) => r[1]);
    out.set(m[1], roles);
  }
  return out;
}

/**
 * @typedef {object} PermissionsVerdict
 * @property {"additive"|"destructive"} verdict
 * @property {string[]} reasons
 */

/**
 * Classify a unified diff of src/lib/permissions.ts. Context lines count for
 * both sides; "-" lines build the before-state, "+" lines the after-state.
 * @param {string} diffText
 * @returns {PermissionsVerdict}
 */
export function classifyPermissionsDiff(diffText) {
  const oldLines = [];
  const newLines = [];
  for (const raw of String(diffText ?? "").split("\n")) {
    if (raw.startsWith("--- ") || raw.startsWith("+++ ") || raw.startsWith("@@") || raw.startsWith("diff ")) {
      continue;
    }
    if (raw.startsWith("-")) oldLines.push(raw.slice(1));
    else if (raw.startsWith("+")) newLines.push(raw.slice(1));
    else {
      oldLines.push(raw.slice(1));
      newLines.push(raw.slice(1));
    }
  }
  const before = parseMatrixEntries(oldLines);
  const after = parseMatrixEntries(newLines);
  const reasons = [];

  for (const [key, roles] of before) {
    const now = after.get(key);
    if (!now) {
      reasons.push(`existing action "${key}" removed (grants [${roles.join(", ")}])`);
    } else if (JSON.stringify(now) !== JSON.stringify(roles)) {
      reasons.push(`existing action "${key}" grant array changed: [${roles.join(", ")}] -> [${now.join(", ")}]`);
    }
  }
  const ALLOWED = ["ADMIN", "AGENT"];
  for (const [key, roles] of after) {
    if (before.has(key)) continue;
    const forbidden = roles.filter((r) => r === "REQUESTER" || r === "AI_AGENT");
    if (forbidden.length > 0) {
      reasons.push(`new action "${key}" grants ${forbidden.join(", ")} — new keys grant ADMIN/AGENT only`);
      continue;
    }
    const outside = roles.filter((r) => !ALLOWED.includes(r));
    if (outside.length > 0) {
      reasons.push(`new action "${key}" grants [${outside.join(", ")}] — not a subset of ["ADMIN","AGENT"]`);
    }
  }
  return { verdict: reasons.length === 0 ? "additive" : "destructive", reasons };
}

import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";

// CLI only — not when the tests import the module.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.argv[2];
  if (!file) {
    console.error("usage: node scripts/permissions-guard.mjs <permissions.diff>");
    process.exit(2);
  }
  const { verdict, reasons } = classifyPermissionsDiff(readFileSync(file, "utf8"));
  for (const r of reasons) console.error(`permissions-guard: ${r}`);
  console.log(`permissions-guard: ${verdict}`);
  process.exit(verdict === "additive" ? 0 : 1);
}
