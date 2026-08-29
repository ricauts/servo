// The two owner-authorised db-05 follow-ups (q48, answered 2026-08-28):
// (a) the demo seed proves the sandbox reachable BEFORE its first wipe —
//     an absent OPS_DATABASE_URL costs nothing instead of wiping the desk
//     and failing; (b) the sandbox refuses to BE Servo's database, decided
//     by asking the database the driver actually reached (the catalog
//     probe), not by parsing the URL — four rounds of URL-parsing bypasses
//     showed parsing fails open.

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { tmpDb, type TmpDb } from "./helpers/tmp-db";

type ServoDb = { [key: string]: unknown };
const holder = vi.hoisted(() => ({ db: null as unknown as ServoDb }));
vi.mock("@/lib/db", () => ({ get db() { return holder.db; } }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: async () => ({ id: "x", role: "ADMIN" }) }));

const handles: TmpDb[] = [];
afterAll(async () => {
  for (const h of handles) await h.dispose();
});

let db: PrismaClient;

beforeEach(async () => {
  if (handles.length > 1) await handles.shift()?.dispose();
  const a = await tmpDb();
  handles.push(a);
  db = a.client;
  holder.db = db as unknown as ServoDb;
});

describe("(b) the sandbox refuses to be Servo's own database", () => {
  it("an OPS_DATABASE_URL naming the desk refuses BOTH ops calls with the reason", async () => {
    const saved = process.env.OPS_DATABASE_URL;
    const savedRo = process.env.OPS_DATABASE_READONLY_URL;
    try {
      // Point the sandbox at the APP CLONE — the exact paste the probe
      // exists to catch: this database carries Ticket/AgentRun/Approval.
      process.env.OPS_DATABASE_URL = handles[0].url;
      process.env.OPS_DATABASE_READONLY_URL = handles[0].url;
      const { opsSelect, opsExecute, opsDisconnect } = await import("@/lib/opsdb");
      // Fresh process-level cache: the probe result caches per module
      // instance, and this is the first import in the test process.
      await expect(opsSelect("SELECT 1")).rejects.toThrow(/points at Servo's own database/i);
      await expect(opsExecute("SELECT 1")).rejects.toThrow(/points at Servo's own database/i);
      await opsDisconnect();
    } finally {
      process.env.OPS_DATABASE_URL = saved;
      process.env.OPS_DATABASE_READONLY_URL = savedRo;
    }
  }, 30_000);

  it("URL spellings a parser misses all reach the probe and refuse", async () => {
    // The parked branch's four bypass shapes, each now handled by asking
    // the reached database instead of parsing the string. One spelling per
    // module registry (the probe caches per module instance).
    // (0.0.0.0 omitted: on this host it refuses to CONNECT before any
    // probe could run — an environment-dependent spelling, and a refused
    // connection is itself a refusal to run agent SQL against the desk.)
    const spellings = [
      (base: string) => base.replace("?", "?port=5433&"), // query-string port
      (base: string) => `${base}&host=127.0.0.1&host=localhost`, // repeated host
      (base: string) => base, // plain paste — the obvious case
    ];
    const saved = process.env.OPS_DATABASE_URL;
    const savedRo = process.env.OPS_DATABASE_READONLY_URL;
    try {
      for (const spell of spellings) {
        process.env.OPS_DATABASE_URL = spell(handles[0].url);
        process.env.OPS_DATABASE_READONLY_URL = spell(handles[0].url);
        vi.resetModules();
        const mod = await import("@/lib/opsdb");
        await expect(mod.opsSelect("SELECT 1")).rejects.toThrow(/Servo's own database/i);
        await mod.opsDisconnect();
      }
    } finally {
      process.env.OPS_DATABASE_URL = saved;
      process.env.OPS_DATABASE_READONLY_URL = savedRo;
      vi.resetModules();
    }
  }, 60_000);

  it("a SANDBOX database (no app tables) passes the probe — the guard is not a blanket refusal", async () => {
    const { opsSandbox, OPS_RW_URL } = await import("./setup/ops-sandbox");
    await opsSandbox();
    const saved = process.env.OPS_DATABASE_URL;
    const savedRo = process.env.OPS_DATABASE_READONLY_URL;
    try {
      process.env.OPS_DATABASE_URL = OPS_RW_URL;
      process.env.OPS_DATABASE_READONLY_URL = OPS_RW_URL.replace("servo_ops_rw:servo_ops_rw", "servo_ops_ro:servo_ops_ro");
      vi.resetModules();
      const { opsSelect, opsDisconnect } = await import("@/lib/opsdb");
      const rows = (await opsSelect("SELECT 1 AS one")) as { one: number }[];
      expect(rows[0].one).toBe(1);
      await opsDisconnect();
    } finally {
      process.env.OPS_DATABASE_URL = saved;
      process.env.OPS_DATABASE_READONLY_URL = savedRo;
    }
  }, 30_000);
});

describe("(a) the demo seed probes before it wipes", () => {
  it("the source runs the SELECT 1 probe before the first deleteMany — order pinned", async () => {
    const source = (await import("node:fs")).readFileSync("prisma/seed-demo.ts", "utf8");
    const probe = source.indexOf('opsRun("SELECT 1")');
    const firstWipe = source.indexOf("deleteMany()");
    expect(probe).toBeGreaterThan(-1);
    expect(firstWipe).toBeGreaterThan(-1);
    expect(probe, "the probe must precede the first wipe").toBeLessThan(firstWipe);
  });

  it("an unreachable sandbox exits before ANY wipe: a marker row survives", async () => {
    // Run the real seed main() with OPS_DATABASE_URL pointing at a closed
    // port; the desk must still hold its marker row afterwards.
    const marker = await db.user.create({ data: { name: "MARKER", email: `m${Date.now()}@x.com`, role: "ADMIN" } });
    const saved = process.env.OPS_DATABASE_URL;
    process.env.DATABASE_URL = handles[0].url;
    try {
      process.env.OPS_DATABASE_URL = "postgresql://servo:servo@127.0.0.1:59999/none?schema=public&connection_limit=1";
      const { execFileSync } = await import("node:child_process");
      let failed = false;
      try {
        execFileSync("npx", ["tsx", "prisma/seed-demo.ts"], {
          cwd: process.cwd(),
          timeout: 60_000,
          stdio: "pipe",
          env: { ...process.env },
        });
      } catch {
        failed = true; // expected: the probe cannot connect
      }
      expect(failed).toBe(true);
      const survived = await db.user.findUnique({ where: { id: marker.id } });
      expect(survived).not.toBeNull(); // the wipe never ran
    } finally {
      process.env.OPS_DATABASE_URL = saved;
    }
  }, 120_000);
});
