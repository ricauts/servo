// reb-07: the claims lint reads its policy from the fenced `banned-phrases`
// block in docs/POSITIONING.md and enforces it over the user-visible surfaces.
// Every rule gets a fixture, and the three mandatory ones — README's
// "self-hosted" line, package.json's "Self-host it" description, and the
// canon's own fence — are driven against the REAL files, not paraphrases of
// them, because a paraphrase can pass while the shipped line fails.

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  auditFile,
  auditFiles,
  auditRepo,
  collectScanSet,
  fenceRegions,
  findPhrases,
  headingChains,
  parsePolicy,
  parseYamlSubset,
  pathMatches,
  phrasePattern,
} from "../scripts/claims-audit.mjs";

const ROOT = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const CANON = read("docs/POSITIONING.md");
const POLICY = parsePolicy(CANON);

/** A synthetic canon, so the unit fixtures do not depend on the real wording. */
function policyDoc(block: string): string {
  return ["# Canon", "", "## Banned phrases", "", "```banned-phrases", block, "```", "", "Prose after the fence."].join("\n");
}

const SIMPLE_BLOCK = [
  "scan:",
  "  - README.md",
  "  - docs/*.md",
  "matching:",
  "  wordBoundary: true",
  "  caseInsensitive: true",
  "selfExclude:",
  "  fence: banned-phrases",
  "  appliesTo: all-scanned-files",
  "banned:",
  "  - hosted",
  "  - control plane",
  "allow:",
  "  - self-hosted",
].join("\n");

