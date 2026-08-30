// dcl-09: re-extraction, the health surface, and citations that went dark.
// Everything runs on tmpDb() with FixtureTransport where the lane is
// exercised — no socket — and the whole suite is green with no Docling
// configuration (LANE 1).

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { tmpDb, type TmpDb } from "./helpers/tmp-db";

type ServoDb = { [key: string]: unknown };
const holder = vi.hoisted(() => ({ db: null as unknown as ServoDb }));
vi.mock("@/lib/db", () => ({ get db() { return holder.db; } }));
const authHolder = vi.hoisted(() => ({ user: null as unknown as { id: string; role: string } }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: async () => authHolder.user }));

import { ingestDocument } from "@/lib/kb/ingest";
import { reextractDocument, reextractFallbackQueue } from "@/lib/kb/reingest";
import { extractorHealth, resetDoclingLaneForTests } from "@/lib/kb/extractors/docling";
import { approveDraft } from "@/lib/ai/draft";
import { POST as reextractRoute } from "@/app/api/kb/documents/[id]/reextract/route";

const handles: TmpDb[] = [];
afterAll(async () => {
  for (const h of handles) await h.dispose();
});

let db: PrismaClient;
let admin: { id: string };
let agent: { id: string };
let requester: { id: string };

beforeEach(async () => {
  if (handles.length > 1) await handles.shift()?.dispose();
  const a = await tmpDb();
  handles.push(a);
  db = a.client;
  holder.db = db as unknown as ServoDb;
  admin = await db.user.create({ data: { name: "A", email: `a${Date.now()}@x.com`, role: "ADMIN" } });
  agent = await db.user.create({ data: { name: "G", email: `g${Date.now()}@x.com`, role: "AGENT" } });
  requester = await db.user.create({ data: { name: "R", email: `r${Date.now()}@x.com`, role: "REQUESTER" } });
  resetDoclingLaneForTests();
  delete process.env.KB_EXTRACT_DOCLING_URL;
});

describe("re-extraction — re-upload semantics on the stored bytes", () => {
  it("replaces chunks and edges, keeps GRANTS, recomputes provenance and extractedAt", async () => {
    const first = await ingestDocument({
      name: "notes.md", contentType: "text/markdown", ownerId: admin.id,
      bytes: Buffer.from("# One\n\nalpha beta gamma"),
    });
    const before = await db.document.findUniqueOrThrow({ where: { id: first.documentId } });
    expect(before.extractor).toBe("baseline-text");
    expect(before.extractedAt).not.toBeNull();

    await db.kbGrant.create({
      data: { documentId: first.documentId, subjectType: "USER", subjectId: agent.id, grantedById: admin.id },
    });
    await db.document.update({
      where: { id: first.documentId },
      data: { extractorFallback: "docling-circuit-open" }, // as if the lane was down
    });

    const result = await reextractDocument(first.documentId);
    expect(result.textStatus).toBe("EXTRACTED");
    expect(result.extractorFallback).toBeNull();

    const after = await db.document.findUniqueOrThrow({ where: { id: first.documentId } });
    expect(after.extractorFallback).toBeNull(); // the queue entry drained
    expect(after.extractor).toBe("baseline-text");
    expect(after.extractorVersion).toBe("kb-04@1");
    expect(after.extractedAt!.getTime()).toBeGreaterThan(before.extractedAt!.getTime());
    // Grants survive the content update — the kb-04 re-upload semantics.
    expect(await db.kbGrant.count({ where: { documentId: first.documentId } })).toBe(1);
    // Chunks were replaced, not duplicated.
    const chunks = await db.documentChunk.findMany({ where: { documentId: first.documentId } });
    expect(chunks.length).toBeGreaterThan(0);
    expect(new Set(chunks.map((c) => c.index)).size).toBe(chunks.length);
  });

  it("a catalog card and a missing id refuse loudly, not silently", async () => {
    const card = await db.document.create({
      data: { name: "card", contentType: "application/vnd.servo.catalog+json", byteSize: 1, sha256: "x", data: null, ownerId: admin.id, kind: "CATALOG" },
    });
    await expect(reextractDocument(card.id)).rejects.toThrow(/no stored bytes/);
    await expect(reextractDocument("missing")).rejects.toThrow(/Unknown document/);
  });

  it("re-extracting with NO configured high-fidelity extractor succeeds — absence is not an error", async () => {
    expect((await extractorHealth(null)).configured).toBe(false);
    const doc = await ingestDocument({
      name: "plain.md", contentType: "text/markdown", ownerId: admin.id,
      bytes: Buffer.from("# Two\n\nsome words"),
    });
    const result = await reextractDocument(doc.documentId);
    expect(result.textStatus).toBe("EXTRACTED");
    const row = await db.document.findUniqueOrThrow({ where: { id: doc.documentId } });
    expect(row.extractedAt).not.toBeNull();
  });
});

