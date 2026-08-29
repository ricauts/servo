// hyg-04: the unreferenced-file and dependency baseline. Every rule is driven
// from a miniature virtual repository built inline; the last block runs the
// real gate against the real tree.
//
// TWO CONVENTIONS IN THIS FILE ARE LOAD-BEARING, not style:
//
//  1. No baselined path is written literally here. This file is a .ts inside
//     the scan set, so a path written in it is an EDGE — the file it names
//     would stop being unreferenced and the row under test would stop being
//     the thing under test. Paths are read out of the baseline at runtime.
//  2. No quote or backtick character appears inside a regex literal here.
//     maskCode() in the scanner tracks strings but not regex context, so such
//     a character opens a string region that never closes, inverts the mask,
//     and makes the whole repository read as INDETERMINATE.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  analyze,
  analyzeRepo,
  BASELINE_PATH,
  checkBaseline,
  MEDIA_ALLOWLIST_FENCE,
  NON_REFERENCING_SOURCES,
  parseBaseline,
  parseMediaAllowlist,
} from "../scripts/repo-refs.mjs";

const ROOT = path.resolve(__dirname, "..");
const baselineText = readFileSync(path.join(ROOT, BASELINE_PATH), "utf8");
const baseline = JSON.parse(baselineText);

type BaselineRow = { path?: string; name?: string; reason: string; owner: string };

/**
 * A minimal repository: a real entry point (the App Router convention the
 * scanner recognises, so it is not itself a finding) importing one module.
 */
function virtualRepo(extra: Record<string, string> = {}, files: string[] = []) {
  const sources: Record<string, string> = {
    "src/app/page.tsx": "import { alive } from '../alive';\nexport default function Page() { return alive(); }\n",
    "src/alive.ts": "export const alive = () => 1;\n",
    ...extra,
  };
  return {
    trackedFiles: [...Object.keys(sources), ...files],
    read: (rel: string) => sources[rel] ?? "",
    packageJsonText: JSON.stringify({ dependencies: {}, devDependencies: {} }),
    packageLockText: JSON.stringify({ packages: {} }),
    tsconfigText: "{}",
    gitignoreText: "",
  };
}

const EMPTY_BASELINE = JSON.stringify({ files: [], packages: [] });

function rowsFor(subjectKind: string, result: ReturnType<typeof checkBaseline>) {
  return result.violations.filter((v) => v.kind === subjectKind);
}

