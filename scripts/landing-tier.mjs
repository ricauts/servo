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
  // hyg-01: what ships in the image is the same class of risk as how it is
  // built, so .dockerignore joins the other two (§0.6 rule 6, as amended by
  // the owner question this item's commit message names).
  ".dockerignore",
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

/**
 * Parse `git diff --name-status` keeping the rename similarity score, which
 * parseNameStatus (loop-guard) drops. The score is the whole control for the
 * deletion rule's one exception: only `R100` — a rename with no content change
 * at all — is not a deletion.
 * @param {string} text
 * @returns {{status: string, score: number|null, path: string, fromPath: string|null}[]}
 */
export function parseNameStatusWithScore(text) {
  const out = [];
  for (const raw of String(text ?? "").split("\n")) {
    const line = raw.trim();
    if (line === "") continue;
    const fields = line.split("\t");
    if (fields.length < 2) continue;
    const code = fields[0];
    const digits = code.match(/[0-9]+$/);
    out.push({
      status: code.replace(/[0-9]+$/, ""),
      score: digits ? Number(digits[0]) : null,
      path: fields[fields.length - 1],
      fromPath: fields.length > 2 ? fields[1] : null,
    });
  }
  return out;
}

/**
 * Names bound by one `export { … }` list fragment.
 * @param {string} fragment
 * @returns {string[]}
 */