describe("policy block parsing", () => {
  it("reads the seven keys of the real canon out of the fence", () => {
    expect(POLICY.scan).toEqual(["README.md", "SECURITY.md", "ROADMAP.md", "package.json", "docs/*.md"]);
    expect(POLICY.banned).toContain("hosted");
    expect(POLICY.banned).toContain("control plane");
    expect(POLICY.banned).toContain("sqlite");
    expect(POLICY.allow).toContain("Self-host it");
    expect(POLICY.matching).toEqual({ wordBoundary: true, caseInsensitive: true });
    expect(POLICY.selfExclude).toEqual({ fence: "banned-phrases", appliesTo: "all-scanned-files" });
    expect(POLICY.unscanned).toEqual(["spec.md", "docs/design/*.md"]);
  });

  it("parses exemption entries including folded reasons, enforced:false and maxOccurrences", () => {
    const marketplace = POLICY.exempt.filter((e: any) => e.phrase === "marketplace");
    expect(marketplace).toHaveLength(2);
    expect(marketplace[0]).toMatchObject({ paths: ["docs/POSITIONING.md"], sections: ["ROADMAP"], maxOccurrences: 1, enforced: true });
    expect(marketplace[1]).toMatchObject({ paths: ["spec.md"], enforced: false });
    // The em-dashed heading survives parsing verbatim; an ASCII hyphen here
    // would silently match no section at all.
    expect(marketplace[1].sections).toEqual(["12. Roadmap — explicitly out of v1"]);

    const transitional = POLICY.exempt.find((e: any) => e.until === "db-01");
    expect(transitional?.paths).toContain("docs/PORTING-LEDGER.md");
    // The reason wraps across two lines in the canon and must fold into one.
    expect(transitional?.reason).toContain("including this ledger's own preamble");
  });

  it("folds continuations, coerces scalars and nests sequences of maps", () => {
    const parsed = parseYamlSubset(
      [
        "banned:",
        "  - one",
        "  - two words",
        "exempt:",
        "  - phrase: one",
        "    enforced: false",
        "    maxOccurrences: 2",
        "    reason: a reason that wraps",
        "      onto a second line",
        "    paths:",
        "      - a.md",
        "      - b/*.md",
      ].join("\n"),
    );
    expect(parsed).toEqual({
      banned: ["one", "two words"],
      exempt: [{ phrase: "one", enforced: false, maxOccurrences: 2, reason: "a reason that wraps onto a second line", paths: ["a.md", "b/*.md"] }],
    });
  });

  it("refuses a policy file with no banned-phrases fence, rather than scanning for nothing", () => {
    expect(() => parsePolicy("# Canon\n\nNo fence here.\n")).toThrow(/banned-phrases/);
    expect(() => parsePolicy(policyDoc("scan:\n  - README.md\n"))).toThrow(/no `banned:` phrases/);
  });

  it("never silently mis-reads a hand edit: the failure modes that would switch the ban off", () => {
    // An inline flow sequence is valid YAML and a plausible edit. Read as one
    // nonsense phrase it would leave the lint green over banned copy, so it is
    // parsed properly.
    const flow = parsePolicy(policyDoc(['scan:', '  - README.md', 'banned: ["hosted", "cloud version"]'].join("\n")));
    expect(flow.banned).toEqual(["hosted", "cloud version"]);
    expect(auditFile({ file: "README.md", text: "# S\n\nOur hosted cloud version is live.\n", policy: flow }).violations).toHaveLength(2);

    // A block sequence at its key's own indentation is ordinary YAML. Read as
    // null it would drop the list AND every later key of the same entry,
    // turning a section-scoped capped exemption into a whole-file uncapped one.
    const flush = parsePolicy(
      policyDoc(["scan:", "- README.md", "banned:", "- marketplace", "exempt:", "- phrase: marketplace", "  reason: one row", "  paths:", "  - README.md", "  sections:", "  - ROADMAP", "  maxOccurrences: 1"].join("\n")),
    );
    expect(flush.scan).toEqual(["README.md"]);
    expect(flush.exempt[0]).toMatchObject({ paths: ["README.md"], sections: ["ROADMAP"], maxOccurrences: 1 });

    // An apostrophe in a value is prose, not an open quote: reading it as one
    // swallows the trailing comment and the phrase never matches anything.
    const possessive = parsePolicy(policyDoc(["scan:", "  - README.md", "banned:", "  - your company's data stays put   # possessive form"].join("\n")));
    expect(possessive.banned).toEqual(["your company's data stays put"]);
    expect(auditFile({ file: "README.md", text: "# S\n\nYour company's data stays put.\n", policy: possessive }).violations).toHaveLength(1);

    // The rest fail loudly rather than parsing to something plausible.
    const bad = (block: string) => () => parsePolicy(policyDoc(block));
    expect(bad(["scan:", "  - README.md", "banned:", "  - hosted", "banned:", "  - marketplace"].join("\n"))).toThrow(/declares "banned" twice/);
    expect(bad(["scan:", "  - README.md", "banned:", "\t- hosted"].join("\n"))).toThrow(/TAB/);
    expect(bad(["scan:", "  - README.md", "banned: {a: b}"].join("\n"))).toThrow(/flow mapping/);
    // Unquoted, this is a map, and String()-ing it yields "[object Object]".
    expect(bad(["scan:", "  - README.md", "banned:", "  - Servo: the AI service desk"].join("\n"))).toThrow(/quote it/);
    expect(bad(["scan:", "  - README.md", "banned:", '  - "  "'].join("\n"))).toThrow(/empty phrase/);
    expect(bad(["scan:", "  - README.md", "banned:", "  - marketplace", "exempt:", "  - phrase: marketplace", "    enforced: no", "    paths:", "      - README.md"].join("\n"))).toThrow(/write true or false/);
    expect(bad(["scan:", "  - README.md", "banned:", "  - marketplace", "exempt:", "  - phrase: marketplace", '    maxOccurrences: "1"', "    paths:", "      - README.md"].join("\n"))).toThrow(/plain integer/);
    expect(bad(["scan:", "  - README.md", "banned:", '  - "cloud version'].join("\n"))).toThrow(/unclosed quote/);
    // A continuation written at its key's own indentation is not YAML. Reading
    // it as "stop here" would drop every later key of the same exemption.
    expect(
      bad(["scan:", "  - README.md", "banned:", "  - marketplace", "exempt:", "  - phrase: marketplace", "    reason: permanent - the marked", "    history section", "    maxOccurrences: 1", "    paths:", "      - README.md"].join("\n")),
    ).toThrow(/cannot read as a key or a list item/);
    // Two fences: the first would win as policy while selfExclude hid the
    // second from the scan — a revised ban list, invisible and inert.
    expect(() =>
      parsePolicy([policyDoc("scan:\n  - README.md\nbanned:\n  - hosted"), "", "```banned-phrases", "banned:", "  - marketplace", "```"].join("\n")),
    ).toThrow(/fences/);
  });
});

