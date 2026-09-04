// kb-lib-2: opt-in model enrichment — the prompt, the parser, the settings
// precedence, the filing rules against a real (throwaway) database with a
// scripted provider, and the PATCH route that files a document by hand.

import { readFileSync } from "node:fs";
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

import {
  buildPrompt,
  enrichDocument,
  getEnrichSettings,
  parseEnrichment,
  sampleText,
  KB_ENRICH_SETTING_KEYS,
  MAX_TOPICS,
} from "@/lib/kb/enrich";
import { PATCH } from "@/app/api/kb/documents/[id]/route";
import type { ChatProvider } from "@/lib/ai/provider";

describe("parseEnrichment (kb-lib-2)", () => {
  it("reads a clean object", () => {
    const e = parseEnrichment(
      '{"language":"es","summary":"Planeación de la Fase 0.","topics":["Infraestructura de datos","WITS"],"collection":{"name":"Ingeniería","isNew":true}}',
    );
    expect(e).toEqual({
      language: "es",
      summary: "Planeación de la Fase 0.",
      topics: ["Infraestructura de datos", "WITS"],
      collection: { name: "Ingeniería", isNew: true },
    });
  });

  it("tolerates a code fence and prose around the object", () => {
    const e = parseEnrichment('Sure! ```json\n{"summary":"x","topics":["a"],"collection":null}\n```');
    expect(e?.summary).toBe("x");
    expect(e?.collection).toBeNull();
  });

  it("refuses non-objects and empty answers", () => {
    expect(parseEnrichment("[1,2]")).toBeNull();
    expect(parseEnrichment("no json here")).toBeNull();
    expect(parseEnrichment('{"topics":[],"summary":""}')).toBeNull();
  });

  it("caps, dedupes and squeezes", () => {
    const topics = Array.from({ length: 20 }, (_, i) => `  topic   ${i % 10}  `);
    const e = parseEnrichment(JSON.stringify({ summary: "s".repeat(2000), topics, collection: { name: "  A  B ", isNew: "yes" } }));
    expect(e?.topics.length).toBe(Math.min(10, MAX_TOPICS));
    expect(e?.topics[0]).toBe("topic 0");
    expect(e?.summary.length).toBeLessThanOrEqual(600);
    expect(e?.collection).toEqual({ name: "A B", isNew: false });
  });
});

describe("buildPrompt / sampleText (kb-lib-2)", () => {
  it("names the existing shelves and asks for JSON only", () => {
    const p = buildPrompt({ name: "a.pdf", contentType: "application/pdf", existingCollections: ["IT", "HR"], text: "body" });
    expect(p.user).toContain("- IT");
    expect(p.user).toContain("- HR");
    expect(p.system).toMatch(/ONE JSON object/);
    expect(p.system).toMatch(/own language/);
  });

  it("samples head, middle and tail under the budget", () => {
    const chunks = Array.from({ length: 100 }, (_, i) => `chunk-${i} ` + "x".repeat(400));
    const s = sampleText(chunks, 3000);
    expect(s.length).toBeLessThanOrEqual(3000 + 20);
    expect(s.startsWith("chunk-0")).toBe(true);
    expect(s).toContain("[…]");
    expect(s.endsWith("x")).toBe(true);
  });
});

