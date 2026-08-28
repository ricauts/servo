// Loop preflight guard — spec item loop-02, the executable form of the §0.8
// safety rails. The pure check* functions take plain strings (branch name,
// porcelain output, staged diff, DATABASE_URL, changed-file list) so tests
// need no real git state and no database; the CLI gathers the real inputs
// and exits 1 with a named reason per failed rail. Run at the top of every
// tick and again against the final staged diff before committing (§0.2
// steps 2 and 11).
//
//   node scripts/loop-guard.mjs            # full preflight
//   node scripts/loop-guard.mjs --db-push  # additionally apply rail 1b: the
//                                          # next command is a prisma db push,
//                                          # allowed only on servo_test_* dbs
//
// Node builtins only, per the loop-02 acceptance.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");

// §0.8 rail 3. Regex scanning is best-effort, not a guarantee — novel
// high-entropy formats will pass; the list is spec-fixed, not advisory.
//
// loop-guard:allowlist-start — the table below names the very secret
// prefixes it detects, so its own lines would trip rail 2. These are
// pattern definitions, not live credentials. The marker pair is greppable
// in review; hiding a real secret under it is a human-visible act.
export const SECRET_PATTERNS = [
  { name: "Anthropic API key (sk-ant-)", re: /sk-ant-/ },
  { name: "AWS access key id (AKIA…)", re: /AKIA[0-9A-Z]{16}/ },
  { name: "GitHub token (ghp_)", re: /ghp_/ },
  { name: "GitHub fine-grained token (github_pat_)", re: /github_pat_/ },
  { name: "private key block", re: /-----BEGIN .* PRIVATE KEY-----/ },
  { name: "sealed secret value (enc:v1:)", re: /enc:v1:/ },
];
// loop-guard:allowlist-end

/**
 * @typedef {object} GuardResult
 * @property {boolean} ok
 * @property {string} rail
 * @property {string} [note]    // present when ok
 * @property {string} [reason]  // present when !ok, names its rail
 */

/** @param {string} rail @param {string} note @returns {GuardResult} */
const ok = (rail, note) => ({ ok: true, rail, note });
// The reason names its rail so a CLI line (or a failing test) says which
// gate fell without reading the separate rail field.
/** @param {string} rail @param {string} reason @returns {GuardResult} */
const fail = (rail, reason) => ({ ok: false, rail, reason: `${rail}: ${reason}` });

/**
 * The database NAME, parsed — never the raw string. `file:./prisma/dev.db`
 * → "dev.db"; `postgresql://u:p@h:5432/servo?schema=public` → "servo".
 * A password containing "dev.db" must not trip rail 1, which is why the
 * name is parsed rather than matched against the raw URL.
 */
export function parseDatabaseName(databaseUrl) {
  if (typeof databaseUrl !== "string" || databaseUrl.trim() === "") return null;
  const url = databaseUrl.trim();
  if (url.startsWith("file:")) {
    const file = url.slice(5).split("?")[0].replace(/[\\/]+$/, "");
    return file.split(/[\\/]/).pop() || null;
  }
  try {
    const parsed = new URL(url);
    return parsed.pathname.replace(/^\/+/, "").split("/")[0] || null;
  } catch {
    return null;
  }
}

/** Rail 1: the loop never resolves DATABASE_URL to the dev or demo database. */
export function checkDatabase(databaseUrl) {
  const name = parseDatabaseName(databaseUrl);
  if (name === null) return ok("rail 1 (database)", "no DATABASE_URL set — nothing to resolve");
  const stem = name.toLowerCase().replace(/\.db$/, "");
  if (stem === "dev" || stem === "demo") {
    return fail(
      "rail 1 (database)",
      `DATABASE_URL resolves to the ${stem} database ("${name}") — the loop never touches it`,
    );
  }
  return ok("rail 1 (database)", `resolved database "${name}" is neither dev nor demo`);
}

/** Rail 1b: prisma db push runs only against a servo_test_* throwaway. */
export function checkDbPush(databaseUrl) {
  const name = parseDatabaseName(databaseUrl);
  if (name === null) {
    return fail("rail 1b (db push)", "no DATABASE_URL resolved — refusing to run prisma db push blind");
  }
  if (!name.startsWith("servo_test_")) {
    return fail(
      "rail 1b (db push)",
      `prisma db push is only allowed on servo_test_* databases; DATABASE_URL resolves to "${name}"`,
    );
  }
  return ok("rail 1b (db push)", `"${name}" is a servo_test_* throwaway`);
}

/**
 * Rail 2: no secret pattern in the staged diff, outside tests/ and fixtures
 * paths. Only ADDED lines are scanned: a removed line is a secret leaving
 * the repo, and matching it would make a cleanup commit impossible. A
 * `loop-guard:allowlist-start` … `loop-guard:allowlist-end` pair marks a
 * block whose lines name the patterns themselves (this file's own table).
 */
