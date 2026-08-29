// reb-05: distill a resolved ticket into a skill. The v1 mechanism is a
// DETERMINISTIC PREFILL — no model call anywhere, mock-safe by construction
// — and the tests cover create-with-provenance and invalid-ticket rejection
// on a tmpDb(), plus the disabled-on-create rule and the pure prefill.

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

import { POST as postSkill, GET as getSkills } from "@/app/api/skills/route";
import { distillPrefill, resolutionOfRecord } from "@/lib/skill-distill";

const handles: TmpDb[] = [];
afterAll(async () => {
  for (const h of handles) await h.dispose();
});

let db: PrismaClient;
let admin: { id: string; role: string };
let requester: { id: string };

beforeEach(async () => {
  if (handles.length > 1) await handles.shift()?.dispose();
  const a = await tmpDb();
  handles.push(a);
  db = a.client;
  holder.db = db as unknown as ServoDb;
  admin = { ...(await db.user.create({ data: { name: "Ad", email: "ad@x.com", role: "ADMIN" } })), role: "ADMIN" };
  requester = await db.user.create({ data: { name: "R", email: "r@x.com", role: "REQUESTER" } });
  holder.user = admin;
});

const MARKDOWN = [
  "---",
  "name: VPN morning drops",
  "description: How the desk resolved ticket #1001 — VPN drops.",
  'categories: ["NETWORK"]',
  "enabled: false",
  "---",
  "",
  "## What worked",
  "",
  "Renewed the DHCP lease.",
  "",
  "## Procedure",
  "",
  "1. Check the gateway.",
].join("\n");

function create(body: unknown) {
  return postSkill(
    new Request("http://x/api/skills", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }) as never,
  );
}

describe("the deterministic prefill — pure, no provider anywhere", () => {
  it("same input, same markdown: name from title, [category], the recorded resolution", () => {
    const source = { number: 1001, title: "VPN drops every morning", category: "NETWORK", runSummary: "Renewed the DHCP lease." };
    const a = distillPrefill(source);
    const b = distillPrefill({ ...source });
    expect(a).toBe(b);
    expect(a).toContain("name: VPN drops every morning");
    expect(a).toContain('categories: ["NETWORK"]');
    expect(a).toContain("Renewed the DHCP lease.");
    expect(a).toContain("Distilled from ticket #1001.");
    expect(a).toContain("enabled: false");
  });

  it("a human-closed ticket gets a placeholder, never a fabricated resolution", () => {
    const a = distillPrefill({ number: 1002, title: "Printer dead", category: "HARDWARE", runSummary: null });
    expect(a).toContain("Describe what actually resolved this ticket");
  });

  it("resolutionOfRecord picks the last COMPLETED RESOLVE run with a summary", () => {
    const runs = [
      { kind: "TRIAGE", status: "COMPLETED", summary: "triaged" },
      { kind: "RESOLVE", status: "FAILED", summary: "attempted" },
      { kind: "RESOLVE", status: "COMPLETED", summary: "first fix" },
      { kind: "RESOLVE", status: "COMPLETED", summary: "final fix" },
    ] as never;
    expect(resolutionOfRecord(runs)).toBe("final fix");
    expect(resolutionOfRecord([])).toBeNull();
  });
});

describe("POST /api/skills with provenance", () => {
  it("creates the skill carrying sourceTicketId — and DISABLED, nothing auto-enables", async () => {
    const ticket = await db.ticket.create({
      data: { number: 1001, title: "VPN drops every morning", description: "d", requesterId: requester.id, status: "RESOLVED", category: "NETWORK" },
    });
    const res = await create({ markdown: MARKDOWN, sourceTicketId: ticket.id });
    expect(res.status).toBe(201);
    const skill = await db.skill.findUniqueOrThrow({ where: { slug: "vpn-morning-drops" } });
    expect(skill.sourceTicketId).toBe(ticket.id);
    expect(skill.enabled).toBe(false);
  });

  it("rejects an invalid sourceTicketId and writes NOTHING", async () => {
    const res = await create({ markdown: MARKDOWN, sourceTicketId: "does-not-exist" });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringMatching(/Source ticket not found/) });
    expect(await db.skill.count()).toBe(0);
  });

  it("a skill without provenance keeps the default enabled path", async () => {
    const res = await create({ markdown: MARKDOWN });
    expect(res.status).toBe(201);
    const skill = await db.skill.findUniqueOrThrow({ where: { slug: "vpn-morning-drops" } });
    expect(skill.sourceTicketId).toBeNull();
    expect(skill.enabled).toBe(true);
  });

  it("GET carries the column the KPIs will read", async () => {
    const ticket = await db.ticket.create({
      data: { number: 1002, title: "t", description: "d", requesterId: requester.id, status: "RESOLVED" },
    });
    await create({ markdown: MARKDOWN, sourceTicketId: ticket.id });
    const res = await getSkills();
    const { skills } = await res.json();
    expect(skills.find((s: { slug: string }) => s.slug === "vpn-morning-drops").sourceTicketId).toBe(ticket.id);
  });
});
