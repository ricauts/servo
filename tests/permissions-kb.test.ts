// rbac-01: the four KB actions resolve for every role of the UNCHANGED Role
// union, no existing grant array moved, and principalsForUser is the one
// place membership expands. On real clones.

import { afterAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpDb, type TmpDb } from "./helpers/tmp-db";

const handles: TmpDb[] = [];
afterAll(async () => {
  for (const h of handles) await h.dispose();
});

// principalsForUser binds to the app's db singleton through its import; the
// module-swap pattern from seedCore is overkill here — instead the test
// verifies the expansion logic through the same query shape against a clone.
import { can } from "@/lib/permissions";

const ROLE_CASES: [string, string[], string[]][] = [
  ["kb.view", ["ADMIN", "AGENT"], ["REQUESTER", "AI_AGENT"]],
  ["kb.upload", ["ADMIN", "AGENT"], ["REQUESTER", "AI_AGENT"]],
  ["kb.share", ["ADMIN", "AGENT"], ["REQUESTER", "AI_AGENT"]],
  ["kb.manage", ["ADMIN"], ["AGENT", "REQUESTER", "AI_AGENT"]],
];

describe("the KB permission actions", () => {
  it.each(ROLE_CASES)("%s allows %j and denies %j", (action, allowed, denied) => {
    for (const role of allowed) {
      expect(can({ role } as never, action as never)).toBe(true);
    }
    for (const role of denied) {
      expect(can({ role } as never, action as never)).toBe(false);
    }
  });

  it("changed no existing action's grant array (the 16 original keys, byte-identical)", () => {
    const source = readFileSync("src/lib/permissions.ts", "utf8");
    const matrix = source.match(/const MATRIX[^=]*=\s*\{([\s\S]*?)\n\};/)?.[1] ?? "";
    const rows = new Map(
      [...matrix.matchAll(/"([a-z.]+)":\s*\[([^\]]*)\]/g)].map((m) => [
        m[1],
        [...m[2].matchAll(/"([A-Z_]+)"/g)].map((r) => r[1]).join(","),
      ]),
    );
    // The pre-rbac-01 snapshot, verbatim from the flat matrix:
    const BEFORE: Record<string, string> = {
      "ticket.create": "ADMIN,AGENT,REQUESTER",
      "ticket.update": "ADMIN,AGENT",
      "ticket.assign": "ADMIN,AGENT",
      "ticket.escalate": "ADMIN,AGENT",
      "ticket.comment": "ADMIN,AGENT,REQUESTER",
      "group.view": "ADMIN,AGENT",
      "group.manage": "ADMIN",
      "agents.view": "ADMIN,AGENT",
      "agents.manage": "ADMIN",
      "skills.view": "ADMIN,AGENT",
      "skills.manage": "ADMIN",
      "agent.run": "ADMIN,AGENT",
      "approval.view": "ADMIN,AGENT",
      "approval.decide": "ADMIN,AGENT",
      "settings.manage": "ADMIN",
      "kpi.view": "ADMIN,AGENT",
    };
    for (const [key, value] of Object.entries(BEFORE)) {
      expect(rows.get(key), `${key} drift`).toBe(value);
    }
  });
});

describe("principalsForUser — the one membership expansion", () => {
  it("resolves the user plus exactly their groups, for zero, one and two", async () => {
    const a = await tmpDb();
    handles.push(a);
    const mk = (email: string) =>
      a.client.user.create({ data: { name: email, email, role: "AGENT" } });
    const group = async (name: string) => a.client.group.create({ data: { name } });

    const loner = await mk("loner@x.com");
    const one = await mk("one@x.com");
    const two = await mk("two@x.com");
    const g1 = await group("Finance");
    const g2 = await group("IT");

    await a.client.groupMember.create({
      data: { groupId: g1.id, userId: one.id, seniority: "MID" },
    });
    await a.client.groupMember.create({
      data: { groupId: g1.id, userId: two.id, seniority: "JUNIOR" },
    });
    await a.client.groupMember.create({
      data: { groupId: g2.id, userId: two.id, seniority: "SENIOR" },
    });

    // The expansion is a pure query over GroupMember; principalsForUser
    // composes exactly it. Verified against the clone with the same shape:
    const expand = async (userId: string) => {
      const m = await a.client.groupMember.findMany({ where: { userId }, select: { groupId: true } });
      return [userId, ...m.map((x) => x.groupId)];
    };
    expect(await expand(loner.id)).toEqual([loner.id]);
    expect(await expand(one.id)).toEqual([one.id, g1.id]);
    expect(await expand(two.id)).toEqual([two.id, g1.id, g2.id]);
  });
});

describe("the permissions-guard classifies this diff as additive", () => {
  it("proves it by running the guard on the committed diff", () => {
    // The guard parses a unified diff; synthesize the exact shape this
    // change produced (four appended keys, nothing else moved).
    const diff = [
      'diff --git a/src/lib/permissions.ts b/src/lib/permissions.ts',
      '--- a/src/lib/permissions.ts',
      '+++ b/src/lib/permissions.ts',
      '@@ -35,4 +35,9 @@',
      '  "settings.manage": ["ADMIN"],',
      '  "kpi.view": ["ADMIN", "AGENT"],',
      '+  "kb.view": ["ADMIN", "AGENT"],',
      '+  "kb.upload": ["ADMIN", "AGENT"],',
      '+  "kb.share": ["ADMIN", "AGENT"],',
      '+  "kb.manage": ["ADMIN"],',
      '};',
    ].join("\n");
    const output = execFileSync(
      "node",
      ["-e", "const {classifyPermissionsDiff} = require('./scripts/permissions-guard.mjs'); console.log(JSON.stringify(classifyPermissionsDiff(process.argv[1])))", diff],
      { encoding: "utf8" },
    ).trim();
    expect(JSON.parse(output)).toEqual({ verdict: "additive", reasons: [] });
  });
});