export function checkStagedDiff(diffText) {
  let file = "";
  let allowlisted = false;
  for (const line of String(diffText ?? "").split("\n")) {
    if (line.startsWith("+++ ")) {
      file = line.slice(4).replace(/^b\//, "");
      allowlisted = false; // markers never leak across files
      continue;
    }
    if (!line.startsWith("+")) continue; // context and removed lines never introduce a secret
    if (line.includes("loop-guard:allowlist-start")) {
      allowlisted = true;
      continue;
    }
    if (line.includes("loop-guard:allowlist-end")) {
      allowlisted = false;
      continue;
    }
    if (allowlisted) continue;
    if (/(^|\/)(tests|fixtures)\//.test(file)) continue;
    for (const { name, re } of SECRET_PATTERNS) {
      if (re.test(line)) {
        return fail("rail 2 (secrets)", `${name} matches the staged diff at ${file || "(unknown file)"}`);
      }
    }
  }
  return ok("rail 2 (secrets)", "no secret pattern in the staged diff");
}

/** Rail 3: a tick never runs on the default branch. */
export function checkBranch(branch) {
  if (branch === "main" || branch === "master") {
    return fail("rail 3 (branch)", `current branch is "${branch}" — the loop never works on the default branch`);
  }
  return ok("rail 3 (branch)", `branch "${branch}"`);
}

/**
 * Rail 4: no prisma/*.db* path in git status --porcelain. The SQLite files
 * still exist on the owner's machine until db-10 removes them, so this is
 * the secondary rail that keeps them out of a commit.
 */
export function checkPorcelain(porcelain) {
  for (const raw of String(porcelain ?? "").split("\n")) {
    const line = raw.trimEnd(); // NOT trim(): a leading space is the unstaged X slot
    if (line.length < 4) continue;
    let entry = line.slice(3).trim().replace(/^"|"$/g, ""); // path always starts at index 3 (XY + space); renames keep the final path
    if (entry.includes(" -> ")) entry = entry.split(" -> ").pop();
    if (/^prisma\/[^/]*\.db/.test(entry)) {
      return fail(
        "rail 4 (residue)",
        `"${entry}" appears in git status — prisma/*.db* files are never staged, committed or written`,
      );
    }
  }
  return ok("rail 4 (residue)", "no prisma/*.db* path in the working-tree status");
}

/**
 * Rail 5: a changed prisma/schema.prisma must ship with an added
 * prisma/migrations/ entry. Inert — reported as ok with a note — until the
 * migrations directory exists (db-01/db-02 create it); until then the repo
 * has no migration history to keep in sync. `changedFiles` entries are
 * { status, path } pairs from git diff --cached --name-status.
 */
export function checkMigrations(changedFiles, migrationsDirExists) {
  const files = Array.isArray(changedFiles) ? changedFiles : [];
  const schemaChanged = files.some((f) => f.path === "prisma/schema.prisma" && f.status !== "D");
  if (!schemaChanged) return ok("rail 5 (migrations)", "prisma/schema.prisma unchanged in the staged diff");
  if (!migrationsDirExists) {
    return ok(
      "rail 5 (migrations)",
      "inert: prisma/migrations/ does not exist yet — the rail activates when db-01/db-02 create it",
    );
  }
  const added = files.some(
    (f) => f.path.startsWith("prisma/migrations/") && (f.status === "A" || f.status === "R"),
  );
  if (!added) {
    return fail(
      "rail 5 (migrations)",
      "prisma/schema.prisma changed with no added prisma/migrations/ entry — write or regenerate the migration",
    );
  }
  return ok("rail 5 (migrations)", "schema change carries a migration");
}

/** Parse `git diff --cached --name-status` into { status, path } pairs. */
export function parseNameStatus(text) {
  const out = [];
  for (const raw of String(text ?? "").split("\n")) {
    const line = raw.trim();
    if (line === "") continue;
    const fields = line.split("\t");
    if (fields.length < 2) continue;
    out.push({ status: fields[0].replace(/[0-9]+$/, ""), path: fields[fields.length - 1] });
  }
  return out;
}

/**
 * All rails over one input bundle. Pure — the CLI only supplies real values.
 * dbPushIntent applies rail 1b, for the moment just before a prisma db push.
 */
export function runGuard(inputs, { dbPushIntent = false } = {}) {
  const results = [
    checkDatabase(inputs.databaseUrl),
    checkBranch(inputs.branch),
    checkPorcelain(inputs.porcelain),
    checkStagedDiff(inputs.stagedDiff),
    checkMigrations(inputs.changedFiles ?? [], Boolean(inputs.migrationsDirExists)),
  ];
  if (dbPushIntent) results.push(checkDbPush(inputs.databaseUrl));
  return results;
}

function sh(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", cwd: REPO_ROOT });
  } catch {
    return "";
  }
}

function main() {
  const inputs = {
    databaseUrl: process.env.DATABASE_URL ?? "",
    branch: sh("git", ["rev-parse", "--abbrev-ref", "HEAD"]).trim(),
    porcelain: sh("git", ["status", "--porcelain"]),
    stagedDiff: sh("git", ["diff", "--cached"]),
    changedFiles: parseNameStatus(sh("git", ["diff", "--cached", "--name-status"])),
    migrationsDirExists: existsSync(path.join(REPO_ROOT, "prisma", "migrations")),
  };
  const results = runGuard(inputs, { dbPushIntent: process.argv.includes("--db-push") });
  const failed = results.filter((r) => !r.ok);
  for (const r of failed) console.error(`loop-guard: ${r.reason}`);
  if (failed.length > 0) process.exit(1);
  console.log(`loop-guard: all rails pass (branch ${inputs.branch || "?"})`);
}

// CLI only — not when the tests import the module.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
