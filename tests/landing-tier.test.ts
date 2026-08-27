// loop-03: the landing-tier classifier and the two guards it delegates to.
// Every rule gets fixture coverage — no database, no network, no dependency.

import { describe, expect, it } from "vitest";
import { classifyMigration } from "../scripts/migration-guard.mjs";
import { classifyPermissionsDiff } from "../scripts/permissions-guard.mjs";
import {
  addedContentByFile,
  classifyLanding,
  diffTouchesRuntimeDependencies,
} from "../scripts/landing-tier.mjs";

function fileDiff(file: string, added: string[], removed: string[] = [], context: string[] = []): string {
  return [
    `diff --git a/${file} b/${file}`,
    `--- a/${file}`,
    `+++ b/${file}`,
    "@@ -1,3 +1,4 @@",
    ...context.map((l) => " " + l),
    ...removed.map((l) => "-" + l),
    ...added.map((l) => "+" + l),
  ].join("\n");
}

const changed = (path: string, status = "M") => ({ status, path });

describe("migration-guard", () => {
  const ADDITIVE = [
    'CREATE TABLE "KbGrant" ("id" TEXT NOT NULL, "access" TEXT NOT NULL);',
    'CREATE INDEX "KbGrant_doc_idx" ON "KbGrant"("documentId");',
    'CREATE UNIQUE INDEX "KbGrant_subject" ON "KbGrant"("subjectId");', // table created above
    "CREATE EXTENSION IF NOT EXISTS vector;",
    'CREATE TYPE "ticket_status" AS ENUM (\'OPEN\');',
    'ALTER TABLE "Ticket" ADD COLUMN "channel" TEXT;', // nullable
    'ALTER TABLE "Ticket" ADD COLUMN "pinned" BOOLEAN NOT NULL DEFAULT false;', // defaulted
    "-- a comment line is not a statement",
  ].join("\n\n");

  it("classifies creation-only SQL as additive", () => {
    expect(classifyMigration(ADDITIVE)).toEqual({ verdict: "additive", reasons: [] });
  });

  it("rejects DROP, ALTER COLUMN, RENAME and data mutation", () => {
    for (const sql of [
      'DROP TABLE "Old";',
      'ALTER TABLE "Ticket" ALTER COLUMN "title" SET DATA TYPE text;',
      'ALTER TABLE "Ticket" RENAME COLUMN "title" TO "subject";',
      'INSERT INTO "Ticket" ("id") VALUES (\'1\');',
      "UPDATE \"Setting\" SET value = 'x';",
      'CREATE OR REPLACE FUNCTION f() RETURNS trigger AS $$ BEGIN END $$ LANGUAGE plpgsql;',
    ]) {
      const verdict = classifyMigration(sql);
      expect(verdict.verdict).toBe("destructive");
      expect(verdict.reasons.length).toBeGreaterThan(0);
    }
  });

  it("rejects ADD COLUMN NOT NULL without a default", () => {
    const verdict = classifyMigration('ALTER TABLE "Ticket" ADD COLUMN "owner" TEXT NOT NULL;');
    expect(verdict.verdict).toBe("destructive");
    expect(verdict.reasons[0]).toMatch(/NOT NULL without DEFAULT/);
  });

  it("rejects a unique index on a pre-existing table", () => {
    const verdict = classifyMigration(
      'CREATE UNIQUE INDEX "ticket_number" ON "Ticket"("number");',
    );
    expect(verdict.verdict).toBe("destructive");
    expect(verdict.reasons[0]).toMatch(/unique index on pre-existing table "ticket"/);
  });

  it("treats ADD CONSTRAINT as non-additive", () => {
    expect(
      classifyMigration('ALTER TABLE "KbGrant" ADD CONSTRAINT one_target CHECK (num_nonnulls(a, b) = 1);')
        .verdict,
    ).toBe("destructive");
  });
});

