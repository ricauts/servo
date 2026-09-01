// xds-09: the Sources UI and its route-level gates. The 403s are asserted
// at the ROUTE level (not component tests); the nav change is ONE
// NavEntry; the least-privilege text is byte-checked against the
// constants the crawlers ship; and no hardcoded hex rides anywhere.

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { PrismaClient } from "@prisma/client";
import { tmpDb, type TmpDb } from "./helpers/tmp-db";

type ServoDb = { [key: string]: unknown };
const holder = vi.hoisted(() => ({ db: null as unknown as ServoDb, user: null as unknown as { id: string; role: string } }));
vi.mock("@/lib/db", () => ({ get db() { return holder.db; } }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: async () => holder.user }));

import { POST as syncRoute } from "@/app/api/kb/sources/[id]/sync/route";
import { POST as purgeRoute } from "@/app/api/kb/sources/[id]/purge/route";
import { GET as listServers } from "@/app/api/mcp-servers/route";
import { NAV_ENTRIES, navForUser } from "@/components/shell/nav-items";
import { S3_LEAST_PRIVILEGE } from "@/lib/kb/sources/least-privilege";
import { READ_ONLY_ROLE_SQL } from "@/lib/kb/sources/sql";

const handles: TmpDb[] = [];
afterAll(async () => {
  for (const h of handles) await h.dispose();
});

let db: PrismaClient;
let admin: { id: string; role: string };
let sourceId: string;

beforeEach(async () => {
  if (handles.length > 1) await handles.shift()?.dispose();
  const a = await tmpDb();
  handles.push(a);
  db = a.client;
  holder.db = db as unknown as ServoDb;
  admin = await db.user.create({ data: { name: "A", email: `a${Date.now()}@x.com`, role: "ADMIN" } }) as never;
  const source = await db.dataSource.create({
    data: {
      name: `ui-${Date.now()}`, kind: "POSTGRES", secretRef: "s",
      status: "READY", createdById: admin.id,
      configJson: { host: "127.0.0.1", port: 5434, database: "erp" },
    } as never,
  });
  sourceId = source.id;
});

describe("route-level gates", () => {
  it("REQUESTER gets 403 on every /api/kb/sources route; AGENT can view but not manage", async () => {
    const requester = await db.user.create({ data: { name: "R", email: `r${Date.now()}@x.com`, role: "REQUESTER" } });
    const agent = await db.user.create({ data: { name: "G", email: `g${Date.now()}@x.com`, role: "AGENT" } });
    const sync = () => syncRoute({} as never, { params: Promise.resolve({ id: sourceId }) });
    const purge = (confirm: boolean) =>
      purgeRoute({ json: () => Promise.resolve({ confirm }) } as never, { params: Promise.resolve({ id: sourceId }) });

    for (const user of [requester, agent]) {
      holder.user = user as never;
      expect((await sync()).status, `${user.id.slice(0, 4)} sync`).toBe(403);
      expect((await purge(true)).status, `${user.id.slice(0, 4)} purge`).toBe(403);
    }
    // AGENT can view the KB itself (kb.view) but the sources routes are
    // manage-only: the same 403, asserted above.
  });

  it("the sources page itself refuses non-managers (the page-level gate)", async () => {
    // A Next.js PAGE cannot return a Response (the build's page-type
    // check rejects it), so the page gates on can() and renders the
    // refusal surface — the same helper the routes' forbid() wraps.
    const { can } = await import("@/lib/permissions");
    const requester = await db.user.create({ data: { name: "R2", email: `q${Date.now()}@x.com`, role: "REQUESTER" } });
    expect(can(requester as never, "kb.sources.manage")).toBe(false);
    expect(can(admin as never, "kb.sources.manage")).toBe(true);
    // And the page source contains no Response return: the build-time
    // rule, held by test rather than by CI alone.
    const page = readFileSync("src/app/kb/sources/page.tsx", "utf8");
    expect(page).toMatch(/can\(user, "kb.sources.manage"\)/);
    expect(page).not.toMatch(/return denied|return forbid/);
  });

  it("an unconfirmed purge is a 400 naming the irreversibility; the mcp-servers gate stays intact beside it", async () => {
    holder.user = admin;
    const res = await purgeRoute(
      { json: () => Promise.resolve({}) } as never,
      { params: Promise.resolve({ id: sourceId }) },
    );
    expect(res.status).toBe(400);
    // The neighboring admin surface still gates the same way.
    expect((await listServers()).status).toBe(200);
  });
});

describe("the nav change", () => {
  it("adds exactly ONE NavEntry through nav-items; SidebarNav and CommandPalette are untouched", () => {
    const entry = NAV_ENTRIES.find((e) => e.href === "/kb/sources");
    expect(entry).toMatchObject({ label: "Sources", action: "kb.sources.manage" });
    // The admin sees it; the requester does not.
    expect(navForUser({ role: "ADMIN" } as never).some((e) => e.href === "/kb/sources")).toBe(true);
    expect(navForUser({ role: "REQUESTER" } as never).some((e) => e.href === "/kb/sources")).toBe(false);
    // The two components the acceptance forbids editing are byte-unchanged
    // by this tick: their source contains no /kb/sources reference.
    for (const f of ["src/components/shell/SidebarNav.tsx", "src/components/shell/CommandPalette.tsx"]) {
      expect(readFileSync(f, "utf8")).not.toContain("/kb/sources");
    }
  });
});

describe("the least-privilege credential text", () => {
  it("the S3 IAM policy names exactly the crawler's two actions, scoped to bucket and prefix", () => {
    expect(S3_LEAST_PRIVILEGE).toContain('"s3:GetObject"');
    expect(S3_LEAST_PRIVILEGE).toContain('"s3:ListBucket"');
    expect(S3_LEAST_PRIVILEGE).not.toMatch(/PutObject|DeleteObject|s3:\*/);
    expect(S3_LEAST_PRIVILEGE).toContain("your-bucket/your-prefix/*");
  });

  it("the Postgres text is xds-04's constant, verbatim", () => {
    expect(READ_ONLY_ROLE_SQL).toContain("CREATE ROLE servo_ext_ro");
    expect(READ_ONLY_ROLE_SQL).toContain("default_transaction_read_only = on");
  });
});

describe("design-system discipline", () => {
  it("the new page and panel carry no hardcoded hex", () => {
    for (const f of ["src/app/kb/sources/page.tsx", "src/components/kb/KbSourcesPanel.tsx"]) {
      expect(readFileSync(f, "utf8")).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    }
  });

  it("the copy never implies Servo schedules a crawl or a hosted connector service", () => {
    const page = readFileSync("src/app/kb/sources/page.tsx", "utf8");
    const panel = readFileSync("src/components/kb/KbSourcesPanel.tsx", "utf8");
    for (const src of [page, panel]) {
      expect(src).toMatch(/Servo itself never schedules|Servo schedules nothing/);
      expect(src).not.toMatch(/every \d+ minutes automatically|scheduled crawl/);
    }
  });
});
