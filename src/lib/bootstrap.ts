// Idempotent bootstrap shared by the first-run /setup wizard, the core seed
// and the Docker entrypoint: everything a FRESH install needs to work — and
// nothing else. No demo users, no fake tickets, no sample rows. The optional
// showcase dataset lives in prisma/seed-demo.ts.

// Relative imports on purpose: prisma/seed-core.ts runs this through tsx,
// outside Next's "@/" alias resolution.
import fs from "fs";
import path from "path";
import { db } from "./db";
import { opsExecute } from "./opsdb";
import { parseProfileMarkdown, slugify } from "./agent-profile-format";
import { parseSkillMarkdown } from "./skill-format";

/** The system AI users the engine and drafter look up by aiKind. */
export async function ensureAiAgents(): Promise<void> {
  const agents = [
    { name: "Servo Triage", email: "triage@servo.ai", aiKind: "TRIAGE", color: "#0A6E66" },
    { name: "Servo Resolver", email: "resolver@servo.ai", aiKind: "RESOLVER", color: "#14625D" },
    { name: "Servo QA", email: "qa@servo.ai", aiKind: "QA", color: "#52514E" },
    // The timeline-comment author for auto-delivered replies (kb-14),
    // matching the agentName the drafter already uses.
    { name: "Servo Drafter", email: "drafter@servo.ai", aiKind: "DRAFT", color: "#4A3AA7" },
  ];
  for (const agent of agents) {
    await db.user.upsert({
      where: { email: agent.email },
      create: { ...agent, role: "AI_AGENT" },
      update: {},
    });
  }
}

/**
 * Create any agents/*.md specialist that is not in the database yet. Existing
 * rows are left untouched — admins may have edited prompts, tools or API-key
 * assignments from the UI, and a redeploy must never overwrite that.
 */
export async function syncAgentProfiles(): Promise<number> {
  const agentsDir = path.join(process.cwd(), "agents");
  if (!fs.existsSync(agentsDir)) return 0;
  let created = 0;
  for (const file of fs
    .readdirSync(agentsDir)
    .filter((f) => f.endsWith(".md"))
    .sort()) {
    const markdown = fs.readFileSync(path.join(agentsDir, file), "utf8");
    let parsed;
    try {
      parsed = parseProfileMarkdown(markdown);
    } catch {
      continue; // a malformed bundled profile must not block setup
    }
    const slug = slugify(parsed.name);
    const existing = await db.agentProfile.findUnique({ where: { slug } });
    if (existing) continue;
    await db.agentProfile.create({
      data: {
        slug,
        name: parsed.name,
        description: parsed.description,
        categories: JSON.stringify(parsed.categories),
        tools: JSON.stringify(parsed.tools),
        systemPrompt: parsed.systemPrompt,
        markdown,
      },
    });
    created++;
  }
  return created;
}

/**
 * Create any bundled skills/<slug>/SKILL.md that is not in the database yet.
 * Same contract as syncAgentProfiles(): existing rows are never touched, so an
 * upgrade adds new procedures without reverting the ones an admin has edited
 * or deliberately disabled.
 *
 * The directory name is the slug — that is what read_skill takes and what the
 * catalogue advertises, so it stays stable when the display name is reworded.
 */
export async function syncSkills(): Promise<number> {
  const skillsDir = path.join(process.cwd(), "skills");
  if (!fs.existsSync(skillsDir)) return 0;
  let created = 0;
  for (const entry of fs
    .readdirSync(skillsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name))) {
    const file = path.join(skillsDir, entry.name, "SKILL.md");
    if (!fs.existsSync(file)) continue;
    const markdown = fs.readFileSync(file, "utf8");
    let parsed;
    try {
      parsed = parseSkillMarkdown(markdown);
    } catch {
      continue; // a malformed bundled skill must not block setup
    }
    const slug = slugify(entry.name);
    const existing = await db.skill.findUnique({ where: { slug } });
    if (existing) continue;
    await db.skill.create({
      data: {
        slug,
        name: parsed.name,
        description: parsed.description,
        categories: JSON.stringify(parsed.categories),
        body: parsed.body,
        markdown,
      },
    });
    created++;
  }
  return created;
}

