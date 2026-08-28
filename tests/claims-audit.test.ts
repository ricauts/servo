// reb-07: the claims lint. `docs/POSITIONING.md`'s fenced banned-phrases block
// is the policy; scripts/claims-audit.mjs is the machine. These tests drive the
// acceptance criteria, not the implementation:
//
//   - the two MANDATORY clean fixtures are the REAL lines that ship — README's
//     "self-hosted" sentence and package.json's "Self-host it" description —
//     read from the tree, so the test cannot drift from the files it protects;
//   - a third fixture proves the fenced block is excluded from its own scan,
//     with a negative control showing what the canon looks like without it;
//   - a seeded violation is reported with the correct file AND line;
//   - the real tree exits clean, which is the criterion the CI step enforces.
//
// Every mechanism carries a negative control: a rule nothing can break is not
// a rule that was tested.

import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  applyExemptions,
  audit,
  compilePhrase,
  expandScanSet,
  extractFence,
  findSpans,
  globToRegExp,
  headingPathsByLine,
  parseCanonBlock,
  scanFile,
  scanSetErrors,
  selfExcludedLines,
  stripTrailingComment,
  unterminatedFences,
  validateCanon,
  validateSections,
} from "../scripts/claims-audit.mjs";

const CANON_TEXT = readFileSync("docs/POSITIONING.md", "utf8");
const canon = () => parseCanonBlock(CANON_TEXT);

/** The scan set the CLI builds, read from the real tree. */
function treeFiles() {
  const listDir = (dir: string) => {
    try {
      return readdirSync(dir === "" ? "." : dir, { withFileTypes: true })
        .filter((e) => e.isFile())
        .map((e) => e.name);
    } catch {
      return [];
    }
  };
  return expandScanSet(canon(), listDir).map((p: string) => ({ path: p, text: readFileSync(p, "utf8") }));
}

/** A minimal canon fixture, so rules can be tested one at a time. */
function fixtureCanon(over: Record<string, unknown> = {}): any {
  return {
    scan: ["a.md"],
    unscanned: [],
    matching: { wordBoundary: true, caseInsensitive: true },
    selfExclude: { fence: "banned-phrases", appliesTo: "all-scanned-files" },
    banned: ["hosted"],
    allow: ["self-hosted"],
    exempt: [],
    ...over,
  };
}

describe("parseCanonBlock — the fence is the whole policy", () => {
  it("reads every top-level key out of the real canon", () => {
    const c = canon();
    expect(c.scan).toEqual(["README.md", "SECURITY.md", "ROADMAP.md", "package.json", "docs/*.md"]);
    expect(c.unscanned).toEqual(["spec.md", "docs/design/*.md"]);
    expect(c.matching).toEqual({ wordBoundary: true, caseInsensitive: true });
    expect(c.selfExclude).toEqual({ fence: "banned-phrases", appliesTo: "all-scanned-files" });
    expect(c.banned).toContain("control plane");
    expect(c.banned).toContain("never leaves your network");
    expect(c.allow).toContain("Self-host it");
    expect(c.exempt.length).toBeGreaterThanOrEqual(5);
  });

  it("keeps every phrase a string — no scalar coercion of policy data", () => {
    const c = parseCanonBlock(
      ["```banned-phrases", "banned:", "  - 12.10", "  - null", "  - 0x10", "```"].join("\n"),
    );
    expect(c.banned).toEqual(["12.10", "null", "0x10"]);
  });

  it("folds a multi-line reason and keeps the following key separate", () => {
    const transitional: any = canon().exempt.find((e: any) => e.until === "db-01");
    expect(transitional).toBeDefined();
    expect(transitional.reason).toContain("db-01 rewrites the present-tense storage claim in");
    expect(transitional.reason).toContain("every file below");
    expect(transitional.paths).toContain("docs/PORTING-LEDGER.md");
    expect(transitional.sections).toEqual([]);
  });

  it("reads maxOccurrences, enforced:false and an em-dash section name verbatim", () => {
    const [scoped, inert]: any[] = canon().exempt.filter((e: any) => e.phrase === "marketplace");
    expect(scoped).toMatchObject({ sections: ["ROADMAP"], maxOccurrences: 1, enforced: true });
    expect(inert).toMatchObject({ paths: ["spec.md"], enforced: false });
    expect(inert.sections).toEqual(["12. Roadmap — explicitly out of v1"]);
  });

  it("throws rather than returning an empty policy when the fence is missing", () => {
    expect(() => parseCanonBlock("# no fence here")).toThrow(/no fenced `banned-phrases` block/);
  });
});