describe("matching", () => {
  it("is case-insensitive and word-boundary bounded", () => {
    expect(phrasePattern("hosted", POLICY.matching).test("A HOSTED offering")).toBe(true);
    expect(findPhrases("we ghosted the unhostedness", ["hosted"], POLICY.matching)).toEqual([]);
    expect(findPhrases("a hosted desk", ["hosted"], POLICY.matching)).toHaveLength(1);
  });

  it("treats a hyphen as a boundary, so self-hosted DOES hit and needs the allow list", () => {
    expect(findPhrases("a self-hosted desk", ["hosted"], POLICY.matching)).toHaveLength(1);
  });

  it("matches a phrase wrapped across a line break", () => {
    const hits = findPhrases("the AI control\nplane for your company", ["control plane"], POLICY.matching);
    expect(hits).toHaveLength(1);
  });

  it("sees through the markdown a claim is written in", () => {
    // A claim renders to the reader through its decoration, so these all read
    // as the banned sentence and all must be reported. Every case here was a
    // live miss an independent verifier produced against an earlier matcher.
    const cases: Array<[string, string[]]> = [
      ["> The open-source AI control\n> plane for your company.", ["control plane"]],
      ["> Your data never leaves your\n> network, ever.", ["never leaves your network"]],
      ["It is the AI **control** plane.", ["control plane"]],
      ["Try the cloud **version** today.", ["cloud version"]],
      ["A _hosted_ desk.", ["hosted"]],
      ["A __marketplace__ of skills.", ["marketplace"]],
      ["It is the AI <em>control</em> plane.", ["control plane"]],
      ["The AI control<br/>plane for your desk.", ["control plane"]],
      ["Try the [cloud](https://example.com/pricing) version today.", ["cloud version"]],
      ["The AI `control` plane.", ["control plane"]],
      ["The AI control-plane for your company.", ["control plane"]],
      ["Sign-up for the beta.", ["sign up"]],
      ["the AI control\nplane for your company", ["control plane"]],
      // A trailing space, or markdown's two-space hard break, before the wrap.
      ["the AI control \nplane for your company", ["control plane"]],
      ["the AI control  \nplane for your company", ["control plane"]],
      // Non-breaking space, which arrives with copy pasted from a design tool.
      ["Try the cloud version today.", ["cloud version"]],
      ["the control&nbsp;plane", ["control plane"]],
      // README states its identity inside raw HTML: alt text is read aloud by
      // a screen reader and rendered when the image fails, so it is copy.
      ['<img src="banner.svg" alt="Servo \u2014 the hosted cloud version" width="100%" />', ["hosted", "cloud version"]],
      ['<a href="/docs" title="sign up for the cloud version">docs</a>', ["sign up", "cloud version"]],
      // Four spaces inside a list is a nested bullet, not a code block, so its
      // markdown still has to be seen through.
      ["- Deployment\n    - Servo as a **hosted** service with the AI `control` plane.", ["hosted", "control plane"]],
      ["Servo is a control-\nplane vendor.", ["control plane"]],
      // A link title is a tooltip the reader sees, unlike the destination.
      ['See the [pricing](/p "Sign up for the hosted cloud version") page.', ["sign up", "hosted", "cloud version"]],
    ];
    for (const [body, expected] of cases) {
      const { violations } = auditFile({ file: "docs/X.md", text: `# D\n\n${body}\n`, policy: POLICY });
      expect(violations.map((v: any) => v.phrase), body).toEqual(expected);
    }
  });

  it("does not fuse two separate pieces of prose into one phrase", () => {
    // The other half of seeing through markdown: a heading and the paragraph
    // under it, two bullets, or two clauses either side of a dash are not one
    // sentence. Every case here was a false positive an independent verifier
    // produced against an earlier separator.
    const clean = [
      "## Cloud\n\nVersion pinning for the image is documented below.",
      // A markdown heading needs no blank line after it.
      "## Mission control\nPlane maintenance is out of scope.",
      "mission control\n\nplane rides are cheap",
      "our own cloud\n\n---\n\nVersion 2 ships next",
      "mission control\n---------------\nPlane maintenance is fine",
      "- takes mission control\n- plane rides are cheap",
      "* mission control\n* plane rides",
      "| cloud | version |\n|---|---|\n| a | b |",
      "Nothing runs in someone else's cloud — version 2 tightens the default.",
      "in the cloud – version 2 shipped",
      "someone else's cloud—version 2 tightens the default",
      "Cost scales with agents, not with cloud * version count.",
      "priced per seat in the cloud*\n\n* Version 2 adds per-agent pricing.",
      "```sh\n$ node scripts/mock-idp.mjs you@x.com\n> control\n> plane\n```",
      // The same transcript as an indented code block.
      "Run the client:\n\n    $ client\n    > control\n    > plane",
      // A link to somebody else's console is not a claim Servo is making.
      "Create an API key at [the provider console](https://console.example.com/sign-up).",
      '<img src="https://example.com/sign-up.png" alt="Tickets list" />',
      "<!-- TODO: mention the hosted plan before launch -->",
      // The allow list survives a wrap at its own hyphen.
      "Servo is self-\nhosted software.",
      // An alt string, a title string and the element's body are three
      // separate pieces of copy — README already ships this exact shape.
      '<p align="center">\n  <img src="a.png" alt="Servo runs in your own cloud" width="300" /><br/>\n  <em>Version 2 \u2014 same app on mobile.</em>\n</p>',
      '<img src="a.png" alt="Servo in the cloud" title="Version 2 of the UI" />',
      '<a href="/x" title="Runs in your cloud">version 2 notes</a>',
      // A comment is invisible to every reader, on one line or several.
      "<!--\nTODO: describe the hosted cloud version before launch\n-->",
    ];
    for (const body of clean) {
      expect(auditFile({ file: "docs/X.md", text: `# D\n\n${body}\n`, policy: POLICY }).violations, body).toEqual([]);
    }
  });

  it("applies the canon's hyphen-as-boundary rule in both directions", () => {
    // The rule that makes "self-hosted" contain "hosted" also makes
    // "multi-cloud version" contain "cloud version". That is the declared
    // semantics; allow: is the escape hatch, not a narrower boundary.
    const hits = (body: string) =>
      auditFile({ file: "docs/X.md", text: `# D\n\n${body}\n`, policy: { ...POLICY, allow: [] } }).violations.map((v: any) => v.phrase);
    expect(hits("Servo is self-hosted.")).toEqual(["hosted"]);
    expect(hits("The multi-cloud version of the guide.")).toEqual(["cloud version"]);
    // And an allow entry only rescues what it actually spans: a dash used as
    // punctuation is not part of the allowed phrase.
    const spaced = auditFile({ file: "docs/X.md", text: "# D\n\nServo is a SaaS — endpoint URLs are managed for you.\n", policy: POLICY }).violations;
    expect(spaced.map((v: any) => v.phrase)).toEqual(["SaaS"]);
    expect(auditFile({ file: "docs/X.md", text: "# D\n\nPoint it at a third party's SaaS endpoint.\n", policy: POLICY }).violations).toEqual([]);
  });

  it("does not invent a claim out of an identifier or a rescued compound", () => {
    for (const body of ["SELECT name FROM sqlite_master;", "Servo is self-hosted software.", "a self-hosting operator", "we ghosted the release"]) {
      expect(auditFile({ file: "docs/X.md", text: `# D\n\n${body}\n`, policy: POLICY }).violations, body).toEqual([]);
    }
  });

  it("reports a hit on line 1 of a BOM-prefixed file at column 1", () => {
    const { violations } = auditFile({ file: "docs/X.md", text: "﻿Sign up now.\n", policy: POLICY });
    expect(violations.map((v: any) => [v.line, v.column])).toEqual([[1, 1]]);
  });

  it("keeps the longest phrase when two overlap at one offset", () => {
    const hits = findPhrases("we use sqlite-vec here", ["sqlite", "sqlite-vec"], POLICY.matching);
    expect(hits.map((h: any) => h.phrase)).toEqual(["sqlite-vec"]);
  });
});

