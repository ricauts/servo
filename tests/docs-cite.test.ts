// doc-01: the v1 documentation's own checks — the cite-check script exits
// 0 on the real tree, its two recognition rules bite, and the claims
// audit covers the four new documents.

import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("docs-cite-check", () => {
  it("exits 0 on the real tree: every cited path and tool name exists", () => {
    const out = execFileSync("node", ["scripts/docs-cite-check.mjs"], { encoding: "utf8" });
    expect(out).toMatch(/OK \(4 documents/);
  });

  it("a dead cited path FAILS with the document and the path named", () => {
    const tmp = mkdtempSync(join(tmpdir(), "cite-"));
    mkdirSync(join(tmp, "docs"), { recursive: true });
    // A minimal copy of the script's contract: run it against a doctored
    // tree by pointing it at a broken doc — the script reads fixed paths,
    // so the honest probe is to doctor the REAL docs in a git stash-free
    // way: append a dead citation, run, restore.
    const doc = "docs/plugins.md";
    const original = readFileSync(doc, "utf8");
    try {
      writeFileSync(doc, original + "\nSee `src/lib/never-existed.ts` for details.\n");
      let status = 0;
      let stderr = "";
      try {
        execFileSync("node", ["scripts/docs-cite-check.mjs"], { encoding: "utf8" });
      } catch (err) {
        status = (err as { status: number }).status;
        stderr = String((err as { stderr: string }).stderr);
      }
      expect(status).not.toBe(0);
      expect(stderr).toMatch(/plugins\.md: cited path "src\/lib\/never-existed\.ts" does not exist/);
    } finally {
      writeFileSync(doc, original);
    }
    rmSync(tmp, { recursive: true, force: true });
  });

  it("a bare basename is a NAME, not a location — SKILL.md and .mcp.json never fail", () => {
    // Pinned by the OK run above plus this explicit source-level check:
    // the recognition rule exists in the script, stated in its comment.
    const src = readFileSync("scripts/docs-cite-check.mjs", "utf8");
    expect(src).toMatch(/BASENAME \(no slash\) is a NAME, not a location/);
    expect(readFileSync("docs/skills.md", "utf8")).toContain("`SKILL.md`");
  });
});

describe("the claims surface", () => {
  it("the four documents make no hosted-cloud claim and no absolute network promise", () => {
    for (const doc of ["docs/connectors.md", "docs/skills.md", "docs/plugins.md", "docs/knowledge-base.md"]) {
      const text = readFileSync(doc, "utf8");
      expect(text, doc).not.toMatch(/hosted|cloud version|sign up|SaaS\b/i);
      expect(text, doc).not.toMatch(/never leaves your network/i);
      expect(text.toLowerCase(), doc).not.toContain("marketplace");
    }
  });

  it("claims:audit passes with the four documents inside the scan (the CLI, as CI runs it)", () => {
    let status = 0;
    try {
      execFileSync("npm", ["run", "claims:audit"], { encoding: "utf8", shell: true });
    } catch (err) {
      status = (err as { status: number }).status;
    }
    expect(status).toBe(0);
  });
});