/**
 * The idempotent half of scripts/postgres-init.sql, re-applied on every boot.
 *
 * /docker-entrypoint-initdb.d runs that file ONLY on an empty data directory,
 * so an install that upgraded its volume has never seen it. The parts that
 * need no superuser — the three revokes inside the sandbox and the read role's
 * grants — are re-stated here so a hand-migrated install converges anyway.
 * Creating the database and the roles still needs the guide.
 *
 * Every branch is conditional and the whole block swallows
 * `insufficient_privilege`: an install whose ops URL is not the database
 * owner keeps whatever grants its DBA set, rather than failing to boot.
 */
const OPS_PRIVILEGES_SQL = `
DO $ops$
BEGIN
  EXECUTE format('REVOKE TEMPORARY ON DATABASE %I FROM PUBLIC', current_database());
  EXECUTE format('REVOKE CONNECT ON DATABASE %I FROM PUBLIC', current_database());
  EXECUTE 'REVOKE ALL ON SCHEMA public FROM PUBLIC';
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'servo_ops_ro') THEN
    EXECUTE format('GRANT CONNECT ON DATABASE %I TO servo_ops_ro', current_database());
    EXECUTE 'GRANT USAGE ON SCHEMA public TO servo_ops_ro';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO servo_ops_ro';
  END IF;
EXCEPTION WHEN insufficient_privilege THEN
  NULL;
END
$ops$;`;

/**
 * The read role's SELECT on the tables that already exist. Separate from the
 * block above because it has to run AFTER the table DDL, while the revokes
 * must run whether or not that DDL succeeds. ALTER DEFAULT PRIVILEGES covers
 * every table created after the first boot; this covers the rest.
 *
 * The role name is the literal from scripts/postgres-init.sql and is
 * load-bearing: an install that renamed its read role gets no grants from
 * here and has to grant them itself.
 */
const OPS_READ_GRANT_SQL = `
DO $ops$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'servo_ops_ro') THEN
    EXECUTE 'GRANT SELECT ON ALL TABLES IN SCHEMA public TO servo_ops_ro';
  END IF;
EXCEPTION WHEN insufficient_privilege THEN
  NULL;
END
$ops$;`;

/**
 * The sandbox "ops" database schema the database tools operate on. Fresh
 * installs get empty tables (the tools work, queries return no rows) —
 * `npm run demo` fills them with the showcase inventory.
 *
 * Portable DDL: `GENERATED BY DEFAULT AS IDENTITY`, which is the standard
 * spelling PostgreSQL takes — the old file-database keyword is gone.
 *
 * The sandbox is OPTIONAL, so an unconfigured or unreachable one is reported
 * and stepped over rather than thrown: this runs inside `npm run setup` and
 * inside the /setup wizard, and neither may be blocked from finishing a desk
 * because a fixture database is missing. The ops tools then say so per call.
 */
export async function ensureOpsSchema(): Promise<void> {
  // The privileges go FIRST and in their own step: a table that fails to
  // create must not be able to skip a revoke. They are also the half that
  // matters on an upgraded volume, where the tables already exist.
  await opsStep("privileges", [OPS_PRIVILEGES_SQL]);
  await opsStep("schema", [
    `CREATE TABLE IF NOT EXISTS devices (
      asset_tag TEXT PRIMARY KEY, model TEXT NOT NULL, type TEXT NOT NULL,
      assigned_to TEXT, status TEXT NOT NULL, os TEXT,
      purchased_at TEXT, warranty_until TEXT
    );`,
    `CREATE TABLE IF NOT EXISTS employees (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, name TEXT NOT NULL,
      email TEXT NOT NULL, department TEXT NOT NULL, title TEXT NOT NULL
    );`,
    `CREATE TABLE IF NOT EXISTS software_licenses (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, product TEXT NOT NULL,
      seats INTEGER NOT NULL, seats_used INTEGER NOT NULL,
      renewal_date TEXT NOT NULL, owner_email TEXT
    );`,
  ]);
  // Last, so the grant covers the tables just created.
  await opsStep("read grant", [OPS_READ_GRANT_SQL]);
}

/** One phase of the sandbox setup, reported and stepped over if it fails. */
async function opsStep(phase: string, statements: string[]): Promise<void> {
  try {
    for (const sql of statements) {
      await opsExecute(sql);
    }
  } catch (err) {
    console.warn(
      `[servo] ops sandbox not prepared (${phase}):`,
      err instanceof Error ? err.message : String(err),
    );
  }
}
