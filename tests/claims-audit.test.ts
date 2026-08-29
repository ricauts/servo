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
  applyPathExemptions,
  audit,
  auditPaths,
  classifyPathRef,
  collectTree,
  compilePhrase,
  expandPathScanSet,
  expandScanSet,
  extractFence,
  findSpans,
  globToRegExp,
  headingPathsByLine,
  normalizePathRef,
  openFenceErrors,
  parseCanonBlock,
  pathCandidates,
  pathScanSetErrors,
  resolvePathRef,
  scanFile,
  scanFilePaths,
  scanSetErrors,
  selfExcludedLines,
  stripTrailingComment,
  topLevelNames,
  treeResolves,
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
    // hyg-03 added a second half to the policy; a minimal canon carries a
    // valid one so a phrase-rule test is not also asserting a path error.
    pathsScan: ["a.md"],
    pathsUnscanned: [],
    pathsMatching: { separatorRequired: true, anchored: true },
    pathsExempt: [],
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
    expect(c.exempt.length).toBeGreaterThanOrEqual(4);
  });

  it("keeps every phrase a string — no scalar coercion of policy data", () => {
    const c = parseCanonBlock(
      ["```banned-phrases", "banned:", "  - 12.10", "  - null", "  - 0x10", "```"].join("\n"),
    );
    expect(c.banned).toEqual(["12.10", "null", "0x10"]);
  });

  it("folds a multi-line reason and keeps the following key separate", () => {
    // A fixture, not the live canon: this asserts the PARSER folds a wrapped
    // `reason:` and still sees `paths:` as its own key. Pinning it to
    // whichever transitional exemption happens to be open made the test fail
    // the day that item shipped and retired the entry (db-05 was the last
    // one), which told nobody anything about the parser.
    const c = parseCanonBlock(
      [
        "```banned-phrases",
        "exempt:",
        "  - phrase: sqlite",
        "    until: some-item",
        "    reason: transitional - the first line of a reason that wraps",
        "      onto a second line and then a third, none of which may be",
        "      mistaken for a key",
        "    paths:",
        "      - docs/ONE.md",
        "      - docs/TWO.md",
        "```",
      ].join("\n"),
    );
    const transitional: any = c.exempt.find((e: any) => e.until === "some-item");
    expect(transitional).toBeDefined();
    expect(transitional.reason).toContain("a reason that wraps onto a second line");
    expect(transitional.reason).toContain("mistaken for a key");
    expect(transitional.paths).toEqual(["docs/ONE.md", "docs/TWO.md"]);
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
    // Also a fixture. The live canon carried exactly one `until:` exemption
    // and db-05 retired it; the behaviour under test — an exempted hit is
    // reported as a NOTE naming its retiring item, never silently dropped —
    // outlives any particular entry.
    const c = fixtureCanon({
      scan: ["docs/FIXTURE.md"],
      pathsScan: ["docs/FIXTURE.md"],
      banned: ["sqlite"],
      exempt: [
        {
          phrase: "sqlite",
          until: "some-item",
          reason: "transitional",
          paths: ["docs/FIXTURE.md"],
          sections: [],
        },
      ],
    });
    const found = scanFile("docs/FIXTURE.md", "The store is still SQLite today.", c);
    expect(found.length).toBeGreaterThan(0);
    const { reported, notes } = applyExemptions(found, c);
    expect(reported).toEqual([]);
    expect(notes.join(" ")).toMatch(/transitional until some-item/);
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

/* ==================================================================== *
 * hyg-03 — the dead-path check
 *
 * A claim can be false by saying something untrue, which the block above
 * covers, or by pointing at a file that is not there, which is this one.
 * These tests drive the acceptance criteria: the three MANDATORY fixtures
 * (a seeded dangling path reported with the right file and line; an
 * illustrative path covered by the exemption list passing clean; an empty
 * glob failing), plus a negative control for every recognition rule — a rule
 * nothing can break is not a rule that was tested.
 * ==================================================================== */

const fixture = (name: string) => readFileSync(`tests/fixtures/claims/${name}`, "utf8");

/** A synthetic tree, so recognition can be tested without the real repo. */
const FIXTURE_TREE = new Set<string>([
  "src",
  "src/lib",
  "src/lib/ai",
  "src/lib/ai/engine.ts",
  "src/lib/ai/tools",
  "src/lib/ai/tools/index.ts",
  "src/lib/ai/tools/history.ts",
  "docs",
  "docs/CONTRACT.md",
  "docs/design",
  "prisma",
  "tests",
  "README.md",
]);
const FIXTURE_TOP = topLevelNames(FIXTURE_TREE);

/** The `paths-exempt` shape, minimal, so one entry can be tested at a time. */
const pathCanon = (over: Record<string, unknown> = {}): any => ({
  pathsScan: ["docs/**/*.md"],
  pathsUnscanned: [],
  pathsMatching: { separatorRequired: true, anchored: true },
  pathsExempt: [],
  ...over,
});

describe("hyg-03 — a seeded dangling path is reported with the right file and line", () => {
  const scan = () =>
    scanFilePaths("docs/dangling.md", fixture("dangling.md"), FIXTURE_TREE, FIXTURE_TOP);

  it("reports the dead inline-code path at its own line", () => {
    const missing = scan().findings.filter((f: any) => f.kind === "code");
    expect(missing).toHaveLength(1);
    expect(missing[0]).toMatchObject({
      file: "docs/dangling.md",
      target: "src/lib/does-not-exist.ts",
      line: 7,
    });
    // The column points at the path itself, not at the start of the line.
    expect(missing[0].column).toBeGreaterThan(1);
  });

  it("reports the dead markdown link target at its own line", () => {
    const missing = scan().findings.filter((f: any) => f.kind === "link");
    expect(missing).toHaveLength(1);
    expect(missing[0]).toMatchObject({ target: "docs/nowhere.md", line: 9 });
  });

  it("resolves a link target against its OWN directory, not the repository root", () => {
    // `[the contract](CONTRACT.md)` inside docs/ means docs/CONTRACT.md.
    expect(resolvePathRef("CONTRACT.md", "link", "docs/dangling.md")).toBe("docs/CONTRACT.md");
    expect(scan().findings.map((f: any) => f.target)).not.toContain("CONTRACT.md");
    // NEGATIVE CONTROL: read as repo-relative it would be reported as dead.
    const asCode = scanFilePaths(
      "docs/dangling.md",
      "[the contract](CONTRACT.md)".replace("[the contract](", "`").replace(")", "`"),
      FIXTURE_TREE,
      FIXTURE_TOP,
    );
    expect(asCode.findings.map((f: any) => f.target)).toEqual([]); // a bare name is not a path at all
    expect(resolvePathRef("CONTRACT.md", "code", "docs/dangling.md")).toBe("CONTRACT.md");
  });

  it("strips a trailing location suffix — the line number is a coordinate, not the name", () => {
    expect(normalizePathRef("src/lib/ai/engine.ts:474-604")).toBe("src/lib/ai/engine.ts");
    expect(normalizePathRef("src/lib/ai/engine.ts:190")).toBe("src/lib/ai/engine.ts");
    expect(normalizePathRef("src/lib/bootstrap.ts:37,80")).toBe("src/lib/bootstrap.ts");
    expect(normalizePathRef("src/lib/opsdb.ts:19/41")).toBe("src/lib/opsdb.ts");
    expect(normalizePathRef("docs/x.md#a-heading")).toBe("docs/x.md");
    // NEGATIVE CONTROL: without stripping, both suffixed forms would be dead.
    expect(scan().findings.map((f: any) => f.target)).not.toContain("src/lib/ai/engine.ts:190");
  });
});

describe("hyg-03 — an illustrative path covered by the exemption list passes clean", () => {
  const findings = () =>
    scanFilePaths("docs/design/exempt.md", fixture("exempt.md"), FIXTURE_TREE, FIXTURE_TOP).findings;

  it("all three paths are genuinely missing, so the exemption is doing the work", () => {
    expect(findings().map((f: any) => f.target).sort()).toEqual([
      "apps/v4/registry/styles/x.css",
      "docs/migrating-to-postgres.md",
      "docs/spec/control-plane.md",
    ]);
  });

  it("an entry whose target AND path globs both match exempts the finding", () => {
    const canon = pathCanon({
      pathsExempt: [
        {
          target: ["docs/migrating-to-postgres.md", "docs/spec/control-plane.md", "apps/**"],
          paths: ["docs/design/*.md"],
          reason: "forward, negative and upstream references",
          until: "db-07",
        },
      ],
    });
    const { reported, exempted, notes } = applyPathExemptions(findings(), canon);
    expect(reported).toEqual([]);
    expect(exempted).toHaveLength(3);
    expect(notes.join(" ")).toContain("db-07");
  });

  it("NEGATIVE CONTROL: the same entry scoped to another file exempts nothing", () => {
    const canon = pathCanon({
      pathsExempt: [
        {
          target: ["docs/migrating-to-postgres.md", "docs/spec/control-plane.md"],
          paths: ["README.md"],
          reason: "wrong scope",
        },
      ],
    });
    expect(applyPathExemptions(findings(), canon).reported).toHaveLength(3);
  });

  it("NEGATIVE CONTROL: a matching path scope with a non-matching target exempts nothing", () => {
    const canon = pathCanon({
      pathsExempt: [{ target: ["docs/something-else.md"], paths: ["docs/design/*.md"], reason: "x" }],
    });
    expect(applyPathExemptions(findings(), canon).reported).toHaveLength(3);
  });

  it("an exemption that matched nothing is reported as a note, never silently", () => {
    const canon = pathCanon({
      pathsExempt: [{ target: ["docs/never-referenced.md"], paths: ["docs/design/*.md"], reason: "x" }],
    });
    expect(applyPathExemptions([], canon).notes.join(" ")).toContain("matched nothing");
  });
});

describe("hyg-03 — a glob is resolved by globbing, and an empty glob is a failure", () => {
  it("a glob that matches passes and one that matches nothing fails", () => {
    const { findings } = scanFilePaths(
      "docs/empty-glob.md",
      fixture("empty-glob.md"),
      FIXTURE_TREE,
      FIXTURE_TOP,
    );
    expect(findings.map((f: any) => f.target)).toEqual(["src/lib/ai/tools/*.nope"]);
  });

  it("treeResolves globs rather than testing the literal string", () => {
    expect(treeResolves(FIXTURE_TREE, "src/lib/ai/tools/*.ts")).toBe(true);
    expect(treeResolves(FIXTURE_TREE, "src/lib/ai/tools/*.nope")).toBe(false);
    // A glob is never satisfied by its own literal text being absent-or-present.
    expect(FIXTURE_TREE.has("src/lib/ai/tools/*.ts")).toBe(false);
  });

  it("resolves directories as readily as files", () => {
    expect(treeResolves(FIXTURE_TREE, "src/lib/ai/tools")).toBe(true);
    expect(treeResolves(FIXTURE_TREE, "src/lib/kb")).toBe(false);
  });
});

describe("hyg-03 — what is NOT a repo-relative path, each with its own control", () => {
  const cls = (raw: string, kind: "code" | "link" = "code") =>
    classifyPathRef(raw, kind, FIXTURE_TOP);

  it("a bare basename is a name, not a location (separatorRequired)", () => {
    for (const name of ["engine.ts", "SKILL.md", "readme.md", "tailwind.config.ts"]) {
      expect(cls(name).path).toBeNull();
    }
    // CONTROL: the same name with a directory in front IS a path.
    expect(cls("src/lib/ai/engine.ts").path).toBe("src/lib/ai/engine.ts");
  });

  it("an unanchored, extension-less first segment is skipped, and COUNTED rather than hidden", () => {
    // These are a GitHub coordinate, a container image, a JSON-RPC method and
    // an upstream package dir — indistinguishable from a directory by shape.
    for (const raw of [
      "paperclipai/paperclip",
      "pgvector/pgvector",
      "tools/call",
      "apps/v4/registry/bases/radix",
    ]) {
      const r = cls(raw);
      expect(r.path).toBeNull();
      expect(r.skip).toBe("unanchored");
    }
    const { skippedUnanchored } = scanFilePaths(
      "docs/not-paths.md",
      fixture("not-paths.md"),
      FIXTURE_TREE,
      FIXTURE_TOP,
    );
    expect(skippedUnanchored).toBeGreaterThan(0);
  });

  it("an UNANCHORED path naming a FILE by extension is still checked — the anchor alone is a hole", () => {
    // The anchor rule on its own would skip this, and it is the exact shape
    // the check exists to catch: a reference to a file that is not there.
    const r = cls("neverexisted/some/file.ts");
    expect(r.path).toBe("neverexisted/some/file.ts");
    expect(r.skip).toBeNull();
    expect(treeResolves(FIXTURE_TREE, "neverexisted/some/file.ts")).toBe(false);
    // ...and it reaches the findings, not the skip counter.
    const scanned = scanFilePaths(
      "docs/x.md",
      "a dead one: `neverexisted/some/file.ts`",
      FIXTURE_TREE,
      FIXTURE_TOP,
    );
    expect(scanned.findings.map((f: any) => f.target)).toEqual(["neverexisted/some/file.ts"]);
    expect(scanned.skippedUnanchored).toBe(0);
    // A glob in the FIRST segment is admitted by the same route.
    expect(cls("*/ai/tools/*.ts").path).toBe("*/ai/tools/*.ts");
  });

  it("DISCLOSED RESIDUE: an unanchored DIRECTORY reference is not checked, and says so", () => {
    // Documented, not accidental: an extension-less unanchored reference is
    // shape-identical to `paperclipai/paperclip`. It is counted, never hidden.
    const r = cls("neverexisted/adir");
    expect(r.path).toBeNull();
    expect(r.skip).toBe("unanchored");
  });

  it("a URI scheme is read on the FIRST segment only, so a line suffix is not one", () => {
    for (const raw of ["node:sqlite", "https://example.com/x", "mailto:a@b.c", "C:/Desarrollos/servo"]) {
      expect(cls(raw).path).toBeNull();
    }
    // CONTROL: a colon deeper in the string is a line reference, not a scheme.
    expect(cls("src/lib/ai/engine.ts:474").path).toBe("src/lib/ai/engine.ts");
  });

  it("npm scopes, absolute paths, anchors and placeholders are all skipped", () => {
    expect(cls("@modelcontextprotocol/sdk").path).toBeNull();
    expect(cls("/api/inbound/email").path).toBeNull();
    expect(cls("#a-heading").path).toBeNull();
    expect(cls("skills/<slug>/SKILL.md").path).toBeNull();
    expect(cls("src/lib/{a,b}.ts").path).toBeNull();
  });

  it("a fenced block is a sample, not an assertion", () => {
    const raws = pathCandidates(fixture("not-paths.md")).map((c: any) => c.raw);
    expect(raws).not.toContain("src/lib/nor-here.ts");
    // CONTROL: the identical span outside a fence IS picked up.
    expect(pathCandidates("see `src/lib/nor-here.ts`").map((c: any) => c.raw)).toContain(
      "src/lib/nor-here.ts",
    );
  });

  it("the whole not-paths fixture yields no finding at all", () => {
    expect(
      scanFilePaths("docs/not-paths.md", fixture("not-paths.md"), FIXTURE_TREE, FIXTURE_TOP).findings,
    ).toEqual([]);
  });
});

describe("hyg-03 — globToRegExp gains ** without widening a single *", () => {
  it("** spans zero or more segments", () => {
    const re = globToRegExp("docs/**/*.md");
    expect(re.test("docs/ARCHITECTURE.md")).toBe(true);
    expect(re.test("docs/design/postgres.md")).toBe(true);
    expect(re.test("README.md")).toBe(false);
  });

  it("NEGATIVE CONTROL: a single * still matches one segment, as docs/*.md relies on", () => {
    const re = globToRegExp("docs/*.md");
    expect(re.test("docs/ARCHITECTURE.md")).toBe(true);
    expect(re.test("docs/design/postgres.md")).toBe(false);
  });
});

describe("hyg-03 — the canon carries the dead-path policy, and a silent one fails", () => {
  it("parses the three new keys out of the real canon", () => {
    const c = canon();
    expect(c.pathsScan).toEqual([
      "README.md",
      "SECURITY.md",
      "ROADMAP.md",
      "THIRD_PARTY.md",
      "docs/**/*.md",
    ]);
    expect(c.pathsUnscanned).toEqual(["spec.md"]);
    expect(c.pathsMatching).toEqual({ separatorRequired: true, anchored: true });
    expect(c.pathsExempt.length).toBeGreaterThanOrEqual(5);
    for (const e of c.pathsExempt) {
      expect(e.target.length).toBeGreaterThan(0);
      expect(e.paths.length).toBeGreaterThan(0);
      expect(e.reason).not.toBe("");
    }
  });

  it("the canon states WHY spec.md is not scanned — it names paths it plans to create", () => {
    const fence = extractFence(CANON_TEXT)!.body.join("\n");
    const entry = fence.slice(fence.indexOf("paths-unscanned:"));
    expect(entry).toMatch(/spec\.md/);
    expect(entry.toLowerCase()).toMatch(/plans? to create/);
  });

  it("an empty paths-scan, or a mode this scanner does not implement, is a canon error", () => {
    expect(validateCanon({ ...fixtureCanon(), ...pathCanon({ pathsScan: [] }) }).join(" ")).toContain(
      "`paths-scan:` is empty",
    );
    expect(
      validateCanon({
        ...fixtureCanon(),
        ...pathCanon({ pathsMatching: { separatorRequired: true, anchored: false } }),
      }).join(" "),
    ).toContain("paths-matching.anchored");
    expect(
      validateCanon({
        ...fixtureCanon(),
        ...pathCanon({ pathsMatching: { separatorRequired: false, anchored: true } }),
      }).join(" "),
    ).toContain("paths-matching.separatorRequired");
  });

  it("an exemption missing a target, a scope or a reason is a canon error", () => {
    const errs = validateCanon({
      ...fixtureCanon(),
      ...pathCanon({ pathsExempt: [{ target: [], paths: [], reason: "" }] }),
    }).join(" ");
    expect(errs).toContain("paths-exempt[0] has no target");
    expect(errs).toContain("has no paths");
    expect(errs).toContain("has no reason");
  });

  it("NEGATIVE CONTROL: the real canon produces no error at all", () => {
    expect(validateCanon(canon())).toEqual([]);
  });

  it("a declared dead-path surface that has gone missing fails loudly", () => {
    const c = pathCanon({ pathsScan: ["README.md", "docs/**/*.md"] });
    expect(pathScanSetErrors(c, ["docs/x.md"]).join(" ")).toContain("`README.md` matched no file");
    expect(pathScanSetErrors(c, ["README.md"]).join(" ")).toContain("`docs/**/*.md` matched no file");
    expect(pathScanSetErrors(c, ["README.md", "docs/x.md"])).toEqual([]);
    expect(pathScanSetErrors(c, []).join(" ")).toContain("scan set is empty");
  });
});

describe("hyg-03 — collectTree", () => {
  it("collects files AND directories, and skips the worktree copies in .claude", () => {
    const listing: Record<string, { name: string; isDir: boolean }[]> = {
      "": [
        { name: "src", isDir: true },
        { name: ".claude", isDir: true },
        { name: "node_modules", isDir: true },
        { name: "README.md", isDir: false },
      ],
      src: [{ name: "lib", isDir: true }],
      "src/lib": [{ name: "db.ts", isDir: false }],
      ".claude": [{ name: "ghost.ts", isDir: false }],
      node_modules: [{ name: "pkg", isDir: true }],
    };
    const tree = collectTree((d: string) => listing[d] ?? []);
    expect([...tree].sort()).toEqual(["README.md", "src", "src/lib", "src/lib/db.ts"]);
    // A stale worktree copy must never make a deleted file look present.
    expect(tree.has(".claude/ghost.ts")).toBe(false);
  });
});

describe("hyg-03 — against the real tree", () => {
  const listEntries = (dir: string) => {
    try {
      return readdirSync(dir === "" ? "." : dir, { withFileTypes: true }).map((e) => ({
        name: e.name,
        isDir: e.isDirectory(),
      }));
    } catch {
      return [];
    }
  };
  const realTree = () => collectTree(listEntries);

  /** The dead-path scan set the CLI builds, read from the real tree. */
  function pathScanFiles() {
    const c = canon();
    const tree = realTree();
    const found = new Set<string>();
    for (const pattern of c.pathsScan) {
      if (!pattern.includes("*")) {
        if (tree.has(pattern)) found.add(pattern);
        continue;
      }
      const re = globToRegExp(pattern);
      for (const p of tree) if (re.test(p)) found.add(p);
    }
    return [...found]
      .filter((f) => !c.pathsUnscanned.some((u: string) => globToRegExp(u).test(f)))
      .sort()
      .map((p) => ({ path: p, text: readFileSync(p, "utf8") }));
  }

  it("every declared surface resolves, and docs/**/*.md really does recurse", () => {
    const files = pathScanFiles().map((f) => f.path);
    expect(files).toContain("THIRD_PARTY.md");
    expect(files).toContain("docs/ARCHITECTURE.md");
    expect(files).toContain("docs/design/postgres.md");
    expect(files).not.toContain("spec.md");
  });

  it("the tree has NO unexempted dangling path — hyg-02's repairs are proven gone", () => {
    const result = auditPaths(pathScanFiles(), canon(), realTree());
    expect(result.errors).toEqual([]);
    expect(
      result.missing.map((m: any) => `${m.file}:${m.line}: ${m.target}`),
    ).toEqual([]);
  });

  it("the check is not vacuous: it resolved a real corpus of references", () => {
    const result = auditPaths(pathScanFiles(), canon(), realTree());
    expect(result.checked).toBeGreaterThan(200);
    // `resolved` is the honest number: `checked` includes the exempted ones,
    // and reporting it as "resolved" would overstate a clean run by the size
    // of the exemption list. It is derived from `unresolved`, never from the
    // DEDUPED finding list — see the dedup block below for why.
    expect(result.resolved).toBe(result.checked - result.unresolved);
    expect(result.resolved).toBeGreaterThan(200);
  });

  it("EVERY skip class is counted, so no drop is invisible", () => {
    const result = auditPaths(pathScanFiles(), canon(), realTree());
    // The unanchored skips are the interesting ones, but the much larger
    // not-path-shaped class is disclosed too: an uncounted skip class is how a
    // lint looks thorough while doing very little.
    expect(result.skippedUnanchored).toBeGreaterThan(0);
    expect(result.skippedNotPathShaped).toBeGreaterThan(result.skippedUnanchored);
  });

  it("the four references hyg-02 repaired are repaired IN THE DOCUMENTS, not just on disk", () => {
    // A tree-membership assertion is not a proof: it passes just as happily on
    // a tree where every document was reverted to the old spelling. The proof
    // has to be about the REFERENCING TEXT, so these read the documents.
    const tree = realTree();
    const ledger = readFileSync("docs/PORTING-LEDGER.md", "utf8");
    const readme = readFileSync("README.md", "utf8");
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));

    // 1+2. The ledger cites the underscore spelling, and the file is there.
    expect(ledger).toContain("THIRD_PARTY.md");
    expect(treeResolves(tree, "THIRD_PARTY.md")).toBe(true);
    // The old spelling survives ONLY as the correction note describing the
    // rename, never as a live citation of a file that does not exist.
    for (const line of ledger.split(/\r?\n/)) {
      if (!line.includes("THIRD-PARTY.md")) continue;
      expect(line).toMatch(/→|->|corrected|spelling/);
    }
    expect(treeResolves(tree, "THIRD-PARTY.md")).toBe(false);

    // 3. package.json's prisma.seed points at a file that exists.
    expect(pkg.prisma.seed).toContain("prisma/seed-core.ts");
    expect(treeResolves(tree, "prisma/seed-core.ts")).toBe(true);
    expect(treeResolves(tree, "prisma/seed.ts")).toBe(false);

    // 4. README's project-structure block names both real seeds, not the ghost.
    expect(readme).toContain("seed-core.ts");
    expect(readme).toContain("seed-demo.ts");
    expect(treeResolves(tree, "prisma/seed-demo.ts")).toBe(true);
    expect(readme).not.toMatch(/`prisma\/seed\.ts`/);
  });
});