describe("stripTrailingComment — YAML's rule, not a blunt split", () => {
  it("drops a comment that follows whitespace", () => {
    expect(stripTrailingComment("  wordBoundary: true   # a hyphen counts").trim()).toBe(
      "wordBoundary: true",
    );
  });

  it("keeps a # that is part of a value or inside quotes", () => {
    expect(stripTrailingComment("  - ticket#123")).toBe("  - ticket#123");
    expect(stripTrailingComment('  - "a # b"')).toBe('  - "a # b"');
  });
});

describe("matching — boundaries, case and separators", () => {
  it("is case-insensitive and boundary-anchored", () => {
    expect(findSpans("Our SQLite volume", "sqlite")).toHaveLength(1);
    expect(findSpans("ghosted by the vendor", "hosted")).toHaveLength(0);
    expect(findSpans("hostedness", "hosted")).toHaveLength(0);
  });

  it("treats `_` as a boundary, which \\b would not", () => {
    // The regression this guards: /\bsqlite\b/ misses sqlite_master, because \b
    // counts `_` as a word character. docs/CONTRACT.md:171 is that exact string.
    expect(findSpans("SELECT name FROM sqlite_master", "sqlite")).toHaveLength(1);
    expect(compilePhrase("sqlite").source).not.toContain("\\b");
  });

  it("matches a phrase across a line wrap and in hyphenated form", () => {
    expect(findSpans("the AI control\nplane for your company", "control plane")).toHaveLength(1);
    expect(findSpans("the control-plane headline", "control plane")).toHaveLength(1);
    expect(findSpans("Sign-Up today", "sign up")).toHaveLength(1);
  });

  it("does not match across unrelated punctuation", () => {
    expect(findSpans("control. plane", "control plane")).toHaveLength(0);
  });
});

describe("rescue — an allow phrase shields only what it CONTAINS", () => {
  it("MANDATORY FIXTURE: README's self-hosted line passes clean", () => {
    const line = readFileSync("README.md", "utf8")
      .split(/\r?\n/)
      .find((l) => l.includes("self-hosted"));
    expect(line).toBeTruthy();
    // The REAL canon, not a stub: a stub banning only "hosted" would let a
    // "SaaS" or "sign up" on the same line through and still look clean.
    expect(scanFile("README.md", line as string, canon())).toEqual([]);
    // Negative control, so this is not a vacuous emptiness assertion: the same
    // line with the allow list emptied DOES trip.
    const noAllow = { ...canon(), allow: [] };
    expect(scanFile("README.md", line as string, noAllow).length).toBeGreaterThan(0);
  });

  it("MANDATORY FIXTURE: package.json's Self-host it description passes clean", () => {
    const pkg = readFileSync("package.json", "utf8");
    expect(pkg).toContain("Self-host it");
    expect(scanFile("package.json", pkg, canon())).toEqual([]);
  });

  it("rescues every self-host* form the canon allows", () => {
    const text = "Self-hostable, self-hosting, self-hosted. Self-host it.";
    expect(scanFile("a.md", text, canon())).toEqual([]);
  });

  it("does NOT rescue a bare banned word sharing the line", () => {
    // The failure mode that rules out line-scoped rescue (gitleaks' regexTarget
    // model): a real overclaim rides along beside an allowed phrase.
    const found = scanFile("a.md", "Self-hosted today, and a hosted edition tomorrow.", fixtureCanon());
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ line: 1, phrase: "hosted" });
    expect(found[0].column).toBeGreaterThan("Self-hosted today, and a ".length - 1);
  });

  it("rescues SaaS only inside `SaaS endpoint`", () => {
    expect(scanFile("a.md", "integrate a SaaS endpoint", canon())).toEqual([]);
    expect(scanFile("a.md", "our SaaS product", canon())).toHaveLength(1);
  });
});

