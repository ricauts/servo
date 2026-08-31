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
 * syncPlugins() (cnp-06) — THE installation system for
 * plugins/<dir>/.claude-plugin/plugin.json. There is no second installer —
 * no pack-install model, no marketplace-source model, no marketplace
 * manifest, no tools manifest, no pack-id column anywhere in the tree —
 * the loader, the Skill/AgentProfile/McpServer tables and the cnp-02
 * policy sync are the whole surface, and tests/plugin-loader.test.ts
 * greps this commit's tree with the exact banned tokens to prove it.
 *
 * Everything a plugin ships arrives DISABLED — Skill.enabled=false,
 * AgentProfile.enabled=false, McpServer.enabled=false — and every tool
 * policy a plugin server ever derives carries the Ruling-6 triple at sync
 * time (cnp-02). An admin promotes plugin content deliberately; nothing
 * activates by being installed.
 *
 * Create-only, exactly like syncSkills() and syncAgentProfiles(): existing
 * rows are never touched, so an admin's edit or enablement survives every
 * re-run. Plugin content is namespaced <plugin>--<slug> so two plugins
 * cannot collide and plugin content cannot shadow a bundled slug.
 */
export async function syncPlugins(pluginsDir?: string): Promise<{
  plugins: number;
  skills: number;
  profiles: number;
  servers: number;
  skipped: string[];
}> {
  const root = pluginsDir ?? path.join(process.cwd(), "plugins");
  if (!fs.existsSync(root)) return { plugins: 0, skills: 0, profiles: 0, servers: 0, skipped: [] };
  const stats = { plugins: 0, skills: 0, profiles: 0, servers: 0, skipped: [] as string[] };

  for (const entry of fs
    .readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name))) {
    const manifestPath = path.join(root, entry.name, ".claude-plugin", "plugin.json");
    if (!fs.existsSync(manifestPath)) continue;
    let manifest: { name?: unknown; version?: unknown; description?: unknown };
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    } catch {
      stats.skipped.push(`${entry.name}: unparseable plugin.json`);
      continue;
    }
    const pluginName = typeof manifest.name === "string" ? manifest.name.trim() : "";
    // kebab-case, required — a plugin that cannot name itself cannot be
    // installed, but it must not block boot either.
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(pluginName)) {
      stats.skipped.push(`${entry.name}: plugin.json name is required and kebab-case`);
      continue;
    }
    const origin = `plugin:${pluginName}`;
    stats.plugins++;

    // skills/ — lenient parse: a malformed SKILL.md is skipped, not fatal.
    const skillsDir = path.join(root, entry.name, "skills");
    if (fs.existsSync(skillsDir)) {
      for (const skillDir of fs
        .readdirSync(skillsDir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .sort((a, b) => a.name.localeCompare(b.name))) {
        const file = path.join(skillsDir, skillDir.name, "SKILL.md");
        if (!fs.existsSync(file)) continue;
        const markdown = fs.readFileSync(file, "utf8");
        let parsed;
        try {
          parsed = parseSkillMarkdown(markdown);
        } catch {
          stats.skipped.push(`${pluginName}/${skillDir.name}: malformed SKILL.md`);
          continue;
        }
        const slug = `${pluginName}--${slugify(skillDir.name)}`;
        if (await db.skill.findUnique({ where: { slug } })) continue;
        await db.skill.create({
          data: {
            slug,
            name: parsed.name,
            description: parsed.description,
            categories: JSON.stringify(parsed.categories),
            body: parsed.body,
            markdown,
            enabled: false,
            origin,
          },
        });
        stats.skills++;
      }
    }

    // agents/ — the agent-profile format; malformed is skipped, not fatal.
    const agentsDir = path.join(root, entry.name, "agents");
    if (fs.existsSync(agentsDir)) {
      for (const agentDir of fs
        .readdirSync(agentsDir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .sort((a, b) => a.name.localeCompare(b.name))) {
        const file = path.join(agentsDir, agentDir.name, "profile.md");
        if (!fs.existsSync(file)) continue;
        let parsed;
        try {
          parsed = parseProfileMarkdown(fs.readFileSync(file, "utf8"));
        } catch {
          stats.skipped.push(`${pluginName}/${agentDir.name}: malformed profile.md`);
          continue;
        }
        const slug = `${pluginName}--${slugify(agentDir.name)}`;
        if (await db.agentProfile.findUnique({ where: { slug } })) continue;
        await db.agentProfile.create({
          data: {
            slug,
            name: parsed.name,
            description: parsed.description,
            systemPrompt: parsed.systemPrompt,
            markdown: fs.readFileSync(file, "utf8"),
            tools: JSON.stringify(parsed.tools),
            categories: JSON.stringify(parsed.categories),
            enabled: false,
            origin,
          },
        });
        stats.profiles++;
      }
    }

    // .mcp.json — loaded, and the servers arrive DISABLED through the
    // cnp-02 model; enabling one is an admin action, and the first tools/
    // list sync writes every derived tool's Ruling-6 policy.
    const mcpPath = path.join(root, entry.name, ".mcp.json");
    if (fs.existsSync(mcpPath)) {
      let mcp: { mcpServers?: Record<string, { url?: unknown; headers?: unknown }> };
      try {
        mcp = JSON.parse(fs.readFileSync(mcpPath, "utf8"));
      } catch {
        stats.skipped.push(`${pluginName}: unparseable .mcp.json`);
        continue;
      }
      for (const [serverName, config] of Object.entries(mcp.mcpServers ?? {})) {
        const url = typeof config?.url === "string" ? config.url : "";
        if (!url) {
          stats.skipped.push(`${pluginName}/${serverName}: .mcp.json server carries no url`);
          continue;
        }
        const slug = `${pluginName}--${slugify(serverName)}`;
        if (await db.mcpServer.findUnique({ where: { slug } })) continue;
        await db.mcpServer.create({
          data: {
            slug,
            name: serverName,
            url,
            headers: JSON.stringify(config?.headers ?? {}),
            enabled: false,
          },
        });
        stats.servers++;
      }
    }
  }
  return stats;
}