describe("permissions-guard", () => {
  const CONTEXT = [
    'const MATRIX: Record<Action, Role[]> = {',
    '  "ticket.create": ["ADMIN", "AGENT", "REQUESTER"],',
    '  "ticket.update": ["ADMIN", "AGENT"],',
  ];
  const CLOSING = ["};"];

  it("accepts appended keys granting subsets of ADMIN/AGENT", () => {
    const diff = fileDiff(
      "src/lib/permissions.ts",
      [
        '  "kb.view": ["ADMIN", "AGENT"],',
        '  "kb.manage": ["ADMIN"],',
        '  "kb.upload": ["AGENT"],',
        ...CLOSING,
      ],
      [],
      CONTEXT,
    );
    expect(classifyPermissionsDiff(diff)).toEqual({ verdict: "additive", reasons: [] });
  });

  it("rejects a changed grant array on an existing key", () => {
    const diff = fileDiff(
      "src/lib/permissions.ts",
      ['  "ticket.update": ["ADMIN"],'],
      ['  "ticket.update": ["ADMIN", "AGENT"],'],
      CONTEXT.slice(0, 2),
    );
    const verdict = classifyPermissionsDiff(diff);
    expect(verdict.verdict).toBe("destructive");
    expect(verdict.reasons[0]).toMatch(/"ticket\.update" grant array changed/);
  });

  it("rejects a removed key", () => {
    const diff = fileDiff(
      "src/lib/permissions.ts",
      [],
      ['  "ticket.update": ["ADMIN", "AGENT"],'],
      ['  "ticket.create": ["ADMIN", "AGENT", "REQUESTER"],'],
    );
    expect(classifyPermissionsDiff(diff).reasons[0]).toMatch(/"ticket\.update" removed/);
  });

  it("rejects new keys granting REQUESTER or AI_AGENT", () => {
    for (const role of ["REQUESTER", "AI_AGENT"]) {
      const diff = fileDiff(
        "src/lib/permissions.ts",
        [`  "kb.view": ["ADMIN", "${role}"],`],
        [],
        CONTEXT,
      );
      const verdict = classifyPermissionsDiff(diff);
      expect(verdict.verdict).toBe("destructive");
      expect(verdict.reasons[0]).toMatch(new RegExp(`"kb\\.view" grants ${role}`));
    }
  });

  it("rejects new keys granting anything outside ADMIN/AGENT", () => {
    const diff = fileDiff("src/lib/permissions.ts", ['  "kb.view": ["SYS_ADMIN"],'], [], CONTEXT);
    expect(classifyPermissionsDiff(diff).reasons[0]).toMatch(/not a subset of/);
  });
});

