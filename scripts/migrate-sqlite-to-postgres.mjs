// One-shot import for existing installs: copies a legacy SQLite database
// (pre-dbt-01 Servo, `prisma/servo.db` on the servo-data volume) into the
// PostgreSQL database, preserving cuid ids and every timestamp, in FK
// dependency order. Node builtins plus @prisma/client only — no pg driver,
// no dumping tools, no network.
//
//   node scripts/migrate-sqlite-to-postgres.mjs --sqlite /data/servo.db \
//        [--target postgresql://…] [--force]
//
// Sealed values (enc:v1: …) are copied VERBATIM. This script deliberately
// never imports src/lib/secret-store: the sealed blob is opaque here and is
// only ever opened by the app, under SERVO_ENCRYPTION_KEY, after the
// migration — which is exactly why the key must survive the move (see
// docs/migrating-to-postgres.md).
//
// The ops sandbox (ops.db) is NOT migrated: it is disposable fixture data
// for the agent's sandboxed SQL tools, recreated by the container entrypoint.

import { DatabaseSync } from "node:sqlite";
import { PrismaClient } from "@prisma/client";

/** Every table a pre-Postgres Servo database had, in FK dependency order —
 *  parents strictly before children. The knowledge-base tables are absent
 *  because they post-date the SQLite era; a table missing from the source
 *  file is simply skipped. */
export const LEGACY_TABLES = [
  "Setting",
  "SlaPolicy",
  "ToolPolicy",
  "User",
  "AiCredential",
  "Group",
  "GroupMember",
  "AgentProfile",
  "Ticket",
  "Skill",
  "Comment",
  "AgentRun",
  "AgentStep",
  "Approval",
  "ReplyDraft",
  "Attachment",
  "AiUsage",
  "Webhook",
  "WebhookDelivery",
  "CustomTool",
  "McpCall",
];

/** Postgres BOOLEAN columns need real booleans; SQLite stored 0/1 under a
 *  BOOLEAN declared type. DATETIME columns (whatever the underlying
 *  storage) become Date objects, which Prisma binds correctly. */
function convertValue(declaredType, value) {
  if (value === null || value === undefined) return null;
  const type = String(declaredType).toUpperCase();
  if (type === "BOOLEAN") return value === 1 || value === true || value === "1";
  if (type.includes("DATETIME") || type.includes("TIMESTAMP")) {
    return value instanceof Date ? value : new Date(value);
  }
  if (type.includes("BLOB")) return Buffer.from(value);
  return value;
}

/**
 * Run the import. `force` wipes the legacy tables on the target (in REVERSE
 * FK order) before copying; without it, a target holding even one legacy
 * row is refused — a half-migrated database must never be silently mixed.
 * Returns the per-table comparison the CLI prints.
 */
