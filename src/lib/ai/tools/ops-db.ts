// Ops database & asset inventory tools: read-only SQL, gated mutating SQL,
// and device lookups against the sandboxed ops database.

import { opsExecute, opsSelect } from "@/lib/opsdb";
import { jsonSafe } from "@/lib/utils";
import { errorMessage, RESULT_LIMIT, str, type ToolDef } from "./types";

/** Returns the statement if it is exactly one SQL statement, else null. */
function singleStatement(sql: string): string | null {
  const trimmed = sql.trim();
  if (!trimmed) return null;
  const body = trimmed.endsWith(";") ? trimmed.slice(0, -1) : trimmed;
  // Ignore semicolons inside quoted literals; only structural ones between
  // statements should reject.
  const stripped = body.replace(/'(?:[^']|'')*'|"(?:[^"]|"")*"/g, "");
  if (stripped.includes(";")) return null;
  return trimmed;
}

// Courtesy pre-check for the read-only tool so the model gets an actionable
// error message. Real enforcement is server-side in opsdb.ts: the read-only
// transaction every statement runs inside, plus the SELECT-only role when
// OPS_DATABASE_READONLY_URL names one.
// `pragma` left the list with SQLite — it is not a PostgreSQL keyword.
const MUTATING_KEYWORD =
  /\b(insert|update|delete|drop|alter|create|replace|attach|detach|vacuum|reindex)\b/i;

function looksMutating(sql: string): boolean {
  const withoutLiterals = sql.replace(/'(?:[^']|'')*'|"(?:[^"]|"")*"/g, "");
  return MUTATING_KEYWORD.test(withoutLiterals);
}

export const opsDbTools: Record<string, ToolDef> = {
  query_ops_database: {
    name: "query_ops_database",
    description:
      "Run read-only SQL (a single SELECT or WITH statement) against the connected ops database (tables: devices, employees, employees_backup, software_licenses, campaign_tracking).",
    inputSchema: {
      type: "object",
      properties: {
        sql: { type: "string", description: "A single read-only SELECT (or WITH) statement." },
      },
      required: ["sql"],
    },
    async execute(input) {
      const sql = singleStatement(str(input.sql));
      if (!sql) return "Error: expected exactly one SQL statement.";
      if (!/^\s*(select|with)\b/i.test(sql) || looksMutating(sql)) {
        return "Error: only read-only SELECT/WITH queries are allowed here. Use execute_ops_sql for mutations.";
      }
      try {
        const rows = await opsSelect(sql);
        const out = jsonSafe(rows);
        return out.length > RESULT_LIMIT ? `${out.slice(0, RESULT_LIMIT)}… (truncated)` : out;
      } catch (err) {
        return errorMessage(err);
      }
    },
  },

  execute_ops_sql: {
    name: "execute_ops_sql",
    description:
      "Run a single mutating SQL statement (CREATE/ALTER/INSERT/UPDATE/DELETE/DROP) against the connected ops database.",
    inputSchema: {
      type: "object",
      properties: {
        sql: { type: "string", description: "A single mutating SQL statement." },
      },
      required: ["sql"],
    },
    async execute(input) {
      const sql = singleStatement(str(input.sql));
      if (!sql) return "Error: expected exactly one SQL statement.";
      try {
        const affected = await opsExecute(sql);
        return `Statement executed. ${affected} rows affected.`;
      } catch (err) {
        return `SQL error: ${errorMessage(err)}`;
      }
    },
  },

  get_device_info: {
    name: "get_device_info",
    description: "Look up a device in the asset inventory by its asset tag (e.g. LT-2043).",
    inputSchema: {
      type: "object",
      properties: {
        assetTag: { type: "string", description: "The asset tag, e.g. LT-2043." },
      },
      required: ["assetTag"],
    },
    async execute(input) {
      const assetTag = str(input.assetTag).trim();
      if (!assetTag) return "Error: assetTag is required.";
      try {
        // Bound as $1, never interpolated: the asset tag arrives from model
        // output, so quote-doubling was the only thing standing between a
        // crafted tag and the rest of the sandbox.
        const rows = await opsSelect("SELECT * FROM devices WHERE asset_tag = $1", [assetTag]);
        if (rows.length === 0) return `No device found with asset tag ${assetTag}.`;
        return jsonSafe(rows[0]);
      } catch (err) {
        return errorMessage(err);
      }
    },
  },
};