describe("permissions — kb-03's shape on the route", () => {
  it("a REQUESTER gets 403; a non-owner without MANAGE gets 403; owner and admin proceed", async () => {
    const owned = await ingestDocument({
      name: "perm.md", contentType: "text/plain", ownerId: agent.id,
      bytes: Buffer.from("owner is agent"),
    });
    const id = owned.documentId;
    const call = () => reextractRoute({} as never, { params: Promise.resolve({ id }) });

    authHolder.user = requester as never;
    expect((await call()).status).toBe(403); // kb.view refuses REQUESTERs

    const otherAgent = await db.user.create({ data: { name: "O", email: `o${Date.now()}@x.com`, role: "AGENT" } });
    authHolder.user = otherAgent as never;
    const r2 = await call();
    expect(r2.status).toBe(403); // not the owner, no MANAGE

    authHolder.user = agent as never;
    const r3 = await call();
    expect(r3.status).toBe(200); // the owner

    authHolder.user = admin as never;
    const r4 = await call();
    expect(r4.status).toBe(200); // kb.manage
  });
});

describe("the fallback queue", () => {
  it("filters to extractorFallback IS NOT NULL and the bulk walk DRAINS it, one document at a time", async () => {
    const a = await ingestDocument({ name: "q1.md", contentType: "text/markdown", ownerId: admin.id, bytes: Buffer.from("# A\n\ncontent a") });
    const b = await ingestDocument({ name: "q2.md", contentType: "text/markdown", ownerId: admin.id, bytes: Buffer.from("# B\n\ncontent b") });
    const clean = await ingestDocument({ name: "q3.md", contentType: "text/markdown", ownerId: admin.id, bytes: Buffer.from("# C\n\ncontent c") });

    await db.document.update({ where: { id: a.documentId }, data: { extractorFallback: "docling-unreachable" } });
    await db.document.update({ where: { id: b.documentId }, data: { extractorFallback: "docling-timeout" } });

    const queued = await db.document.findMany({ where: { extractorFallback: { not: null } }, select: { id: true } });
    expect(queued.map((q) => q.id).sort()).toEqual([a.documentId, b.documentId].sort());

    const { walked, drained } = await reextractFallbackQueue();
    expect(walked).toBe(2);
    expect(drained).toBe(2); // LANE 1 baseline re-extraction clears the reason
    // The queue drains rather than looping over the same rows.
    expect(await db.document.count({ where: { extractorFallback: { not: null } } })).toBe(0);
    // The clean document was never touched.
    const cleanRow = await db.document.findUniqueOrThrow({ where: { id: clean.documentId } });
    expect(cleanRow.extractorFallback).toBeNull();
  });
});