describe("the three mandatory fixtures", () => {
  it("README's self-hosted line passes clean — and fails once the allow list is removed", () => {
    const line = read("README.md")
      .split("\n")
      .find((l) => l.includes("self-hosted deployments"));
    expect(line, "README no longer carries the self-hosted SSO line").toBeTruthy();
    const text = `# Servo\n\n${line}\n`;
    expect(auditFile({ file: "README.md", text, policy: POLICY }).violations).toEqual([]);
    // Negative control: the pass is the allow list doing its job, not the
    // matcher failing to see "hosted" inside "self-hosted".
    const stripped = { ...POLICY, allow: [] };
    const control = auditFile({ file: "README.md", text, policy: stripped }).violations;
    expect(control).toHaveLength(1);
    expect(control[0]).toMatchObject({ phrase: "hosted", line: 3 });
  });

  it("package.json's Self-host it description passes clean", () => {
    const pkg = read("package.json");
    expect(pkg).toContain("Self-host it");
    expect(auditFile({ file: "package.json", text: pkg, policy: POLICY }).violations).toEqual([]);
    // Honest about WHY it passes: "Self-host it" contains "host", and "host"
    // is not banned — "hosted" is. The description needs no rescue at all, so
    // the pass does not depend on the allow list.
    expect(findPhrases(pkg, POLICY.banned, POLICY.matching)).toEqual([]);
    expect(auditFile({ file: "package.json", text: pkg, policy: { ...POLICY, allow: [] } }).violations).toEqual([]);
    // The allow entry is still live rather than decorative: widen the ban to
    // the shorter stem and the entry is what keeps the description clean.
    const widened = { ...POLICY, banned: [...POLICY.banned, "host"] };
    expect(auditFile({ file: "package.json", text: pkg, policy: widened }).violations).toEqual([]);
    const control = auditFile({ file: "package.json", text: pkg, policy: { ...widened, allow: [] } }).violations;
    expect(control.map((v: any) => v.phrase)).toContain("host");
  });

  it("the canon's own fence is excluded from its own scan", () => {
    const result = auditFile({ file: "docs/POSITIONING.md", text: CANON, policy: POLICY });
    expect(result.violations).toEqual([]);
    // Everything the fence bans is written inside it; without the exclusion
    // the canon fails its own linter many times over.
    const control = auditFile({ file: "docs/POSITIONING.md", text: CANON, policy: { ...POLICY, selfExclude: null } }).violations;
    expect(control.length).toBeGreaterThan(9);
    const [fence] = fenceRegions(CANON, "banned-phrases");
    expect(control.every((v: any) => v.line >= fence.startLine && v.line <= fence.endLine)).toBe(true);
    // The exclusion is scoped to the LABEL, not to fences in general: an
    // ordinary code block is still scanned, or every shell snippet and every
    // landing drop-in would be a blind spot.
    const inACodeBlock = auditFile({
      file: "README.md",
      text: "# Servo\n\n```bash\nSign up for the hosted cloud version\n```\n",
      policy: POLICY,
    }).violations;
    expect(inACodeBlock.map((v: any) => v.phrase)).toEqual(["sign up", "hosted", "cloud version"]);
  });
});

