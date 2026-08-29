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
    // The catalog's system agent (cat-01): profiling runs and the eventual
    // router act under this identity. No human is ever the ownerId of a
    // kind='CATALOG' Document — asserted by tests/catalog-schema.test.ts.
    { name: "Servo Catalog", email: "catalog@servo.ai", aiKind: "CATALOG", color: "#2F44C9" },
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
 * The sandbox "ops" database schema the database tools operate on. Fresh
 * installs get empty tables (the tools work, queries return no rows) —
 * `npm run demo` fills them with the showcase inventory.
 */
export async function ensureOpsSchema(): Promise<void> {
  const statements = [
    `CREATE TABLE IF NOT EXISTS devices (
      asset_tag TEXT PRIMARY KEY, model TEXT NOT NULL, type TEXT NOT NULL,
      assigned_to TEXT, status TEXT NOT NULL, os TEXT,
      purchased_at TEXT, warranty_until TEXT
    );`,
    `CREATE TABLE IF NOT EXISTS employees (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL,
      department TEXT NOT NULL, title TEXT NOT NULL
    );`,
    `CREATE TABLE IF NOT EXISTS software_licenses (
      id INTEGER PRIMARY KEY, product TEXT NOT NULL, seats INTEGER NOT NULL,
      seats_used INTEGER NOT NULL, renewal_date TEXT NOT NULL, owner_email TEXT
    );`,
  ];
  for (const sql of statements) {
    await opsExecute(sql);
  }
}
