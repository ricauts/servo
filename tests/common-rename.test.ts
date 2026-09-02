// hyg-06: the pure rename — src/components/legacy/ became
// src/components/common/ and every import specifier moved with it. This is
// the acceptance's grep test: the old alias appears NOWHERE under src/ or
// tests/. The classifier fixtures in tests/landing-tier.test.ts model the
// rename as synthetic diffs (fromPath -> path), which is exactly the
// history this rename left in git — they are not tree claims and the
// repo-refs dead-file literals assert the DELETED three's absence.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const REPO = path.resolve(__dirname, "..");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name === ".git") continue;
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

describe("hyg-06 — legacy is gone by that name", () => {
  // Assembled from parts so THIS file's own source is not a match for the
  // string it guards against (the repo-refs suite's established trick).
  const oldAlias = "@/components/" + "legacy/";

  it("@/components/legacy appears nowhere under src/ or tests/, naming the offender", () => {
    const offenders: string[] = [];
    for (const root of ["src", "tests"]) {
      for (const p of walk(path.join(REPO, root))) {
        const text = readFileSync(p, "utf8");
        if (text.includes(oldAlias)) {
          offenders.push(path.relative(REPO, p).split(path.sep).join("/"));
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the four survivors live under common/ with their importers intact", () => {
    for (const name of ["Avatar.tsx", "Badge.tsx", "EmptyState.tsx", "Spinner.tsx"]) {
      const p = path.join(REPO, "src", "components", "common", name);
      expect(statSync(p, { throwIfNoEntry: false }), p).toBeDefined();
    }
    // And the old directory is gone.
    expect(statSync(path.join(REPO, "src", "components", "legacy"), { throwIfNoEntry: false })).toBeUndefined();
  });
});
