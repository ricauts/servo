// db-02: the throwaway-database harness. Isolation between clones, teardown
// that really drops, and the core bootstrap seeding a clone. Runs against the
// test container (docker-compose.test.yml, port 5433) — never a mock.

import { afterAll, describe, expect, it } from "vitest";
import { databaseExists, seedCore, tmpDb, type TmpDb } from "./helpers/tmp-db";

const handles: TmpDb[] = [];
afterAll(async () => {
  for (const h of handles) await h.dispose();
});

describe("tmpDb()", () => {
  it("clones a database that carries the schema (the User table exists)", async () => {
    const a = await tmpDb();
    handles.push(a);
    expect(a.dbName.startsWith("servo_test_")).toBe(true);
    await expect(a.client.user.count()).resolves.toBe(0);
  });

  it("isolates: two handles never see each other's rows", async () => {
    const a = await tmpDb();
    const b = await tmpDb();
    handles.push(a, b);
    await a.client.user.create({
      data: { name: "Only In A", email: "a@example.com", role: "AGENT" },
    });
    expect(await a.client.user.count()).toBe(1);
    expect(await b.client.user.count()).toBe(0);
  });

  it("drops the database on dispose", async () => {
    const a = await tmpDb();
    expect(await databaseExists(a.dbName)).toBe(true);
    await a.dispose();
    expect(await databaseExists(a.dbName)).toBe(false);
  });

  it("clones the vector extension with the template", async () => {
    const a = await tmpDb();
    handles.push(a);
    const exts = await a.client.$queryRawUnsafe<{ extname: string }[]>(
      "SELECT extname FROM pg_extension",
    );
    expect(exts.map((e) => e.extname)).toContain("vector");
  });

  it("seedCore(): the first-boot bootstrap seeds a clone", async () => {
    const a = await tmpDb();
    handles.push(a);
    await seedCore(a.url);
    const agents = await a.client.user.findMany({ where: { role: "AI_AGENT" } });
    expect(agents.map((u) => u.email).sort()).toEqual([
      "drafter@servo.ai", // kb-14: the auto-delivery timeline author
      "qa@servo.ai",
      "resolver@servo.ai",
      "triage@servo.ai",
    ]);
    const policies = await a.client.toolPolicy.count();
    expect(policies).toBeGreaterThanOrEqual(23);
  });
});
