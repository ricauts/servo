// loop-03: whole-file backlog validation. Every rule gets a passing and a
// failing fixture built from synthetic spec text — no git, no database.

import { describe, expect, it } from "vitest";
import { lintSpecText, parseBacklog, questionsSection } from "../scripts/spec-lint.mjs";

function item(id: string, over: Record<string, string> = {}): string {
  const fields = {
    status: "todo",
    date: "-",
    size: "one-tick",
    tier: "A",
    "depends-on": "-",
    files: "src/x.ts",
    ...over,
  };
  return [
    "```",
    `### [${id}] a title for ${id}`,
    ...Object.entries(fields).map(([k, v]) => `${k}: ${v}`),
    "acceptance:",
    "- one offline-checkable criterion",
    "```",
    "",
  ].join("\n");
}

function spec(...blocks: string[]): string {
  return [
    "# Servo",
    "## 0. How to read this file",
    // A template-shaped block OUTSIDE §11, with an id that also exists in
    // §11 below — the parser must ignore it entirely.
    "```",
    "### [alpha-01] this block is a TEMPLATE, not an item",
    "status: todo",
    "```",
    // The format exemplar's literal placeholder, also outside a real area.
    "## 10. Something else",
    "## 11. Backlog",
    ...blocks,
    "## 14. Open questions for the owner",
    "2026-08-27 gamma-01: the dated question naming gamma-01.",
    "## 15. Changelog",
    "| date | item id | what changed | commit |",
  ].join("\n");
}

describe("parseBacklog", () => {
  it("collects only fenced §11 items with real ids", () => {
    const items = parseBacklog(
      spec(item("alpha-01"), item("beta-01", { "depends-on": "alpha-01" })),
    );
    expect(items.map((i: { id: string }) => i.id)).toEqual(["alpha-01", "beta-01"]);
    expect(items[1].dependsOn).toEqual(["alpha-01"]);
  });

  it("splits multi-dependency lists and drops the dash", () => {
    const items = parseBacklog(spec(item("alpha-01"), item("beta-01", { "depends-on": "alpha-01, alpha-01" })));
    expect(items[1].dependsOn).toEqual(["alpha-01", "alpha-01"]);
    expect(parseBacklog(spec(item("solo-01")))[0].dependsOn).toEqual([]);
  });

  it("extracts the questions section", () => {
    expect(questionsSection(spec(item("alpha-01")))).toContain("gamma-01");
  });
});

describe("lintSpecText — the happy paths", () => {
  it("accepts a well-formed backlog", () => {
    const text = spec(
      item("alpha-01", { status: "done", date: "2026-08-27" }),
      item("beta-01", { "depends-on": "alpha-01" }),
      item("gamma-01", { status: "review", date: "2026-08-27" }),
    );
    expect(lintSpecText(text)).toEqual([]);
  });

  it("accepts a blocked item whose dated question exists", () => {
    const text = spec(item("gamma-01", { status: "blocked", date: "2026-08-27" }));
    expect(lintSpecText(text)).toEqual([]);
  });
});

describe("lintSpecText — item shape", () => {
  it("rejects a duplicate id", () => {
    const text = spec(item("alpha-01"), item("alpha-01"));
    expect(lintSpecText(text).join("\n")).toMatch(/alpha-01: duplicate id/);
  });

  it("rejects an unknown status", () => {
    expect(lintSpecText(spec(item("alpha-01", { status: "finished" })))[0]).toMatch(
      /status "finished" not in todo\|doing\|blocked\|review\|done/,
    );
  });

  it("rejects an unknown tier", () => {
    expect(lintSpecText(spec(item("alpha-01", { tier: "D" })))[0]).toMatch(/tier "D" not in A\|B\|C/);
  });

  it("rejects a missing field", () => {
    const broken = item("alpha-01").replace("size: one-tick\n", "");
    expect(lintSpecText(spec(broken))[0]).toMatch(/missing or empty field "size"/);
  });
});

describe("lintSpecText — the pick-rule invariants", () => {
  it("rejects a dependency that does not exist", () => {
    expect(lintSpecText(spec(item("alpha-01", { "depends-on": "nope-99" })))[0]).toMatch(
      /depends-on "nope-99" does not exist/,
    );
  });

  it("rejects a forward reference", () => {
    const text = spec(item("alpha-01", { "depends-on": "beta-01" }), item("beta-01"));
    expect(lintSpecText(text).join("\n")).toMatch(/alpha-01: depends-on "beta-01" appears LATER/);
  });

  it("rejects more than one doing", () => {
    const text = spec(
      item("alpha-01", { status: "doing", date: "2026-08-27" }),
      item("beta-01", { status: "doing", date: "2026-08-27" }),
    );
    expect(lintSpecText(text)[0]).toMatch(/2 items are doing/);
  });

  it("rejects more than one review", () => {
    const text = spec(
      item("alpha-01", { status: "review", date: "2026-08-27" }),
      item("beta-01", { status: "review", date: "2026-08-27" }),
    );
    expect(lintSpecText(text)[0]).toMatch(/2 items are review/);
  });

  it("demands a real date on every non-todo item", () => {
    for (const status of ["doing", "review", "done", "blocked"]) {
      const violations = lintSpecText(spec(item("alpha-01", { status, date: "-" })));
      expect(violations[0]).toMatch(new RegExp(`status ${status} but date "-" is not YYYY-MM-DD`));
    }
  });

  it("rejects a blocked item with no dated question naming it", () => {
    const text = spec(item("delta-01", { status: "blocked", date: "2026-08-27" }));
    expect(lintSpecText(text)[0]).toMatch(
      /delta-01: blocked but "Questions for the owner" carries no question/,
    );
  });
});

describe("lintSpecText — against the real spec.md", () => {
  it("parses and validates the repository's own spec.md clean", async () => {
    const { readFileSync } = await import("node:fs");
    const text = readFileSync("spec.md", "utf8");
    const items = parseBacklog(text);
    expect(items.length).toBeGreaterThan(40);
    expect(lintSpecText(text)).toEqual([]);
  });
});