describe("hyg-03 — the CLI reports a missing path with file:line and exits 1", () => {
  it("runs under the SAME npm script, and fails on a seeded dangling path", async () => {
    const { execFileSync } = await import("node:child_process");
    const { mkdtempSync, mkdirSync, writeFileSync, copyFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const root = mkdtempSync(join(tmpdir(), "claims-paths-"));
    mkdirSync(join(root, "scripts"));
    mkdirSync(join(root, "docs"));
    copyFileSync("scripts/claims-audit.mjs", join(root, "scripts/claims-audit.mjs"));
    writeFileSync(
      join(root, "docs/POSITIONING.md"),
      [
        "```banned-phrases",
        "scan:",
        "  - README.md",
        "matching:",
        "  wordBoundary: true",
        "  caseInsensitive: true",
        "selfExclude:",
        "  fence: banned-phrases",
        "  appliesTo: all-scanned-files",
        "banned:",
        "  - hosted",
        "paths-scan:",
        "  - README.md",
        "paths-matching:",
        "  separatorRequired: true",
        "  anchored: true",
        "paths-exempt:",
        "  - target:",
        "      - docs/planned.md",
        "    paths:",
        "      - README.md",
        "    reason: a forward reference",
        "```",
      ].join("\n"),
    );
    writeFileSync(
      join(root, "README.md"),
      ["# T", "fine", "the engine is `docs/POSITIONING.md`", "dead: `docs/gone.md`", "ok: `docs/planned.md`"].join(
        "\n",
      ),
    );

    let status = 0;
    let stderr = "";
    try {
      execFileSync("node", [join(root, "scripts/claims-audit.mjs")], { encoding: "utf8" });
    } catch (err: any) {
      status = err.status;
      stderr = String(err.stderr);
    }
    expect(status).toBe(1);
    expect(stderr).toContain('README.md:4:8: missing path "docs/gone.md"');
    // The exempted forward reference is NOT reported...
    expect(stderr).not.toContain("docs/planned.md");
    // ...and the path that really exists is not reported either.
    expect(stderr).not.toContain("docs/POSITIONING.md\"");
    expect(stderr).toMatch(/1 missing path\(s\)/);
  });
});

describe("hyg-03 — reference forms an adversarial pass found missing", () => {
  it("an HTML <img src> is a reference — README ships six of them", () => {
    const raws = pathCandidates('<img src="docs/assets/banner.svg" alt="x" />').map((c: any) => c.raw);
    expect(raws).toContain("docs/assets/banner.svg");
    // ...and the real README's six are actually checked against the tree.
    const readme = readFileSync("README.md", "utf8");
    const imgs = pathCandidates(readme)
      .map((c: any) => c.raw)
      .filter((r: string) => r.startsWith("docs/assets/"));
    expect(imgs.length).toBeGreaterThanOrEqual(6);
    // NEGATIVE CONTROL: without this, deleting a shipped screenshot is silent.
    const tree = new Set(["docs", "docs/assets"]);
    expect(
      scanFilePaths("README.md", '<img src="docs/assets/gone.png" />', tree, topLevelNames(tree))
        .findings.map((f: any) => f.target),
    ).toEqual(["docs/assets/gone.png"]);
  });

  it("an <a href> is a reference too", () => {
    expect(pathCandidates('<a href="docs/USER-GUIDE.md">guide</a>').map((c: any) => c.raw)).toContain(
      "docs/USER-GUIDE.md",
    );
  });

  it("a reference-style link definition is read at its definition line", () => {
    const cands = pathCandidates("see [the guide][g]\n\n[g]: docs/gone.md");
    const def: any = cands.find((c: any) => c.raw === "docs/gone.md");
    expect(def).toBeDefined();
    expect(def.line).toBe(3);
    expect(def.kind).toBe("link");
  });

  it("markdown link syntax INSIDE inline code is a sample, not a link", () => {
    // False positives are the worst kind: `[x](y.md)` written as code is
    // documentation of syntax, and reading it as a link invents a finding.
    const cands = pathCandidates("write it as `[label](docs/target.md)` in prose");
    expect(cands.filter((c: any) => c.kind === "link")).toEqual([]);
    // The code span itself is still a candidate; it is simply not path-shaped.
    expect(cands.map((c: any) => c.kind)).toEqual(["code"]);
    // CONTROL: the same construct outside backticks IS a link.
    expect(pathCandidates("write it as [label](docs/target.md) in prose").map((c: any) => c.kind)).toContain(
      "link",
    );
  });

  it("a ./-prefixed path normalizes rather than being dropped uncounted", () => {
    expect(normalizePathRef("./docs/x.md")).toBe("docs/x.md");
    expect(normalizePathRef("./././docs/x.md")).toBe("docs/x.md");
    const tree = new Set(["docs"]);
    const r = scanFilePaths("README.md", "see `./docs/gone.md`", tree, topLevelNames(tree));
    expect(r.findings.map((f: any) => f.target)).toEqual(["docs/gone.md"]);
  });
});

describe("hyg-03 — exemption liveness is tracked PER TARGET, not per entry", () => {
  const findings = [{ file: "docs/a.md", line: 1, column: 1, target: "docs/live.md", kind: "code" }];

  it("a live entry still reports the targets inside it that matched nothing", () => {
    // Without this, eleven dead targets hide inside one entry that still has
    // a twelfth live one, and the exemption list rots invisibly.
    const canon = pathCanon({
      pathsExempt: [
        { target: ["docs/live.md", "docs/dead-one.md", "docs/dead-two.md"], paths: ["docs/*.md"], reason: "x" },
      ],
    });
    const { reported, notes } = applyPathExemptions(findings as any, canon);
    expect(reported).toEqual([]);
    expect(notes.join(" ")).toContain("docs/dead-one.md");
    expect(notes.join(" ")).toContain("docs/dead-two.md");
  });

  it("NEGATIVE CONTROL: an entry whose targets all matched reports nothing", () => {
    const canon = pathCanon({
      pathsExempt: [{ target: ["docs/live.md"], paths: ["docs/*.md"], reason: "x" }],
    });
    expect(applyPathExemptions(findings as any, canon).notes).toEqual([]);
  });

  it("the REAL canon carries no dead exemption entry and no dead target", async () => {
    const { execFileSync } = await import("node:child_process");
    const listEntries = (dir: string) => {
      try {
        return readdirSync(dir === "" ? "." : dir, { withFileTypes: true }).map((e) => ({
          name: e.name,
          isDir: e.isDirectory(),
        }));
      } catch {
        return [];
      }
    };
    // The audit resolves paths against TRACKED files; gitignored runtime
    // artefacts (prisma/*.db) exist on an operator's machine and in no
    // checkout, so a working-tree walk must drop them or liveness goes
    // machine-dependent (it did: the entry looked dead on the dev machine).
    const ignored = execFileSync(
      "git",
      ["ls-files", "--others", "--ignored", "--exclude-standard", "--directory"],
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    )
      .split(/\r?\n/)
      .filter(Boolean);
    // --directory groups ignored trees (node_modules/) into one entry each;
    // match tree paths by prefix so the grouping still filters everything.
    const isIgnored = (p: string) =>
      ignored.some((entry: string) => p === entry || p.startsWith(entry + "/"));
    const tree = new Set([...collectTree(listEntries)].filter((p: string) => !isIgnored(p)));
    const c = canon();
    const found = new Set<string>();
    for (const pattern of c.pathsScan) {
      const re = globToRegExp(pattern);
      for (const p of tree) if (re.test(p)) found.add(p);
    }
    const files = [...found]
      .filter((f) => !c.pathsUnscanned.some((u: string) => globToRegExp(u).test(f)))
      .map((p) => ({ path: p, text: readFileSync(p, "utf8") }));
    const notes = auditPaths(files, c, tree).notes.filter((n: string) => n.includes("matched nothing"));
    expect(notes).toEqual([]);
  });
});

describe("hyg-03 — silent-pass guards on the dead-path half", () => {
  it("CRITICAL: an unterminated fence does NOT un-scan the rest of the file", () => {
    // Reproduced before the fix: a stray ``` ran to EOF, every later reference
    // vanished from the check, the counters did not move and the run exited 0.
    const text = ["# T", "```", "an unbalanced fence", "", "dead: `docs/gone.md`"].join("\n");
    const tree = new Set(["docs"]);
    const raws = pathCandidates(text).map((c: any) => c.raw);
    expect(raws).toContain("docs/gone.md");
    expect(scanFilePaths("docs/a.md", text, tree, topLevelNames(tree)).findings).toHaveLength(1);
    // NEGATIVE CONTROL: a properly CLOSED fence really does mask its contents.
    const closed = ["# T", "```", "dead: `docs/gone.md`", "```"].join("\n");
    expect(pathCandidates(closed).map((c: any) => c.raw)).not.toContain("docs/gone.md");
  });

  it("...and the unterminated fence is reported loudly, so the cause is named", () => {
    const errs = openFenceErrors("docs/a.md", ["# T", "```", "never closed"].join("\n"));
    expect(errs).toHaveLength(1);
    expect(errs[0]).toContain("docs/a.md:2");
    expect(errs[0]).toContain("unterminated");
    // NEGATIVE CONTROL: a balanced document reports nothing.
    expect(openFenceErrors("docs/a.md", ["```", "x", "```"].join("\n"))).toEqual([]);
  });

  it("auditPaths wires the open-fence check in, not just pathCandidates", () => {
    const c = pathCanon({ pathsScan: ["docs/a.md"] });
    const files = [{ path: "docs/a.md", text: "# T\n```\nnever closed" }];
    const result = auditPaths(files, c, new Set(["docs", "docs/a.md"]));
    expect(result.errors.join(" ")).toContain("unterminated");
  });

  it("a misspelled paths-matching mode is a canon error, not a silent default", () => {
    const errs = validateCanon({
      ...fixtureCanon(),
      pathsMatching: { separatorRequired: true, anchored: true, anchorred: true },
    });
    expect(errs.join(" ")).toContain("`paths-matching.anchorred` is not a mode");
  });

  it("an unexplained paths-unscanned entry is a canon error", () => {
    // Removing a file from the check is the edit nobody should make quietly.
    const errs = validateCanon({
      ...fixtureCanon(),
      pathsUnscannedEntries: [{ path: "THIRD_PARTY.md", reason: "" }],
    });
    expect(errs.join(" ")).toContain("`THIRD_PARTY.md` has no reason");
    // NEGATIVE CONTROL: with a reason it passes.
    expect(
      validateCanon({
        ...fixtureCanon(),
        pathsUnscannedEntries: [{ path: "THIRD_PARTY.md", reason: "because" }],
      }),
    ).toEqual([]);
  });

  it("a paths-exempt entry that is not a map is counted and reported, not dropped", () => {
    const c = parseCanonBlock(
      [
        "```banned-phrases",
        "paths-exempt:",
        "  - just-a-string",
        "  - target: docs/x.md",
        "    paths: README.md",
        "    reason: fine",
        "```",
      ].join("\n"),
    );
    expect(c.pathsExemptMalformed).toBe(1);
    expect(validateCanon({ ...fixtureCanon(), pathsExemptMalformed: 1 }).join(" ")).toContain(
      "are not maps and were dropped",
    );
  });

  it("the REAL canon carries a reason on every paths-unscanned entry", () => {
    for (const e of canon().pathsUnscannedEntries) {
      expect(e.path).not.toBe("");
      expect(e.reason).not.toBe("");
    }
  });

  it("a reference that escapes the repository is counted, never lost", () => {
    const tree = new Set(["docs", "README.md"]);
    const r = scanFilePaths(
      "docs/a.md",
      "[up and out](../../elsewhere/x.md)",
      tree,
      topLevelNames(tree),
    );
    expect(r.findings).toEqual([]);
    expect(r.skippedOutsideRepo).toBe(1);
  });
});

describe("hyg-03 — deleting the canon's closing fence cannot pass quietly", () => {
  it("a canon whose fence is left open makes the whole run fail loudly", () => {
    // The fence re-pairs with a later delimiter, which would otherwise swallow
    // prose into the policy and still exit 0. The open-fence check is what
    // turns that into a named error instead of a silent acceptance.
    const doc = [
      "# Canon",
      "```banned-phrases",
      "banned:",
      "  - hosted",
      "```",
      "prose",
      "```",
      "a later block",
      "```",
    ].join("\n");
    expect(openFenceErrors("docs/POSITIONING.md", doc)).toEqual([]);
    const broken = doc.split("\n");
    broken.splice(4, 1); // delete the canon's closing ```
    const errs = openFenceErrors("docs/POSITIONING.md", broken.join("\n"));
    expect(errs).toHaveLength(1);
    expect(errs[0]).toContain("unterminated");
  });
});

describe("hyg-03 — the resolved counter is independent of deduplication", () => {
  it("two dead references to the same target on one line are TWO failures", () => {
    // docs/design/postgres.md:242 writes `prisma/*.db` twice on one line.
    // Deriving `resolved` from the deduped finding list reported the second
    // dead reference as healthy — an overstatement that grows with the file.
    const tree = new Set(["src", "src/lib", "src/lib/db.ts", "prisma"]);
    const r = scanFilePaths(
      "docs/a.md",
      "both dead: `prisma/gone.db` and again `prisma/gone.db`, one live: `src/lib/db.ts`",
      tree,
      topLevelNames(tree),
    );
    expect(r.checked).toBe(3);
    expect(r.unresolved).toBe(2);
    expect(r.findings).toHaveLength(1); // deduped for reporting...
    expect(r.checked - r.unresolved).toBe(1); // ...but not for counting
  });

  it("the real tree's counters add up exactly, with nothing unaccounted for", async () => {
    const { execFileSync } = await import("node:child_process");
    const listEntries = (dir: string) => {
      try {
        return readdirSync(dir === "" ? "." : dir, { withFileTypes: true }).map((e) => ({
          name: e.name,
          isDir: e.isDirectory(),
        }));
      } catch {
        return [];
      }
    };
    // The audit resolves paths against TRACKED files; gitignored runtime
    // artefacts (prisma/*.db) exist on an operator's machine and in no
    // checkout, so a working-tree walk must drop them or liveness goes
    // machine-dependent (it did: the entry looked dead on the dev machine).
    const ignored = execFileSync(
      "git",
      ["ls-files", "--others", "--ignored", "--exclude-standard", "--directory"],
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    )
      .split(/\r?\n/)
      .filter(Boolean);
    // --directory groups ignored trees (node_modules/) into one entry each;
    // match tree paths by prefix so the grouping still filters everything.
    const isIgnored = (p: string) =>
      ignored.some((entry: string) => p === entry || p.startsWith(entry + "/"));
    const tree = new Set([...collectTree(listEntries)].filter((p: string) => !isIgnored(p)));
    const c = canon();
    const found = new Set<string>();
    for (const pattern of c.pathsScan) {
      const re = globToRegExp(pattern);
      for (const p of tree) if (re.test(p)) found.add(p);
    }
    const files = [...found]
      .filter((f) => !c.pathsUnscanned.some((u: string) => globToRegExp(u).test(f)))
      .map((p) => ({ path: p, text: readFileSync(p, "utf8") }));
    const r = auditPaths(files, c, tree);
    // resolved is derived from unresolved, never from the deduped list.
    expect(r.resolved).toBe(r.checked - r.unresolved);
    // and every unresolved reference is either reported or exempted, with the
    // difference being exactly the duplicates deduplication removed.
    expect(r.unresolved).toBeGreaterThanOrEqual(r.missing.length + r.exempted.length);
  });
});

/* ==================================================================== *
 * hyg-03 — mutation-proven gaps.
 *
 * An adversarial pass applied 48 mutations to the dead-path implementation
 * and found 8 that left the suite fully green. It could not make the checker
 * produce a wrong ANSWER on any input; every one of these was a rule the
 * tests did not hold down. Each mutation now fails a test.
 * ==================================================================== */

describe("hyg-03 — rules a mutation could delete with the suite still green", () => {
  it("auditPaths WIRES pathScanSetErrors in — a vanished surface is not silent", () => {
    // Mutation: delete the pathScanSetErrors call from auditPaths.
    const c = pathCanon({ pathsScan: ["README.md", "docs/**/*.md"] });
    const files = [{ path: "docs/a.md", text: "# ok" }];
    const result = auditPaths(files, c, new Set(["docs", "docs/a.md"]));
    expect(result.errors.join(" ")).toContain("`README.md` matched no file");
  });

  it("expandPathScanSet drops DIRECTORIES a glob matched — the EISDIR guard", () => {
    // Mutation: delete the isFile filter. The CLI then reads a directory and
    // dies with an uncaught EISDIR instead of reporting anything.
    const tree = new Set(["docs", "docs/design", "docs/a.md", "docs/design/b.md"]);
    const isFile = (rel: string) => rel.endsWith(".md");
    const c = pathCanon({ pathsScan: ["docs/**"] });
    expect(expandPathScanSet(c, tree, isFile)).toEqual(["docs/a.md", "docs/design/b.md"]);
    // NEGATIVE CONTROL: without the filter the directories come back.
    expect(expandPathScanSet(c, tree, () => true)).toContain("docs/design");
  });

  it("expandPathScanSet HONOURS paths-unscanned — the canon's one exclusion works", () => {
    // Mutation: drop the paths-unscanned filter. spec.md would be scanned and
    // every unbuilt item in it would read as a dangling reference.
    const tree = new Set(["docs", "docs/a.md", "docs/b.md"]);
    const c = pathCanon({ pathsScan: ["docs/**/*.md"], pathsUnscanned: ["docs/b.md"] });
    expect(expandPathScanSet(c, tree, () => true)).toEqual(["docs/a.md"]);
  });

  it("a paths-unscanned entry with a reason but NO path is a canon error", () => {
    // Mutation: delete the `has no path` branch.
    expect(
      validateCanon({
        ...fixtureCanon(),
        pathsUnscannedEntries: [{ path: "", reason: "because" }],
      }).join(" "),
    ).toContain("`paths-unscanned` entry has no path");
  });

  it("normalizePathRef strips trailing sentence punctuation", () => {
    // Mutation: delete the trailing-punctuation strip. A healthy reference at
    // the end of a sentence then reads as dead.
    expect(normalizePathRef("docs/ARCHITECTURE.md.")).toBe("docs/ARCHITECTURE.md");
    expect(normalizePathRef("docs/ARCHITECTURE.md,")).toBe("docs/ARCHITECTURE.md");
    const tree = new Set(["docs", "docs/a.md"]);
    expect(
      scanFilePaths("README.md", "see `docs/a.md`.", tree, topLevelNames(tree)).findings,
    ).toEqual([]);
  });

  it("findings come back ordered by file, then line, then COLUMN", () => {
    // Mutation: remove the sort in auditPaths. Two findings on one line then
    // return code-before-link rather than in reading order.
    const tree = new Set(["docs"]);
    const files = [
      { path: "docs/b.md", text: "x" },
      { path: "docs/a.md", text: "[l](gone-link.md) then `docs/gone-code.md`" },
    ];
    const c = pathCanon({ pathsScan: ["docs/**/*.md"] });
    const r = auditPaths(files, c, tree);
    // The link is doc-relative (docs/gone-link.md), the code span is not.
    expect(r.missing.map((m: any) => m.target)).toEqual(["docs/gone-link.md", "docs/gone-code.md"]);
    expect(r.missing[0].column).toBeLessThan(r.missing[1].column);
  });

  it("a `.` or `..` first segment in INLINE CODE is not a repo-relative path", () => {
    // Mutation: delete the guard. The reference is then booked to a different
    // counter and resolved from the wrong base.
    const r = classifyPathRef("../outside/x.md", "code", FIXTURE_TOP);
    expect(r.path).toBeNull();
    expect(r.skip).toBeNull();
    // A LINK target may legitimately climb: docs/USER-GUIDE.md links ../README.md.
    expect(classifyPathRef("../README.md", "link", FIXTURE_TOP).path).toBe("../README.md");
    expect(resolvePathRef("../README.md", "link", "docs/USER-GUIDE.md")).toBe("README.md");
  });
});

describe("hyg-03 — the CLI fails on a dead-path CANON error, not only on a missing path", () => {
  it("a declared dead-path surface that has vanished exits 1", async () => {
    // Mutation: drop paths.errors from main()'s failure count. Canon errors
    // are then printed and ignored, and the run exits 0 anyway.
    const { execFileSync } = await import("node:child_process");
    const { mkdtempSync, mkdirSync, writeFileSync, copyFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const root = mkdtempSync(join(tmpdir(), "claims-canonerr-"));
    mkdirSync(join(root, "scripts"));
    mkdirSync(join(root, "docs"));
    copyFileSync("scripts/claims-audit.mjs", join(root, "scripts/claims-audit.mjs"));
    writeFileSync(
      join(root, "docs/POSITIONING.md"),
      [
        "```banned-phrases",
        "scan:",
        "  - README.md",
        "matching:",
        "  wordBoundary: true",
        "  caseInsensitive: true",
        "selfExclude:",
        "  fence: banned-phrases",
        "  appliesTo: all-scanned-files",
        "banned:",
        "  - hosted",
        "paths-scan:",
        "  - README.md",
        "  - THIRD_PARTY.md", // declared, but absent from this tree
        "paths-matching:",
        "  separatorRequired: true",
        "  anchored: true",
        "```",
      ].join("\n"),
    );
    writeFileSync(join(root, "README.md"), "# T\nnothing dangling here\n");

    let status = 0;
    let stderr = "";
    try {
      execFileSync("node", [join(root, "scripts/claims-audit.mjs")], { encoding: "utf8" });
    } catch (err: any) {
      status = err.status;
      stderr = String(err.stderr);
    }
    expect(status).toBe(1);
    expect(stderr).toContain("`THIRD_PARTY.md` matched no file");
    expect(stderr).toMatch(/0 missing path\(s\)/); // the FAILURE is the canon error alone
  });
});

describe("hyg-03 follow-up — defects an adjudicator found after the merge", () => {
  it("BLOCKING: a 4-space-indented fence is NOT a fence, so it cannot un-scan a region", () => {
    // Reproduced on main: two 4-space-indented ``` lines around a paragraph
    // made its dead link vanish with the counters byte-identical and exit 0,
    // while every markdown renderer still showed the link as live.
    const text = ["# T", "    ```", "    indented", "", "[x](zz-dangle.md)", "", "    ```"].join("\n");
    expect(pathCandidates(text).map((c: any) => c.raw)).toContain("zz-dangle.md");
    // CommonMark allows up to THREE spaces, and that still masks.
    const three = ["# T", "   ```", "[x](zz-dangle.md)", "   ```"].join("\n");
    expect(pathCandidates(three).map((c: any) => c.raw)).not.toContain("zz-dangle.md");
    // NEGATIVE CONTROL: an unindented fence masks, as it always did.
    expect(
      pathCandidates(["```", "[x](zz-dangle.md)", "```"].join("\n")).map((c: any) => c.raw),
    ).not.toContain("zz-dangle.md");
  });

  it("a link title in single quotes or parentheses does not hide the target", () => {
    for (const form of ["[x](docs/gone.md 'title')", "[x](docs/gone.md (title))", '[x](docs/gone.md "t")']) {
      expect(pathCandidates(form).map((c: any) => c.raw)).toContain("docs/gone.md");
    }
  });

  it("an HTML attribute value may be unquoted or single-quoted", () => {
    expect(pathCandidates("<img src=docs/gone.png >").map((c: any) => c.raw)).toContain("docs/gone.png");
    expect(pathCandidates("<img src='docs/gone.png'>").map((c: any) => c.raw)).toContain("docs/gone.png");
    expect(pathCandidates('<img alt="a>b" src="docs/gone.png">').map((c: any) => c.raw)).toContain(
      "docs/gone.png",
    );
  });

  it("a catch-all paths-exempt target is a canon error, not a silencer", () => {
    // Appended last, `*` exempts every finding while only the exempt counter
    // moves — the one malformed shape every other validator let through.
    for (const t of ["*", "**", "**/*"]) {
      expect(
        validateCanon({
          ...fixtureCanon(),
          pathsExempt: [{ target: [t], paths: ["docs/*.md"], reason: "x" }],
        }).join(" "),
      ).toContain("is a catch-all");
    }
    // NEGATIVE CONTROL: a scoped glob is fine.
    expect(
      validateCanon({
        ...fixtureCanon(),
        pathsExempt: [{ target: ["apps/**"], paths: ["docs/*.md"], reason: "x" }],
      }),
    ).toEqual([]);
  });

  it("the printed arithmetic reconciles: checked = resolved + exempt + missing", async () => {
    const { execFileSync } = await import("node:child_process");
    const listEntries = (dir: string) => {
      try {
        return readdirSync(dir === "" ? "." : dir, { withFileTypes: true }).map((e) => ({
          name: e.name,
          isDir: e.isDirectory(),
        }));
      } catch {
        return [];
      }
    };
    // The audit resolves paths against TRACKED files; gitignored runtime
    // artefacts (prisma/*.db) exist on an operator's machine and in no
    // checkout, so a working-tree walk must drop them or liveness goes
    // machine-dependent (it did: the entry looked dead on the dev machine).
    const ignored = execFileSync(
      "git",
      ["ls-files", "--others", "--ignored", "--exclude-standard", "--directory"],
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    )
      .split(/\r?\n/)
      .filter(Boolean);
    // --directory groups ignored trees (node_modules/) into one entry each;
    // match tree paths by prefix so the grouping still filters everything.
    const isIgnored = (p: string) =>
      ignored.some((entry: string) => p === entry || p.startsWith(entry + "/"));
    const tree = new Set([...collectTree(listEntries)].filter((p: string) => !isIgnored(p)));
    const c = canon();
    const found = new Set<string>();
    for (const pattern of c.pathsScan) {
      const re = globToRegExp(pattern);
      for (const p of tree) if (re.test(p)) found.add(p);
    }
    const files = [...found]
      .filter((f) => !c.pathsUnscanned.some((u: string) => globToRegExp(u).test(f)))
      .map((p) => ({ path: p, text: readFileSync(p, "utf8") }));
    const r = auditPaths(files, c, tree);
    // Deduped findings would leave this short by the duplicate count.
    expect(r.resolved + r.exemptedOccurrences + r.missing.length).toBe(r.checked);
  });
});

describe("hyg-03 follow-up — two false positives an adversarial pass reproduced", () => {
  it("a ?query is stripped like a #fragment — a healthy link must not fail CI", () => {
    // `docs/POSITIONING.md?plain=1` is GitHub-idiomatic and names a file that
    // exists. A false positive is worse than a miss: it fails CI on good copy
    // and the only escape is to record a healthy link as an exception.
    expect(normalizePathRef("docs/POSITIONING.md?plain=1")).toBe("docs/POSITIONING.md");
    expect(normalizePathRef("docs/POSITIONING.md#paths-scan")).toBe("docs/POSITIONING.md");
    const tree = new Set(["docs", "docs/POSITIONING.md"]);
    expect(
      scanFilePaths("README.md", "[raw](docs/POSITIONING.md?plain=1)", tree, topLevelNames(tree)).findings,
    ).toEqual([]);
  });

  it("the extension escape does NOT swallow a two-segment GitHub coordinate", () => {
    // THIRD_PARTY.md exists to cite upstream projects, and `.js` repo names are
    // everywhere. Resolving these would fail CI on a healthy citation.
    for (const coord of ["vercel/next.js", "mrdoob/three.js", "lodash/merge.js", "expressjs/express.js"]) {
      const r = classifyPathRef(coord, "code", FIXTURE_TOP);
      expect(r.path).toBeNull();
      expect(r.skip).toBe("unanchored"); // counted, never silent
    }
    // ...while a DEEPER unanchored file reference is still caught, which is the
    // whole point of the extension escape.
    expect(classifyPathRef("neverexisted/some/file.ts", "code", FIXTURE_TOP).path).toBe(
      "neverexisted/some/file.ts",
    );
    // ...and an ANCHORED two-segment path is unaffected: the rule is about the
    // extension escape, not about depth in general.
    expect(classifyPathRef("src/missing.ts", "code", FIXTURE_TOP).path).toBe("src/missing.ts");
  });
});
