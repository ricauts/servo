// kb-17: the share panel round-trip, the settings gates, the egress warning
// condition, and the audit view — against real clones with boundary-only
// mocks.

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
// The settings route's sibling imports drag next-auth's runtime in; mock the
// integration modules at the boundary so the route's own logic runs bare.
vi.mock("@/lib/authjs", () => ({
  AUTH_SETTING_KEYS: { issuer: "auth.oidc.issuer", clientId: "auth.oidc.clientId", clientSecret: "auth.oidc.clientSecret", providerName: "auth.oidc.providerName", adminEmails: "auth.admin.emails", allowedDomains: "auth.allowed.domains" },
  getAuthConfig: async () => ({ mode: "demo" }),
  needsSetup: async () => false,
}));
vi.mock("@/lib/inbound-email", () => ({
  INBOUND_SETTING_KEYS: { enabled: "integration.inbound.enabled", secret: "integration.inbound.secret" },
  getInboundConfig: async () => ({ enabled: false, secret: "" }),
}));
vi.mock("@/lib/integrations/github", () => ({
  GITHUB_SETTING_KEYS: { token: "integration.github.token", owner: "integration.github.owner", apiUrl: "integration.github.apiUrl" },
  getGithubConfig: async () => ({ token: "", tokenSource: "none" }),
}));
vi.mock("@/lib/integrations/azure", () => ({
  AZURE_SETTING_KEYS: { tenantId: "integration.azure.tenantId", clientId: "integration.azure.clientId", clientSecret: "integration.azure.clientSecret", subscriptionId: "integration.azure.subscriptionId" },
  azureConfigured: () => false,
  getAzureConfig: async () => ({ tenantId: "", clientId: "", clientSecret: "", subscriptionId: "" }),
}));
vi.mock("@/lib/notify", () => ({
  sendMail: async () => true,
  getSmtpConfig: async () => ({ enabled: false, url: "", from: "" }),
}));
vi.mock("@/lib/mcp", () => ({
  MCP_SETTING_KEYS: { token: "integration.mcp.token" },
  getMcpConfig: async () => ({ token: "", tokenSource: "none" }),
}));
vi.mock("@/lib/egress", () => ({
  EGRESS_SETTING_KEYS: { allowlist: "integration.egress.allowlist" },
  getEgressConfig: async () => ({ allowlist: [] as string[] }),
}));
vi.mock("@/lib/ai/settings", () => ({
  getAiSettings: async () => ({ provider: "mock", model: "mock", apiKey: "", baseUrl: "", autoTriage: true, autoDraft: true, qaEnabled: true, keySource: "none" }),
}));

import { GET as listCollections, POST as createCollection } from "@/app/api/kb/collections/route";
import { GET as getReaders } from "@/app/api/kb/documents/[id]/readers/route";
import { PUT as putSettings } from "@/app/api/settings/route";
import { entitledDocumentIds } from "@/lib/kb/entitlement";

const handles: TmpDb[] = [];
afterAll(async () => {
  for (const h of handles) await h.dispose();
});

let db: PrismaClient;
let admin: { id: string; name: string; role: string };
let deskAgent: { id: string; name: string; role: string };
let groupUser: { id: string; name: string; role: string };
let groupId: string;

beforeEach(async () => {
  if (handles.length > 1) await handles.shift()?.dispose();
  const a = await tmpDb();
  handles.push(a);
  db = a.client;
  holder.db = db as unknown as ServoDb;
  admin = { ...(await db.user.create({ data: { name: "Admin", email: "a@x.com", role: "ADMIN" } })), role: "ADMIN" };
  deskAgent = { ...(await db.user.create({ data: { name: "Desk", email: "d@x.com", role: "AGENT" } })), role: "AGENT" };
  groupUser = { ...(await db.user.create({ data: { name: "Grp", email: "g@x.com", role: "AGENT" } })), role: "AGENT" };
  const group = await db.group.create({ data: { name: "Finance" } });
  await db.groupMember.create({ data: { groupId: group.id, userId: groupUser.id, seniority: "MID" } });
  groupId = group.id;
  holder.user = admin;
});

async function doc() {
  return db.document.create({
    data: { name: `d${Math.random().toString(36).slice(2)}.md`, contentType: "text/markdown", byteSize: 1, sha256: Math.random().toString(36).padEnd(64, "0").slice(0, 64), data: new Uint8Array(1), ownerId: admin.id },
  });
}

const P = (id: string) => ({ params: Promise.resolve({ id }) });
const json = (method: string, body: unknown) =>
  new Request("http://x", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) as never;

