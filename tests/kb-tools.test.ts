// kb-11: the knowledge-base tools — the mock-provider resolver run calling
// search_knowledge with citations, cursor pagination, the no-existence-oracle
// rule, MCP denial by name, and ensureToolPolicies backfilling the rows.

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { tmpDb, type TmpDb } from "./helpers/tmp-db";

type ServoDb = { [key: string]: unknown };
const holder = vi.hoisted(() => ({ db: null as unknown as ServoDb }));
vi.mock("@/lib/db", () => ({ get db() { return holder.db; } }));

import { kbTools } from "@/lib/ai/tools/kb";
import { getMcpTools, mcpToolWithholdReason } from "@/lib/mcp";
import { ensureToolPolicies } from "@/lib/ai/custom-tools";
import { ingestDocument } from "@/lib/kb/ingest";

const handles: TmpDb[] = [];
afterAll(async () => {
  for (const h of handles) await h.dispose();
});

let db: PrismaClient;
let admin: { id: string; role: string };
let requester: { id: string; role: string };

beforeEach(async () => {
  if (handles.length > 2) await handles.shift()?.dispose();
  const a = await tmpDb();
  handles.push(a);
  db = a.client;
  holder.db = db as unknown as ServoDb;
  admin = await db.user.create({ data: { name: "A", email: "a@x.com", role: "ADMIN" } });
  requester = await db.user.create({ data: { name: "R", email: "r@x.com", role: "REQUESTER" } });
});

const ctx = (agentId = "builtin:resolver", humanId: string | null) => ({
  ticketId: "t",
  runId: "r",
  agentUser: { id: "ai" } as never,
  principals: { agentId, humanId },
});

describe("search_knowledge", () => {
  it("returns passage + document name + locator for an entitled document", async () => {
    const doc = await ingestDocument({
      name: "pricing.md", contentType: "text/markdown", ownerId: admin.id, visibility: "PUBLIC",
      bytes: Buffer.from("# Pricing\n\nThe renewal window for pricing is March."),
    });
    await db.kbGrant.create({
      data: { documentId: doc.documentId, subjectType: "AGENT", subjectId: "builtin:resolver", grantedById: admin.id },
    });
    const out = await kbTools.search_knowledge.execute(
      { query: "renewal pricing" },
      ctx("builtin:resolver", requester.id),
    );
    expect(out).toContain("pricing.md");
    expect(out).toContain("lines 1");
    expect(out).toContain("renewal window");
    expect(out.startsWith("[1]")).toBe(true);
  });

  it("denies without a human principal — and MCP contexts carry none", async () => {
    const out = await kbTools.search_knowledge.execute(
      { query: "x" },
      { ticketId: "mcp-external", runId: "mcp-external", agentUser: { id: "ai" } as never },
    );
    expect(out).toMatch(/per-user token/);
  });

  it("No accessible sources. on an empty intersection — never a degraded answer", async () => {
    await ingestDocument({
      name: "locked.md", contentType: "text/markdown", ownerId: admin.id,
      bytes: Buffer.from("# Locked\n\nsecret renewal terms"),
    });
    const out = await kbTools.search_knowledge.execute(
      { query: "renewal terms" },
      ctx("builtin:resolver", requester.id),
    );
    expect(out).toBe("No accessible sources.");
  });
});

describe("read_document — cursor pagination and the no-existence-oracle", () => {
  it("pages by chunk cursor and names the next cursor", async () => {
    const doc = await ingestDocument({
      name: "big.md", contentType: "text/markdown", ownerId: admin.id, visibility: "PUBLIC",
      bytes: Buffer.from(
        ["# One", "", "first section body", "", "# Two", "", "second section body", "", "# Three", "", "third section body", "", "# Four", "", "fourth section body", "", "# Five", "", "fifth section body"].join("\n"),
      ),
    });
    // The resolver reads only what an AGENT grant gives it — even PUBLIC.
    await db.kbGrant.create({
      data: { documentId: doc.documentId, subjectType: "AGENT", subjectId: "builtin:resolver", grantedById: admin.id },
    });
    const first = await kbTools.read_document.execute(
      { documentId: doc.documentId },
      ctx("builtin:resolver", requester.id),
    );
    expect(first).toContain("big.md");
    expect(first).toContain("next cursor");
    const m = first.match(/"fromChunk": (\d+)/);
    expect(m).toBeTruthy();
    const second = await kbTools.read_document.execute(
      { documentId: doc.documentId, fromChunk: Number(m![1]) },
      ctx("builtin:resolver", requester.id),
    );
    expect(second).not.toContain("first section body");
  });

  it("returns the IDENTICAL string for non-entitled and non-existent ids", async () => {
    const doc = await ingestDocument({
      name: "hidden.md", contentType: "text/markdown", ownerId: admin.id,
      bytes: Buffer.from("# Hidden\n\nbody"),
    });
    const denied = await kbTools.read_document.execute(
      { documentId: doc.documentId },
      ctx("builtin:resolver", requester.id),
    );
    const missing = await kbTools.read_document.execute(
      { documentId: "does-not-exist" },
      ctx("builtin:resolver", requester.id),
    );
    expect(denied).toBe(missing);
    expect(denied).toMatch(/no accessible document/i);
  });
});

describe("list_collections", () => {
  it("counts only entitled documents and omits empty collections", async () => {
    const collection = await db.collection.create({ data: { name: "Readable" } });
    const empty = await db.collection.create({ data: { name: "Empty" } });
    void empty;
    const doc = await ingestDocument({
      name: "in-collection.md", contentType: "text/markdown", ownerId: admin.id, visibility: "PUBLIC",
      bytes: Buffer.from("# C\n\ncontent"),
    });
    await db.document.update({ where: { id: doc.documentId }, data: { collectionId: collection.id } });
    await db.kbGrant.create({
      data: { collectionId: collection.id, subjectType: "AGENT", subjectId: "builtin:resolver", grantedById: admin.id },
    });
    const out = await kbTools.list_collections.execute({}, ctx("builtin:resolver", requester.id));
    expect(out).toContain("Readable (1 readable document)");
    expect(out).not.toContain("Empty");
  });
});

describe("MCP denial and policy backfill", () => {
  it("the three KB tools are absent from the MCP registry and the refusal names the reason", async () => {
    const served = await getMcpTools();
    expect(served.search_knowledge).toBeUndefined();
    expect(served.read_document).toBeUndefined();
    expect(served.list_collections).toBeUndefined();
    const reason = await mcpToolWithholdReason("search_knowledge");
    expect(reason).toMatch(/per-user token/);
  });

  it("ensureToolPolicies backfills the three rows on an existing database", async () => {
    expect(await db.toolPolicy.findUnique({ where: { toolName: "search_knowledge" } })).toBeNull();
    await ensureToolPolicies();
    for (const name of ["search_knowledge", "read_document", "list_collections"]) {
      const row = await db.toolPolicy.findUnique({ where: { toolName: name } });
      expect(row?.riskLevel).toBe("LOW");
      expect(row?.requiresApproval).toBe(false);
    }
  });
});