describe("self-exclusion — the fence does not trip its own linter", () => {
  it("MANDATORY FIXTURE: the real canon yields only its one exempt ROADMAP hit", () => {
    const found = scanFile("docs/POSITIONING.md", CANON_TEXT, canon());
    expect(found.map((v: any) => v.phrase)).toEqual(["marketplace"]);
    expect(found[0].sectionPath).toContain("ROADMAP");
    // Every other occurrence lives between the fence delimiters.
    const excluded = selfExcludedLines(CANON_TEXT);
    const fence: any = extractFence(CANON_TEXT);
    expect(fence).not.toBeNull();
    expect(excluded.has(fence.start)).toBe(true);
    expect(excluded.has(fence.end)).toBe(true);
  });

  it("NEGATIVE CONTROL: without the exclusion the canon fails on its own phrases", () => {
    const off = { ...canon(), selfExclude: { fence: "banned-phrases", appliesTo: "none" } };
    const found = scanFile("docs/POSITIONING.md", CANON_TEXT, off);
    expect(found.length).toBeGreaterThan(9);
    expect(new Set(found.map((v: any) => v.phrase)).size).toBeGreaterThanOrEqual(10);
  });

  it("leaves other fenced blocks in scope", () => {
    const text = ["```", "our hosted edition", "```"].join("\n");
    expect(scanFile("a.md", text, fixtureCanon())).toHaveLength(1);
  });
});

describe("seeded violations are reported with the right file and line", () => {
  it("names the file, the line and the matched text", () => {
    const text = ["# Title", "", "Servo is fine.", "Sign up for our cloud version today.", ""].join("\n");
    const found = scanFile("docs/SEEDED.md", text, canon());
    // Ordered by line, then by column: "Sign up" opens the line.
    expect(found.map((v: any) => [v.file, v.line, v.phrase])).toEqual([
      ["docs/SEEDED.md", 4, "sign up"],
      ["docs/SEEDED.md", 4, "cloud version"],
    ]);
    expect(found[0]).toMatchObject({ column: 1, text: "Sign up" });
  });

  it("reports a violation on a later line at its own line number", () => {
    const text = ["ok", "ok", "ok", "", "It never leaves your network."].join("\n");
    expect(scanFile("a.md", text, canon())[0]).toMatchObject({ line: 5 });
  });
});

