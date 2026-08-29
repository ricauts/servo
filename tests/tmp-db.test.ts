// db-02: the throwaway-database harness. Isolation between clones, teardown
// that really drops, the refusal rails, and the core bootstrap seeding a
// clone. The DB-touching tests here run against the harness database on the
// test container (docker-compose.test.yml, port 5433); the dev database is
// never opened. The rail tests alongside them are pure functions over URL
// strings and open no connection at all.

import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import {
  assertSafeAdminUrl,
  assertThrowawayUrl,
  databaseExists,
  databaseName,
  seedCore,
  templateUrl,
  testDatabaseUrl,
  tmpDb,
  urlForDatabase,
  type TmpDb,
} from "./helpers/tmp-db";

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
    expect(a.dbName).not.toBe(b.dbName);

    await a.client.user.create({
      data: { name: "Only In A", email: "a@example.com", role: "AGENT" },
    });
    await b.client.user.create({
      data: { name: "Only In B", email: "b@example.com", role: "AGENT" },
    });

    // Both directions: each handle sees its own row and only its own row.
    expect(await a.client.user.count()).toBe(1);
    expect(await b.client.user.count()).toBe(1);
    expect((await a.client.user.findMany()).map((u) => u.email)).toEqual(["a@example.com"]);
    expect((await b.client.user.findMany()).map((u) => u.email)).toEqual(["b@example.com"]);
  });

  it("drops the database on dispose, even with a foreign session still open", async () => {
    const a = await tmpDb();
    // A SECOND client on the same clone, which dispose() knows nothing about
    // and therefore never disconnects. Without WITH (FORCE) the DROP fails on
    // this session, so the assertion below is what makes that clause testable.
    const squatter = new PrismaClient({ datasourceUrl: a.url });
    await squatter.$queryRawUnsafe("SELECT 1");
    try {
      expect(await databaseExists(a.dbName)).toBe(true);
      await a.dispose();
      expect(await databaseExists(a.dbName)).toBe(false);
    } finally {
      await squatter.$disconnect().catch(() => undefined);
    }
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

describe("the harness refuses the dev, demo and application databases", () => {
  const forbidden = [
    "postgresql://servo:servo@localhost:5433/dev",
    "postgresql://servo:servo@localhost:5433/demo",
    "postgresql://servo:servo@localhost:5433/servo", // the application database
    "postgresql://servo:servo@localhost:5433/servo_dev",
    "postgresql://servo:servo@localhost:5433/servo_demo",
    "postgresql://servo:servo@localhost:5433/servo_ops", // the ops sandbox
    "file:./prisma/dev.db",
    "file:/data/demo.db",
  ];

  it.each(forbidden)("refuses %s", (url) => {
    expect(() => assertSafeAdminUrl(url)).toThrow(/the harness never touches it/);
  });

  it("refuses a URL with no database name rather than running blind", () => {
    expect(() => assertSafeAdminUrl("")).toThrow(/never runs blind/);
    expect(() => assertSafeAdminUrl("postgresql://servo:servo@localhost:5433/")).toThrow(
      /never runs blind/,
    );
  });

  it.each(["dev", "demo", "servo", "servo_ops"])(
    "tmpDb() itself refuses %s — the rail is not only a module-load side effect",
    async (name) => {
      const prev = process.env.TEST_DATABASE_URL;
      try {
        process.env.TEST_DATABASE_URL = `postgresql://servo:servo@localhost:5433/${name}`;
        await expect(tmpDb()).rejects.toThrow(/the harness never touches it/);
      } finally {
        if (prev === undefined) delete process.env.TEST_DATABASE_URL;
        else process.env.TEST_DATABASE_URL = prev;
      }
    },
  );

  it("an EMPTY TEST_DATABASE_URL does not fall through to DATABASE_URL", () => {
    const prev = process.env.TEST_DATABASE_URL;
    try {
      // Prisma resolves an empty datasourceUrl through env("DATABASE_URL") —
      // the dev database — so empty must mean unset, not "pass it along".
      process.env.TEST_DATABASE_URL = "";
      expect(testDatabaseUrl()).toBe("postgresql://servo:servo@localhost:5433/postgres");
    } finally {
      if (prev === undefined) delete process.env.TEST_DATABASE_URL;
      else process.env.TEST_DATABASE_URL = prev;
    }
  });

  it("seedCore() takes an allowlist: only a servo_test_* database may be written", async () => {
    await expect(seedCore("postgresql://servo:servo@localhost:5433/production")).rejects.toThrow(
      /only a servo_test_\* throwaway may be seeded/,
    );
    expect(() => assertThrowawayUrl("postgresql://servo:servo@localhost:5433/staging")).toThrow(
      /only a servo_test_\* throwaway may be seeded/,
    );
    expect(() =>
      assertThrowawayUrl("postgresql://servo:servo@localhost:5433/servo_test_1_1"),
    ).not.toThrow();
  });

  it("allows the harness's own maintenance database", () => {
    expect(() => assertSafeAdminUrl("postgresql://servo:servo@localhost:5433/postgres")).not.toThrow();
    expect(() => assertSafeAdminUrl(testDatabaseUrl())).not.toThrow();
  });

  it("parses the NAME, so a password containing dev.db does not trip the rail", () => {
    expect(databaseName("postgresql://user:dev.db@localhost:5433/postgres")).toBe("postgres");
    expect(databaseName("file:./prisma/dev.db")).toBe("dev.db");
    expect(() =>
      assertSafeAdminUrl("postgresql://user:dev.db@localhost:5433/postgres"),
    ).not.toThrow();
  });
});

describe("every connection is derived from TEST_DATABASE_URL", () => {
  const base = "postgresql://someone:secret@db.internal:6000/postgres?sslmode=require";

  it("carries host, port and credentials onto the clone and the template", () => {
    const clone = new URL(urlForDatabase("servo_test_1_1", base));
    expect(clone.hostname).toBe("db.internal");
    expect(clone.port).toBe("6000");
    expect(clone.username).toBe("someone");
    expect(clone.pathname).toBe("/servo_test_1_1");
    expect(clone.searchParams.get("sslmode")).toBe("require");
    expect(clone.searchParams.get("schema")).toBe("public");

    expect(new URL(templateUrl(base)).pathname).toBe("/servo_test_template");
    expect(new URL(templateUrl(base)).host).toBe("db.internal:6000");
  });

  it("leaves an explicit schema alone rather than forcing public", () => {
    const url = new URL(urlForDatabase("servo_test_1_1", `${base}&schema=elsewhere`));
    expect(url.searchParams.get("schema")).toBe("elsewhere");
  });

  it("a redirected harness moves ENTIRELY: the live clone follows the override", async () => {
    // 127.0.0.1 is the same server by a different spelling, so this runs
    // everywhere the default does — including CI, which sets no override. It
    // is the regression test for the hardcoded endpoint: pin the clone URL
    // back to `localhost` and this goes red.
    const prev = process.env.TEST_DATABASE_URL;
    try {
      process.env.TEST_DATABASE_URL = "postgresql://servo:servo@127.0.0.1:5433/postgres";
      const a = await tmpDb();
      try {
        expect(new URL(a.url).hostname).toBe("127.0.0.1");
        // Not just the string: the handle really connects through it.
        const [row] = await a.client.$queryRawUnsafe<{ current_database: string }[]>(
          "SELECT current_database()",
        );
        expect(row.current_database).toBe(a.dbName);
      } finally {
        await a.dispose();
      }
    } finally {
      if (prev === undefined) delete process.env.TEST_DATABASE_URL;
      else process.env.TEST_DATABASE_URL = prev;
    }
  });
});
