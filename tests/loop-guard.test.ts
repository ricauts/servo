// loop-02: every rail of the preflight guard, one passing and one failing
// fixture each (at minimum). The checks are pure functions over plain
// strings — no real git state, no database, no new dependency.

import { describe, expect, it } from "vitest";
import {
  checkBranch,
  checkDatabase,
  checkDbPush,
  checkMigrations,
  checkPorcelain,
  checkStagedDiff,
  parseDatabaseName,
  parseNameStatus,
  runGuard,
} from "../scripts/loop-guard.mjs";

/** A minimal unified diff with one hunk, so rail 2 has real structure. */
function diff(file: string, added: string[] = [], removed: string[] = []): string {
  return [
    `diff --git a/${file} b/${file}`,
    "--- a/" + file,
    "+++ b/" + file,
    "@@ -1,2 +1,2 @@",
    ...removed.map((l) => "-" + l),
    ...added.map((l) => "+" + l),
  ].join("\n");
}

describe("rail 1 — database name", () => {
  it("refuses the dev database, file: or postgres", () => {
    for (const url of [
      "file:./prisma/dev.db",
      "file:/data/dev.db",
      "postgresql://servo:servo@localhost:5432/dev?schema=public",
    ]) {
      const r = checkDatabase(url);
      expect(r.ok).toBe(false);
      expect(r.reason).toMatch(/dev database/);
    }
  });

  it("refuses the demo database", () => {
    const r = checkDatabase("file:./demo.db");
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/demo database/);
  });

  it("passes the app database and servo_test_* throwaways", () => {
    expect(checkDatabase("postgresql://servo:servo@localhost:5432/servo?schema=public").ok).toBe(true);
    expect(checkDatabase("postgresql://servo:servo@localhost:5433/servo_test_8012").ok).toBe(true);
    expect(checkDatabase("").ok).toBe(true); // nothing resolved, nothing to refuse
  });

  it("compares the parsed name, never the raw string", () => {
    // The password contains "dev.db"; the database is "servo" — must pass.
    expect(parseDatabaseName("postgresql://user:dev.db@localhost:5432/servo")).toBe("servo");
    expect(checkDatabase("postgresql://user:dev.db@localhost:5432/servo").ok).toBe(true);
    expect(parseDatabaseName("file:./prisma/dev.db")).toBe("dev.db");
  });
});

describe("rail 1b — prisma db push", () => {
  it("refuses any database that is not a servo_test_* throwaway", () => {
    for (const url of [
      "postgresql://servo:servo@localhost:5432/servo",
      "file:./prisma/dev.db",
      "postgresql://servo:servo@localhost:5432/demo",
    ]) {
      expect(checkDbPush(url).ok).toBe(false);
    }
  });

  it("allows servo_test_* and refuses to run blind", () => {
    expect(checkDbPush("postgresql://servo:servo@localhost:5433/servo_test_8012").ok).toBe(true);
    expect(checkDbPush("").ok).toBe(false); // no URL resolved: fail closed
  });
});

describe("rail 2 — secrets in the staged diff", () => {
  it("refuses every spec pattern on an added line in source", () => {
    const fixtures = [
      'const key = "sk-ant-abc123";',
      "aws_access_key_id = AKIA1234567890ABCDEF",
      "token: ghp_16CharacterToken__",
      "github_pat_11ABCDEFG0abcdefghijklmnop",
      "-----BEGIN OPENSSH PRIVATE KEY-----",
      'apiKey: "enc:v1:9f2c…"',
    ];
    for (const line of fixtures) {
      const r = checkStagedDiff(diff("src/lib/settings.ts", [line]));
      expect(r.ok).toBe(false);
      expect(r.reason).toMatch(/rail 2/);
    }
  });

  it("passes a clean diff, and exempts tests/fixtures paths", () => {
    expect(checkStagedDiff(diff("src/lib/settings.ts", ["const x = 1;"])).ok).toBe(true);
    // Fixture secrets are test data, not live credentials.
    expect(checkStagedDiff(diff("tests/fixtures/policy-baseline.json", ['"enc:v1:deadbeef"'])).ok).toBe(true);
    expect(checkStagedDiff(diff("fixtures/secrets.txt", ["sk-ant-fixture"])).ok).toBe(true);
    // Removed/context lines cannot introduce a secret into the repo.
    expect(
      checkStagedDiff(diff("src/lib/settings.ts", [], ['const key = "sk-ant-abc123";'])).ok,
    ).toBe(true);
  });

  it("allows a marked pattern-definition block, and only inside its markers", () => {
    // The guard's own pattern table names the prefixes it detects.
    const marked = diff("scripts/loop-guard.mjs", [
      "// loop-guard:allowlist-start",
      '{ name: "Anthropic API key (sk-ant-)", re: /sk-ant-/ },',
      "// loop-guard:allowlist-end",
    ]);
    expect(checkStagedDiff(marked).ok).toBe(true);
    // Without the markers the same line is a hit — the exemption is the
    // greppable marker pair, not the file path.
    const unmarked = diff("scripts/loop-guard.mjs", [
      '{ name: "Anthropic API key (sk-ant-)", re: /sk-ant-/ },',
    ]);
    expect(checkStagedDiff(unmarked).ok).toBe(false);
    // Markers never leak into a following file in the same diff.
    const leak = marked + "\n" + diff("src/lib/keys.ts", ["sk-ant-abc"]);
    expect(checkStagedDiff(leak).ok).toBe(false);
  });
});