describe("exemptions — path, section, count and inert entries", () => {
  const sectioned = () =>
    fixtureCanon({
      banned: ["marketplace"],
      allow: [],
      exempt: [
        {
          phrase: "marketplace",
          reason: "roadmap row only",
          paths: ["docs/POSITIONING.md"],
          sections: ["ROADMAP"],
          maxOccurrences: 1,
          until: null,
          enforced: true,
        },
      ],
    });

  const doc = (...body: string[]) =>
    ["# Canon", "a marketplace in the preamble", "## ROADMAP", ...body].join("\n");

  it("covers a heading and its descendants, not the preamble", () => {
    const c = sectioned();
    const found = scanFile("docs/POSITIONING.md", doc("### Row", "never a marketplace"), c);
    const { reported, exempted } = applyExemptions(found, c);
    expect(exempted).toHaveLength(1); // the one under ROADMAP > Row
    expect(reported).toHaveLength(1);
    expect(reported[0]).toMatchObject({ line: 2 }); // the preamble one is not covered
  });

  it("enforces maxOccurrences and reports the surplus", () => {
    const c = sectioned();
    const found = scanFile("docs/POSITIONING.md", doc("one marketplace", "two marketplace"), c);
    const { reported, exempted } = applyExemptions(found, c);
    expect(exempted).toHaveLength(1);
    expect(reported).toHaveLength(2); // the preamble one, plus the surplus
    expect(reported.some((v: any) => /allows 1 occurrence/.test(v.note ?? ""))).toBe(true);
  });

  it("does not apply an entry to a different path", () => {
    const c = sectioned();
    const found = scanFile("docs/OTHER.md", doc("## ROADMAP", "a marketplace"), c);
    expect(applyExemptions(found, c).exempted).toEqual([]);
    expect(applyExemptions(found, c).reported.length).toBeGreaterThan(0);
  });

  it("does not apply an entry to a DIFFERENT phrase", () => {
    // Two banned phrases, one exemption. Deleting the phrase-identity guard
    // would exempt the un-exempted phrase too, which this catches.
    const c = sectioned();
    c.banned = ["marketplace", "hosted"];
    const found = scanFile("docs/POSITIONING.md", doc("a hosted marketplace"), c);
    const { reported, exempted } = applyExemptions(found, c);
    // Only the `marketplace` under ROADMAP is exempt. The `hosted` beside it is
    // a different phrase, so the same entry must not cover it.
    expect(exempted.map((v: any) => [v.line, v.phrase])).toEqual([[4, "marketplace"]]);
    expect(reported.map((v: any) => [v.line, v.phrase])).toEqual([
      [2, "marketplace"], // the preamble, outside the ROADMAP section
      [4, "hosted"],
    ]);
  });

  it("counts maxOccurrences per file, not globally across files", () => {
    const c = sectioned();
    c.exempt[0].paths = ["docs/A.md", "docs/B.md"];
    const body = doc("one marketplace");
    const a = applyExemptions(scanFile("docs/A.md", body, c), c);
    const both = applyExemptions(
      [...scanFile("docs/A.md", body, c), ...scanFile("docs/B.md", body, c)],
      c,
    );
    expect(a.exempted).toHaveLength(1);
    // Each file gets its own allowance of 1, so both are exempt.
    expect(both.exempted).toHaveLength(2);
    expect(both.reported.filter((v: any) => /allows 1 occurrence/.test(v.note ?? ""))).toEqual([]);
  });

  it("treats `enforced: false` as recorded policy, not an exemption", () => {
    const c = fixtureCanon({
      banned: ["marketplace"],
      allow: [],
      exempt: [
        {
          phrase: "marketplace",
          reason: "policy only",
          paths: ["a.md"],
          sections: [],
          maxOccurrences: null,
          until: null,
          enforced: false,
        },
      ],
    });
    const found = scanFile("a.md", "a marketplace", c);
    expect(applyExemptions(found, c).reported).toHaveLength(1);
  });

  it("surfaces a transitional exemption as a note naming the item that retires it", () => {
    const c = canon();
    const found = scanFile("ROADMAP.md", readFileSync("ROADMAP.md", "utf8"), c);
    const { reported, notes } = applyExemptions(found, c);
    expect(reported).toEqual([]);
    expect(notes.join(" ")).toMatch(/transitional until db-01/);
  });
});

describe("headingPathsByLine — sections resolve past fenced `#` lines", () => {
  it("does not read a `#` comment inside a fence as a heading", () => {
    const text = ["# Top", "```banned-phrases", "# not a heading", "```", "body"].join("\n");
    expect(headingPathsByLine(text)[5]).toEqual(["Top"]);
  });

  it("pops to the right level on a sibling heading", () => {
    const text = ["# A", "## B", "### C", "## D", "x"].join("\n");
    expect(headingPathsByLine(text)[5]).toEqual(["A", "D"]);
  });
});

describe("validateCanon / validateSections — a silent policy is a failure", () => {
  it("fails an empty banned list rather than passing vacuously", () => {
    expect(validateCanon(fixtureCanon({ banned: [] })).join(" ")).toMatch(/pass vacuously/);
  });

  it("fails a canon whose declared matching mode is not the one implemented", () => {
    expect(validateCanon(fixtureCanon({ matching: {} })).length).toBeGreaterThanOrEqual(2);
  });

  it("fails an exemption naming a section that resolves to no heading", () => {
    // reb-03's own review caught an em dash written as an ASCII hyphen here. A
    // string match that silently resolves to nothing reads as a clean pass.
    const c: any = fixtureCanon({
      exempt: [
        {
          phrase: "hosted",
          reason: "r",
          paths: ["a.md"],
          sections: ["Roadmap - explicitly out of v1"],
          maxOccurrences: null,
          until: null,
          enforced: true,
        },
      ],
    });
    const files = [{ path: "a.md", text: "# Roadmap — explicitly out of v1\ntext" }];
    expect(validateSections(c, files)[0]).toMatch(/which has no such heading/);
    // The em-dash spelling resolves, so the check is not simply always-on.
    c.exempt[0].sections = ["Roadmap — explicitly out of v1"];
    expect(validateSections(c, files)).toEqual([]);
  });

  it("skips section validation on an inert entry, with the path MATCHING", () => {
    // Isolated from the path guard: the path matches, the section does not
    // exist, and only `enforced: false` may keep this quiet.
    const entry = {
      phrase: "hosted",
      reason: "r",
      paths: ["a.md"],
      sections: ["Nowhere At All"],
      maxOccurrences: null,
      until: null,
      enforced: false,
    };
    const files = [{ path: "a.md", text: "# A\ntext" }];
    expect(validateSections(fixtureCanon({ exempt: [entry] }), files)).toEqual([]);
    // Flip only `enforced`, and the same entry must now be reported.
    const live = { ...entry, enforced: true };
    expect(validateSections(fixtureCanon({ exempt: [live] }), files)[0]).toMatch(
      /no such heading/,
    );
  });

  it("ignores sections on an inert entry and on a path that does not exist", () => {
    const c = fixtureCanon({
      exempt: [
        {
          phrase: "hosted",
          reason: "r",
          paths: ["spec.md"],
          sections: ["Nowhere"],
          maxOccurrences: null,
          until: null,
          enforced: false,
        },
      ],
    });
    expect(validateSections(c, [{ path: "a.md", text: "# A" }])).toEqual([]);
  });
});

