// Mechanical landing-tier classifier — spec item loop-03, §0.6. The control
// is what the diff DOES: risk lowered or data destroyed ⇒ Tier C. This
// script encodes the named Tier-C surfaces and delegates the three judgement
// calls to the sibling guards (migration-guard, permissions-guard, and —
// once loop-06 ships it — policy-guard). Until scripts/policy-guard.mjs
// exists, any tool-policy diff classifies C: the safe default the acceptance
// demands.
//
//   node scripts/landing-tier.mjs          # classifies the staged diff
//
// Rule 7 of the Tier-C list (user-visible copy making a product claim) is a
// human judgement; the classifier covers the mechanical rules 1–6.

import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { parseNameStatus } from "./loop-guard.mjs";
import { classifyMigration } from "./migration-guard.mjs";
import { classifyPermissionsDiff } from "./permissions-guard.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");

// §0.6 Tier C, rules 2/3/6. src/lib/mcp.ts and src/lib/ai/engine.ts are
// listed whole because "the executeMcpToolCall body" and "the policy/approval
// path inside driveResolverLoop" cannot be located reliably from a diff —
// classifying them C outright is the conservative direction the landing rule
// prefers; a false Tier B is the failure the rule exists to prevent.
// src/lib/ai/tool-policies.ts is NOT here: §0.6's additive-tools Tier B
// allows appended rows proven by policy-guard, so the policy-guard branch
// below owns that file (and returns C while the guard is missing).
export const TIER_C_FILES = new Set([
  "src/lib/auth.ts",
  "src/lib/authjs.ts",
  "src/lib/secret-store.ts",
  "src/lib/egress.ts",
  "src/app/api/mcp/route.ts",
  "src/lib/mcp.ts",
  "src/lib/ai/engine.ts",
  "Dockerfile",
  "docker-compose.yml",
  "docker-compose.test.yml",
]);

const TIER_RANK = { A: 0, B: 1, C: 2 };

/**
 * Reconstruct per-file ADDED content from a unified diff (the full text of
 * newly added files; the added lines of modified ones).
 * @param {string} diffText
 * @returns {Map<string, string>}
 */
export function addedContentByFile(diffText) {
  const out = new Map();
  let file = "";
  let buf = null;
  for (const raw of String(diffText ?? "").split("\n")) {
    if (raw.startsWith("+++ ")) {
      if (buf !== null) out.set(file, buf.join("\n"));
      file = raw.slice(4).replace(/^b\//, "");
      buf = [];
      continue;
    }
    if (buf === null) continue;
    if (raw.startsWith("@@")) continue;
    if (raw.startsWith("+")) buf.push(raw.slice(1));
  }
  if (buf !== null) out.set(file, buf.join("\n"));
  return out;
}

/**
 * True when the diff changes lines inside package.json's runtime dependency
 * blocks. devDependencies are exempt (§0.6 names "new runtime dependencies").
 * Block state is tracked across context lines; a heuristic, deliberately
 * biased toward C.
 * @param {string} diffText
 * @returns {boolean}
 */
export function diffTouchesRuntimeDependencies(diffText) {
  const RUNTIME_BLOCKS = new Set(["dependencies", "peerDependencies", "optionalDependencies"]);
  let block = "";
  for (const raw of String(diffText ?? "").split("\n")) {
    if (raw.startsWith("--- ") || raw.startsWith("+++ ") || raw.startsWith("@@") || raw.startsWith("diff ")) {
      continue;
    }
    const changed = raw.startsWith("+") || raw.startsWith("-");
    const line = raw.slice(1);
    const header = line.match(/^\s*"(dependencies|devDependencies|peerDependencies|optionalDependencies)"\s*:/);
    if (header) {
      block = header[1];
      continue;
    }
    if (/^\s*}\s*,?\s*$/.test(line)) {
      block = "";
      continue;
    }
    if (changed && block && RUNTIME_BLOCKS.has(block) && /^\s*"[^"]+"\s*:/.test(line)) {
      return true;
    }
  }
  return false;
}

/** Try to load scripts/policy-guard.mjs (loop-06); null while it does not exist. */
async function defaultLoadPolicyGuard() {
  try {
    return await import("./policy-guard.mjs");
  } catch {
    return null;
  }
}