describe("citations that went dark — kb-13 extended to missing chunks", () => {
  it("a PENDING draft citing a re-extracted (deleted) chunk REFUSES: named citation, draft stays PENDING, nothing sent", async () => {
    const doc = await ingestDocument({
      name: "cited.md", contentType: "text/markdown", ownerId: admin.id, visibility: "PUBLIC",
      bytes: Buffer.from("# Renewal\n\nThe renewal window for pricing is March."),
    });
    // The grant keeps the DOCUMENT readable (kb-13's fixture shape) so the
    // refusal under test is the CHUNK going dark, not the grant.
    await db.kbGrant.create({
      data: { documentId: doc.documentId, subjectType: "AGENT", subjectId: "builtin:drafter", grantedById: admin.id },
    });
    const chunk = await db.documentChunk.findFirstOrThrow({ where: { documentId: doc.documentId } });
    const ticket = await db.ticket.create({
      data: { number: 6001, title: "renewal", description: "when?", requesterId: requester.id },
    });
    const draft = await db.replyDraft.create({
      data: {
        ticketId: ticket.id,
        body: "The renewal window is March. [1]",
        status: "PENDING",
        sources: [{ docId: doc.documentId, docName: "cited.md", locator: { lines: "1" }, chunkId: chunk.id }],
      },
    });

    // Re-extraction replaces the chunk rows — the cited chunk id dangles.
    await reextractDocument(doc.documentId);
    const stillThere = await db.documentChunk.findFirst({ where: { id: chunk.id } });
    expect(stillThere).toBeNull();

    await expect(approveDraft(draft.id, admin as never)).rejects.toThrow(
      /[\s\S]*went dark[\s\S]*re-extracted|re-extracted[\s\S]*went dark/,
    );
    // The atomic claim was never attempted: the draft is still PENDING,
    // with no comment, no mail, no webhook.
    const after = await db.replyDraft.findUniqueOrThrow({ where: { id: draft.id } });
    expect(after.status).toBe("PENDING");
    expect(await db.comment.count({ where: { ticketId: ticket.id } })).toBe(0);
  });

  it("a draft citing a LIVE chunk still sends — the extension does not over-block", async () => {
    const doc = await ingestDocument({
      name: "live.md", contentType: "text/markdown", ownerId: admin.id, visibility: "PUBLIC",
      bytes: Buffer.from("# Live\n\nThe support SLA is 8 hours."),
    });
    await db.kbGrant.create({
      data: { documentId: doc.documentId, subjectType: "AGENT", subjectId: "builtin:drafter", grantedById: admin.id },
    });
    const chunk = await db.documentChunk.findFirstOrThrow({ where: { documentId: doc.documentId } });
    const ticket = await db.ticket.create({
      data: { number: 6002, title: "sla", description: "what?", requesterId: requester.id },
    });
    const draft = await db.replyDraft.create({
      data: {
        ticketId: ticket.id,
        body: "The SLA is 8 hours. [1]",
        status: "PENDING",
        sources: [{ docId: doc.documentId, docName: "live.md", locator: { lines: "1" }, chunkId: chunk.id }],
      },
    });
    const sent = await approveDraft(draft.id, admin as never);
    expect(sent.status).toBe("SENT");
  });
});

describe("the health surface — FixtureTransport only", () => {
  it("unconfigured: configured=false, no fetch happens, version is the unknown literal", async () => {
    const health = await extractorHealth(null, {
      transport: { request: () => { throw new Error("NO SOCKET"); } },
    });
    expect(health).toMatchObject({ configured: false, url: "", version: "docling-serve@unknown" });
  });

  it("configured: the URL, the reported version and the circuit state", async () => {
    process.env.KB_EXTRACT_DOCLING_URL = "http://127.0.0.1:9998";
    const calls: string[] = [];
    const health = await extractorHealth(null, {
      transport: {
        request: async (url) => {
          calls.push(url);
          if (url.endsWith("/openapi.json")) {
            return new Response(JSON.stringify({ info: { version: "1.4.2" } }), { headers: { "content-type": "application/json" } });
          }
          throw new Error(`unexpected ${url}`);
        },
      },
    });
    expect(health.configured).toBe(true);
    expect(health.url).toBe("http://127.0.0.1:9998");
    expect(health.version).toBe("docling-serve@1.4.2");
    expect(health.circuit).toMatch(/^closed \(0 consecutive/);
    expect(calls).toEqual(["http://127.0.0.1:9998/openapi.json"]); // exactly one probe, no socket
    delete process.env.KB_EXTRACT_DOCLING_URL;
  });
});
