// loop-06: the quarantine rail (§0.8 rail 4) as executable invariants.
// Adding a tool without a policy row, ungated outside the baseline, minting
// a non-core policy row outside quarantineRow(), or editing a baseline
// snapshot all FAIL here with a message naming the tool.

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { TOOLS } from "@/lib/ai/tools";
import { DEFAULT_TOOL_POLICIES } from "@/lib/ai/tool-policies";
import {
  QUARANTINE_TRIPLE,
  classifyToolPoliciesDiff,
  parseBaseline,
  quarantineRow,
} from "../scripts/policy-guard.mjs";
import baselineJson from "./fixtures/policy-baseline.json";

const baseline = parseBaseline(JSON.stringify(baselineJson));

/** Walk files under a directory (relative to repo root), text only. */
function walk(dir: string): string[] {
  const root = path.resolve(__dirname, "..", dir);
  const out: string[] = [];
  try {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      const full = path.join(root, entry.name);
      if (entry.isDirectory()) out.push(...walk(path.join(dir, entry.name)));
      else if (/\.(ts|tsx|mjs|cjs|js)$/.test(entry.name)) out.push(full);
    }
  } catch {
    /* directory absent — nothing to walk */
  }
  return out;
}

const toRepoPath = (abs: string) => path.relative(path.resolve(__dirname, ".."), abs).replace(/\\/g, "/");

describe("built-in tools and default policies are 1:1", () => {
  it("every registry tool has exactly one DEFAULT_TOOL_POLICIES row with the same name", () => {
    const names = new Set(DEFAULT_TOOL_POLICIES.map((p) => p.toolName));
    for (const name of Object.keys(TOOLS)) {
      expect(names.has(name), `"${name}" is in the registry but has no DEFAULT_TOOL_POLICIES row`).toBe(true);
    }
  });

  it("every DEFAULT_TOOL_POLICIES row corresponds to a registry tool", () => {
    for (const p of DEFAULT_TOOL_POLICIES) {
      expect(
        TOOLS[p.toolName],
        `"${p.toolName}" has a policy row but no tool in the registry`,
      ).toBeDefined();
    }
  });
});

describe("the baseline and the quarantine triple", () => {
  it("every baselined tool's row matches its snapshot exactly", () => {
    for (const p of DEFAULT_TOOL_POLICIES) {
      const snap = baseline.get(p.toolName);
      if (!snap) continue;
      expect(
        { riskLevel: p.riskLevel, requiresApproval: p.requiresApproval },
        `"${p.toolName}" drifted from its baseline snapshot — owner sign-off required`,
      ).toEqual(snap);
    }
  });

  it("a tool absent from the baseline MUST carry the triple's riskLevel and approval flag", () => {
    for (const p of DEFAULT_TOOL_POLICIES) {
      if (baseline.has(p.toolName)) continue;
      expect(
        { riskLevel: p.riskLevel, requiresApproval: p.requiresApproval },
        `"${p.toolName}" is not baselined, so it must ship HIGH-risk and approval-gated (enabled:false is the DB default for non-core intake)`,
      ).toEqual({ riskLevel: "HIGH", requiresApproval: true });
    }
  });

  it("the baseline covers exactly today's default rows", () => {
    const names = new Set(DEFAULT_TOOL_POLICIES.map((p) => p.toolName));
    for (const name of baseline.keys()) {
      expect(names.has(name), `baseline entry "${name}" has no default row — prune it`).toBe(true);
    }
  });
});

describe("quarantineRow — the only way a non-core tool gets a policy", () => {
  it("returns the triple regardless of any manifest declaration", () => {
    const row = quarantineRow("mcp__fixture__echo", "Echo", { riskLevel: "LOW" });
    expect(row.riskLevel).toBe("HIGH");
    expect(row.requiresApproval).toBe(true);
    expect(row.enabled).toBe(false);
    expect(row.declaredRiskLevel).toBe("LOW"); // recorded…
    expect(QUARANTINE_TRIPLE).toEqual({ enabled: false, requiresApproval: true, riskLevel: "HIGH" });
  });

  it("a fixture declaring riskLevel LOW still lands HIGH — there is no floor", () => {
    for (const declared of ["LOW", "MEDIUM", "HIGH", undefined]) {
      expect(quarantineRow("x", "", declared ? { riskLevel: declared } : null).riskLevel).toBe("HIGH");
    }
  });
});