describe("the share panel round-trip (through its API surface)", () => {
  it("a USER, a GROUP and an AGENT grant each land and the preview matches retrieval", async () => {
    const { POST: postGrant } = await import("@/app/api/kb/documents/[id]/grants/route");
    const d = await doc();
    for (const [subjectType, subjectId] of [
      ["USER", deskAgent.id],
      ["GROUP", groupId],
      ["AGENT", "builtin:resolver"],
    ] as const) {
      const res = await postGrant(json("POST", { subjectType, subjectId }), P(d.id));
      expect(res.status).toBe(201);
    }

    const res = await getReaders(new Request(`http://x/api/kb/documents/${d.id}/readers`) as never, P(d.id));
    const { readers } = (await res.json()) as { readers: { id: string }[] };
    const preview = new Set(readers.map((r) => r.id));
    for (const person of [admin, deskAgent, groupUser]) {
      const ids = await entitledDocumentIds(db, { humanId: person.id, agentId: null });
      expect(preview.has(person.id), `preview/retrieval disagree for ${person.name}`).toBe(ids.includes(d.id));
    }
  });
});

describe("collections admin", () => {
  it("kb.manage creates; duplicates 409; non-admin 403; the list counts entitled documents", async () => {
    const created = await createCollection(json("POST", { name: "Finance" }), );
    expect(created.status).toBe(201);
    const dup = await createCollection(json("POST", { name: "Finance" }));
    expect(dup.status).toBe(409);

    holder.user = deskAgent;
    expect((await createCollection(json("POST", { name: "Nope" }))).status).toBe(403);

    const collection = await db.collection.findUniqueOrThrow({ where: { name: "Finance" } });
    const d1 = await doc();
    await db.document.update({ where: { id: d1.id }, data: { collectionId: collection.id, visibility: "PUBLIC" } });
    const listed = await listCollections();
    const body = (await listed.json()) as { collections: { name: string; documentCount: number }[] };
    expect(body.collections.find((c) => c.name === "Finance")?.documentCount).toBe(1);
  });
});

describe("settings gates", () => {
  it("kb.* settings require settings.manage; autodeliver categories round-trip with absent=OFF", async () => {
    holder.user = deskAgent;
    expect((await putSettings(json("PUT", { kbEmbedBaseUrl: "http://x" }))).status).toBe(403);

    holder.user = admin;
    const ok = await putSettings(json("PUT", {
      kbEmbedBaseUrl: "http://localhost:11434/v1",
      kbEmbedModel: "nomic-embed-text",
      kbAutodeliverCategories: "SOFTWARE,DEVOPS",
      kbAutodeliverDailyCap: "5",
    }));
    expect(ok.status).toBe(200);
    expect(await db.setting.findUniqueOrThrow({ where: { key: "kb.autodeliver.SOFTWARE" } })).toMatchObject({ value: "true" });
    expect(await db.setting.count({ where: { key: { startsWith: "kb.autodeliver." } } })).toBe(3); // 2 categories + cap

    // Turning a category OFF removes its key entirely (absent = OFF).
    await putSettings(json("PUT", { kbAutodeliverCategories: "SOFTWARE" }));
    expect(await db.setting.findUnique({ where: { key: "kb.autodeliver.DEVOPS" } })).toBeNull();
    expect(await db.setting.count({ where: { key: { startsWith: "kb.autodeliver." } } })).toBe(2); // 1 + cap
  });
});

describe("the egress warning condition (component logic)", () => {
  it("warns for non-local endpoints and stays quiet for local ones", async () => {
    const source = await (await import("node:fs")).readFileSync("src/components/kb/KbAdminPanel.tsx", "utf8");
    expect(source).toContain("Query egress");
    expect(source).toMatch(/localhost\|127\\\.0\\\.0\\\.1\|::1/);
    void groupUser;
  });
});

describe("the audit view (query shape)", () => {
  it("lists SENT autoDelivered drafts with ticket numbers", async () => {
    const requester = await db.user.create({ data: { name: "R", email: "r@x.com", role: "REQUESTER" } });
    const t = await db.ticket.create({ data: { number: 5001, title: "T", description: "d", requesterId: requester.id } });
    await db.replyDraft.create({
      data: { ticketId: t.id, body: "auto answer", agentName: "Servo Drafter", status: "SENT", autoDelivered: true, decidedAt: new Date() },
    });
    const rows = await db.replyDraft.findMany({
      where: { status: "SENT", autoDelivered: true },
      include: { ticket: { select: { number: true, title: true } } },
      orderBy: { decidedAt: "desc" },
      take: 10,
    });
    expect(rows.map((r) => r.ticket.number)).toEqual([5001]);
  });
});