describe("enrichment against the database (kb-lib-2)", () => {
  let handle: TmpDb;
  let db: PrismaClient;
  let owner: { id: string; role: string };

  beforeEach(async () => {
    handle = await tmpDb();
    db = handle.client;
    holder.db = db as unknown as ServoDb;
    const u = await db.user.create({ data: { email: `o-${Date.now()}@x.test`, name: "Owner", role: "ADMIN" } });
    owner = { id: u.id, role: "ADMIN" };
    holder.user = owner;
  });
  afterAll(async () => {
    await handle?.dispose();
  });

  async function doc(name: string, over: Record<string, unknown> = {}) {
    const d = await db.document.create({
      data: {
        name,
        contentType: "text/plain",
        byteSize: 10,
        sha256: `sha-${name}-${Math.random()}`,
        data: Buffer.from("x"),
        ownerId: owner.id,
        textStatus: "EXTRACTED",
        ...over,
      },
    });
    await db.documentChunk.create({ data: { documentId: d.id, index: 0, text: "Runbook for the nightly backup job.", locator: { lines: "1-1" } } });
    return d;
  }

  const scripted = (answer: string): ChatProvider => ({
    async complete() {
      return { text: answer, toolCalls: [] };
    },
  });

  it("settings: off by default, env wins over the row", async () => {
    expect(await getEnrichSettings(db as never, {})).toEqual({ enabled: false, autoFile: true });
    await db.setting.create({ data: { key: KB_ENRICH_SETTING_KEYS.enabled, value: "true" } });
    expect((await getEnrichSettings(db as never, {})).enabled).toBe(true);
    expect((await getEnrichSettings(db as never, { KB_ENRICH_ENABLED: "false" })).enabled).toBe(false);
  });

  it("writes topics and summary, files on a NEW shelf, and is idempotent", async () => {
    const d = await doc("backup.txt");
    const provider = scripted('{"language":"en","summary":"Nightly backup runbook.","topics":["Backups","Runbooks"],"collection":{"name":"Operations","isNew":true}}');
    const first = await enrichDocument(d.id, { provider, settings: { enabled: true, autoFile: true } });
    expect(first.status).toBe("enriched");
    if (first.status !== "enriched") return;
    expect(first.collection).toBe("Operations");
    expect(first.created).toBe(true);

    const row = await db.document.findUniqueOrThrow({ where: { id: d.id }, include: { collection: true } });
    expect(row.topics).toEqual(["Backups", "Runbooks"]);
    expect(row.aiSummary).toBe("Nightly backup runbook.");
    expect(row.enrichedAt).not.toBeNull();
    expect(row.collection?.name).toBe("Operations");
    // The deterministic summary is untouched.
    expect(row.summary).toBe("");

    const again = await enrichDocument(d.id, { provider, settings: { enabled: true, autoFile: true } });
    expect(again.status).toBe("skipped");
  });

  it("reuses an EXISTING shelf case-insensitively and never moves a filed document", async () => {
    const ops = await db.collection.create({ data: { name: "Operations" } });
    const hr = await db.collection.create({ data: { name: "HR" } });
    const unfiled = await doc("a.txt");
    const filed = await doc("b.txt", { collectionId: hr.id });
    const provider = scripted('{"summary":"s","topics":["t"],"collection":{"name":"operations","isNew":true}}');

    const r1 = await enrichDocument(unfiled.id, { provider, settings: { enabled: true, autoFile: true } });
    expect(r1.status === "enriched" && r1.created).toBe(false);
    expect((await db.document.findUniqueOrThrow({ where: { id: unfiled.id } })).collectionId).toBe(ops.id);

    const r2 = await enrichDocument(filed.id, { provider, settings: { enabled: true, autoFile: true } });
    expect(r2.status).toBe("enriched");
    expect((await db.document.findUniqueOrThrow({ where: { id: filed.id } })).collectionId).toBe(hr.id);
    expect(await db.collection.count()).toBe(2);
  });

  it("auto-file off: topics land, the shelf does not", async () => {
    const d = await doc("c.txt");
    const provider = scripted('{"summary":"s","topics":["t"],"collection":{"name":"New Shelf","isNew":true}}');
    await enrichDocument(d.id, { provider, settings: { enabled: true, autoFile: false } });
    const row = await db.document.findUniqueOrThrow({ where: { id: d.id } });
    expect(row.topics).toEqual(["t"]);
    expect(row.collectionId).toBeNull();
    expect(await db.collection.count()).toBe(0);
  });

  it("a bad answer records nothing", async () => {
    const d = await doc("d.txt");
    const r = await enrichDocument(d.id, { provider: scripted("I cannot help with that."), settings: { enabled: true, autoFile: true } });
    expect(r.status).toBe("failed");
    const row = await db.document.findUniqueOrThrow({ where: { id: d.id } });
    expect(row.enrichedAt).toBeNull();
    expect(row.topics).toEqual([]);
  });

  it("PATCH files a document and sets visibility; a stranger gets 403", async () => {
    const d = await doc("e.txt");
    const shelf = await db.collection.create({ data: { name: "Shelf" } });
    const req = (body: unknown) =>
      new Request(`http://x/api/kb/documents/${d.id}`, { method: "PATCH", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
    const ctx = { params: Promise.resolve({ id: d.id }) };

    const ok = await PATCH(req({ collectionId: shelf.id, visibility: "STAFF" }) as never, ctx);
    expect(ok.status).toBe(200);
    const row = await db.document.findUniqueOrThrow({ where: { id: d.id } });
    expect(row.collectionId).toBe(shelf.id);
    expect(row.visibility).toBe("STAFF");

    const off = await PATCH(req({ collectionId: null }) as never, ctx);
    expect(off.status).toBe(200);
    expect((await db.document.findUniqueOrThrow({ where: { id: d.id } })).collectionId).toBeNull();

    expect((await PATCH(req({ collectionId: "nope" }) as never, ctx)).status).toBe(400);
    expect((await PATCH(req({}) as never, ctx)).status).toBe(400);

    const stranger = await db.user.create({ data: { email: `s-${Date.now()}@x.test`, name: "S", role: "AGENT" } });
    holder.user = { id: stranger.id, role: "AGENT" };
    expect((await PATCH(req({ visibility: "PUBLIC" }) as never, ctx)).status).toBe(403);
  });
});

describe("kb-lib-2 markup and wiring", () => {
  it("the admin panel carries the switch with the egress sentence beside it, and ingest hooks enrichment last", () => {
    const panel = readFileSync("src/components/kb/KbAdminPanel.tsx", "utf8");
    expect(panel).toMatch(/AI enrichment \(optional\)/);
    expect(panel).toMatch(/sends document CONTENT outside this/);
    expect(panel).toMatch(/kbEnrichEnabled/);
    const ingest = readFileSync("src/lib/kb/ingest.ts", "utf8");
    expect(ingest).toMatch(/rebuildEdgesFor\(document\.documentId\)[\s\S]*enrichAfterIngest\(document\.documentId\)/);
    const migration = readFileSync("prisma/migrations/0014_kb_enrichment/migration.sql", "utf8");
    for (const col of ["topics", "aiSummary", "enrichModel", "enrichedAt"]) expect(migration).toContain(`"${col}"`);
  });
});