describe("rail 3 — default branch", () => {
  it("refuses main and master", () => {
    expect(checkBranch("main").ok).toBe(false);
    expect(checkBranch("master").ok).toBe(false);
  });

  it("passes a work branch", () => {
    expect(checkBranch("feat/loop-02").ok).toBe(true);
  });
});

describe("rail 4 — prisma/*.db* residue", () => {
  it("refuses any porcelain line listing a prisma database file", () => {
    for (const porcelain of [
      "?? prisma/dev.db\nM  src/lib/mcp.ts",
      "M  prisma/dev.db-journal", // the * in *.db* covers -journal siblings
      " M prisma/demo.db", // leading space = unstaged slot; still residue
      "R  src/old.ts -> prisma/demo.db", // renames are judged by the final path
    ]) {
      const r = checkPorcelain(porcelain);
      expect(r.ok).toBe(false);
      expect(r.reason).toMatch(/rail 4/);
    }
  });

  it("passes ordinary working-tree noise", () => {
    expect(checkPorcelain("M src/lib/mcp.ts\n?? tests/loop-guard.test.ts").ok).toBe(true);
    expect(checkPorcelain("").ok).toBe(true);
  });
});

describe("rail 5 — schema change needs a migration", () => {
  const SCHEMA = { status: "M", path: "prisma/schema.prisma" };

  it("is inert while prisma/migrations/ does not exist, and says so", () => {
    const r = checkMigrations([SCHEMA], false);
    expect(r.ok).toBe(true);
    expect(r.note).toMatch(/inert/);
  });

  it("refuses a schema change with no migration once the directory exists", () => {
    const r = checkMigrations([SCHEMA, { status: "M", path: "src/lib/x.ts" }], true);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/rail 5/);
  });

  it("passes a schema change that adds a migration, and ignores unrelated diffs", () => {
    expect(
      checkMigrations([SCHEMA, { status: "A", path: "prisma/migrations/0003_kb/migration.sql" }], true).ok,
    ).toBe(true);
    expect(checkMigrations([{ status: "M", path: "src/lib/x.ts" }], true).ok).toBe(true);
  });

  it("parses name-status output, including rename scores", () => {
    expect(
      parseNameStatus("A\tscripts/x.mjs\nM\tprisma/schema.prisma\nR100\told.ts\tnew.ts\n"),
    ).toEqual([
      { status: "A", path: "scripts/x.mjs" },
      { status: "M", path: "prisma/schema.prisma" },
      { status: "R", path: "new.ts" },
    ]);
  });
});

describe("runGuard — the whole preflight in one call", () => {
  it("names every failed rail", () => {
    const results = runGuard({
      databaseUrl: "file:./prisma/dev.db",
      branch: "main",
      porcelain: "?? prisma/dev.db",
      stagedDiff: diff("src/lib/keys.ts", ["sk-ant-abc"]),
      changedFiles: [{ status: "M", path: "src/lib/keys.ts" }],
      migrationsDirExists: false,
    });
    const rails = results.filter((r) => !r.ok).map((r) => r.rail);
    expect(rails).toContain("rail 1 (database)");
    expect(rails).toContain("rail 2 (secrets)");
    expect(rails).toContain("rail 3 (branch)");
    expect(rails).toContain("rail 4 (residue)");
  });

  it("passes a healthy tick and only applies rail 1b on intent", () => {
    const inputs = {
      databaseUrl: "postgresql://servo:servo@localhost:5433/servo_test_8012",
      branch: "feat/loop-02",
      porcelain: "M scripts/loop-guard.mjs",
      stagedDiff: diff("scripts/loop-guard.mjs", ["export function checkBranch() {}"]),
      changedFiles: [{ status: "A", path: "scripts/loop-guard.mjs" }],
      migrationsDirExists: false,
    };
    expect(resultsOk(runGuard(inputs))).toBe(true);
    expect(resultsOk(runGuard(inputs, { dbPushIntent: true }))).toBe(true);
    // The same database with db-push intent against the app database fails.
    expect(
      resultsOk(runGuard({ ...inputs, databaseUrl: "postgresql://servo:servo@localhost:5432/servo" }, { dbPushIntent: true })),
    ).toBe(false);
  });
});

function resultsOk(results: { ok: boolean }[]): boolean {
  return results.every((r) => r.ok);
}
