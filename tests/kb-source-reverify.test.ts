// xds-08: send-time re-verification covers gone records and dark sources.
// Both refusals ride the SAME guard kb-13 built (inside approveDraft,
// before the atomic claim) — the automatic path inherits them through the
// one approveDraft call it already makes, with no second call site.

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { PrismaClient } from "@prisma/client";
import { tmpDb, type TmpDb } from "./helpers/tmp-db";

type ServoDb = { [key: string]: unknown };
const holder = vi.hoisted(() => ({ db: null as unknown as ServoDb }));
vi.mock("@/lib/db", () => ({ get db() { return holder.db; } }));

import { approveDraft } from "@/lib/ai/draft";
import { seal } from "@/lib/secret-store";

const handles: TmpDb[] = [];
afterAll(async () => {
  for (const h of handles) await h.dispose();
});

let db: PrismaClient;
let admin: { id: string };
let requester: { id: string };

beforeEach(async () => {
  if (handles.length > 1) await handles.shift()?.dispose();
  const a = await tmpDb();
  handles.push(a);
  db = a.client;
  holder.db = db as unknown as ServoDb;
  admin = await db.user.create({ data: { name: "A", email: `a${Date.now()}@x.com`, role: "ADMIN" } });
  requester = await db.user.create({ data: { name: "R", email: `r${Date.now()}@x.com`, role: "REQUESTER" } });
});

async function fixture(status: string, textStatus: string) {
  const source = await db.dataSource.create({
    data: {
      name: `src-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      kind: "POSTGRES", secretRef: "s", status, createdById: admin.id,
      configJson: { host: "127.0.0.1", port: 5434, database: "erp" },
    } as never,
  });
  const doc = await db.document.create({
    data: {
      name: "row.md", contentType: "text/markdown", byteSize: 1,
      sha256: "1".repeat(64), data: new Uint8Array(0), ownerId: admin.id,
      visibility: "PUBLIC", textStatus, sourceId: source.id,
      externalLocator: { kind: "POSTGRES", source: "erp", schema: "public", table: "t", id: "R1" },
    } as never,
  });
  const chunk = await db.documentChunk.create({ data: { documentId: doc.id, index: 0, text: "the INV-2024-113 row", locator: { lines: "1" } } });
  const ticket = await db.ticket.create({ data: { number: 8000 + Math.floor(Math.random() * 999), title: "t", description: "d", requesterId: requester.id } });
  const draft = await db.replyDraft.create({
    data: {
      ticketId: ticket.id, body: "b", status: "PENDING",
      sources: [{ docId: doc.id, docName: "row.md", chunkId: chunk.id, locator: { lines: "1" } }],
    } as never,
  });
  // The entitlement chain: the drafter holds the document grant, PUBLIC
  // covers the requester's human half (kb-13's own fixture shape).
  await db.kbGrant.create({ data: { documentId: doc.id, subjectType: "AGENT", subjectId: "builtin:drafter", grantedById: admin.id } });
  await db.kbGrant.create({ data: { sourceId: source.id, subjectType: "USER", subjectId: requester.id, grantedById: admin.id } });
  await db.kbGrant.create({ data: { sourceId: source.id, subjectType: "AGENT", subjectId: "builtin:drafter", grantedById: admin.id } });
  return { source, doc, ticket, draft };
}

describe("the two new refusals", () => {
  it("a cited document whose textStatus is GONE refuses: 'removed upstream', claim untouched", async () => {
    const f = await fixture("READY", "GONE");
    await expect(approveDraft(f.draft.id, admin as never)).rejects.toThrow(/removed upstream|gone from its source/);
    const draft = await db.replyDraft.findUniqueOrThrow({ where: { id: f.draft.id } });
    expect(draft.status).toBe("PENDING");
    expect(await db.comment.count({ where: { ticketId: f.ticket.id } })).toBe(0);
  });

  it("a cited document whose DataSource is DISABLED refuses: 'data source was disabled'", async () => {
    const f = await fixture("DISABLED", "EXTRACTED");
    await expect(approveDraft(f.draft.id, admin as never)).rejects.toThrow(/data source was disabled|turned off or purged/);
    const draft = await db.replyDraft.findUniqueOrThrow({ where: { id: f.draft.id } });
    expect(draft.status).toBe("PENDING");
    expect(await db.comment.count({ where: { ticketId: f.ticket.id } })).toBe(0);
  });

  it("PURGED refuses identically; SYNCING and UNREACHABLE do NOT refuse", async () => {
    const purged = await fixture("PURGED", "EXTRACTED");
    await expect(approveDraft(purged.draft.id, admin as never)).rejects.toThrow(/disabled/);
    expect((await db.replyDraft.findUniqueOrThrow({ where: { id: purged.draft.id } })).status).toBe("PENDING");

    for (const status of ["SYNCING", "UNREACHABLE"]) {
      const f = await fixture(status, "EXTRACTED");
      const sent = await approveDraft(f.draft.id, admin as never);
      expect(sent.status, status).toBe("SENT");
    }
  });

  it("with the source enabled and the record present, the send proceeds unchanged", async () => {
    const f = await fixture("READY", "EXTRACTED");
    const sent = await approveDraft(f.draft.id, admin as never);
    expect(sent.status).toBe("SENT");
    expect(await db.comment.count({ where: { ticketId: f.ticket.id } })).toBe(1);
  });

  it("the automatic path inherits both refusals through the SAME guard — no second call site", async () => {
    const source = readFileSync("src/lib/ai/draft.ts", "utf8");
    const calls = source.split("approveDraft(").length - 1; // definition + call sites
    expect(calls).toBe(2); // the definition and ONE call: the auto path's
    void seal;
  });
});
