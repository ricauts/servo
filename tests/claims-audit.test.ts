// reb-07: the claims lint. The two mandatory clean fixtures (README's
// "self-hosted", package.json's "Self-host it"), the banned block's
// self-exclusion, a seeded violation with file+line, and the real tree
// running clean.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  extractBannedBlock,
  parseBannedBlock,
  scanFile,
  withoutBannedBlock,
} from "../scripts/claims-audit.mjs";

const RULES = parseBannedBlock(extractBannedBlock(readFileSync("docs/POSITIONING.md", "utf8")));

describe("the banned-phrases block parses", () => {
  it("carries the banned list, the allow list and the path exemptions", () => {
    expect(RULES.banned).toContain("hosted");
    expect(RULES.banned).toContain("marketplace");
    expect(RULES.banned).toContain("control plane");
    expect(RULES.banned).toContain("sqlite");
    expect(RULES.allow).toContain("self-hosted");
    expect(RULES.allow).toContain("Self-host it");
    const sqliteExemptions = RULES.exempt.filter((e: { phrase: string }) => e.phrase === "sqlite");
    expect(sqliteExemptions.some((e: { paths: string[] }) => e.paths.includes("README.md"))).toBe(true);
  });
});

describe("matching is word-boundary and context aware", () => {
  it("README's self-hosted line and package.json's description pass clean", () => {
    const readme = readFileSync("README.md", "utf8");
    const selfHostedLines = readme
      .split(/\r?\n/)
      .filter((l) => l.includes("self-hosted") || l.includes("Self-host it"));
    expect(selfHostedLines.length).toBeGreaterThan(0);
    for (const line of selfHostedLines) {
      expect(scanFile("README.md", line, RULES)).toEqual([]);
    }
    expect(scanFile("package.json", readFileSync("package.json", "utf8"), RULES)).toEqual([]);
  });

  it("still catches the bare banned word on the same line as an allow phrase", () => {
    const hits = scanFile("README.md", "Servo is a hosted service desk, self-hosted by you.", RULES);
    expect(hits.map((h: { phrase: string }) => h.phrase)).toContain("hosted");
  });

  it("the banned-phrases block is excluded from its own scan", () => {
    const canon = readFileSync("docs/POSITIONING.md", "utf8");
    expect(scanFile("docs/POSITIONING.md", canon, RULES).length).toBeGreaterThan(0); // without exclusion it would trip
    expect(scanFile("docs/POSITIONING.md", withoutBannedBlock(canon), RULES)).toEqual([]);
  });

  it("path exemptions scope their phrase only", () => {
    // PORTING-LEDGER may say sqlite (history); it may NOT say hosted.
    const text = "sqlite history line\nhosted by us line";
    const hits = scanFile("docs/PORTING-LEDGER.md", text, RULES);
    expect(hits.map((h: { phrase: string }) => h.phrase)).toEqual(["hosted"]);
  });

  it("multi-word phrases match across whitespace variance", () => {
    const hits = scanFile("README.md", "Servo is the AI control  plane for your company.", RULES);
    expect(hits[0]?.phrase).toBe("control plane");
  });
});

describe("a seeded violation", () => {
  it("is detected with the correct file and line", () => {
    const seeded = [
      "# A doc",
      "",
      "Servo is available as a cloud version today.",
    ].join("\n");
    const hits = scanFile("docs/EXAMPLE.md", seeded, RULES);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ file: "docs/EXAMPLE.md", line: 3, phrase: "cloud version" });
  });
});

describe("the real tree", () => {
  it("runs clean against the canon", async () => {
    const { execFileSync } = await import("node:child_process");
    // The CLI is the acceptance: exit 0 on the current tree.
    const out = execFileSync("node", ["scripts/claims-audit.mjs"], { encoding: "utf8" });
    expect(out).toMatch(/claims-audit: OK/);
  });
});