/**
 * The sandbox "ops" database schema the database tools operate on. Fresh
 * installs get empty tables (the tools work, queries return no rows) —
 * `npm run demo` fills them with the showcase inventory.
 */
export async function ensureOpsSchema(): Promise<void> {
  // Portable DDL (db-05): IDENTITY columns, no AUTOINCREMENT, no pragmas.
  // CREATE TABLE IF NOT EXISTS keeps it idempotent for upgraded volumes
  // that never ran postgres-init.sql; the grants below are the same ones
  // the init file sets, re-applied because tables created later inherit
  // nothing without the ALTER DEFAULT PRIVILEGES the init file installs.
  const statements = [
    `CREATE TABLE IF NOT EXISTS devices (
      asset_tag TEXT PRIMARY KEY, model TEXT NOT NULL, type TEXT NOT NULL,
      assigned_to TEXT, status TEXT NOT NULL, os TEXT,
      purchased_at TEXT, warranty_until TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS employees (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      name TEXT NOT NULL, email TEXT NOT NULL,
      department TEXT NOT NULL, title TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS employees_backup (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      name TEXT NOT NULL, email TEXT NOT NULL,
      department TEXT NOT NULL, title TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS software_licenses (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      product TEXT NOT NULL, seats INTEGER NOT NULL,
      seats_used INTEGER NOT NULL, renewal_date TEXT NOT NULL, owner_email TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS campaign_tracking (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      campaign TEXT NOT NULL, channel TEXT NOT NULL,
      sent_at TEXT NOT NULL, responses INTEGER NOT NULL DEFAULT 0
    )`,
    `GRANT SELECT ON devices, employees, employees_backup, software_licenses, campaign_tracking TO servo_ops_ro`,
    `GRANT SELECT, INSERT, UPDATE, DELETE ON devices, employees, employees_backup, software_licenses, campaign_tracking TO servo_ops_rw`,
  ];
  for (const sql of statements) {
    try {
      await opsExecute(sql);
    } catch (err) {
      // The GRANTs need roles a dev checkout without postgres-init.sql
      // may not have; their failure is loud but must not block boot. The
      // TABLE statements themselves are not optional.
      if (!/servo_ops_(ro|rw)/.test(sql)) throw err;
    }
  }
}