/**
 * @typedef {object} LandingVerdict
 * @property {"A"|"B"|"C"} tier
 * @property {string[]} reasons
 */

/**
 * Classify a diff into A|B|C per §0.6.
 *
 * @param {{files?: {status: string, path: string}[], diffText?: string}} input
 * @param {{loadPolicyGuard?: () => Promise<object|null>}} [opts]
 * @returns {Promise<LandingVerdict>}
 */
export async function classifyLanding(
  { files = [], diffText = "" } = {},
  { loadPolicyGuard = defaultLoadPolicyGuard } = {},
) {
  const reasons = [];
  let tier = "A";
  const raise = (to, why) => {
    if (TIER_RANK[to] > TIER_RANK[tier]) tier = to;
    reasons.push(why);
  };

  // Rule 2/3/6: named Tier-C surfaces.
  for (const f of files) {
    if (TIER_C_FILES.has(f.path)) raise("C", `${f.path} is a §0.6 Tier-C surface`);
  }

  // Rule 6: runtime dependencies in package.json.
  if (files.some((f) => f.path === "package.json") && diffTouchesRuntimeDependencies(diffText)) {
    raise("C", "runtime dependency change in package.json");
  }

  // Rule 1: migrations. Additive ⇒ Tier B; anything the migration-guard
  // rejects ⇒ Tier C. A schema change with no migration at all is C —
  // loop-guard rail 5 refuses it too.
  const migrationFiles = files.filter((f) => f.path.startsWith("prisma/migrations/") && f.path.endsWith(".sql"));
  const schemaChanged = files.some((f) => f.path === "prisma/schema.prisma");
  const addedByFile = addedContentByFile(diffText);
  if (schemaChanged || migrationFiles.length > 0) {
    if (migrationFiles.length === 0) {
      raise("C", "prisma/schema.prisma changed with no prisma/migrations/ entry in the diff");
    }
    for (const f of migrationFiles) {
      const verdict = classifyMigration(addedByFile.get(f.path) ?? "");
      if (verdict.verdict === "destructive") {
        raise("C", `${f.path}: migration-guard rejects it (${verdict.reasons[0]})`);
      } else {
        raise("B", `${f.path}: additive migration (migration-guard)`);
      }
    }
  }

  // Rule 5: permissions. Additive ⇒ Tier B; anything else ⇒ Tier C.
  if (files.some((f) => f.path === "src/lib/permissions.ts")) {
    const verdict = classifyPermissionsDiff(diffText);
    if (verdict.verdict === "additive") {
      raise("B", "src/lib/permissions.ts: additive (permissions-guard)");
    } else {
      raise("C", `src/lib/permissions.ts: ${verdict.reasons[0]}`);
    }
  }

  // Rule 4 via policy-guard (loop-06): appended tool-policy rows and new
  // src/lib/ai/tools/ files land Tier B only when policy-guard proves the
  // quarantine triple. Without policy-guard, any tool-policy diff is C.
  const touchesToolPolicies = files.some((f) => f.path === "src/lib/ai/tool-policies.ts");
  const addsTools = files.some((f) => f.path.startsWith("src/lib/ai/tools/") && f.status === "A");
  if (touchesToolPolicies || addsTools) {
    const guard = await loadPolicyGuard();
    const classify = guard?.classifyToolPoliciesDiff;
    if (typeof classify !== "function") {
      raise("C", "tool-policy diff but scripts/policy-guard.mjs is missing — C until loop-06 ships it");
    } else {
      const verdict = classify(diffText);
      if (verdict?.verdict === "additive") {
        raise("B", "tool-policy rows additive, quarantine triple proven (policy-guard)");
      } else {
        raise("C", `tool-policy diff rejected: ${verdict?.reasons?.[0] ?? "policy-guard said no"}`);
      }
    }
  }

  return { tier, reasons };
}

function sh(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", cwd: REPO_ROOT });
  } catch {
    return "";
  }
}

// CLI only — not when the tests import the module.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const diffText = sh("git", ["diff", "--cached"]);
  const files = parseNameStatus(sh("git", ["diff", "--cached", "--name-status"]));
  const { tier, reasons } = await classifyLanding({ files, diffText });
  for (const r of reasons) console.log(`landing-tier: ${r}`);
  console.log(`landing-tier: ${tier}`);
}
