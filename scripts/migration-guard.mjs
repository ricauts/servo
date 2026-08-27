// Tier classifier for a Prisma migration's SQL — spec item loop-03, the
// §0.6 Tier B "additive schema" proof. Additive means the SQL only CREATES:
// CREATE TABLE, CREATE INDEX, CREATE EXTENSION, CREATE TYPE, and ADD COLUMN
// that is nullable or carries a default. Anything else — DROP, ALTER COLUMN,
// RENAME, ADD COLUMN NOT NULL without default, a unique index on a table the
// migration did not itself create, INSERT/UPDATE/DELETE, GRANT, functions,
// triggers — is destructive: it risks data or mutates pre-existing objects,
// and lands Tier C (an owner PR). Pure text analysis; no database, no
// network; Node builtins only.
//
//   node scripts/migration-guard.mjs <file.sql>   # prints additive|destructive

/** Split SQL into statements on semicolons, with `--` line comments stripped. */
export function splitStatements(sql) {
  return String(sql ?? "")
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Normalize a possibly-quoted, possibly-schema-qualified SQL identifier. */
function normIdent(name) {
  return String(name ?? "")
    .replace(/"/g, "")
    .split(".")
    .pop()
    .toLowerCase();
}

const CREATE_TABLE_RE = /^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(["\w.]+)/i;
const CREATE_INDEX_RE =
  /^CREATE\s+(UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?[\w"]+\s+(?:USING\s+\w+\s+)?ON\s+(["\w.]+)/i;
const ALTER_ADD_COLUMN_RE = /^ALTER\s+TABLE\s+(?:ONLY\s+)?(["\w.]+)\s+ADD\s+(COLUMN\s+)?(.*)$/is;

/**
 * @typedef {object} MigrationVerdict
 * @property {"additive"|"destructive"} verdict
 * @property {string[]} reasons   // one per destructive statement, named
 */

/**
 * Classify migration SQL as additive or destructive per §0.6 Tier B. A unique
 * index is additive only on a table this same migration creates — on a
 * pre-existing table it can reject rows that already exist.
 * @param {string} sql
 * @returns {MigrationVerdict}
 */
export function classifyMigration(sql) {
  const reasons = [];
  const createdTables = new Set();
  const statements = splitStatements(sql);

  // First pass: tables created here. Indexes on them — unique or not — are
  // additive; a UNIQUE index on anything else is a Tier-C statement.
  for (const s of statements) {
    const m = s.match(CREATE_TABLE_RE);
    if (m) createdTables.add(normIdent(m[1]));
  }

  for (const s of statements) {
    const head = s.slice(0, 72).replace(/\s+/g, " ").trim();
    if (CREATE_TABLE_RE.test(s)) continue;
    if (/^CREATE\s+(?:UNIQUE\s+)?INDEX\b/i.test(s)) {
      const m = s.match(CREATE_INDEX_RE);
      const isUnique = /^CREATE\s+UNIQUE\s+INDEX\b/i.test(s);
      const table = m ? normIdent(m[2]) : "(unknown)";
      if (isUnique && !createdTables.has(table)) {
        reasons.push(`unique index on pre-existing table "${table}": ${head}`);
      }
      continue;
    }
    if (/^CREATE\s+EXTENSION\b/i.test(s)) continue;
    if (/^CREATE\s+TYPE\b/i.test(s)) continue;

    const alter = s.match(ALTER_ADD_COLUMN_RE);
    if (alter && alter[2]) {
      const clause = alter[3] ?? "";
      if (/NOT\s+NULL/i.test(clause) && !/\bDEFAULT\b/i.test(clause)) {
        reasons.push(`ADD COLUMN NOT NULL without DEFAULT on "${normIdent(alter[1])}": ${head}`);
      }
      continue; // nullable or defaulted ADD COLUMN is additive
    }

    if (/^DROP\b/i.test(s)) reasons.push(`DROP statement: ${head}`);
    else if (/\bRENAME\b/i.test(s)) reasons.push(`RENAME: ${head}`);
    else if (/^ALTER\b/i.test(s)) reasons.push(`ALTER (not a plain ADD COLUMN): ${head}`);
    else reasons.push(`non-additive statement: ${head}`);
  }
  return { verdict: reasons.length === 0 ? "additive" : "destructive", reasons };
}

import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";

// CLI only — not when the tests import the module.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.argv[2];
  if (!file) {
    console.error("usage: node scripts/migration-guard.mjs <migration.sql>");
    process.exit(2);
  }
  const { verdict, reasons } = classifyMigration(readFileSync(file, "utf8"));
  for (const r of reasons) console.error(`migration-guard: ${r}`);
  console.log(`migration-guard: ${verdict}`);
  process.exit(verdict === "additive" ? 0 : 1);
}