describe("expandScanSet — docs/*.md is one segment deep", () => {
  const listDir = (dir: string) =>
    ({ "": ["README.md", "spec.md"], docs: ["ARCHITECTURE.md", "design"] })[dir] ?? [];

  it("expands a single-segment glob and drops unscanned paths", () => {
    const c = fixtureCanon({ scan: ["README.md", "docs/*.md"], unscanned: ["docs/design/*.md"] });
    expect(expandScanSet(c, listDir)).toEqual(["README.md", "docs/ARCHITECTURE.md"]);
  });

  it("never reaches into a subdirectory", () => {
    // The stub MUST be able to emit the nested path, or the assertion is
    // vacuous: compiling `*` to `.*` has to be able to fail this test.
    const deep = (dir: string) =>
      ({ docs: ["ARCHITECTURE.md", "design/knowledge-base.md"] })[dir] ?? [];
    const c = fixtureCanon({ scan: ["docs/*.md"], unscanned: [] });
    expect(expandScanSet(c, deep)).toEqual(["docs/ARCHITECTURE.md"]);
    expect(globToRegExp("docs/*.md").test("docs/design/knowledge-base.md")).toBe(false);
    expect(globToRegExp("docs/*.md").test("docs/ARCHITECTURE.md")).toBe(true);
  });
});

describe("audit — against the real tree", () => {
  it("scans the canon's declared surfaces and exits clean", () => {
    const files = treeFiles();
    expect(files.map((f) => f.path)).toEqual(
      expect.arrayContaining(["README.md", "SECURITY.md", "ROADMAP.md", "package.json", "docs/POSITIONING.md"]),
    );
    expect(files.some((f) => f.path.startsWith("docs/design/"))).toBe(false);

    const result = audit(files, canon());
    expect(result.errors).toEqual([]);
    expect(result.violations).toEqual([]);
    // The exemptions are load-bearing, not decorative: without them the tree
    // fails. A green run over a policy that exempted nothing would prove less.
    expect(result.exempted.length).toBeGreaterThan(0);
  });

  it("NEGATIVE CONTROL: the same tree fails once the exemptions are removed", () => {
    const bare = { ...canon(), exempt: [] };
    expect(audit(treeFiles(), bare).violations.length).toBeGreaterThan(0);
  });
});