describe("seeded violations", () => {
  it("reports the file, line and phrase of a planted claim", () => {
    const text = ["# Servo", "", "Servo is a self-hosted desk.", "", "Sign up for the hosted cloud version today.", "", "It is the AI control plane for your company."].join("\n");
    const { violations } = auditFile({ file: "README.md", text, policy: POLICY });
    expect(violations.map((v: any) => [v.line, v.phrase])).toEqual([
      [5, "sign up"],
      [5, "hosted"],
      [5, "cloud version"],
      [7, "control plane"],
    ]);
    expect(violations[0].source).toBe("Sign up for the hosted cloud version today.");
    expect(violations[0].column).toBe(1);
    expect(new Set(violations.map((v: any) => v.file))).toEqual(new Set(["README.md"]));
  });

  it("catches a reverse lock-in and a retired storage claim in an unexempted file", () => {
    const { violations } = auditFiles(
      { "docs/USER-GUIDE.md": "Your data never leaves your network, and it is stored in SQLite.\n" },
      POLICY,
    );
    expect(violations.map((v: any) => v.phrase)).toEqual(["never leaves your network", "sqlite"]);
  });
});

describe("exemptions", () => {
  const canon = (body: string) => policyDoc(SIMPLE_BLOCK.replace("banned:\n  - hosted", "banned:\n  - marketplace")) + body;

  it("honours a section-scoped exemption and fails the same word elsewhere", () => {
    const policy = parsePolicy(
      policyDoc(
        [
          "scan:",
          "  - docs/*.md",
          "matching:",
          "  wordBoundary: true",
          "banned:",
          "  - marketplace",
          "exempt:",
          "  - phrase: marketplace",
          "    reason: the roadmap row that names the anti-pattern",
          "    paths:",
          "      - docs/CANON.md",
          "    sections:",
          "      - ROADMAP",
          "    maxOccurrences: 1",
        ].join("\n"),
      ),
    );
    const doc = ["# Canon", "", "## Ledger", "", "### TRUE-TODAY", "", "A marketplace of skills.", "", "### ROADMAP", "", "Never described as a marketplace.", ""].join("\n");
    const { violations, exempted } = auditFile({ file: "docs/CANON.md", text: doc, policy });
    expect(violations.map((v: any) => v.line)).toEqual([7]);
    expect(exempted.map((e: any) => e.line)).toEqual([11]);
  });

  it("counts maxOccurrences and reports the overflow", () => {
    const policy = parsePolicy(
      policyDoc(["scan:", "  - docs/*.md", "banned:", "  - marketplace", "exempt:", "  - phrase: marketplace", "    reason: one row only", "    paths:", "      - docs/CANON.md", "    maxOccurrences: 1"].join("\n")),
    );
    const doc = "# Canon\n\nnot a marketplace\n\nstill not a marketplace\n";
    const { violations, exempted } = auditFile({ file: "docs/CANON.md", text: doc, policy });
    expect(exempted.map((e: any) => e.line)).toEqual([3]);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ line: 5 });
    expect(violations[0].note).toMatch(/allows 1 occurrence/);
  });

  it("treats enforced:false as inert — a recorded rule grants no exemption", () => {
    const policy = parsePolicy(
      policyDoc(["scan:", "  - docs/*.md", "banned:", "  - marketplace", "exempt:", "  - phrase: marketplace", "    reason: recorded, not enforced", "    enforced: false", "    paths:", "      - docs/CANON.md"].join("\n")),
    );
    const { violations } = auditFile({ file: "docs/CANON.md", text: "# Canon\n\na marketplace\n", policy });
    expect(violations).toHaveLength(1);
  });

  it("scopes an exemption to its paths", () => {
    const { violations } = auditFiles({ "docs/DEMO.md": "Stored in SQLite.\n" }, POLICY);
    expect(violations.map((v: any) => v.phrase)).toEqual(["sqlite"]);
    expect(auditFiles({ "README.md": "Stored in SQLite.\n" }, POLICY).violations).toEqual([]);
  });

  it("gives a hit to the most specific applicable exemption, not the first written", () => {
    // The canon carries a whole-file transitional sqlite exemption (until
    // db-01) AND a permanent section-scoped one for the porting ledger's
    // history. First-match-wins would hide the permanent entry and overstate
    // how much copy db-01 has to rewrite.
    const ledger = read("docs/PORTING-LEDGER.md");
    const { exempted } = auditFile({ file: "docs/PORTING-LEDGER.md", text: ledger, policy: POLICY });
    const permanent = POLICY.exempt.find((e: any) => e.phrase === "sqlite" && e.sections.length > 0);
    const transitional = POLICY.exempt.find((e: any) => e.until === "db-01");
    expect(exempted.filter((e: any) => e.exemptIndex === permanent?.index).length).toBeGreaterThan(0);
    // The preamble's present-tense line is NOT history, so it stays on the
    // transitional entry — that is the pressure db-01 has to answer.
    expect(exempted.filter((e: any) => e.exemptIndex === transitional?.index).length).toBe(1);
  });

  it("warns when a scanned file other than the canon carries a policy fence", () => {
    // selfExclude applies to every scanned file, as the canon declares, so a
    // fence is a way to hide copy. The engine honours the policy and says so.
    const { warnings, violations } = auditFiles(
      { "README.md": "# Servo\n\n```banned-phrases\nSign up for the hosted cloud version.\n```\n" },
      POLICY,
    );
    expect(violations).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/README.md carries a `banned-phrases` fence/);
  });

  it("warns when a section-scoped exemption names a heading that does not exist", () => {
    const policy = parsePolicy(
      policyDoc(["scan:", "  - docs/*.md", "banned:", "  - marketplace", "exempt:", "  - phrase: marketplace", "    reason: typo in the section name", "    paths:", "      - docs/CANON.md", "    sections:", "      - Roadmap - out of v1"].join("\n")),
    );
    const { warnings } = auditFiles({ "docs/CANON.md": "# Canon\n\n## Roadmap — out of v1\n\na marketplace\n" }, policy);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/is not a heading in docs\/CANON.md/);
  });
});

