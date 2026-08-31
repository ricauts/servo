// db-07, offline check B: the backup procedure the docs teach — pg_dump the
// running database, restore into a FRESH database, then boot the app's data
// layer against the restore and match ticket counts. The dump/restore tools
// resolve from the host PATH (CI ships postgresql-client) or, failing that,
// from the running test container via docker compose exec — the same
// binaries, reached the way each environment has them.

import { afterAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { tmpDb, testDatabaseUrl, type TmpDb } from "./helpers/tmp-db";

const handles: TmpDb[] = [];
afterAll(async () => {
  for (const h of handles) await h.dispose();
});

function urlParts() {
  const url = new URL(testDatabaseUrl());
  return { host: url.hostname, port: url.port || "5432", user: decodeURIComponent(url.username || "servo") };
}

/** Run pg_dump/psql, preferring the host binary and falling back to the
 *  test container. Inside the container the server is on its own unix
 *  socket, so the docker path drops the host/port the host path needs.
 *  Returns stdout; throws with both attempts' stderr. */
function pgTool(tool: string, args: string[], opts: { input?: string } = {}) {
  const env = { ...process.env, PGPASSWORD: "servo" };
  let hostError = "not on PATH";
  try {
    const r = spawnSync(tool, args, { encoding: "utf8", env, input: opts.input });
    if (r.status === 0) return String(r.stdout);
    hostError = `${r.status}: ${String(r.stderr).slice(0, 300)}`;
  } catch (e) {
    hostError = String(e);
  }
  // -h <host> -p <port> come in pairs; strip both for the socket path.
  const socketArgs = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "-h" || args[i] === "-p") i++;
    else socketArgs.push(args[i]);
  }
  const viaDocker = spawnSync(
    "docker",
    ["compose", "-f", "docker-compose.test.yml", "-p", "servo-test", "exec", "-T", "db", tool, ...socketArgs],
    { encoding: "utf8", env, input: opts.input },
  );
  if (viaDocker.status === 0) return String(viaDocker.stdout);
  throw new Error(
    `${tool} failed on both the host and the test container.\n` +
      `host: ${hostError}\n` +
      `docker: ${viaDocker.status}: ${String(viaDocker.stderr).slice(0, 300)}`,
  );
}

function psql(sql: string, database = "postgres") {
  const { host, port, user } = urlParts();
  return pgTool("psql", ["-h", host, "-p", port, "-U", user, "-d", database, "-v", "ON_ERROR_STOP=1", "-c", sql]);
}

describe("dump, restore, boot — offline check B", () => {
  it("a pg_dump of the live database restores into a fresh database the app can read", async () => {
    const handle = await tmpDb();
    handles.push(handle);
    const db = handle.client;

    // A database worth backing up: three tickets, comments, an attachment.
    const requester = await db.user.create({ data: { name: "R", email: `r${Date.now()}@x.com`, role: "REQUESTER" } });
    for (let i = 1; i <= 3; i++) {
      const ticket = await db.ticket.create({
        data: { number: 2000 + i, title: `Backup probe ${i}`, description: "counted after restore", requesterId: requester.id },
      });
      await db.comment.create({
        data: { ticketId: ticket.id, authorId: requester.id, body: `note ${i}`, kind: "HUMAN" },
      });
    }
    const sourceCount = await db.ticket.count();
    const sourceUsers = await db.user.count();
    expect(sourceCount).toBe(3);

    // Dump.
    const { host, port, user } = urlParts();
    const dump = pgTool("pg_dump", [
      "-h", host, "-p", port, "-U", user,
      "-d", new URL(handle.url).pathname.replace("/", ""),
    ]);
    expect(dump).toContain("COPY public.");
    // The source clone's pool can go before the restore: this file runs in
    // parallel with the rest of the suite, and connections are the shared
    // budget that exhausted once already.
    const [userCount] = await db.user.findMany({ take: 1 });
    void userCount;
    await db.$disconnect();
    await handle.dispose();
    handles.pop();

    // Restore into a fresh database.
    const restoreName = "servo_test_restore_probe";
    psql(`DROP DATABASE IF EXISTS ${restoreName} WITH (FORCE)`);
    psql(`CREATE DATABASE ${restoreName}`);
    pgTool("psql", ["-h", host, "-p", port, "-U", user, "-d", restoreName, "-v", "ON_ERROR_STOP=1"], { input: dump });

    // Boot the app's data layer against the restore and match counts.
    const { urlForDatabase } = await import("./helpers/tmp-db");
    const restoredUrl = urlForDatabase(restoreName) + "&connection_limit=2";
    const booted = new PrismaClient({ datasourceUrl: restoredUrl });
    try {
      expect(await booted.ticket.count()).toBe(sourceCount);
      const withComments = await booted.ticket.findFirst({
        where: { title: "Backup probe 1" },
        include: { comments: true },
      });
      expect(withComments?.comments).toHaveLength(1);
      expect(await booted.user.count()).toBe(sourceUsers);
    } finally {
      await booted.$disconnect();
    }

    psql(`DROP DATABASE ${restoreName} WITH (FORCE)`);
  }, 120_000);
});