export async function migrateSqliteToPostgres({ sqlitePath, target, force = false }) {
  const sqlite = new DatabaseSync(sqlitePath, { readOnly: true });
  // The importer is a single-threaded copier; a small connection budget
  // keeps it a polite citizen when it runs beside a busy server.
  const limited =
    target.includes("connection_limit")
      ? target
      : target + (target.includes("?") ? "&" : "?") + "connection_limit=3";
  const prisma = new PrismaClient({ datasourceUrl: limited });

  try {
    // Legacy databases predate column changes: a column nullable then may
    // be NOT NULL with a default now (User.color is the case in point).
    // Where the source holds NULL and the target could not accept it, the
    // row asks for the target's own DEFAULT rather than failing the copy.
    const targetColumns = async (table) => {
      const rows = await prisma.$queryRawUnsafe(
        `SELECT column_name, is_nullable, column_default, data_type
         FROM information_schema.columns WHERE table_name = $1`,
        table,
      );
      const map = new Map();
      for (const r of rows) map.set(r.column_name, r);
      return map;
    };

    const sourceTables = new Set(
      sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        .all()
        .map((r) => r.name),
    );
    const tables = LEGACY_TABLES.filter((t) => sourceTables.has(t));

    // Completeness both ways: every source table must be one we know — an
    // unknown table means this script predates a schema change and MUST NOT
    // claim a complete migration.
    const unknown = [...sourceTables].filter((t) => !LEGACY_TABLES.includes(t));
    if (unknown.length > 0) {
      throw new Error(
        `Source holds table(s) this importer does not know: ${unknown.join(", ")}. ` +
          "The migration script is older than the source database — do not trust a partial copy.",
      );
    }

    if (!force) {
      const counts = await Promise.all(
        tables.map(async (t) => [t, await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM "${t}"`)]),
      );
      const nonEmpty = counts.filter(([, [row]]) => row.n > 0).map(([t]) => t);
      if (nonEmpty.length > 0) {
        throw new Error(
          `Target already holds rows in ${nonEmpty.join(", ")} — refusing to mix into a used database. ` +
            "Pass --force to wipe those tables first.",
        );
      }
    } else {
      for (const t of [...tables].reverse()) {
        await prisma.$executeRawUnsafe(`DELETE FROM "${t}"`);
      }
    }

    const copied = [];
    for (const table of tables) {
      const columns = sqlite.prepare(`PRAGMA table_info("${table}")`).all();
      const colNames = columns.map((c) => c.name);
      const colTypes = columns.map((c) => c.type);
      const pgColumns = await targetColumns(table);
      const rows = sqlite.prepare(`SELECT * FROM "${table}"`).all();

      for (let start = 0; start < rows.length; start += 100) {
        const chunk = rows.slice(start, start + 100);
        const values = [];
        const tuples = chunk.map((row) => {
          const placeholders = colNames.map((name, i) => {
            const value = convertValue(colTypes[i], row[name]);
            const pg = pgColumns.get(name);
            if (value === null && pg && pg.is_nullable === "NO" && pg.column_default !== null) {
              return "DEFAULT"; // legacy NULL into a column that grew a default
            }
            values.push(value);
            // JSON lived as TEXT in SQLite; jsonb needs the cast on the bind.
            if (pg && (pg.data_type === "jsonb" || pg.data_type === "json")) {
              return `$${values.length}::jsonb`;
            }
            return `$${values.length}`;
          });
          return `(${placeholders.join(", ")})`;
        });
        await prisma.$executeRawUnsafe(
          `INSERT INTO "${table}" (${colNames.map((c) => `"${c}"`).join(", ")}) VALUES ${tuples.join(", ")}`,
          ...values,
        );
      }

      const [pgCount] = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM "${table}"`);
      copied.push({ table, sqlite: rows.length, pg: pgCount.n, ok: rows.length === pgCount.n });
    }

    // Ticket numbers now come from the sequence (db-03): push it past
    // everything just imported, or the first new create collides.
    let setvalTo = null;
    if (tables.includes("Ticket")) {
      const [row] = await prisma.$queryRawUnsafe(
        'SELECT setval(\'ticket_number_seq\', (SELECT COALESCE(MAX("number"), 1000) FROM "Ticket")) AS n',
      );
      setvalTo = Number(row.n);
    }

    return { copied, setvalTo };
  } finally {
    sqlite.close();
    await prisma.$disconnect();
  }
}

// ─── CLI ──────────────────────────────────────────────────────────────────
function cli() {
  const args = process.argv.slice(2);
  const flag = (name) => {
    const i = args.indexOf(`--${name}`);
    return i !== -1 ? args[i + 1] : undefined;
  };
  const sqlitePath = flag("sqlite");
  const target = flag("target") ?? process.env.DATABASE_URL;
  if (!sqlitePath || !target) {
    console.error("usage: node scripts/migrate-sqlite-to-postgres.mjs --sqlite <path> [--target <url>] [--force]");
    process.exit(2);
  }
  migrateSqliteToPostgres({ sqlitePath, target, force: args.includes("--force") })
    .then(({ copied, setvalTo }) => {
      console.log("table                       sqlite   postgres   match");
      for (const c of copied) {
        console.log(
          `${c.table.padEnd(26)} ${String(c.sqlite).padStart(6)} ${String(c.pg).padStart(10)}   ${c.ok ? "✓" : "MISMATCH"}`,
        );
      }
      if (setvalTo !== null) console.log(`ticket_number_seq set to ${setvalTo}`);
      if (copied.some((c) => !c.ok)) process.exit(1);
    })
    .catch((err) => {
      console.error(`migrate: ${err.message}`);
      process.exit(1);
    });
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href) {
  cli();
}