function exportListNames(fragment) {
  const out = [];
  for (const piece of String(fragment).split(",")) {
    const m = piece
      .trim()
      .replace(/^type\s+/, "")
      .match(/(?:[A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)|^([A-Za-z_$][\w$]*)$/);
    const name = m?.[1] ?? m?.[2];
    if (name) out.push(name);
  }
  return out;
}

const EXPORT_DECL =
  /^\s*export\s+(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:function\*?|const|let|var|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/;

/**
 * Feed one line of one side of the diff (the `-` side or the `+` side) through
 * a small state machine, because an `export { … }` list spans lines: in a diff
 * the removed line is often just `  Bar,` with the `export {` sitting on a
 * context line. Fourteen files in src/ use that form, so a line-local regex
 * would classify a real removal Tier A.
 *
 * @param {{open: boolean}} state carried across lines for this side
 * @param {string} body the line without its +/-/space marker
 * @param {Set<string>|null} sink null for a context line: it moves the state, it changes nothing
 */
function feedExportLine(state, body, sink) {
  const add = (name) => {
    if (sink && name) sink.add(name);
  };
  if (state.open) {
    const close = body.indexOf("}");
    for (const n of exportListNames(close >= 0 ? body.slice(0, close) : body)) add(n);
    if (close >= 0) state.open = false;
    return;
  }
  const list = body.match(/^\s*export\s+(?:type\s+)?\{(.*)$/);
  if (list) {
    const rest = list[1];
    const close = rest.indexOf("}");
    for (const n of exportListNames(close >= 0 ? rest.slice(0, close) : rest)) add(n);
    state.open = close < 0;
    return;
  }
  const decl = body.match(EXPORT_DECL);
  if (decl) {
    add(decl[1]);
    return;
  }
  // Destructuring: export const { a, b } = x;  /  export const [a, b] = y;
  const destructured = body.match(/^\s*export\s+(?:const|let|var)\s*[{[]([^}\]]*)[}\]]\s*=/);
  if (destructured) {
    for (const n of exportListNames(destructured[1])) add(n);
    return;
  }
  // Star re-exports carry no local name; the specifier identifies them.
  const star = body.match(/^\s*export\s+\*\s*(?:as\s+([A-Za-z_$][\w$]*)\s*)?from\s*["']([^"']+)["']/);
  if (star) {
    add(star[1] ? star[1] : `*:${star[2]}`);
    return;
  }
  if (/^\s*export\s+default\b/.test(body)) add("default");
}

/**
 * Exported symbols the diff REMOVES and does not add back, tracked PER FILE.
 * Per file matters: `default` is removed and added in unrelated files all the
 * time, and a global set would let one cancel the other.
 * @param {string} diffText
 * @returns {string[]}
 */
export function removedExportedSymbols(diffText) {
  /** @type {Map<string, {removed: Set<string>, added: Set<string>}>} */
  const perFile = new Map();
  let file = "";
  let minus = { open: false };
  let plus = { open: false };
  const bucket = () => {
    if (!perFile.has(file)) perFile.set(file, { removed: new Set(), added: new Set() });
    return perFile.get(file);
  };
  for (const raw of String(diffText ?? "").split("\n")) {
    if (raw.startsWith("+++ ")) {
      file = raw.slice(4).replace(/^b\//, "");
      minus = { open: false };
      plus = { open: false };
      continue;
    }
    if (raw.startsWith("--- ") || raw.startsWith("diff ")) continue;
    if (raw.startsWith("@@")) {
      // A new hunk is not continuous with the last one.
      minus = { open: false };
      plus = { open: false };
      continue;
    }
    const sign = raw[0];
    const body = raw.slice(1);
    if (sign === "-") feedExportLine(minus, body, bucket().removed);
    else if (sign === "+") feedExportLine(plus, body, bucket().added);
    else {
      // Context: belongs to both sides, and changes neither set.
      feedExportLine(minus, body, null);
      feedExportLine(plus, body, null);
    }
  }
  const out = [];
  for (const { removed, added } of perFile.values()) {
    for (const name of removed) if (!added.has(name)) out.push(name);
  }
  return out;
}

/**
 * Package names the diff REMOVES from package.json's dependency blocks.
 * devDependencies count here — §0.6 rule 6 is about *adding* a runtime
 * dependency, while the deletion rule is about removing any declared one,
 * because `npm ci` breaks either way.
 *
 * The block header is often OUTSIDE the diff: with git's default three lines
 * of context, removing a dependency from the middle of a long list shows no
 * `"dependencies": {` line at all. So an entry whose block cannot be seen is
 * still reported, flagged `block-unknown` — the conservative direction this
 * classifier takes everywhere else.
 *
 * @param {string} diffText
 * @returns {{name: string, block: string}[]}
 */
export function removedDependencyEntries(diffText) {
  const BLOCKS = new Set(["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]);
  const NON_DEPENDENCY_BLOCKS = new Set(["scripts", "prisma", "engines", "exports", "overrides", "resolutions"]);
  const removed = new Map();
  const added = new Set();
  let file = "";
  let block = "";
  for (const raw of String(diffText ?? "").split("\n")) {
    if (raw.startsWith("+++ ")) {
      file = raw.slice(4).replace(/^b\//, "");
      block = "";
      continue;
    }
    if (raw.startsWith("--- ") || raw.startsWith("diff ")) continue;
    if (raw.startsWith("@@")) {
      block = ""; // the hunk may start mid-list; the header is not in view
      continue;
    }
    if (file !== "package.json") continue;
    const changed = raw.startsWith("+") || raw.startsWith("-");
    const line = changed ? raw.slice(1) : raw;
    const header = line.match(/^\s*"([A-Za-z]+)"\s*:\s*\{/);
    if (header) {
      block = header[1];
      continue;
    }
    if (/^\s*}\s*,?\s*$/.test(line)) {
      block = "";
      continue;
    }
    if (!changed) continue;
    const entry = line.match(/^\s*"([^"]+)"\s*:\s*"[^"]*"\s*,?\s*$/);
    if (!entry) continue;
    if (block !== "" && !BLOCKS.has(block)) continue;
    if (NON_DEPENDENCY_BLOCKS.has(block)) continue;
    if (raw.startsWith("-")) removed.set(entry[1], block === "" ? "block-unknown" : block);
    else added.add(entry[1]);
  }
  return [...removed].filter(([name]) => !added.has(name)).map(([name, block]) => ({ name, block }));
}

/** Names only — the shape the classifier reports. */
export function removedDependencyNames(diffText) {
  return removedDependencyEntries(diffText).map((d) => d.name);
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
 * @param {{files?: {status: string, path: string, score?: number|null, fromPath?: string|null}[], diffText?: string}} input
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

  // hyg-01 / §13.1 clause 2: deleting is Tier C. The one exception is a PURE
  // rename — git reports it R100, meaning the content is byte-identical — which
  // stays Tier A. A rename that also edits the file (R087 and friends) is not
  // that exception: the old path is gone and its content changed, so it is
  // classified C like any other deletion. A rename with no score at all is
  // treated the same way, because "unknown" must not resolve to "safe".
  for (const f of files) {
    if (f.status === "D") raise("C", `${f.path} is deleted — §13.1 clause 2 puts a deletion in front of a human`);
    if (f.status === "R") {
      if (f.score === 100) continue; // pure rename, no content change
      raise(
        "C",
        `${f.path} is a rename with content changes (R${f.score ?? "??"}) — not the pure-rename exception`,
      );
    }
  }
  const droppedExports = removedExportedSymbols(diffText);
  if (droppedExports.length > 0) {
    raise("C", `removes exported symbol(s): ${droppedExports.join(", ")}`);
  }
  if (files.some((f) => f.path === "package.json")) {
    const droppedDeps = removedDependencyEntries(diffText);
    if (droppedDeps.length > 0) {
      const named = droppedDeps.map((d) => `${d.name} (${d.block})`).join(", ");
      raise("C", `removes package.json dependency line(s): ${named}`);
    }
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
    // 64 MiB: Node's 1 MiB default silently truncates a large staged diff to
    // "", and the content-based rules (removed exports, removed dependencies)
    // would then find nothing and classify a deletion Tier A.
    return execFileSync(cmd, args, { encoding: "utf8", cwd: REPO_ROOT, maxBuffer: 64 * 1024 * 1024 });
  } catch (err) {
    if (err && err.code === "ENOBUFS") {
      console.log("landing-tier: the staged diff exceeded the read buffer — the content rules cannot run");
      console.log("landing-tier: C");
      process.exit(0);
    }
    return "";
  }
}

// CLI only — not when the tests import the module.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const diffText = sh("git", ["diff", "--cached"]);
  // parseNameStatusWithScore, not loop-guard's parseNameStatus: the deletion
  // rule needs the rename similarity score parseNameStatus discards.
  const files = parseNameStatusWithScore(sh("git", ["diff", "--cached", "--name-status", "-M"]));
  const { tier, reasons } = await classifyLanding({ files, diffText });
  for (const r of reasons) console.log(`landing-tier: ${r}`);
  console.log(`landing-tier: ${tier}`);
}
