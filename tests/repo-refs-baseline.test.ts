// hyg-04: the keep-list that turns hyg-01's report into a gate.
//
// Two halves. The first drives every rule of `checkBaseline` from synthetic
// reports — plain objects, so a rule is proven rather than observed. The second
// runs against the REAL tree and asserts the two things a keep-list can rot in:
// a row that describes nothing any more, and an owner that names an item or a
// question that does not exist. No database, no network, no new dependency.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  analyze,
  analyzeRepo,
  BASELINE_PATH,
  isNonReferencingSource,
  NON_REFERENCING_PREFIXES,
  NON_REFERENCING_SOURCES,
  checkBaseline,
  loadBaselineInputs,
  MEDIA_FENCE_NAME,
  MEDIA_GUIDE_PATH,
  OWNER_RE,
  parseBaseline,
  parseMediaAllowlist,
} from "../scripts/repo-refs.mjs";

const REPO_ROOT = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(REPO_ROOT, rel), "utf8");

/** A report with only the fields the gate reads. */
function report({
  files = [],
  dependencies = [],
}: {
  files?: { path: string; status: string; keep?: boolean }[];
  dependencies?: { name: string; status: string; usedBy?: { file: string; line: number }[] }[];
} = {}) {
  return { files, dependencies } as never;
}

function baseline(files: unknown[] = [], dependencies: unknown[] = []) {
  return parseBaseline(JSON.stringify({ files, dependencies }));
}

const ROW = { reason: "kept for a stated reason", owner: "hyg-09" };