describe("landing-tier classifier", () => {
  it("rates plain docs/tests/scripts diffs Tier A", async () => {
    const verdict = await classifyLanding({
      files: [changed("README.md"), changed("tests/x.test.ts"), changed("scripts/y.mjs")],
      diffText: fileDiff("README.md", ["docs change"]),
    });
    expect(verdict.tier).toBe("A");
  });

  it("rates any named Tier-C surface Tier C, alone", async () => {
    for (const file of [
      "src/lib/egress.ts",
      "src/app/api/mcp/route.ts",
      "src/lib/mcp.ts",
      "src/lib/ai/engine.ts",
      "Dockerfile",
      "docker-compose.yml",
    ]) {
      const verdict = await classifyLanding({ files: [changed(file)], diffText: "" });
      expect(verdict.tier).toBe("C");
      expect(verdict.reasons.join("\n")).toMatch(/Tier-C surface/);
    }
  });

  it("rates an additive migration + schema Tier B", async () => {
    const sql = 'CREATE TABLE "Thing" ("id" TEXT NOT NULL);\nCREATE INDEX "T_idx" ON "Thing"("id");';
    const diffText = fileDiff("prisma/migrations/0003_thing/migration.sql", sql.split("\n"));
    const verdict = await classifyLanding({
      files: [
        changed("prisma/schema.prisma"),
        changed("prisma/migrations/0003_thing/migration.sql", "A"),
      ],
      diffText: diffText + "\n" + fileDiff("prisma/schema.prisma", ['model Thing { id String @id }']),
    });
    expect(verdict.tier).toBe("B");
    expect(verdict.reasons.join("\n")).toMatch(/additive migration/);
  });

  it("rates a destructive migration Tier C", async () => {
    const sql = 'DROP TABLE "Thing";';
    const diffText = fileDiff("prisma/migrations/0004_drop/migration.sql", [sql]);
    const verdict = await classifyLanding({
      files: [changed("prisma/schema.prisma"), changed("prisma/migrations/0004_drop/migration.sql", "A")],
      diffText,
    });
    expect(verdict.tier).toBe("C");
    expect(verdict.reasons.join("\n")).toMatch(/migration-guard rejects/);
  });

  it("rates a schema change with no migration Tier C", async () => {
    const verdict = await classifyLanding({
      files: [changed("prisma/schema.prisma")],
      diffText: fileDiff("prisma/schema.prisma", ["model Extra {}"]),
    });
    expect(verdict.tier).toBe("C");
    expect(verdict.reasons.join("\n")).toMatch(/no prisma\/migrations\/ entry/);
  });

  it("rates additive permissions Tier B and rejected ones Tier C", async () => {
    const good = fileDiff(
      "src/lib/permissions.ts",
      ['  "kb.view": ["ADMIN", "AGENT"],'],
      [],
      ['  "kpi.view": ["ADMIN", "AGENT"],'],
    );
    expect((await classifyLanding({ files: [changed("src/lib/permissions.ts")], diffText: good })).tier).toBe("B");

    const bad = fileDiff(
      "src/lib/permissions.ts",
      ['  "kpi.view": ["ADMIN"],'],
      ['  "kpi.view": ["ADMIN", "AGENT"],'],
      [],
    );
    expect((await classifyLanding({ files: [changed("src/lib/permissions.ts")], diffText: bad })).tier).toBe("C");
  });

  it("classifies tool-policy diffs C while policy-guard is missing, B when it approves", async () => {
    const files = [changed("src/lib/ai/tool-policies.ts")];
    const diffText = fileDiff("src/lib/ai/tool-policies.ts", [
      '  { toolName: "search_knowledge", riskLevel: "LOW", requiresApproval: false },',
    ]);
    const missing = await classifyLanding({ files, diffText }, { loadPolicyGuard: async () => null });
    expect(missing.tier).toBe("C");
    expect(missing.reasons.join("\n")).toMatch(/policy-guard\.mjs is missing/);

    const approving = await classifyLanding(
      { files, diffText },
      {
        loadPolicyGuard: async () => ({
          classifyToolPoliciesDiff: () => ({ verdict: "additive", reasons: [] }),
        }),
      },
    );
    expect(approving.tier).toBe("B");

    const rejecting = await classifyLanding(
      { files, diffText },
      {
        loadPolicyGuard: async () => ({
          classifyToolPoliciesDiff: () => ({ verdict: "destructive", reasons: ["existing row edited"] }),
        }),
      },
    );
    expect(rejecting.tier).toBe("C");
    expect(rejecting.reasons.join("\n")).toMatch(/existing row edited/);
  });

  it("flags runtime dependency changes but not devDependency-only ones", async () => {
    const runtime = [
      'diff --git a/package.json b/package.json',
      '--- a/package.json',
      '+++ b/package.json',
      '@@ -18,3 +18,4 @@',
      '  "dependencies": {',
      '-    "next": "^15.1.6",',
      '+    "next": "^15.1.6",',
      '+    "exceljs": "^4.4.0",',
    ].join("\n");
    expect(diffTouchesRuntimeDependencies(runtime)).toBe(true);
    expect(
      (await classifyLanding({ files: [changed("package.json")], diffText: runtime })).tier,
    ).toBe("C");

    const dev = [
      'diff --git a/package.json b/package.json',
      '--- a/package.json',
      '+++ b/package.json',
      '@@ -46,3 +46,4 @@',
      '  "devDependencies": {',
      '+    "gifenc": "^1.0.3",',
    ].join("\n");
    expect(diffTouchesRuntimeDependencies(dev)).toBe(false);
    expect((await classifyLanding({ files: [changed("package.json")], diffText: dev })).tier).toBe("A");
  });

  it("reconstructs added file content per path", () => {
    const diff = [
      fileDiff("prisma/migrations/0001_a/migration.sql", ["CREATE TABLE A(id TEXT);"]),
      fileDiff("src/x.ts", ["export const x = 1;"]),
    ].join("\n");
    const byFile = addedContentByFile(diff);
    expect(byFile.get("prisma/migrations/0001_a/migration.sql")).toBe("CREATE TABLE A(id TEXT);");
    expect(byFile.get("src/x.ts")).toBe("export const x = 1;");
    expect(byFile.has("src/untouched.ts")).toBe(false);
  });
});