describe("silent-pass guards — the lint must fail loudly, never shrink quietly", () => {
  it("fails when a declared surface has gone missing", () => {
    const c = canon();
    expect(scanSetErrors(c, ["SECURITY.md", "ROADMAP.md", "package.json", "docs/POSITIONING.md"])[0])
      .toMatch(/scan entry `README\.md` resolves to no file/);
    // A glob that matches nothing is the same failure wearing a different hat.
    expect(scanSetErrors(c, ["README.md", "SECURITY.md", "ROADMAP.md", "package.json"]).join(" "))
      .toMatch(/`docs\/\*\.md` matched no file/);
    expect(scanSetErrors(c, []).join(" ")).toMatch(/scan set is empty/);
  });

  it("treats an unterminated banned-phrases fence as an error, not an exclusion", () => {
    // One stray line would otherwise un-scan the whole rest of a file.
    const text = ["# Doc", "```banned-phrases", "Sign up for our cloud version."].join("\n");
    expect(unterminatedFences("README.md", text)[0]).toMatch(/unterminated `banned-phrases` fence/);
    expect(selfExcludedLines(text).size).toBe(0);
    // ...and the smuggled text is still scanned.
    expect(scanFile("README.md", text, canon()).length).toBeGreaterThan(0);
  });

  it("refuses to parse a canon whose own fence is never closed", () => {
    expect(() => parseCanonBlock("```banned-phrases\nbanned:\n  - hosted")).toThrow(/never closed/);
  });

  it("reports a duplicate key rather than letting the later one win", () => {
    const c = parseCanonBlock(
      ["```banned-phrases", "banned:", "  - hosted", "banned:", "  - zzz", "```"].join("\n"),
    );
    expect(c.banned).toEqual(["zzz"]);
    expect(validateCanon(c).join(" ")).toMatch(/duplicate key `banned`/);
  });

  it("reports a maxOccurrences that is not a non-negative integer", () => {
    const c = parseCanonBlock(
      [
        "```banned-phrases",
        "banned:",
        "  - hosted",
        "exempt:",
        "  - phrase: hosted",
        "    reason: r",
        "    paths:",
        "      - a.md",
        "    maxOccurrences: 1.0",
        "```",
      ].join("\n"),
    );
    expect(validateCanon(c).join(" ")).toMatch(/maxOccurrences `1\.0`.*not a non-negative integer/);
    // It must fail CLOSED — uncapped would be the dangerous reading.
    expect(c.exempt[0].maxOccurrences).toBe(0);
  });

  it("audit() wires BOTH validators into the result, not just the scan", () => {
    // Deleting either call from audit() has to break something.
    const files = [{ path: "a.md", text: "# A\ntext" }];
    const noBanned = audit(files, fixtureCanon({ scan: ["a.md"], banned: [] }));
    expect(noBanned.errors.join(" ")).toMatch(/pass vacuously/);

    const badSection = audit(
      files,
      fixtureCanon({
        scan: ["a.md"],
        exempt: [
          {
            phrase: "hosted",
            reason: "r",
            paths: ["a.md"],
            sections: ["Nowhere"],
            maxOccurrences: null,
            until: null,
            enforced: true,
          },
        ],
      }),
    );
    expect(badSection.errors.join(" ")).toMatch(/no such heading/);
  });
});

describe("the CLI — exit codes and file:line output, end to end", () => {
  it("exits 0 on the real tree and says what it checked", async () => {
    const { execFileSync } = await import("node:child_process");
    const out = execFileSync("node", ["scripts/claims-audit.mjs"], { encoding: "utf8" });
    expect(out).toMatch(/claims-audit: OK \(\d+ files, \d+ banned phrases/);
  });

  it("exits 1 with file:line:column on a seeded violation", async () => {
    const { execFileSync } = await import("node:child_process");
    const { mkdtempSync, mkdirSync, writeFileSync, copyFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const root = mkdtempSync(join(tmpdir(), "claims-cli-"));
    mkdirSync(join(root, "scripts"));
    mkdirSync(join(root, "docs"));
    copyFileSync("scripts/claims-audit.mjs", join(root, "scripts/claims-audit.mjs"));
    writeFileSync(
      join(root, "docs/POSITIONING.md"),
      ["```banned-phrases", "scan:", "  - README.md", "banned:", "  - hosted", "```"].join("\n"),
    );
    writeFileSync(join(root, "README.md"), ["# T", "fine", "fine", "our hosted edition"].join("\n"));

    let status = 0;
    let stderr = "";
    try {
      execFileSync("node", [join(root, "scripts/claims-audit.mjs")], { encoding: "utf8" });
    } catch (err: any) {
      status = err.status;
      stderr = String(err.stderr);
    }
    expect(status).toBe(1);
    expect(stderr).toContain('README.md:4:5: banned phrase "hosted"');
    // The canon here declares no matching block, so it must ALSO complain.
    expect(stderr).toMatch(/matching\.wordBoundary/);
  });
});