describe("hyg-04 · the gate rules", () => {
  it("fails on a file that became unreferenced and has no row", () => {
    const { violations } = checkBaseline(
      report({ files: [{ path: "src/lib/orphan.ts", status: "unreferenced", keep: false }] }),
      baseline(),
    );
    expect(violations).toHaveLength(1);
    expect(violations[0].kind).toBe("unreferenced-file");
    // Naming the offender is the criterion: a gate that says only "failed" is
    // one nobody can act on.
    expect(violations[0].message).toContain("src/lib/orphan.ts");
  });

  it("passes a baselined unreferenced file", () => {
    const { violations, covered } = checkBaseline(
      report({ files: [{ path: "src/lib/orphan.ts", status: "unreferenced", keep: false }] }),
      baseline([{ path: "src/lib/orphan.ts", ...ROW }]),
    );
    expect(violations).toEqual([]);
    expect(covered).toBe(1);
  });

  it("never fails for a file the never-delete list already keeps", () => {
    const { violations } = checkBaseline(
      report({ files: [{ path: "skills/x/SKILL.md", status: "unreferenced", keep: true }] }),
      baseline(),
    );
    expect(violations).toEqual([]);
  });

  it("fails on a declared dependency that stopped being imported", () => {
    const { violations } = checkBaseline(
      report({ dependencies: [{ name: "left-pad", status: "unreferenced" }] }),
      baseline(),
    );
    expect(violations).toHaveLength(1);
    expect(violations[0].kind).toBe("unreferenced-dependency");
    expect(violations[0].message).toContain("left-pad");
  });

  it("fails on an imported module that appears in no manifest", () => {
    const { violations } = checkBaseline(
      report({
        dependencies: [
          { name: "sharp", status: "undeclared", usedBy: [{ file: "scripts/x.mjs", line: 7 }] },
        ],
      }),
      baseline(),
    );
    expect(violations).toHaveLength(1);
    expect(violations[0].kind).toBe("undeclared-dependency");
    // The line that imports it, so the fix is one file away.
    expect(violations[0].message).toContain("scripts/x.mjs:7");
  });

  it("fails on a package claimed in prose that neither manifest has heard of", () => {
    const { violations } = checkBaseline(
      report({ dependencies: [{ name: "ffmpeg-static", status: "claimed-absent" }] }),
      baseline(),
    );
    expect(violations.map((v) => v.kind)).toEqual(["claimed-absent-dependency"]);
  });

  it("passes a baselined dependency finding, whatever its kind", () => {
    const { violations } = checkBaseline(
      report({
        dependencies: [
          { name: "gifenc", status: "unreferenced" },
          { name: "sharp", status: "undeclared" },
        ],
      }),
      baseline([], [
        { name: "gifenc", ...ROW },
        { name: "sharp", ...ROW },
      ]),
    );
    expect(violations).toEqual([]);
  });

  it("does not act on a referenced or tooling dependency", () => {
    const { violations, covered } = checkBaseline(
      report({
        dependencies: [
          { name: "next", status: "tooling" },
          { name: "zod", status: "referenced" },
        ],
      }),
      baseline(),
    );
    expect(violations).toEqual([]);
    expect(covered).toBe(0);
  });

  it("treats the media allowlist as a keep-list hyg-09 owns", () => {
    const findings = report({
      dependencies: [{ name: "sharp", status: "undeclared" }],
    });
    expect(checkBaseline(findings, baseline()).violations).toHaveLength(1);
    expect(
      checkBaseline(findings, baseline(), { mediaAllowlist: ["sharp"] }).violations,
    ).toEqual([]);
  });

  it("does not let the media allowlist excuse a declared-and-unimported dependency", () => {
    // The allowlist exists for modules the media rig IMPORTS without declaring.
    // Letting it also cover `unreferenced` would excuse the one class the
    // keep-list format exists to make someone write a reason for.
    const { violations } = checkBaseline(
      report({ dependencies: [{ name: "sharp", status: "unreferenced" }] }),
      baseline(),
      { mediaAllowlist: ["sharp"] },
    );
    expect(violations.map((v) => v.kind)).toEqual(["unreferenced-dependency"]);
  });

  it("refuses a row whose `finding` is not the live finding", () => {
    // A row accepted for one violation kind must not silently cover another.
    const { violations } = checkBaseline(
      report({ dependencies: [{ name: "gifenc", status: "undeclared" }] }),
      baseline([], [{ name: "gifenc", finding: "unreferenced", ...ROW }]),
    );
    expect(violations).toHaveLength(1);
    expect(violations[0].message).toContain("accepts finding `unreferenced`");
    expect(violations[0].message).toContain("live finding is `undeclared`");
  });

  it("counts INDETERMINATE files out loud without failing on them", () => {
    const { violations, unjudgeable } = checkBaseline(
      report({ files: [{ path: "src/lib/maybe.ts", status: "INDETERMINATE" }] }),
      baseline(),
    );
    expect(violations).toEqual([]);
    expect(unjudgeable).toEqual(["src/lib/maybe.ts"]);
  });

  it("reports instead of throwing on malformed input that never saw parseBaseline", () => {
    expect(() => checkBaseline(report(), { files: [null], dependencies: [] } as never)).not.toThrow();
    expect(() => checkBaseline({ files: [null] } as never, baseline())).not.toThrow();
    expect(() => checkBaseline(report(), { files: "x" } as never)).not.toThrow();
  });

  it("reports a stale row but never fails for it", () => {
    const { violations, stale } = checkBaseline(
      report(),
      baseline([{ path: "src/lib/gone.ts", ...ROW }], [{ name: "gone-pkg", ...ROW }]),
    );
    expect(violations).toEqual([]);
    expect(stale.map((s) => s.id).sort()).toEqual(["gone-pkg", "src/lib/gone.ts"]);
  });
});

describe("hyg-04 · the keep-list must stay a keep-list", () => {
  it("rejects a row with no reason", () => {
    const { violations } = checkBaseline(
      report({ files: [{ path: "a.ts", status: "unreferenced" }] }),
      baseline([{ path: "a.ts", owner: "hyg-09" }]),
    );
    expect(violations.some((v) => v.message.includes("missing `reason`"))).toBe(true);
  });

  it("rejects a row whose owner is neither an item id nor question-<n>", () => {
    const parsed = baseline([{ path: "a.ts", reason: "r", owner: "because I said so" }]);
    expect(parsed.problems.some((p) => p.includes("owner"))).toBe(true);
  });

  it("accepts both owner forms", () => {
    expect(OWNER_RE.test("hyg-05")).toBe(true);
    expect(OWNER_RE.test("cnp-02")).toBe(true);
    expect(OWNER_RE.test("question-31")).toBe(true);
    expect(OWNER_RE.test("question-")).toBe(false);
    expect(OWNER_RE.test("someone")).toBe(false);
    // A typo'd question reference must not pass as a plausible item id.
    expect(OWNER_RE.test("question-abc")).toBe(false);
    expect(OWNER_RE.test("-x")).toBe(false);
  });

  it("rejects a row whose `finding` is not a real violation status", () => {
    const parsed = baseline([], [{ name: "x", finding: "unused", ...ROW }]);
    expect(parsed.problems.some((p) => p.includes("`finding` must be one of"))).toBe(true);
  });

  it("names a duplicate row rather than letting the later one silently win", () => {
    const parsed = baseline([
      { path: "a.ts", ...ROW },
      { path: "a.ts", ...ROW },
    ]);
    expect(parsed.problems.some((p) => p.includes("duplicate"))).toBe(true);
  });

  it("fails loudly on unreadable JSON instead of passing an empty keep-list", () => {
    const parsed = parseBaseline("{ not json");
    expect(parsed.problems).toHaveLength(1);
    const { violations } = checkBaseline(report(), parsed);
    expect(violations).toHaveLength(1);
    expect(violations[0].kind).toBe("baseline");
  });
});

