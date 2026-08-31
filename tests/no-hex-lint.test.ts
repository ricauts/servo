// ds-01: the no-hardcoded-hex lint and its token-resolution companion.
// Fixtures prove one violating file is caught and one token-only file passes;
// the real tree must pass both checks — that is the acceptance.

import { describe, expect, it } from "vitest";
import {
  collectVarDefinitions,
  collectVarReferences,
  scanSource,
  unresolvedVarReferences,
} from "../scripts/no-hex-lint.mjs";

describe("scanSource — raw colour literals", () => {
  it("flags hex literals, quoted or bare, at their line", () => {
    const violations = scanSource(
      "src/components/Foo.tsx",
      ['const color = "#4E66E4";', "border: 1px solid #fff;"].join("\n"),
    );
    expect(violations).toHaveLength(2);
    expect(violations[0]).toMatchObject({ file: "src/components/Foo.tsx", line: 1, rule: "hex" });
    expect(violations[1]).toMatchObject({ line: 2, rule: "hex" });
  });

  it("flags rgb()/hsl()/oklch() literals but not var()-based ones", () => {
    const violations = scanSource(
      "a.css",
      ["color: rgb(13 15 20);", "color: hsl(200 10% 20%);", "color: oklch(0.2 0.01 250);", "color: rgb(var(--x));"].join("\n"),
    );
    expect(violations.map((v) => v.line)).toEqual([1, 2, 3]);
  });

  it("flags Tailwind arbitrary colour values and allows token references", () => {
    const violations = scanSource(
      "Foo.tsx",
      [
        '<div className="bg-[#0D0F14]">',
        '<div className="text-[rgb(1,2,3)]">',
        '<div className="bg-[var(--surface)]">',
        '<div className="w-[length:220px]">',
      ].join("\n"),
    );
    // The literal interiors trip their own rules too (hex / color-function);
    // what this case asserts is that lines 3 and 4 — token reference and
    // typed non-colour arbitrary value — produce nothing.
    expect(violations.map((v) => v.line)).toEqual([1, 1, 2, 2]);
    expect(violations.filter((v) => v.rule === "tailwind-arbitrary-color")).toHaveLength(2);
  });

  it("skips a line carrying the greppable allow marker", () => {
    const violations = scanSource(
      "Foo.tsx",
      ['#1029 is a ticket number in copy {/* no-hex-lint:allow — copy, not a colour */}'].join("\n"),
    );
    expect(violations).toEqual([]);
  });

  it("passes a token-only file untouched", () => {
    expect(
      scanSource("Foo.tsx", ['<div className="bg-surface text-[color:var(--text-muted)]">'].join("\n")),
    ).toEqual([]);
  });
});

describe("token resolution — the companion check", () => {
  it("collects definitions and references", () => {
    expect([...collectVarDefinitions(":root{--brand:#fff; --ink-950:#0D0F14}")].sort()).toEqual([
      "brand",
      "ink-950",
    ]);
    expect([...collectVarReferences("color: var(--brand); fill:var( --chart-1 )")].sort()).toEqual([
      "brand",
      "chart-1",
    ]);
  });

  it("reports a referenced token with no definition anywhere", () => {
    const unresolved = unresolvedVarReferences(
      [{ path: "src/components/Foo.tsx", text: "fill: var(--color-ai)" }],
      new Set(["chart-1", "chart-2"]),
    );
    expect(unresolved).toEqual([{ file: "src/components/Foo.tsx", name: "color-ai" }]);
  });

  it("accepts references that resolve in the design system or globals", () => {
    expect(
      unresolvedVarReferences(
        [{ path: "src/components/Foo.tsx", text: "color: var(--critical-chip-ink)" }],
        new Set(["critical-chip-ink"]),
      ),
    ).toEqual([]);
  });
});

describe("the real tree", () => {
  it("has no hardcoded colour literals and no undefined token references", async () => {
    const { readdirSync, readFileSync } = await import("node:fs");
    const { execFileSync } = await import("node:child_process");

    const tracked = execFileSync("git", ["ls-files", "src/app", "src/components"], {
      encoding: "utf8",
    })
      .split(/\r?\n/)
      .filter((f) => /\.(ts|tsx|css|js|jsx|mjs)$/.test(f));
    expect(tracked.length).toBeGreaterThan(100);

    let violations: ReturnType<typeof scanSource> = [];
    for (const rel of tracked) violations.push(...scanSource(rel, readFileSync(rel, "utf8")));
    expect(violations).toEqual([]);

    const definitions = new Set<string>();
    const tokenFiles = ["src/app/globals.css", ...execFileSync(
      "git",
      ["ls-files", "servo_design_system/tokens"],
      { encoding: "utf8" },
    )
      .split(/\r?\n/)
      .filter((f) => f.endsWith(".css"))];
    for (const rel of tokenFiles) {
      for (const name of collectVarDefinitions(readFileSync(rel, "utf8"))) definitions.add(name);
    }
    const unresolved = unresolvedVarReferences(
      tracked.map((rel) => ({ path: rel, text: readFileSync(rel, "utf8") })),
      definitions,
    );
    expect(unresolved).toEqual([]);
  });
});
