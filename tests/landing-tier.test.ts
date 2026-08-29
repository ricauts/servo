// loop-03: the landing-tier classifier and the two guards it delegates to.
// Every rule gets fixture coverage — no database, no network, no dependency.

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { classifyMigration } from "../scripts/migration-guard.mjs";
import { classifyPermissionsDiff } from "../scripts/permissions-guard.mjs";
import {
  addedContentByFile,
  classifyLanding,
  diffTouchesRuntimeDependencies,
  parseNameStatusWithScore,
  removedDependencyEntries,
  removedDependencyNames,
  removedExportedSymbols,
} from "../scripts/landing-tier.mjs";

/** A dependency block long enough that git's three lines of context hide its header. */
const DEPS: Record<string, string> = {
  "@types/node": "^22.10.0",
  "@types/react": "^19.0.0",
  gifenc: "^1.0.3",
  postcss: "^8.4.49",
  typescript: "^5.7.3",
};

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
    'CREATE SCHEMA IF NOT EXISTS "public";', // prisma migrate diff emits this
    // Prisma emits same-file FK constraints after each CREATE TABLE:
    'ALTER TABLE "KbGrant" ADD CONSTRAINT "KbGrant_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;',
    'ALTER TABLE "Ticket" ADD COLUMN "channel" TEXT;', // nullable
    'ALTER TABLE "Ticket" ADD COLUMN "pinned" BOOLEAN NOT NULL DEFAULT false;', // defaulted
    "-- a comment line is not a statement",
  ].join("\n\n");

  it("classifies creation-only SQL as additive", () => {
    expect(classifyMigration(ADDITIVE)).toEqual({ verdict: "additive", reasons: [] });
  });

  it("classifies a sequence plus its forward-only backfill as additive (db-03)", () => {
    // The exact shape of migration 0002_ticket_number_seq: create the
    // sequence, then point it past the MAX of an existing column so an
    // upgrade's first nextval cannot collide. COALESCE keeps an empty
    // table correct.
    const sql = [
      "CREATE SEQUENCE ticket_number_seq START 1001;",
      'SELECT setval(\'ticket_number_seq\', (SELECT COALESCE(MAX("number"), 1000) FROM "Ticket"));',
    ].join("\n\n");
    expect(classifyMigration(sql)).toEqual({ verdict: "additive", reasons: [] });
  });

  it("rejects a setval the shape does not sanction", () => {
    // A sequence this migration did NOT create:
    const foreign = classifyMigration(
      'SELECT setval(\'other_seq\', (SELECT COALESCE(MAX("n"), 1) FROM "T"));',
    );
    expect(foreign.verdict).toBe("destructive");
    expect(foreign.reasons[0]).toMatch(/sequence this migration did not create/);
    // A literal instead of the COALESCE subselect — not the sanctioned shape:
    const literal = classifyMigration("SELECT setval('ticket_number_seq', 42);");
    expect(literal.verdict).toBe("destructive");
    expect(literal.reasons[0]).toMatch(/non-additive/);
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
      // docker-compose.test.yml is deliberately NOT a Tier-C surface: it
      // starts a throwaway test container; §0.6 rule 6 names the app's
      // production compose file.
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

// hyg-01 §13.1 clause 2: the classifier and the written deletion rail must
// agree. Deleting a tracked file, removing an exported symbol or dropping a
// dependency line is Tier C; a PURE rename is not a deletion.
describe("landing-tier: the deletion rule", () => {
  it("keeps the rename similarity score parseNameStatus drops", () => {
    const parsed = parseNameStatusWithScore(
      ["M\tsrc/a.ts", "D\tsrc/gone.ts", "R100\tsrc/old.ts\tsrc/new.ts", "R087\tsrc/x.ts\tsrc/y.ts"].join("\n"),
    );
    expect(parsed).toEqual([
      { status: "M", score: null, path: "src/a.ts", fromPath: null },
      { status: "D", score: null, path: "src/gone.ts", fromPath: null },
      { status: "R", score: 100, path: "src/new.ts", fromPath: "src/old.ts" },
      { status: "R", score: 87, path: "src/y.ts", fromPath: "src/x.ts" },
    ]);
  });

  it("classifies a deleted tracked file as C", async () => {
    const verdict = await classifyLanding({
      files: [{ status: "D", path: "src/components/legacy/Button.tsx" }],
      diffText: "",
    });
    expect(verdict.tier).toBe("C");
    expect(verdict.reasons.join(" ")).toMatch(/deleted/);
  });

  it("leaves a PURE rename at A, and raises a rename-plus-edit to C", async () => {
    const pure = await classifyLanding({
      files: [{ status: "R", score: 100, path: "src/components/common/Badge.tsx", fromPath: "src/components/legacy/Badge.tsx" }],
      diffText: "",
    });
    expect(pure.tier).toBe("A");

    const edited = await classifyLanding({
      files: [{ status: "R", score: 87, path: "src/components/common/Badge.tsx", fromPath: "src/components/legacy/Badge.tsx" }],
      diffText: "",
    });
    expect(edited.tier).toBe("C");
    expect(edited.reasons.join(" ")).toMatch(/R87/);
  });

  it("treats a rename with no score as C — unknown must not resolve to safe", async () => {
    const verdict = await classifyLanding({
      files: [{ status: "R", path: "src/b.ts" }],
      diffText: "",
    });
    expect(verdict.tier).toBe("C");
  });

  it("classifies a removed exported symbol as C, but not one moved within the diff", async () => {
    const removed = fileDiff("src/lib/utils.ts", [], ["export function timeAgo(d: Date) {}"]);
    expect(removedExportedSymbols(removed)).toEqual(["timeAgo"]);
    expect((await classifyLanding({ files: [changed("src/lib/utils.ts")], diffText: removed })).tier).toBe("C");

    const moved = fileDiff(
      "src/lib/utils.ts",
      ["export function timeAgo(d: Date | string) {}"],
      ["export function timeAgo(d: Date) {}"],
    );
    expect(removedExportedSymbols(moved)).toEqual([]);
    expect((await classifyLanding({ files: [changed("src/lib/utils.ts")], diffText: moved })).tier).toBe("A");
  });

  it("classifies a removed package.json dependency line as C, in either block", async () => {
    const dropped = [
      "diff --git a/package.json b/package.json",
      "--- a/package.json",
      "+++ b/package.json",
      "@@ -46,3 +46,2 @@",
      '  "devDependencies": {',
      '-    "gifenc": "^1.0.3",',
    ].join("\n");
    expect(removedDependencyNames(dropped)).toEqual(["gifenc"]);
    // devDependencies do not raise the ADD rule, but removing one still does:
    // npm ci breaks either way.
    expect(diffTouchesRuntimeDependencies(dropped)).toBe(false);
    expect((await classifyLanding({ files: [changed("package.json")], diffText: dropped })).tier).toBe("C");

    const bumped = [
      "diff --git a/package.json b/package.json",
      "--- a/package.json",
      "+++ b/package.json",
      "@@ -46,3 +46,3 @@",
      '  "devDependencies": {',
      '-    "gifenc": "^1.0.3",',
      '+    "gifenc": "^1.0.4",',
    ].join("\n");
    expect(removedDependencyNames(bumped)).toEqual([]);
  });

  it("catches a removed export in every form the tree actually uses", async () => {
    const cases: [string, string[], string][] = [
      ["declaration", ["export function timeAgo(d: Date) {}"], "timeAgo"],
      ["abstract class", ["export abstract class Base {}"], "Base"],
      ["type alias", ["export type RunKind = string;"], "RunKind"],
      ["one-line list", ["export { Card, CardTitle };"], "CardTitle"],
      ["type-only list", ["export type { SlaTicketFields };"], "SlaTicketFields"],
      ["destructured const", ["export const { alpha, beta } = obj;"], "beta"],
      ["star re-export", ['export * from "./legacy";'], "*:./legacy"],
      ["namespaced star", ['export * as legacy from "./legacy";'], "legacy"],
    ];
    for (const [label, removed, name] of cases) {
      const diff = fileDiff("src/lib/x.ts", [], removed);
      expect(removedExportedSymbols(diff), label).toContain(name);
      expect((await classifyLanding({ files: [changed("src/lib/x.ts")], diffText: diff })).tier, label).toBe("C");
    }
  });

  it("catches a name removed from a MULTILINE export list, where the header is only context", () => {
    // Fourteen files in src/ use this shape. In a diff the removed line is just
    // "  Bar," — a line-local regex sees no `export` at all and calls it Tier A.
    const diff = [
      "diff --git a/src/components/ui/card.tsx b/src/components/ui/card.tsx",
      "--- a/src/components/ui/card.tsx",
      "+++ b/src/components/ui/card.tsx",
      "@@ -80,6 +80,5 @@",
      " export {",
      "   Card,",
      "   CardHeader,",
      "-  CardFooter,",
      "   CardTitle,",
      " };",
    ].join("\n");
    expect(removedExportedSymbols(diff)).toEqual(["CardFooter"]);
  });

  it("does not let a removal in one file be cancelled by an addition in another", () => {
    const diff = [
      fileDiff("src/a.tsx", [], ["export default function A() {}"]),
      fileDiff("src/b.tsx", ["export default function B() {}"], []),
    ].join("\n");
    expect(removedExportedSymbols(diff)).toEqual(["default"]);
  });

  it("catches a dependency removed mid-list, where git's context never shows the block header", async () => {
    // This is what `git diff` actually produces: three lines of context and no
    // `"devDependencies": {` in sight.
    const diff = [
      "diff --git a/package.json b/package.json",
      "--- a/package.json",
      "+++ b/package.json",
      "@@ -50,7 +50,6 @@",
      '     "@types/react": "^19.0.0",',
      '     "@types/react-dom": "^19.0.0",',
      '-    "gifenc": "^1.0.3",',
      '     "oauth2-mock-server": "^9.1.0",',
      '     "postcss": "^8.4.49",',
    ].join("\n");
    expect(removedDependencyEntries(diff)).toEqual([{ name: "gifenc", block: "block-unknown" }]);
    expect((await classifyLanding({ files: [changed("package.json")], diffText: diff })).tier).toBe("C");
  });

  it("does not fire on a version bump, or on a removed npm script", async () => {
    const bump = [
      "diff --git a/package.json b/package.json",
      "--- a/package.json",
      "+++ b/package.json",
      "@@ -50,7 +50,7 @@",
      '-    "gifenc": "^1.0.3",',
      '+    "gifenc": "^1.0.4",',
    ].join("\n");
    expect(removedDependencyEntries(bump)).toEqual([]);

    const script = [
      "diff --git a/package.json b/package.json",
      "--- a/package.json",
      "+++ b/package.json",
      "@@ -8,7 +8,6 @@",
      '   "scripts": {',
      '     "dev": "next dev -p 3000",',
      '-    "demo": "prisma generate",',
      '     "typecheck": "tsc --noEmit"',
    ].join("\n");
    expect(removedDependencyNames(script)).toEqual([]);
    expect((await classifyLanding({ files: [changed("package.json")], diffText: script })).tier).toBe("A");
  });

  it("classifies a REAL git diff of a deletion, produced by git itself", () => {
    // The synthetic fixtures above can flatter the parsers. This one is the
    // exact bytes git emits.
    const dir = mkdtempSync(path.join(os.tmpdir(), "landing-tier-"));
    try {
      const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
      git("init", "-q");
      git("config", "user.email", "t@example.com");
      git("config", "user.name", "t");
      writeFileSync(path.join(dir, "package.json"), JSON.stringify({ devDependencies: DEPS }, null, 2) + "\n");
      writeFileSync(path.join(dir, "mod.ts"), "export {\n  Alpha,\n  Beta,\n  Gamma,\n};\n");
      git("add", "-A");
      git("commit", "-qm", "base");
      const { gifenc: _dropped, ...rest } = DEPS;
      writeFileSync(path.join(dir, "package.json"), JSON.stringify({ devDependencies: rest }, null, 2) + "\n");
      writeFileSync(path.join(dir, "mod.ts"), "export {\n  Alpha,\n  Gamma,\n};\n");
      git("add", "-A");
      const diff = git("diff", "--cached");
      expect(removedDependencyNames(diff)).toEqual(["gifenc"]);
      expect(removedExportedSymbols(diff)).toEqual(["Beta"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("puts .dockerignore beside Dockerfile and docker-compose.yml", async () => {
    const verdict = await classifyLanding({ files: [changed(".dockerignore")], diffText: "" });
    expect(verdict.tier).toBe("C");
    expect(verdict.reasons.join(" ")).toMatch(/\.dockerignore/);
  });
});