describe("hyg-04 — the baseline format", () => {
  it("is a keep-list with a reason and an owner on every row", () => {
    const parsed = parseBaseline(baselineText);
    expect(parsed.errors).toEqual([]);
    expect(parsed.files.size + parsed.dependencies.size).toBeGreaterThan(0);
    for (const row of [...parsed.files.values(), ...parsed.dependencies.values()] as BaselineRow[]) {
      expect(typeof row.reason).toBe("string");
      expect(row.reason.trim().length).toBeGreaterThan(10);
      expect(typeof row.owner).toBe("string");
      expect(row.owner.trim().length).toBeGreaterThan(0);
    }
  });

  it("names, for every row, a backlog item or a numbered question that really exists", () => {
    // The criterion is that a row carries "the backlog item id or the numbered
    // question under Open questions that owns it". An owner nobody can look up
    // is the same as no owner, so this resolves each one against spec.md.
    const spec = readFileSync(path.join(ROOT, "spec.md"), "utf8");
    const itemIds = new Set(
      [...spec.matchAll(/^### \[([a-z0-9-]+)\]/gm)].map((m) => m[1]).filter((id) => id !== "<id>"),
    );
    // Counted, not a Set. A Set collapses duplicates, so it would call a
    // number that appears twice "found" and the owner reference would be
    // ambiguous while the assertion passed — which is exactly what happened
    // when this item first numbered its question 43, a number the previous
    // tick had already used. Uniqueness is asserted only for the numbers this
    // baseline actually cites: the Phase-8 subsections deliberately restart
    // their own numbering, so it is not a property of the whole document.
    const questionCounts = new Map<string, number>();
    for (const m of spec.matchAll(/^(\d+)\. \*\*/gm)) {
      questionCounts.set(m[1], (questionCounts.get(m[1]) ?? 0) + 1);
    }
    const parsed = parseBaseline(baselineText);
    for (const row of [...parsed.files.values(), ...parsed.dependencies.values()] as BaselineRow[]) {
      const owner: string = row.owner;
      const asQuestion = /^q(\d+)$/.exec(owner);
      if (asQuestion) {
        const seen = questionCounts.get(asQuestion[1]) ?? 0;
        expect(seen, `${owner} is not a numbered question in spec.md`).toBeGreaterThan(0);
        expect(seen, `${owner} matches ${seen} different questions in spec.md — the owner reference is ambiguous`).toBe(1);
      } else {
        expect(itemIds.has(owner), `${owner} is not a backlog item id in spec.md`).toBe(true);
      }
    }
  });

  it("rejects a row with no reason, a row with no owner, a duplicate and unreadable JSON", () => {
    const noReason = parseBaseline(JSON.stringify({ files: [{ path: "a.ts", owner: "hyg-05" }], packages: [] }));
    expect(noReason.errors.join(" ")).toContain("no reason");

    const noOwner = parseBaseline(JSON.stringify({ files: [{ path: "a.ts", reason: "because" }], packages: [] }));
    expect(noOwner.errors.join(" ")).toContain("no owner");

    const dupe = parseBaseline(
      JSON.stringify({
        files: [
          { path: "a.ts", reason: "kept for a reason", owner: "hyg-05" },
          { path: "a.ts", reason: "kept for a reason", owner: "hyg-05" },
        ],
        packages: [],
      }),
    );
    expect(dupe.errors.join(" ")).toContain("duplicate");

    expect(parseBaseline("{not json").errors.join(" ")).toContain("not valid JSON");
    expect(parseBaseline("").errors.join(" ")).toContain("empty");
    expect(parseBaseline(JSON.stringify({ files: [] })).errors.join(" ")).toContain("packages");
  });

  it("is excluded as a referencing source, so it cannot launder its own rows", () => {
    // The trap this guards: .json is a mention extension. A baseline counted as
    // a source would make every path it lists read as referenced, the findings
    // would vanish and the gate would pass because it had stopped looking.
    expect(NON_REFERENCING_SOURCES.has(BASELINE_PATH)).toBe(true);

    const listed = (baseline.files[0] as BaselineRow).path;
    const withBaseline = analyze(
      virtualRepo(
        {
          "src/orphan.ts": "export const orphan = () => 1;\n",
          [BASELINE_PATH]: JSON.stringify({ files: [{ path: "src/orphan.ts", reason: "r", owner: "hyg-05" }], packages: [] }),
        },
        [],
      ),
    );
    const orphan = withBaseline.files.find((f: { path: string }) => f.path === "src/orphan.ts");
    expect(orphan?.status, `a baseline naming ${listed} must not make it referenced`).toBe("unreferenced");
  });
});

describe("hyg-04 — what --check fails on", () => {
  const withOrphan = () => analyze(virtualRepo({ "src/orphan.ts": "export const orphan = () => 1;\n" }));

  it("fails when a file becomes unreferenced and no row excuses it", () => {
    const result = checkBaseline({ report: withOrphan(), baselineText: EMPTY_BASELINE });
    expect(rowsFor("file", result).map((v) => v.subject)).toContain("src/orphan.ts");
    expect(result.violations.length).toBeGreaterThan(0);
  });

  it("passes when that same file carries a baseline row, and names it excused", () => {
    const result = checkBaseline({
      report: withOrphan(),
      baselineText: JSON.stringify({
        files: [{ path: "src/orphan.ts", reason: "kept on purpose", owner: "hyg-05" }],
        packages: [],
      }),
    });
    expect(result.violations).toEqual([]);
    expect(result.excused).toBe(1);
  });

  it("fails when a declared dependency becomes unused, and passes when it is baselined", () => {
    const repo = virtualRepo();
    repo.packageJsonText = JSON.stringify({ dependencies: { "left-pad": "^1.0.0" }, devDependencies: {} });
    const report = analyze(repo);

    const failing = checkBaseline({ report, baselineText: EMPTY_BASELINE });
    expect(rowsFor("dependency", failing).map((v) => v.subject)).toContain("left-pad");

    const excused = checkBaseline({
      report,
      baselineText: JSON.stringify({
        files: [],
        packages: [{ name: "left-pad", reason: "kept until its item removes it", owner: "hyg-05" }],
      }),
    });
    expect(excused.violations).toEqual([]);
  });

  it("fails when an imported module appears in no manifest", () => {
    const repo = virtualRepo({ "src/index.ts": "import sharpish from 'sharpish';\nexport const run = () => sharpish;\n" });
    const report = analyze(repo);
    const result = checkBaseline({ report, baselineText: EMPTY_BASELINE });
    const named = rowsFor("dependency", result).map((v) => v.subject);
    expect(named).toContain("sharpish");
    expect(result.violations.find((v) => v.subject === "sharpish")?.message).toContain("no manifest");
  });

  it("fails on a package named in prose that is in no manifest at all", () => {
    // The claimed-absent shape: a comment says node_modules carries it, and
    // neither package.json nor the lockfile has ever heard of it, so npm ci
    // never creates it. It is the same clause as an undeclared import.
    const repo = virtualRepo({
      "src/alive.ts": "// requires node_modules/phantom-codec to be present\nexport const alive = () => 1;\n",
    });
    const report = analyze(repo);
    const claimed = report.dependencies.find((d: { name: string }) => d.name === "phantom-codec");
    expect(claimed?.status).toBe("claimed-absent");
    const result = checkBaseline({ report, baselineText: EMPTY_BASELINE });
    expect(result.violations.map((v) => v.subject)).toContain("phantom-codec");
    expect(result.violations.find((v) => v.subject === "phantom-codec")?.message).toContain("no manifest");
  });

  it("fails on a malformed baseline, because a row with no owner excuses nothing", () => {
    const result = checkBaseline({
      report: withOrphan(),
      baselineText: JSON.stringify({ files: [{ path: "src/orphan.ts" }], packages: [] }),
    });
    expect(result.violations.some((v) => v.kind === "baseline")).toBe(true);
  });

  it("reports a stale row rather than failing on it — the baseline test owns that rule", () => {
    const result = checkBaseline({
      report: analyze(virtualRepo()),
      baselineText: JSON.stringify({
        files: [{ path: "src/deleted-last-week.ts", reason: "gone", owner: "hyg-05" }],
        packages: [],
      }),
    });
    expect(result.violations).toEqual([]);
    expect(result.stale.map((s) => s.subject)).toContain("src/deleted-last-week.ts");
  });
});

describe("hyg-04 — the media-tooling allowlist", () => {
  const guide = [
    "# Media guide",
    "",
    "```" + MEDIA_ALLOWLIST_FENCE,
    "allow:",
    "  - sharp",
    "  - module: ffmpeg-static",
    "```",
    "",
    "```json",
    "  - not-in-the-allowlist",
    "```",
  ].join("\n");

  it("reads module names from the fenced block, and stops at the closing fence", () => {
    expect(parseMediaAllowlist(guide)).toEqual(["sharp", "ffmpeg-static"]);
  });

  it("treats an absent file, an absent block and an empty block as no allowance, never an error", () => {
    // hyg-09 is what writes the guide; until then its absence is normal.
    expect(parseMediaAllowlist("")).toEqual([]);
    expect(parseMediaAllowlist("# nothing fenced here")).toEqual([]);
    expect(parseMediaAllowlist(["```" + MEDIA_ALLOWLIST_FENCE, "```"].join("\n"))).toEqual([]);
    expect(existsSync(path.join(ROOT, "docs/MEDIA-GUIDE.md"))).toBe(false);
  });

  it("excuses an unmanifested import but never a declared-and-unused package", () => {
    const repo = virtualRepo({ "src/index.ts": "import s from 'sharp';\nexport const run = () => s;\n" });
    repo.packageJsonText = JSON.stringify({ dependencies: {}, devDependencies: { gifencish: "^1.0.0" } });
    const report = analyze(repo);
    const result = checkBaseline({
      report,
      baselineText: EMPTY_BASELINE,
      mediaGuideText: ["```" + MEDIA_ALLOWLIST_FENCE, "  - sharp", "  - gifencish", "```"].join("\n"),
    });
    const named = result.violations.map((v) => v.subject);
    expect(named).not.toContain("sharp");
    // A media script cannot explain a package that is declared and imported by
    // nothing, so the allowlist must not reach that shape.
    expect(named).toContain("gifencish");
  });
});

describe("hyg-04 — against the real tree", () => {
  const report = analyzeRepo();

  it("every file row still names something in the tree", () => {
    const tracked = new Set(report.files.map((f: { path: string }) => f.path));
    for (const row of baseline.files) {
      expect(tracked.has(row.path), `${row.path} has a baseline row but is not in the scan set`).toBe(true);
    }
  });

  it("every dependency row still names a live finding", () => {
    const findings = new Map(
      report.dependencies
        .filter((d: { status: string }) => ["unreferenced", "undeclared", "claimed-absent"].includes(d.status))
        .map((d: { name: string; status: string }) => [d.name, d.status]),
    );
    for (const row of baseline.packages) {
      expect(findings.has(row.name), `${row.name} has a baseline row but is no longer a finding`).toBe(true);
    }
  });

  it("has no row for anything the never-delete list already keeps", () => {
    const keeps = new Set(
      report.files.filter((f: { keep: unknown }) => f.keep).map((f: { path: string }) => f.path),
    );
    for (const row of baseline.files) {
      expect(keeps.has(row.path), `${row.path} is already kept by the never-delete list and needs no row`).toBe(false);
    }
  });

  it("the gate passes on the tree today, and every finding is excused by a row", () => {
    const result = checkBaseline({
      report,
      baselineText,
      mediaGuideText: "",
    });
    expect(result.violations).toEqual([]);
    expect(result.stale).toEqual([]);
    expect(result.excused).toBe(baseline.files.length + baseline.packages.length);
  });

  it("the CLI actually hands the media guide to the gate", () => {
    // Every other test drives checkBaseline directly, so nothing would catch a
    // regression that stopped the CLI reading the file off disk. The guide does
    // not exist until hyg-09 writes it, so this is asserted against the source
    // rather than by creating a file inside the repository during a test run.
    const source = readFileSync(path.join(ROOT, "scripts/repo-refs.mjs"), "utf8");
    expect(source).toContain("mediaGuideText: readRepoFile(MEDIA_GUIDE_PATH)");
  });

  it("the CLI exits 0 with --check and stays a report without it", () => {
    const checked = execFileSync("node", ["scripts/repo-refs.mjs", "--check"], { encoding: "utf8", cwd: ROOT });
    expect(checked).toContain("check OK");
    const plain = execFileSync("node", ["scripts/repo-refs.mjs"], { encoding: "utf8", cwd: ROOT });
    expect(plain).toContain("nothing is deleted by this script");
    expect(plain).not.toContain("check OK");
  });

  it("removes nothing: gifenc is still declared", () => {
    // hyg-04's own words. hyg-05 is the item that may remove a dependency line,
    // and only with the deletion rule's evidence.
    const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
    expect(pkg.devDependencies.gifenc).toBeDefined();
    expect(pkg.scripts["hygiene:check"]).toBeDefined();
  });
});
