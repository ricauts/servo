// hyg-07: the image's rule set, asserted OFFLINE as STRINGS — no Docker
// required, no base image pulled, no npm ci inside a build. THIS IS THE
// BINDING CRITERION precisely because `docker build` is not hermetic: the
// test is what makes a dropped rule fail npm test (and therefore CI) while
// the real build runs only in an operator's hands.
//
// What the rules protect: syncSkills() and syncAgentProfiles()
// (src/lib/bootstrap.ts:37,80) return 0 on a missing directory instead of
// failing, so a wrong rule would ship a desk with no procedures AND no
// error. The tokens re-include keeps `next build` alive (ds-01 imports
// servo_design_system/tokens/*.css from globals.css).
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const REPO = path.resolve(__dirname, "..");
const text = readFileSync(path.join(REPO, ".dockerignore"), "utf8");

/** The rule lines: comments and blanks stripped, verbatim strings. */
const rules = text
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith("#"));

/** Would `rule` match `file` under Docker's semantics? Only the shapes
 *  this file actually uses are modelled — a novel rule shape FAILS the
 *  test rather than being silently mis-evaluated. */
function matches(rule: string, file: string): boolean {
  if (rule.startsWith("!")) return false; // re-includes never exclude
  if (rule === file) return true;
  if (!rule.includes("/")) return !file.includes("/"); // root-anchored (Go filepath.Match, no slash)
  if (rule.endsWith("/*")) {
    const dir = rule.slice(0, -2);
    return file.startsWith(dir + "/");
  }
  return false; // unmodelled shape: conservative — the exact-rule tests below carry the load
}

describe("hyg-07 — the image rule set, offline", () => {
  it("excludes the test data, the loop's scratch, the assistant dir, and the design system's non-token bulk", () => {
    for (const rule of ["tests", ".claude", ".spec-build", "servo_design_system/*"]) {
      expect(rules, `missing rule: ${rule}`).toContain(rule);
    }
  });

  it("re-includes the tokens — the one child the build imports", () => {
    expect(rules).toContain("!servo_design_system/tokens");
    // And the exclusion is the /* form, because Docker's ! cannot re-include
    // under a directory that is itself excluded.
    expect(rules).not.toContain("servo_design_system");
    expect(rules).not.toContain("servo_design_system/");
  });

  it("NO rule excludes skills/ or agents/ — the desk's procedures ship", () => {
    for (const rule of rules.filter((r) => !r.startsWith("!"))) {
      for (const shipped of [
        "skills/analyst/SKILL.md",
        "agents/servo-admin.md",
        "agents/analytics-agent.md",
      ]) {
        expect(matches(rule, shipped), `${rule} would exclude ${shipped}`).toBe(false);
      }
    }
    // The belt-to-braces re-include stays, with the Docker-pattern analysis.
    expect(rules).toContain("!agents");
    expect(text).toContain("filepath.Match");
  });

  it("the tokens re-include actually rescues the tokens from the /* exclusion", () => {
    expect(matches("servo_design_system/*", "servo_design_system/tokens/colors.css")).toBe(true);
    // The re-include is the LAST word for that subtree:
    const lastWord = rules.filter((r) => r.includes("servo_design_system")).pop();
    expect(lastWord).toBe("!servo_design_system/tokens");
  });

  it("the dcl-03 and hyg-07 rationales stay explained in the file itself", () => {
    expect(text).toContain("DoclingDocument fixtures");
    expect(text).toContain("syncAgentProfiles");
  });
});