describe("sections and fences", () => {
  it("does not read # comment lines inside a fence as headings", () => {
    const chains = headingChains(CANON);
    const bannedListLine = CANON.split("\n").findIndex((l) => l.trim() === "- cloud version") + 1;
    expect(chains[bannedListLine - 1]).toEqual(["positioning canon", "banned phrases"]);
  });

  it("gives a line the whole ancestor chain of headings", () => {
    const chains = headingChains("# Top\n\n## Middle\n\n### Leaf\n\nbody\n");
    expect(chains[6]).toEqual(["top", "middle", "leaf"]);
  });
});

describe("the scan set", () => {
  it("expands docs/*.md non-recursively and subtracts unscanned paths", () => {
    const { files, missing } = collectScanSet(ROOT, POLICY);
    expect(missing).toEqual([]);
    expect(files).toContain("README.md");
    expect(files).toContain("package.json");
    expect(files).toContain("docs/POSITIONING.md");
    expect(files.some((f: string) => f.startsWith("docs/design/"))).toBe(false);
    expect(files).not.toContain("spec.md");
  });

  it("never lets a * span a path separator", () => {
    expect(pathMatches("docs/*.md", "docs/X.md")).toBe(true);
    expect(pathMatches("docs/*.md", "docs/design/X.md")).toBe(false);
    expect(pathMatches("README.md", "README.md")).toBe(true);
  });

  it("reports a scan: entry naming a file that does not exist", () => {
    const policy = { ...POLICY, scan: ["README.md", "NOPE.md"] };
    const { missing } = collectScanSet(ROOT, policy);
    expect(missing).toEqual(["NOPE.md"]);
  });
});

