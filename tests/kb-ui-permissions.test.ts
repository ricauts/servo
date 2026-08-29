// kb-16: route-level permission tests — a REQUESTER gets 403 on every
// /api/kb/* route and the nav entry is absent; the download route is the
// only place Document.data materializes; no hardcoded hex anywhere in the
// new components (the lint enforces it tree-wide).

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

import { GET as listDocuments } from "@/app/api/kb/documents/route";
import { GET as getReaders } from "@/app/api/kb/documents/[id]/readers/route";
import { GET as getRelated } from "@/app/api/kb/documents/[id]/related/route";
import { GET as download } from "@/app/api/kb/documents/[id]/download/route";
import { POST as postGrants } from "@/app/api/kb/documents/[id]/grants/route";
import { NAV_ENTRIES, navForUser } from "@/components/shell/nav-items";

const handles: TmpDb[] = [];
afterAll(async () => {
  for (const h of handles) await h.dispose();
});

let db: PrismaClient;
let requester: { id: string; role: string };
let admin: { id: string; role: string };

beforeEach(async () => {
  if (handles.length > 1) await handles.shift()?.dispose();
  const a = await tmpDb();
  handles.push(a);
  db = a.client;
  holder.db = db as unknown as ServoDb;
  requester = { ...(await db.user.create({ data: { name: "R", email: "r@x.com", role: "REQUESTER" } })), role: "REQUESTER" };
  admin = { ...(await db.user.create({ data: { name: "A", email: "a@x.com", role: "ADMIN" } })), role: "ADMIN" };
});

const req = (url: string) => new Request(url) as never;
const P = (id: string) => ({ params: Promise.resolve({ id }) });

describe("a REQUESTER on every /api/kb/* route", () => {
  it("gets 403 — and the nav entry is absent from their tree", async () => {
    holder.user = requester;
    expect((await listDocuments()).status).toBe(403);
    expect((await getReaders(req("http://x"), P("any"))).status).toBe(403);
    expect((await getRelated(req("http://x"), P("any"))).status).toBe(403);
    expect((await download(req("http://x"), P("any"))).status).toBe(403);
    expect((await postGrants(new Request("http://x", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }) as never, P("any"))).status).toBe(403);

    expect(navForUser({ role: "REQUESTER" }).map((e) => e.href)).not.toContain("/kb");
    expect(navForUser({ role: "AGENT" }).map((e) => e.href)).toContain("/kb");
    expect(NAV_ENTRIES.find((e) => e.href === "/kb")?.action).toBe("kb.view");
  });
});

describe("the download route", () => {
  it("materializes data for an entitled user and 404s a non-entitled id", async () => {
    holder.user = admin;
    const doc = await db.document.create({
      data: { name: "f.md", contentType: "text/markdown", byteSize: 3, sha256: "a".repeat(64), data: new Uint8Array([97, 98, 99]), ownerId: admin.id },
    });
    const res = await download(req(`http://x/api/kb/documents/${doc.id}/download`), P(doc.id));
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe("abc");

    holder.user = requester;
    // kb.view denies first (403) — a REQUESTER never reaches the id oracle.
    expect((await download(req(`http://x/api/kb/documents/${doc.id}/download`), P(doc.id))).status).toBe(403);
    // An AGENT (kb.view yes, no grant) gets the 404: same string as unknown.
    holder.user = { ...(await db.user.create({ data: { name: "G", email: "g@x.com", role: "AGENT" } })), role: "AGENT" };
    expect((await download(req(`http://x/api/kb/documents/${doc.id}/download`), P(doc.id))).status).toBe(404);
  });
});

describe("design system", () => {
  it("the new KB components carry no hardcoded hex (lint enforces tree-wide)", async () => {
    const { execFileSync } = await import("node:child_process");
    const out = execFileSync("node", ["scripts/no-hex-lint.mjs"], { encoding: "utf8" });
    expect(out).toMatch(/no-hex-lint: OK/);
  });
});
