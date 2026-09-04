// kb-lib-5: Packs — the curated catalog, its install-state merge, the local
// bundle view over syncPlugins()'s rows, and the rails docs/design/
// marketplace.md fixes: no forbidden copy, no install affordance on a
// planned entry, admin-only promotion through the routes that own the rows.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { tmpDb, type TmpDb } from "./helpers/tmp-db";

type ServoDb = { [key: string]: unknown };
const holder = vi.hoisted(() => ({
  db: null as unknown as ServoDb,
  user: null as unknown as { id: string; role: string },
}));
vi.mock("@/lib/db", () => ({ get db() { return holder.db; } }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: async () => holder.user }));

import { CATALOG, CATEGORY_LABEL, FORBIDDEN_COPY } from "@/lib/packs/catalog";
import { packsState } from "@/lib/packs/state";
import { GET as getPacks } from "@/app/api/packs/route";
import { syncPlugins } from "@/lib/bootstrap";
import { NAV_ENTRIES, navForUser } from "@/components/shell/nav-items";
import { can } from "@/lib/permissions";

describe("the catalog (kb-lib-5)", () => {
  it("has unique ids, a known category and at least one tag per entry", () => {
    const ids = new Set(CATALOG.map((e) => e.id));
    expect(ids.size).toBe(CATALOG.length);
    for (const e of CATALOG) {
      expect(Object.keys(CATEGORY_LABEL)).toContain(e.category);
      expect(e.tags.length).toBeGreaterThan(0);
    }
  });

  it("a planned entry has no install affordance; an available one points somewhere in this app", () => {
    for (const e of CATALOG) {
      if (e.status === "planned") expect(e.href).toBeUndefined();
      else expect(e.href?.startsWith("/")).toBe(true);
    }
  });

  it("carries none of the forbidden copy, in the catalog or on the page", () => {
    const text = JSON.stringify(CATALOG);
    for (const re of FORBIDDEN_COPY) expect(text).not.toMatch(re);
    for (const file of ["src/components/packs/PacksBrowser.tsx", "src/app/packs/page.tsx", "docs/packs.md"]) {
      const src = readFileSync(file, "utf8");
      expect(src.toLowerCase()).not.toContain("marketplace");
      expect(src).not.toMatch(/\bhosted\b/i);
    }
  });

  it("names the data types the graph facet knows", () => {
    const s3 = CATALOG.find((e) => e.id === "source-s3");
    const pg = CATALOG.find((e) => e.id === "source-postgres");
    expect(s3?.dataTypes).toEqual(["S3"]);
    expect(pg?.dataTypes).toEqual(["POSTGRES"]);
  });
});

describe("nav and permissions (kb-lib-5)", () => {
  it("adds /packs behind packs.view, admins manage", () => {
    const entry = NAV_ENTRIES.find((e) => e.href === "/packs");
    expect(entry?.action).toBe("packs.view");
    expect(navForUser({ role: "AGENT" } as never).some((e) => e.href === "/packs")).toBe(true);
    expect(navForUser({ role: "REQUESTER" } as never).some((e) => e.href === "/packs")).toBe(false);
    expect(can({ role: "ADMIN" } as never, "packs.manage")).toBe(true);
    expect(can({ role: "AGENT" } as never, "packs.manage")).toBe(false);
    expect(can({ role: "REQUESTER" } as never, "packs.view")).toBe(false);
  });
});

describe("state and bundles against the database (kb-lib-5)", () => {
  let handle: TmpDb;
  let db: PrismaClient;

  beforeEach(async () => {
    handle = await tmpDb();
    db = handle.client;
    holder.db = db as unknown as ServoDb;
    const admin = await db.user.create({ data: { name: "A", email: `a-${Date.now()}@x.com`, role: "ADMIN" } });
    holder.user = { id: admin.id, role: "ADMIN" };
  });
  afterAll(async () => {
    await handle?.dispose();
  });

  it("a fresh install: built-in extraction configured, connectors available, planned entries planned", async () => {
    const { packs, bundles } = await packsState();
    const byId = new Map(packs.map((p) => [p.id, p]));
    expect(byId.get("extract-baseline")?.state).toBe("configured");
    expect(byId.get("source-s3")?.state).toBe("available");
    expect(byId.get("source-azure-blob")?.state).toBe("planned");
    expect(byId.get("model-provider")?.state).toBe("available");
    expect(bundles).toEqual([]);
  });

  it("a configured source and an enrichment switch flip their cards", async () => {
    const admin = holder.user;
    await db.dataSource.create({
      data: { name: "erp", kind: "POSTGRES", secretRef: "s", status: "READY", createdById: admin.id, configJson: { host: "127.0.0.1", port: 5434, database: "erp" } },
    });
    await db.setting.create({ data: { key: "kb.enrich.enabled", value: "true" } });
    const { packs } = await packsState();
    const byId = new Map(packs.map((p) => [p.id, p]));
    expect(byId.get("source-postgres")).toMatchObject({ state: "configured", detail: "1 source" });
    expect(byId.get("model-enrichment")?.state).toBe("configured");
  });

  it("a synced plugin appears as one bundle with its disabled items", async () => {
    await syncPlugins(join(process.cwd(), "tests", "fixtures", "plugins"));
    const res = await getPacks();
    expect(res.status).toBe(200);
    const body = await res.json();
    const bundle = body.bundles.find((b: { name: string }) => b.name === "fixture-demo");
    expect(bundle).toBeDefined();
    expect(bundle.enabledCount).toBe(0);
    const kinds = bundle.items.map((i: { kind: string }) => i.kind).sort();
    expect(kinds).toEqual(["profile", "server", "skill"]);
    for (const item of bundle.items) expect(item.enabled).toBe(false);
  });

  it("refuses a requester", async () => {
    const r = await db.user.create({ data: { name: "R", email: `r-${Date.now()}@x.com`, role: "REQUESTER" } });
    holder.user = { id: r.id, role: "REQUESTER" };
    expect((await getPacks()).status).toBe(403);
  });
});