describe("hyg-04 · the media-tooling allowlist", () => {
  it("reads one module per line, dashes and comments allowed", () => {
    const md = [
      "# Media guide",
      "",
      "```" + MEDIA_FENCE_NAME,
      "# regenerates docs/assets/before-after-fix.png",
      "- sharp",
      "ffmpeg-static  # named by record-hero.mjs",
      "```",
      "",
      "prose after the fence names puppeteer-core and must not be read",
    ].join("\n");
    expect(parseMediaAllowlist(md)).toEqual(["sharp", "ffmpeg-static"]);
  });

  it("does not read a media-tooling block shown as an EXAMPLE inside an outer fence", () => {
    // The guide hyg-09 writes will document the format. A documentation
    // example must never become live configuration.
    const md = "````markdown\n```" + MEDIA_FENCE_NAME + "\nsharp\n```\n````\n";
    expect(parseMediaAllowlist(md)).toEqual([]);
  });

  it("stops at a nested fence rather than swallowing its lines as module names", () => {
    const md = "```" + MEDIA_FENCE_NAME + "\nsharp\n```js\nrequire(\"left-pad\")\n```\n";
    expect(parseMediaAllowlist(md)).toEqual(["sharp"]);
  });

  it("treats an absent file, an absent fence and an unterminated fence as an empty list", () => {
    expect(parseMediaAllowlist("")).toEqual([]);
    expect(parseMediaAllowlist("# guide\n\nno fence here\n")).toEqual([]);
    // An open fence must widen nothing: a typo in the closing marker would
    // otherwise turn the rest of the document into an allowlist.
    expect(parseMediaAllowlist("```" + MEDIA_FENCE_NAME + "\nsharp\n")).toEqual([]);
  });

  it("is absent today, and that is not a failure — hyg-09 writes it", () => {
    const { mediaAllowlist } = loadBaselineInputs(REPO_ROOT);
    if (existsSync(path.join(REPO_ROOT, MEDIA_GUIDE_PATH))) {
      expect(Array.isArray(mediaAllowlist)).toBe(true);
    } else {
      expect(mediaAllowlist).toEqual([]);
    }
  });
});

describe("hyg-04 · the gate may not launder its own findings", () => {
  // §13.1 requires a deletion item to COMMIT a docs/hygiene/*.md evidence
  // report before removing anything, and that report NAMES every dead path.
  // If it counted as a referencing source, committing it would flip every one
  // of those paths to `referenced, prose only` and the gate would pass on
  // files it had just proven dead — one commit after proving it.
  const virtual = {
    "src/lib/orphan.ts": "export const orphan = 1;\n",
    "src/lib/live.ts": "export const live = 2;\n",
    "src/app/page.tsx": "import { live } from '@/lib/live';\nexport default function P() { return live; }\n",
  };
  const tsconfig = JSON.stringify({ compilerOptions: { paths: { "@/*": ["./src/*"] } } });

  function statusOf(files: Record<string, string>) {
    const r = analyze({
      trackedFiles: Object.keys(files),
      read: files,
      tsconfigText: tsconfig,
    }) as { files: { path: string; status: string }[] };
    return Object.fromEntries(r.files.map((f) => [f.path, f.status]));
  }

  it("an evidence report naming a dead file does not make it referenced", () => {
    expect(statusOf(virtual)["src/lib/orphan.ts"]).toBe("unreferenced");
    const withEvidence = {
      ...virtual,
      "docs/hygiene/hyg-05-evidence.md": "| `src/lib/orphan.ts` | unreferenced | delete |\n",
    };
    expect(statusOf(withEvidence)["src/lib/orphan.ts"]).toBe("unreferenced");
  });

  it("the keep-list naming a dead file does not make it referenced", () => {
    const withBaseline = {
      ...virtual,
      "tests/fixtures/repo-refs-baseline.json": JSON.stringify({
        files: [{ path: "src/lib/orphan.ts", reason: "r", owner: "hyg-05" }],
      }),
    };
    expect(statusOf(withBaseline)["src/lib/orphan.ts"]).toBe("unreferenced");
  });

  it("an ordinary document naming a file still counts as a reference", () => {
    // The exclusion is narrow on purpose: only this tool's own artifacts.
    const withDoc = { ...virtual, "docs/USER-GUIDE.md": "see `src/lib/orphan.ts`\n" };
    expect(statusOf(withDoc)["src/lib/orphan.ts"]).toBe("referenced");
  });

  it("names both non-referencing sources as data, not as a convention", () => {
    expect(NON_REFERENCING_SOURCES.has("spec.md")).toBe(true);
    expect(NON_REFERENCING_SOURCES.has("tests/fixtures/repo-refs-baseline.json")).toBe(true);
    expect(NON_REFERENCING_PREFIXES).toContain("docs/hygiene/");
    expect(isNonReferencingSource("docs/hygiene/audit-2026-08-29.md")).toBe(true);
    expect(isNonReferencingSource("docs/USER-GUIDE.md")).toBe(false);
  });
});