describe("policy-creation sites in src/ are allowlisted", () => {
  it("only human-in-the-loop sites and the baseline-checked backfill create or mutate ToolPolicy rows", () => {
    const ALLOWED = new Set([
      "src/lib/ai/custom-tools.ts", // ensureToolPolicies: createMany of baseline-checked DEFAULTs
      "src/app/api/settings/tools/route.ts", // admin UI policy editor — the human downgrade
      "src/app/api/tools/route.ts", // admin UI custom-tool create
      "src/app/api/tools/[id]/route.ts", // admin UI custom-tool edit/delete
      // cnp-02: the MCP tools/list sync. It is a NON-CORE source, so it is
      // allowlisted only because the two writes it makes are a quarantined
      // create and a quarantining update, and nothing else. What that is
      // warranted by, precisely: tests/mcp-server-sync.test.ts drives the
      // four admin states x the three snapshot states (same hash, changed
      // hash, ABSENT hash) and asserts no field moved in the loosening
      // direction on any of the twelve, plus the three named ways an enabled
      // row can outlive its snapshot. Not a proof over all inputs — a proof
      // over the state space the sync branches on.
      "src/lib/mcp-client.ts",
      "prisma/seed-core.ts",
      "prisma/seed-demo.ts",
    ]);
    const MUTATION_RE = /toolPolicy\s*\.\s*(?:create|createMany|upsert|update|updateMany|delete|deleteMany)\b/;
    const offenders: string[] = [];
    for (const file of [...walk("src"), ...walk("prisma")]) {
      const text = readFileSync(file, "utf8");
      if (MUTATION_RE.test(text)) {
        const rel = toRepoPath(file);
        if (!ALLOWED.has(rel)) offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no max(declared, MEDIUM) floor exists anywhere in the tree", () => {
    const FLOOR_RE = /Math\.max\([^)]{0,120}(riskLevel|declared|risk\b)/i;
    const offenders: string[] = [];
    for (const file of [...walk("src"), ...walk("scripts")]) {
      if (FLOOR_RE.test(readFileSync(file, "utf8"))) offenders.push(toRepoPath(file));
    }
    expect(offenders).toEqual([]);
  });
});

describe("classifyToolPoliciesDiff — the landing-tier seam", () => {
  const rowText = (name: string, risk: string, approval: boolean) =>
    [
      "  {",
      `    toolName: "${name}",`,
      '    description: "…",',
      `    riskLevel: "${risk}",`,
      `    requiresApproval: ${approval},`,
      "  },",
    ].join("\n");

  function diffOf(file: string, added: string[], removed: string[] = [], context: string[] = []): string {
    return [
      `diff --git a/${file} b/${file}`,
      `--- a/${file}`,
      `+++ b/${file}`,
      "@@ -20,4 +20,6 @@",
      ...context.map((l) => " " + l),
      ...removed.map((l) => "-" + l),
      ...added.map((l) => "+" + l),
    ].join("\n");
  }

  it("accepts an appended quarantined row", () => {
    const diff = diffOf("src/lib/ai/tool-policies.ts", rowText("mcp__srv__thing", "HIGH", true).split("\n"));
    expect(classifyToolPoliciesDiff(diff)).toMatchObject({ verdict: "additive", baselineChanged: false });
  });

  it("accepts an appended ungated row ONLY when the baseline adds it in the same diff", () => {
    const policyDiff = diffOf("src/lib/ai/tool-policies.ts", rowText("search_knowledge", "LOW", false).split("\n"));
    expect(classifyToolPoliciesDiff(policyDiff).verdict).toBe("destructive");

    const withBaseline =
      policyDiff +
      "\n" +
      diffOf("tests/fixtures/policy-baseline.json", [
        '    "search_knowledge": { "riskLevel": "LOW", "requiresApproval": false },',
      ]);
    const verdict = classifyToolPoliciesDiff(withBaseline);
    expect(verdict.verdict).toBe("additive");
    expect(verdict.baselineChanged).toBe(true); // flagged: owner sign-off
  });

  it("rejects edits to existing rows and to baseline values", () => {
    const edited = diffOf(
      "src/lib/ai/tool-policies.ts",
      rowText("query_ops_database", "LOW", true).split("\n"),
      rowText("query_ops_database", "LOW", false).split("\n"),
    );
    expect(classifyToolPoliciesDiff(edited).reasons[0]).toMatch(/"query_ops_database" changed/);

    const baselineDrift = diffOf(
      "tests/fixtures/policy-baseline.json",
      ['    "query_ops_database": { "riskLevel": "HIGH", "requiresApproval": true },'],
      ['    "query_ops_database": { "riskLevel": "LOW", "requiresApproval": false },'],
    );
    expect(classifyToolPoliciesDiff(baselineDrift).reasons[0]).toMatch(/"query_ops_database" changed — owner sign-off/);
  });
});
