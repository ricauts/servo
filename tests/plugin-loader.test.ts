// cnp-06: the plugin loader — THE installation system. Everything runs on
// a tmpDb() with the fixture plugin's .mcp.json pointed at a local fixture
// MCP server's real port (the loader only stores the row; nothing dials
// it). No external network.

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { tmpDb, type TmpDb } from "./helpers/tmp-db";

type ServoDb = { [key: string]: unknown };
const holder = vi.hoisted(() => ({ db: null as unknown as ServoDb }));
vi.mock("@/lib/db", () => ({ get db() { return holder.db; } }));

import { syncPlugins } from "@/lib/bootstrap";
import { startMcpFixture, type McpFixture } from "./setup/mcp-fixture-server";

const handles: TmpDb[] = [];
afterAll(async () => {
  for (const h of handles) await h.dispose();
  await fixture?.close();
  rmSync(tmpRoot, { recursive: true, force: true });
});

let fixture: McpFixture | null = null;
let tmpRoot: string;
let db: PrismaClient;

beforeEach(async () => {
  if (handles.length > 1) await handles.shift()?.dispose();
  const handle = await tmpDb();
  handles.push(handle);
  db = handle.client;
  holder.db = db as unknown as ServoDb;
  if (!fixture) fixture = await startMcpFixture([]);

  // A private plugins root carrying the fixture plugin, with .mcp.json
  // pointed at the LIVE fixture server's port — proving the row carries a
  // real, locally-resolvable sidecar URL without anything dialing it.
  tmpRoot = mkdtempSync(join(tmpdir(), "plugins-"));
  cpSync("tests/fixtures/plugins/fixture-demo", join(tmpRoot, "fixture-demo"), { recursive: true });
  writeFileSync(
    join(tmpRoot, "fixture-demo", ".mcp.json"),
    JSON.stringify({ mcpServers: { "fixture-echo": { url: `${fixture.url}` } } }),
  );
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("the one installation system", () => {
  it("the absent names are absent: no second installer exists anywhere in the tree", () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`],
      );
    const offenders: string[] = [];
    for (const base of ["src", "prisma", "scripts"]) {
      if (!existsSync(base)) continue;
      for (const f of walk(base)) {
        if (!/\.(ts|tsx|mjs|cjs|json|prisma|sql)$/.test(f)) continue;
        const text = readFileSync(f, "utf8");
        for (const banned of ["PackInstall", "MarketplaceSource", "marketplace.json", "originPackId"]) {
          if (text.includes(banned)) offenders.push(`${f}: ${banned}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("loads all three component types end to end, everything DISABLED, provenance recorded", async () => {
    const stats = await syncPlugins(tmpRoot);
    expect(stats).toMatchObject({ plugins: 1, skills: 1, profiles: 1, servers: 1, skipped: [] });

    const skill = await db.skill.findUniqueOrThrow({ where: { slug: "fixture-demo--greet" } });
    expect(skill.enabled).toBe(false);
    expect(skill.origin).toBe("plugin:fixture-demo");
    expect(skill.body).toContain("Greet the requester warmly");

    const profile = await db.agentProfile.findUniqueOrThrow({ where: { slug: "fixture-demo--tier-one" } });
    expect(profile.enabled).toBe(false);
    expect(profile.origin).toBe("plugin:fixture-demo");
    expect(JSON.parse(profile.tools)).toEqual(["search_tickets"]);

    const server = await db.mcpServer.findUniqueOrThrow({ where: { slug: "fixture-demo--fixture-echo" } });
    expect(server.enabled).toBe(false);
    expect(server.url).toBe(fixture!.url);

    // THE assertion: NO plugin-origin row is enabled after sync.
    const enabledSkills = await db.skill.count({ where: { origin: { startsWith: "plugin:" }, enabled: true } });
    const enabledProfiles = await db.agentProfile.count({ where: { origin: { startsWith: "plugin:" }, enabled: true } });
    const enabledServers = await db.mcpServer.count({ where: { enabled: true } });
    expect([enabledSkills, enabledProfiles, enabledServers]).toEqual([0, 0, 0]);
  });

  it("create-only: re-running after an admin edits or enables a plugin skill NEVER reverts it", async () => {
    await syncPlugins(tmpRoot);
    await db.skill.update({
      where: { slug: "fixture-demo--greet" },
      data: { enabled: true, description: "edited by an admin" },
    });
    const again = await syncPlugins(tmpRoot);
    expect(again.skills).toBe(0); // nothing re-created
    const skill = await db.skill.findUniqueOrThrow({ where: { slug: "fixture-demo--greet" } });
    expect(skill.enabled).toBe(true);
    expect(skill.description).toBe("edited by an admin");
  });

  it("a malformed plugin.json is skipped without blocking boot, named in the report", async () => {
    const { mkdirSync } = await import("node:fs");
    mkdirSync(join(tmpRoot, "broken", ".claude-plugin"), { recursive: true });
    writeFileSync(join(tmpRoot, "broken", ".claude-plugin", "plugin.json"), "{ not json");
    mkdirSync(join(tmpRoot, "noname", ".claude-plugin"), { recursive: true });
    writeFileSync(join(tmpRoot, "noname", ".claude-plugin", "plugin.json"), JSON.stringify({ name: "Not Kebab" }));
    mkdirSync(join(tmpRoot, "silent"), { recursive: true }); // no manifest: not a plugin at all

    const stats = await syncPlugins(tmpRoot);
    expect(stats.plugins).toBe(1); // only the healthy fixture
    expect(stats.skipped.join("\n")).toMatch(/broken: unparseable plugin\.json/);
    expect(stats.skipped.join("\n")).toMatch(/noname: plugin\.json name is required and kebab-case/);
    expect(stats.skipped.join("\n")).not.toMatch(/silent/);
  });

  it("a malformed SKILL.md inside a healthy plugin is skipped, the plugin still lands", async () => {
    const { mkdirSync } = await import("node:fs");
    mkdirSync(join(tmpRoot, "fixture-demo", "skills", "busted"), { recursive: true });
    writeFileSync(
      join(tmpRoot, "fixture-demo", "skills", "busted", "SKILL.md"),
      "---\nname: [unclosed\ndescription: broken yaml\n---\nBody.\n",
    );
    const stats = await syncPlugins(tmpRoot);
    expect(stats.plugins).toBe(1);
    expect(stats.skills).toBe(1); // greet landed; busted skipped
    expect(stats.skipped.join("\n")).toMatch(/fixture-demo\/busted: malformed SKILL\.md/);
  });

  it("an empty root and a missing root are both quiet no-ops", async () => {
    expect(await syncPlugins(join(tmpRoot, "does-not-exist"))).toMatchObject({ plugins: 0 });
    const { mkdirSync } = await import("node:fs");
    mkdirSync(join(tmpRoot, "empty-root"), { recursive: true });
    expect(await syncPlugins(join(tmpRoot, "empty-root"))).toMatchObject({ plugins: 0, skipped: [] });
  });
});