describe("hyg-04 · the real tree", () => {
  const tracked = new Set(
    execFileSync("git", ["ls-files", "-z"], { encoding: "utf8", cwd: REPO_ROOT, maxBuffer: 32 * 1024 * 1024 })
      .split("\0")
      .filter(Boolean),
  );
  const { baseline: real, mediaAllowlist } = loadBaselineInputs(REPO_ROOT);
  const live = analyzeRepo(REPO_ROOT);
  // The scanner is plain .mjs, so its rows arrive untyped; the shape below is
  // the one parseBaseline() guarantees.
  const fileRows = real.files as { path: string; reason: string; owner: string }[];
  const depRows = real.dependencies as { name: string; reason: string; owner: string }[];

  it("parses with no problems", () => {
    expect(real.problems).toEqual([]);
  });

  it("npm run hygiene:check exits 0 on the tree today", () => {
    const { violations } = checkBaseline(live, real, { mediaAllowlist });
    expect(violations.map((v) => `${v.kind}: ${v.id}`)).toEqual([]);
  });

  // The removal rule: a row may only go in the commit that removes the thing it
  // describes or adds a reference to it. --check cannot see a commit, so this is
  // where a row that describes nothing is caught.
  it("every file row's path exists in the tree", () => {
    const missing = fileRows.filter((r) => !tracked.has(r.path)).map((r) => r.path);
    expect(missing).toEqual([]);
  });

  it("every row still describes a live finding", () => {
    const { stale } = checkBaseline(live, real, { mediaAllowlist });
    expect(stale.map((s) => `${s.kind}: ${s.id}`)).toEqual([]);
  });

  it("every owner names a backlog item or a numbered question that exists", () => {
    const spec = read("spec.md");
    const items = new Set([...spec.matchAll(/^### \[([a-z0-9-]+)\]/gm)].map((m) => m[1]));
    const questions = new Set(
      [...spec.slice(spec.indexOf("## 14. Open questions")).matchAll(/^\s*(\d+)\.\s+\*\*/gm)].map((m) => m[1]),
    );
    const owners = [...fileRows, ...depRows].map((r) => r.owner);
    const dangling = [...new Set(owners)].filter((o) => {
      const q = /^question-(\d+)$/.exec(o);
      return q ? !questions.has(q[1]) : !items.has(o);
    });
    expect(dangling).toEqual([]);
  });

  it("removes nothing: gifenc is still declared", () => {
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.devDependencies.gifenc).toBeTruthy();
  });

  it("is wired as npm run hygiene:check and as its own CI step", () => {
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.scripts["hygiene:check"]).toBe("node scripts/repo-refs.mjs --check");
    const ci = read(".github/workflows/ci.yml");
    expect(ci).toContain("npm run hygiene:check");
  });

  it("the baseline lives where the script looks for it", () => {
    expect(BASELINE_PATH).toBe("tests/fixtures/repo-refs-baseline.json");
    expect(tracked.has(BASELINE_PATH) || existsSync(path.join(REPO_ROOT, BASELINE_PATH))).toBe(true);
  });
});