describe("the command line", () => {
  // The criterion is stated in terms of the CLI — "exiting nonzero with
  // file:line output" — so the exit code and the printed line are themselves
  // the contract, and unit-testing the exports alone would leave the audit's
  // own failure path unguarded.
  const run = (args: string[], cwd: string = ROOT) => {
    const result = spawnSync(process.execPath, [path.join(ROOT, "scripts/claims-audit.mjs"), ...args], { cwd, encoding: "utf8" });
    return { status: result.status, out: result.stdout, err: result.stderr };
  };

  function fixtureRepo(): string {
    const dir = mkdtempSync(path.join(tmpdir(), "claims-audit-"));
    mkdirSync(path.join(dir, "docs"));
    writeFileSync(
      path.join(dir, "docs/POSITIONING.md"),
      ["# Canon", "", "```banned-phrases", "scan:", "  - README.md", "banned:", "  - hosted", "  - control plane", "allow:", "  - self-hosted", "```", ""].join("\n"),
    );
    return dir;
  }

  it("exits 0 and says what it scanned when the tree is clean", () => {
    const dir = fixtureRepo();
    writeFileSync(path.join(dir, "README.md"), "# Servo\n\nServo is self-hosted software.\n");
    const { status, out } = run(["--root", dir], dir);
    expect(status).toBe(0);
    expect(out).toMatch(/claims-audit: OK/);
    rmSync(dir, { recursive: true, force: true });
  });

  it("exits 1 and prints file:line:col for each hit", () => {
    const dir = fixtureRepo();
    writeFileSync(path.join(dir, "README.md"), "# Servo\n\nfine line\n\nThe hosted control plane is live.\n");
    const { status, err } = run(["--root", dir], dir);
    expect(status).toBe(1);
    expect(err).toContain('README.md:5:5: banned phrase "hosted"');
    expect(err).toContain('README.md:5:12: banned phrase "control plane"');
    expect(err).toMatch(/2 violation\(s\)/);
    rmSync(dir, { recursive: true, force: true });
  });

  it("exits 1 on an unreadable policy or an unknown flag, rather than scanning nothing", () => {
    const dir = fixtureRepo();
    writeFileSync(path.join(dir, "README.md"), "# Servo\n");
    expect(run(["--root", dir, "--policy", "docs/NOPE.md"], dir).status).toBe(1);
    expect(run(["--root", dir, "--bogus"], dir).err).toMatch(/unknown flag/);
    expect(run(["--root"], dir).err).toMatch(/needs a value/);
    rmSync(dir, { recursive: true, force: true });
  });

  it("runs clean against this repository, which is what CI executes", () => {
    const { status, out } = run([]);
    expect(status).toBe(0);
    expect(out).toMatch(/claims-audit: OK/);
  });
});

describe("the repository as it stands", () => {
  it("exits clean: no banned phrase on any scanned surface", () => {
    const result = auditRepo(ROOT);
    expect(result.violations).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.files.length).toBeGreaterThanOrEqual(5);
  });

  it("is not vacuously green — the scan really does reach the shipped copy", () => {
    const result = auditRepo(ROOT);
    // The audit only means something if the phrases are actually being found
    // and then justified: three allow-list rescues and the exempted storage
    // claims db-01 has to rewrite.
    expect(result.rescued.length).toBeGreaterThanOrEqual(3);
    expect(result.exempted.some((e: any) => e.until === "db-01")).toBe(true);
    expect(result.exempted.some((e: any) => e.file === "docs/POSITIONING.md" && e.phrase === "marketplace")).toBe(true);
  });
});
