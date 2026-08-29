// db-07, offline check A: a legacy SQLite fixture (every table the importer
// knows, binary attachment, sealed values) imports into a tmpDb clone with
// matching row counts on every table, a byte-identical attachment blob,
// sealed values arriving VERBATIM, and the ticket sequence pushed past the
// highest imported number. The refusal path and the --force wipe are proven
// on the same fixture.

import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import { tmpDb, type TmpDb } from "./helpers/tmp-db";
import { buildLegacySqlite } from "./helpers/legacy-sqlite";
import { migrateSqliteToPostgres, LEGACY_TABLES } from "../scripts/migrate-sqlite-to-postgres.mjs";

const handles: TmpDb[] = [];
const dirs: string[] = [];
afterAll(async () => {
  for (const h of handles) await h.dispose();
  // Windows can keep a just-closed SQLite file locked briefly; a temp
  // dir that outlives the run is harmless, a failed suite is not.
  for (const d of dirs) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* temp dir — the OS reclaims it */
    }
  }
});

function freshFixture() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "servo-legacy-"));
  dirs.push(dir);
  return buildLegacySqlite(path.join(dir, "servo.db"));
}

async function freshDb(): Promise<{ h: TmpDb; db: PrismaClient; url: string }> {
  const h = await tmpDb();
  handles.push(h);
  if (handles.length > 2) await handles.shift()?.dispose();
  return { h, db: h.client, url: h.url };
}

describe("migrate-sqlite-to-postgres — offline check A", () => {
  it("imports every table with matching counts, byte-identical blobs and verbatim seals", async () => {
    const fixture = freshFixture();
    const { db, url } = await freshDb();
    const { copied, setvalTo } = await migrateSqliteToPostgres({ sqlitePath: fixture.path, target: url });

    // Every table the fixture has was copied — and the importer knows every
    // table the fixture has (completeness in both directions).
    expect(copied.map((c) => c.table).sort()).toEqual([...LEGACY_TABLES].sort());
    for (const c of copied) {
      expect(c.sqlite, `${c.table} source rows`).toBe(fixture.counts[c.table]);
      expect(c.pg, `${c.table} imported rows`).toBe(c.sqlite);
      expect(c.ok).toBe(true);
    }

    // cuid ids and timestamps preserved, not re-minted.
    const ticket = await db.ticket.findUniqueOrThrow({ where: { id: "t_1001" } });
    expect(ticket.number).toBe(1001);
    expect(ticket.createdAt.toISOString()).toBe("2026-01-05T08:00:00.000Z");
    expect(ticket.resolvedAt?.toISOString()).toBe("2026-01-05T08:55:00.000Z");

    // Attachment.data is a bytea holding the exact source bytes.
    const attachment = await db.attachment.findUniqueOrThrow({ where: { id: "at_1" } });
    expect(Buffer.from(attachment.data).equals(fixture.attachmentBytes)).toBe(true);

    // Sealed values arrive VERBATIM — never decrypted, never mangled: the
    // importer does not even link the secret store.
    const apiKey = await db.setting.findUniqueOrThrow({ where: { key: "ai.apiKey" } });
    expect(apiKey.value).toBe(fixture.sealedSetting);
    const credential = await db.aiCredential.findUniqueOrThrow({ where: { id: "cred_1" } });
    expect(credential.apiKey).toBe("enc:v1:deadbeefcafebabe");
    const tool = await db.customTool.findUniqueOrThrow({ where: { id: "ct_1" } });
    expect(tool.secret).toBe("enc:v1:ct-secret-fixture");

    // Booleans survived the 0/1 → boolean crossing.
    const draft = await db.replyDraft.findUniqueOrThrow({ where: { id: "d_1" } });
    expect(draft.emailed).toBe(true);
    expect(draft.edited).toBe(false);

    // The sequence sits past the highest imported number (db-03).
    expect(setvalTo).toBe(fixture.maxTicketNumber);
    const [seq] = await db.$queryRawUnsafe<{ n: number }[]>("SELECT last_value::int AS n FROM ticket_number_seq");
    expect(seq.n).toBe(fixture.maxTicketNumber);
  }, 60_000);

  it("refuses a non-empty target without --force, and does not touch its rows", async () => {
    const fixture = freshFixture();
    const { db, url } = await freshDb();
    await db.user.create({ data: { name: "Pre", email: "pre@x.com", role: "ADMIN" } });

    await expect(
      migrateSqliteToPostgres({ sqlitePath: fixture.path, target: url }),
    ).rejects.toThrow(/refusing to mix into a used database/);
    // The refusal is clean: nothing was written, the pre-existing row intact.
    expect(await db.user.count()).toBe(1);
    expect(await db.ticket.count()).toBe(0);
  }, 60_000);

  it("with --force, wipes the legacy tables first and imports cleanly", async () => {
    const fixture = freshFixture();
    const { db, url } = await freshDb();
    await db.user.create({ data: { name: "Pre", email: "pre@x.com", role: "ADMIN" } });
    await db.slaPolicy.create({ data: { priority: "URGENT", responseMinutes: 5, resolutionMinutes: 60, escalateOnBreach: true } });

    const { copied } = await migrateSqliteToPostgres({ sqlitePath: fixture.path, target: url, force: true });
    expect(copied.every((c) => c.ok)).toBe(true);
    expect(await db.user.count()).toBe(3); // wiped, then the fixture's three
    expect(await db.slaPolicy.count()).toBe(2);
  }, 60_000);

  it("refuses a source holding a table it does not know — no silent partial copy", async () => {
    const fixture = freshFixture();
    const { url } = await freshDb();
    const { DatabaseSync } = await import("node:sqlite");
    const legacy = new DatabaseSync(fixture.path);
    legacy.exec(`CREATE TABLE "FromTheFuture" ("id" TEXT PRIMARY KEY)`);
    legacy.close();

    await expect(
      migrateSqliteToPostgres({ sqlitePath: fixture.path, target: url }),
    ).rejects.toThrow(/does not know/);
  }, 60_000);
});
