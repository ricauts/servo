// hyg-01: the reference scanner. Every resolver rule is driven from the
// miniature repository under tests/fixtures/repo-refs/, and the last block
// runs the scanner against the REAL tree to prove the findings the hygiene
// audit recorded are still reproducible. No database, no network, no new
// dependency.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  analyze,
  analyzeRepo,
  collectExportedNames,
  extractImportBindings,
  extractModuleSpecifiers,
  extractNodeModulesClaims,
  extractPathMentions,
  gitignoreMatcher,
  codeLines,
  isBarrel,
  maskCode,
  MENTION_EXT,
  NEVER_DELETE,
  neverDeleteReason,
  parseTsconfigPaths,
  renderEvidence,
  resolveSpecifier,
  scanSet,
  stripJsonComments,
} from "../scripts/repo-refs.mjs";

const FIXTURES = path.join(__dirname, "fixtures", "repo-refs");
const manifest = JSON.parse(readFileSync(path.join(FIXTURES, "virtual-repo.json"), "utf8"));

function fixtureText(name: string | null): string {
  return name === null ? "" : readFileSync(path.join(FIXTURES, name), "utf8");
}

/** Build the virtual repository, optionally with extra files layered on. */
function virtualRepo(extra: Record<string, string> = {}) {
  const files: Record<string, string | null> = { ...manifest.files, ...extra };
  return analyze({
    trackedFiles: Object.keys(files),
    read: (rel: string) => fixtureText(files[rel] ?? null),
    tsconfigText: manifest.tsconfig,
    packageJsonText: JSON.stringify(manifest.packageJson),
    packageLockText: manifest.packageLock,
    gitignoreText: manifest.gitignore,
  });
}

/** A missing finding is a test failure with a name, not a null-check cascade. */
function must<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`repo-refs reported no finding for ${what}`);
  return value;
}

const fileFinding = (report: ReturnType<typeof virtualRepo>, p: string) =>
  must(report.files.find((f) => f.path === p), p);
const exportFinding = (report: ReturnType<typeof virtualRepo>, file: string, name: string) =>
  must(report.exports.find((e) => e.file === file && e.name === name), `${file} ${name}`);
const dependency = (report: ReturnType<typeof virtualRepo>, name: string) =>
  report.dependencies.find((d) => d.name === name);
const requiredDependency = (report: ReturnType<typeof virtualRepo>, name: string) =>
  must(dependency(report, name), name);

describe("scan set", () => {
  it("drops .claude, .next, .git, .spec-build, node_modules, the lockfile and prisma db files", () => {
    const set = scanSet([
      "src/app/page.tsx",
      ".claude/worktree/src/app/page.tsx",
      ".next/build/x.js",
      ".git/config",
      ".spec-build/spec.md",
      "node_modules/pkg/index.js",
      "package-lock.json",
      "prisma/dev.db",
      "prisma/dev.db-journal",
      "prisma/schema.prisma",
    ]);
    expect(set).toEqual(["prisma/schema.prisma", "src/app/page.tsx"]);
  });

  it("excludes a vendored node_modules or worktree copy at any depth", () => {
    expect(scanSet(["vendor/node_modules/x.js", "a/b/.claude/copy.ts", "src/keep.ts"])).toEqual(["src/keep.ts"]);
  });

  it("accepts file contents as a plain record, not only as a callback", () => {
    const report = analyze({
      trackedFiles: ["src/a.ts", "src/b.ts"],
      read: { "src/a.ts": 'import { b } from "./b";\nexport const a = b;\n', "src/b.ts": "export const b = 1;\n" },
    });
    expect(must(report.files.find((f) => f.path === "src/b.ts"), "src/b.ts").codeReferenceCount).toBe(1);
  });

  it("excluding .claude is what stops two worktree copies making everything look referenced", () => {
    const report = virtualRepo();
    expect(report.files.some((f) => f.path.startsWith(".claude/"))).toBe(false);
    // Shadow.tsx inside .claude is the ONLY code importing DeadWidget. Because
    // .claude is excluded, DeadWidget is still reported as having no code
    // reference — the trap the exclusion exists for.
    const dead = fileFinding(report, "src/components/DeadWidget.tsx");
    expect(dead.codeReferenceCount).toBe(0);
  });
});

describe("spec.md is scanned but never a referencing source", () => {
  it("a file only spec.md names reads as unreferenced", () => {
    const report = virtualRepo();
    const specOnly = fileFinding(report, "src/lib/spec-only.ts");
    expect(specOnly.status).toBe("unreferenced");
    expect(specOnly.referenceCount).toBe(0);
  });

  it("spec.md itself is in the scan set", () => {
    const report = virtualRepo();
    expect(fileFinding(report, "spec.md")).toBeDefined();
  });

  it("negative control: the SAME mention from any other file does count", () => {
    // Without this the previous test would stay green even if the mention had
    // stopped matching for an unrelated reason, proving nothing.
    const report = virtualRepo({ "docs/PLAN.md": "spec.md.fixture" });
    const specOnly = fileFinding(report, "src/lib/spec-only.ts");
    expect(specOnly.status).toBe("referenced");
    expect(specOnly.referencedBy.map((r) => r.file)).toEqual(["docs/PLAN.md"]);
  });
});

describe("tsconfig paths", () => {
  it("reads the @/* alias without a naive comment strip eating it", () => {
    // The real tsconfig.json's own `"@/*": ["./src/*"]` contains both a `/*`
    // and a `*/`. A regex block-comment strip deletes the paths map.
    expect(parseTsconfigPaths(manifest.tsconfig)).toEqual([{ alias: "@/", targets: ["src/"] }]);
    expect(stripJsonComments('{ "a": "http://x", /* c */ "b": 1 } // tail')).toContain('"a": "http://x"');
    expect(stripJsonComments('{ /* drop */ "b": 1 }')).not.toContain("drop");
  });

  it("resolves an aliased import to a real file, with extension resolution", () => {
    const files = new Set(["src/lib/utils.ts", "src/components/Widget.tsx", "src/lib/x/index.ts"]);
    const aliases = parseTsconfigPaths(manifest.tsconfig);
    expect(resolveSpecifier("@/lib/utils", "src/app/page.tsx", files, aliases)).toEqual({
      kind: "file",
      value: "src/lib/utils.ts",
    });
    expect(resolveSpecifier("@/components/Widget", "src/app/page.tsx", files, aliases).value).toBe(
      "src/components/Widget.tsx",
    );
    expect(resolveSpecifier("@/lib/x", "src/app/page.tsx", files, aliases).value).toBe("src/lib/x/index.ts");
    // TypeScript ESM style: "./utils.js" on disk is "./utils.ts".
    expect(resolveSpecifier("../lib/utils.js", "src/app/page.tsx", files, aliases).value).toBe("src/lib/utils.ts");
  });

  it("follows whatever alias tsconfig declares, rather than a hardcoded @/", () => {
    // Feed a DIFFERENT alias: if @/ -> src/ were baked in, this would fail.
    const tsconfig = '{ "compilerOptions": { "paths": { "~lib/*": ["./packages/core/*"] } } }';
    const report = analyze({
      trackedFiles: ["app/main.ts", "packages/core/thing.ts"],
      read: { "app/main.ts": 'import { thing } from "~lib/thing";\nexport default thing;\n', "packages/core/thing.ts": "export const thing = 1;\n" },
      tsconfigText: tsconfig,
    });
    expect(must(report.files.find((f) => f.path === "packages/core/thing.ts"), "thing").codeReferenceCount).toBe(1);
    // …and the old alias is not silently still in force.
    const report2 = analyze({
      trackedFiles: ["app/main.ts", "src/thing.ts"],
      read: { "app/main.ts": 'import { thing } from "@/thing";\nexport default thing;\n', "src/thing.ts": "export const thing = 1;\n" },
      tsconfigText: tsconfig,
    });
    expect(must(report2.files.find((f) => f.path === "src/thing.ts"), "thing2").codeReferenceCount).toBe(0);
  });

  it("never turns an alias-shaped specifier into a package", () => {
    // With no tsconfig, "@/lib/db" must not be invented as a dependency.
    expect(resolveSpecifier("@/lib/db", "src/app/page.tsx", new Set(), []).kind).toBe("unresolved");
  });
});

describe("module specifiers", () => {
  it("finds static, side-effect, require, dynamic and css imports", () => {
    const text = [
      'import { a } from "./a";',
      'import "./side-effect.css";',
      'const b = require("./b");',
      'const c = await import("pkg-c");',
      '@import url("tokens/base.css");',
      'export { d } from "./d";',
    ].join("\n");
    const specs = extractModuleSpecifiers(text).map((r) => `${r.kind}:${r.spec}`);
    expect(specs).toContain("static:./a");
    expect(specs).toContain("side-effect:./side-effect.css");
    expect(specs).toContain("require:./b");
    expect(specs).toContain("dynamic:pkg-c");
    expect(specs).toContain("css-import:tokens/base.css");
    expect(specs).toContain("static:./d");
  });

  it("does not mistake prose, JSX attributes or string arrays for imports", () => {
    const text = [
      '// the merge below cannot tell "never set" from "just deleted"',
      "/** @type {import('postcss-load-config').Config} */",
      '<Label htmlFor="smtp-from" className="font-heading">',
      'const from = pick(payload, ["from", "sender"]);',
    ].join("\n");
    expect(extractModuleSpecifiers(text)).toEqual([]);
  });

  it("never invents a package from a URL-shaped css import", () => {
    const report = virtualRepo();
    expect(dependency(report, "https:")).toBeUndefined();
    // …and a bare `@import url("tokens/base.css")` resolves relative to the
    // stylesheet rather than becoming a package called "tokens".
    expect(dependency(report, "tokens")).toBeUndefined();
  });
});

describe("dynamic imports are reported, never guessed", () => {
  it("a literal dynamic import resolves and marks nothing dead — src/lib/screenshot.ts:56", () => {
    const report = virtualRepo();
    // The exact shape of the real tree's `(await import("puppeteer-core")).default`.
    const dyn = must(
      report.dynamicImports.find((d) => d.file === "src/lib/screenshot.ts"),
      "the dynamic import in src/lib/screenshot.ts",
    );
    expect(dyn.spec).toBe("puppeteer-core");
    expect(dyn.line).toBe(2);
    // Nothing is dead because of it: puppeteer-core counts as used, and the
    // run carries no global INDETERMINATE flag.
    expect(requiredDependency(report, "puppeteer-core").status).toBe("referenced");
    expect(report.indeterminate.global).toBe(false);
    expect(report.files.some((f) => f.status === "INDETERMINATE")).toBe(false);
  });

  it("a template-literal import makes only its own directory INDETERMINATE", () => {
    const report = virtualRepo(manifest.scopedDynamicFiles);
    expect(fileFinding(report, "src/lib/locales/en.js").status).toBe("INDETERMINATE");
    expect(fileFinding(report, "src/components/DeadWidget.tsx").status).not.toBe("INDETERMINATE");
    expect(report.indeterminate.global).toBe(false);
  });

  it("resolves the static prefix through the SAME alias table as a static import", () => {
    // import(`@/locales/${l}.js`) reaches src/locales, not a directory beside
    // the importing file. Joining the prefix onto the importer's directory
    // would leave the real candidates reported deletable.
    const report = virtualRepo(manifest.dynamicShapes.alias);
    expect(fileFinding(report, "src/locales/en.js").status).toBe("INDETERMINATE");
    expect(report.indeterminate.global).toBe(false);
  });

  it("treats a concatenated import specifier as a prefix, not as a literal", () => {
    // import("./plugins/" + name + ".js") is neither a literal (the argument
    // does not end at the quote) nor opaque (the prefix is readable).
    const report = virtualRepo(manifest.dynamicShapes.concat);
    expect(fileFinding(report, "src/lib/plugins/one.js").status).toBe("INDETERMINATE");
    // …and the prefix is never mistaken for a package name.
    expect(report.dependencies.some((d) => d.name.startsWith("."))).toBe(false);
  });

  it("still resolves a literal import that carries import attributes", () => {
    // import("./data.json", { with: { type: "json" } }) is fully resolvable;
    // dropping it would report a live target dead.
    const report = virtualRepo(manifest.dynamicShapes.attributes);
    expect(fileFinding(report, "src/lib/data.json").status).toBe("referenced");
    expect(fileFinding(report, "src/lib/data.json").codeReferenceCount).toBe(1);
  });

  it("does not silently miss a dynamic import split across lines", () => {
    // The call is read line by line, so an unterminated one must fall to the
    // SAFE side — INDETERMINATE — rather than disappearing.
    const report = virtualRepo(manifest.dynamicShapes.multiline);
    expect(fileFinding(report, "src/lib/split/en.js").status).not.toBe("unreferenced");
  });

  it("records a computed require the same way as a computed import", () => {
    const report = virtualRepo(manifest.dynamicShapes.computedRequire);
    expect(fileFinding(report, "src/lib/handlers/one.js").status).toBe("INDETERMINATE");
  });

  it("bounds a prefix that ends MID-SEGMENT, not only one ending in a slash", () => {
    // import(`./locale-${l}.js`) — the classic i18n shape. Treating "./locale-"
    // as a directory leaves every locale-*.ts reported deletable, and nothing
    // else rescues them because the run is not globally uncertain.
    for (const body of [
      "export const go = (l: string) => import(`./locale-${l}.js`);\n",
      'export const go = (l: string) => import("./locale-" + l + ".js");\n',
    ]) {
      const report = analyze({
        trackedFiles: ["src/a.ts", "src/locale-en.ts"],
        read: { "src/a.ts": body, "src/locale-en.ts": "export const x = 1;\n" },
      });
      expect(report.indeterminate.global).toBe(false);
      expect(must(report.files.find((f) => f.path === "src/locale-en.ts"), "locale-en").status).toBe(
        "INDETERMINATE",
      );
    }
  });

  it("keeps a literal resolvable when a comment sits between it and the paren", () => {
    const report = analyze({
      trackedFiles: ["src/a.ts", "src/x.ts"],
      read: {
        "src/a.ts": 'export const go = () => import("./x" /* webpackChunkName: "x" */);\n',
        "src/x.ts": "export const x = 1;\n",
      },
    });
    expect(must(report.files.find((f) => f.path === "src/x.ts"), "x").status).toBe("referenced");
  });

  it("does not judge the SYMBOLS of a file that is only INDETERMINATE", () => {
    const report = analyze({
      trackedFiles: ["src/a.ts", "src/lazy/one.ts"],
      read: {
        "src/a.ts": "export const go = (n: string) => import(`./lazy/${n}.js`);\n",
        "src/lazy/one.ts": "export function maybeUsed() {}\n",
      },
    });
    const sym = must(
      report.exports.find((e) => e.file === "src/lazy/one.ts" && e.name === "maybeUsed"),
      "maybeUsed",
    );
    expect(sym.status).toBe("INDETERMINATE");
  });

  it("lists a computed require alongside computed imports", () => {
    const report = analyze({
      trackedFiles: ["src/a.cjs", "src/h/one.js"],
      read: { "src/a.cjs": 'module.exports = (n) => require("./h/" + n);\n', "src/h/one.js": "module.exports = 1;\n" },
    });
    expect(report.dynamicImports.some((d) => d.call === "require" && d.spec === null)).toBe(true);
    expect(must(report.files.find((f) => f.path === "src/h/one.js"), "one.js").status).toBe("INDETERMINATE");
  });

  it("an opaque import(x) makes every unreferenced module INDETERMINATE, never dead", () => {
    const report = virtualRepo(manifest.opaqueDynamicFile);
    expect(report.indeterminate.global).toBe(true);
    expect(fileFinding(report, "src/components/index.ts").status).toBe("INDETERMINATE");
    // …and no module is reported unreferenced while that uncertainty stands.
    const deadModules = report.files.filter((f) => f.status === "unreferenced" && /\.tsx?$/.test(f.path));
    expect(deadModules).toEqual([]);
  });
});

describe("barrel files", () => {
  it("recognises a re-export-only index and flags what only it references", () => {
    expect(isBarrel("src/components/index.ts", fixtureText("barrel-index.ts.fixture"))).toBe(true);
    expect(isBarrel("src/lib/utils.ts", fixtureText("utils.ts.fixture"))).toBe(false);
    const report = virtualRepo();
    expect(report.barrels.map((b) => b.file)).toEqual(["src/components/index.ts"]);
    expect(fileFinding(report, "src/components/barrelled-widget.tsx").onlyBarrelReferences).toBe(true);
    expect(fileFinding(report, "src/components/Widget.tsx").onlyBarrelReferences).toBe(false);
  });
});

describe("path mentions in prose", () => {
  it("counts a markdown mention as a reference, and marks it as prose-only", () => {
    const fileSet = new Set(["src/lib/utils.ts", "scripts/record.mjs"]);
    const mentions = extractPathMentions(fixtureText("docs-mention.md.fixture"), fileSet);
    expect(mentions.map((m) => m.target).sort()).toEqual(["scripts/record.mjs", "src/lib/utils.ts"]);

    const report = virtualRepo();
    const dead = fileFinding(report, "src/components/DeadWidget.tsx");
    expect(dead.status).toBe("referenced"); // a mention IS a reference
    expect(dead.proseOnly).toBe(true); // …but not a code reference
    expect(dead.referencedBy[0].file).toBe("docs/NOTES.md");
    const utils = fileFinding(report, "src/lib/utils.ts");
    expect(utils.proseOnly).toBe(false);
  });

  it("reads a specifier that sits on the line after `from`", () => {
    const report = analyze({
      trackedFiles: ["src/a.ts", "src/b.ts"],
      read: { "src/a.ts": 'import X\n  from "./b";\nexport default X;\n', "src/b.ts": "export default 1;\n" },
    });
    expect(must(report.files.find((f) => f.path === "src/b.ts"), "b").codeReferenceCount).toBe(1);
  });

  it("never invents a path that is not in the scan set", () => {
    expect(extractPathMentions("see src/lib/imaginary.ts for details", new Set(["src/lib/real.ts"]))).toEqual([]);
  });

  it("scans every extension the criterion names: md, json, yml, sh, mjs, cjs, ts, tsx", () => {
    // Each of these must be able to KEEP a file alive on its own.
    for (const ext of [".md", ".json", ".yml", ".sh", ".mjs", ".cjs", ".ts", ".tsx"]) {
      expect(MENTION_EXT.has(ext), ext).toBe(true);
    }
    // …proven end to end for the three the other fixtures do not already cover.
    const report = virtualRepo(manifest.mentionSources);
    const utils = fileFinding(report, "src/lib/utils.ts");
    const sources = utils.referencedBy.map((r) => r.file);
    for (const f of ["ci.yml", "run.sh", "config.json"]) {
      expect(sources, f).toContain(f);
    }
    // …and end to end for the four code extensions too: a path named in a
    // comment or a string inside a source file is a mention like any other.
    const mention = "// see src/lib/utils.ts for the helper\nexport const x = 1;\n";
    const report2 = analyze({
      trackedFiles: ["src/lib/utils.ts", "a.mjs", "b.cjs", "c.ts", "d.tsx"],
      read: {
        "src/lib/utils.ts": "export const cn = 1;\n",
        "a.mjs": mention,
        "b.cjs": mention,
        "c.ts": mention,
        "d.tsx": mention,
      },
    });
    const named = must(report2.files.find((f) => f.path === "src/lib/utils.ts"), "utils").referencedBy.map(
      (r) => r.file,
    );
    for (const f of ["a.mjs", "b.cjs", "c.ts", "d.tsx"]) expect(named, f).toContain(f);
  });
});

describe("the shapes a line-oriented scanner gets wrong", () => {
  const TSCONFIG = '{"compilerOptions":{"paths":{"@/*":["./src/*"]}}}';
  const run = (files: Record<string, string>, tsconfigText = TSCONFIG) =>
    analyze({ trackedFiles: Object.keys(files), read: files, tsconfigText });

  it("binds the names of a MULTI-LINE named import", () => {
    // The name lines carry no import keyword. Losing them leaves an import
    // that binds nothing, and every symbol it brings in reads as dead — which
    // is how two live exports of this repo's own scripts got listed.
    const report = run({
      "src/app/page.tsx": 'import {\n  alpha,\n} from "@/lib/utils";\nexport default function P() { return alpha(); }\n',
      "src/lib/utils.ts": "export function alpha() {}\n",
    });
    expect(must(report.exports.find((e) => e.name === "alpha"), "alpha").status).toBe("referenced");
  });

  it("follows a MULTI-LINE barrel re-export through to the symbol", () => {
    const report = run({
      "src/app/page.tsx": 'import { Toolbar } from "@/components";\nexport default Toolbar;\n',
      "src/components/index.ts": 'export {\n  Toolbar,\n} from "./toolbar";\n',
      "src/components/toolbar.tsx": "export function Toolbar() {}\n",
    });
    expect(must(report.exports.find((e) => e.name === "Toolbar"), "Toolbar").status).toBe("referenced");
  });

  it("a JSX apostrophe does not hide every import after it", () => {
    // A ' that reaches a newline was never a string opener. Treating it as one
    // masks the rest of the file, and a live file lands on the deletion list
    // with nothing in the report hinting that anything was missed.
    const report = run({
      "src/app/page.tsx":
        "const T = <p>It's fine</p>;\nimport { go } from \"@/lib/heavy\";\nexport default function P() { return go(T); }\n",
      "src/lib/heavy.ts": "export function go(x: unknown) { return x; }\n",
    });
    expect(must(report.files.find((f) => f.path === "src/lib/heavy.ts"), "heavy").status).toBe("referenced");
    expect(report.indeterminate.global).toBe(false);
  });

  it("a quote inside a regex character class does not hide the import after it", () => {
    const report = run({
      "src/lib/host.ts": 'const S = /["]/g;\nexport const lazy = () => import("./heavy");\n',
      "src/lib/heavy.ts": "export function boom() {}\n",
    });
    expect(must(report.files.find((f) => f.path === "src/lib/heavy.ts"), "heavy").status).toBe("referenced");
  });

  it("a template literal may still span lines", () => {
    // The rewind must not break the one string form that legitimately wraps.
    const source = ["const t = `line one", 'line two`;', 'import { a } from "./a";'].join("\n");
    const mask = maskCode(source);
    const lines = codeLines(source);
    expect(mask.length).toBe(source.length);
    expect(lines[2]).toContain('import { a } from "./a";');
  });

  it("a dynamic import consumed without a binding marks the whole module used", () => {
    const report = run({
      "src/a.ts": 'export const go = () => import("./x").then(({ used }) => used);\n',
      "src/x.ts": "export function used() {}\n",
    });
    expect(must(report.exports.find((e) => e.name === "used"), "used").status).toBe("referenced");
  });

  it("scopes an aliased prefix through EVERY target the tsconfig declares", () => {
    const report = run(
      {
        "src/a.ts": "export const go = (n: string) => import(`~x/${n}.js`);\n",
        "packages/one/en.ts": "export const x = 1;\n",
        "packages/two/en.ts": "export const x = 1;\n",
      },
      '{"compilerOptions":{"paths":{"~x/*":["./packages/one/*","./packages/two/*"]}}}',
    );
    for (const p of ["packages/one/en.ts", "packages/two/en.ts"]) {
      expect(must(report.files.find((f) => f.path === p), p).status, p).toBe("INDETERMINATE");
    }
  });
});

describe("CJS", () => {
  it("a require() of a local module is a file edge, not just an extracted string", () => {
    const report = virtualRepo(manifest.requireFiles);
    const helper = fileFinding(report, "src/lib/helper.ts");
    expect(helper.codeReferenceCount).toBeGreaterThan(0);
    expect(helper.referencedBy.some((r) => r.file === "src/lib/cjs-user.cjs" && r.kind === "require")).toBe(true);
  });
});

describe("entry points and the never-delete list", () => {
  it("a Next.js route file is referenced by convention, not reported dead", () => {
    const report = virtualRepo();
    const page = fileFinding(report, "src/app/page.tsx");
    expect(page.status).toBe("referenced");
    expect(page.entryPoint).toMatch(/App Router/);
  });

  it("carries all seven never-delete prefixes as data", () => {
    const prefixes = NEVER_DELETE.map((r) => r.prefix);
    for (const p of [
      "agents/",
      "skills/",
      "servo_design_system/",
      "prisma/",
      "prisma/migrations/",
      "tests/fixtures/",
      "docs/hygiene/",
    ]) {
      expect(prefixes, p).toContain(p);
    }
    // Every entry states WHY, so a wrong one is arguable rather than invisible.
    for (const rule of NEVER_DELETE) expect(rule.reason.length, rule.prefix).toBeGreaterThan(10);
    // A path under each prefix resolves to keep, including one only .gitignore covers.
    for (const p of prefixes) expect(neverDeleteReason(p + "x", () => false), p).not.toBeNull();
    expect(neverDeleteReason("some/ignored.tmp", () => true)).toMatch(/gitignore/);
  });

  it("never-delete paths are reported but always keep", () => {
    const report = virtualRepo();
    const agent = fileFinding(report, "agents/keeper.md");
    expect(agent.keep).toBe(true);
    expect(agent.keepReason).toMatch(/bootstrap/);
  });

  it("the .gitignore matcher covers directory, glob and exact rules", () => {
    const match = gitignoreMatcher(manifest.gitignore);
    expect(match("node_modules/pkg/index.js")).toBe(true);
    expect(match("prisma/dev.db")).toBe(true);
    expect(match("prisma/schema.prisma")).toBe(false);
    expect(match(".claude/worktree/x.ts")).toBe(true);
    expect(match("src/lib/utils.ts")).toBe(false);
  });
});

describe("exported symbols", () => {
  it("collects declaration and list exports", () => {
    const names = collectExportedNames(
      [
        "export function a() {}",
        "export const b = 1;",
        "export type C = number;",
        "export interface D {}",
        "export class E {}",
        "export { f, g as h };",
        "export default a;",
      ].join("\n"),
    ).map((e) => e.name);
    expect(names).toEqual(["a", "b", "C", "D", "E", "f", "h", "default"]);
  });

  it("reads named bindings out of import, export-from and destructured dynamic import", () => {
    const bindings = extractImportBindings(
      [
        'import { cn, initials } from "@/lib/utils";',
        'import * as ns from "./ns";',
        'export { Toolbar } from "./toolbar";',
        'const { TOOLS } = await import("@/lib/ai/tools");',
        'const mod = await import("./mod");',
      ].join("\n"),
    );
    expect(bindings[0]).toMatchObject({ spec: "@/lib/utils", names: ["cn", "initials"] });
    expect(bindings[1]).toMatchObject({ spec: "./ns", namespace: true });
    expect(bindings[2]).toMatchObject({ spec: "./toolbar", names: ["Toolbar"] });
    expect(bindings[3]).toMatchObject({ spec: "@/lib/ai/tools", names: ["TOOLS"] });
    expect(bindings[4]).toMatchObject({ spec: "./mod", namespace: true });
  });

  it("a symbol is dead only when no other file BINDS it", () => {
    const report = virtualRepo();
    expect(exportFinding(report, "src/lib/utils.ts", "cn").status).toBe("referenced");
    expect(exportFinding(report, "src/lib/utils.ts", "timeAgo").status).toBe("unreferenced");
  });

  it("a symbol used inside its own file is alive, and says so", () => {
    const report = virtualRepo();
    const own = exportFinding(report, "src/lib/utils.ts", "usedInOwnFile");
    expect(own.status).toBe("referenced");
    expect(own.scope).toBe("own-file");
  });

  it("does not judge symbols inside never-delete paths", () => {
    const report = virtualRepo();
    expect(report.exports.some((e) => e.file.startsWith("agents/"))).toBe(false);
  });
});

describe("dependencies are part of the graph", () => {
  it("reports declared-and-unimported, used-but-undeclared, and a lockfile-absent claim", () => {
    const report = virtualRepo();
    expect(requiredDependency(report, "gifenc").status).toBe("unreferenced");
    expect(requiredDependency(report, "sharp")).toMatchObject({ status: "undeclared", declaredIn: null, inLockfile: true });
    expect(requiredDependency(report, "sharp").usedBy[0].file).toBe("scripts/shrink.mjs");
    // The fixture carries a comment asserting the package sits under the
    // install directory, for a package neither package.json nor the lockfile
    // has ever heard of. (Phrased without the literal path: this comment is
    // itself inside the scan set.)
    const claim = requiredDependency(report, "ffmpeg-static");
    expect(claim.status).toBe("claimed-absent");
    expect(claim.inLockfile).toBe(false);
    expect(claim.usedBy[0].file).toBe("scripts/record.mjs");
  });

  it("extractNodeModulesClaims reads the package name out of prose", () => {
    expect(extractNodeModulesClaims("carries one at node_modules/ffmpeg-static; prepend it")).toEqual([
      { name: "ffmpeg-static", line: 1 },
    ]);
    expect(extractNodeModulesClaims("node_modules/@scope/pkg")[0].name).toBe("@scope/pkg");
  });
});

describe("the evidence report", () => {
  it("records the command, the scan set, the resolver rules and one row per finding", () => {
    const report = virtualRepo();
    const md = renderEvidence(report, { command: "node scripts/repo-refs.mjs --evidence x.md", date: "2026-08-27" });
    expect(md).toContain("# Reference scan — 2026-08-27");
    expect(md).toContain("node scripts/repo-refs.mjs --evidence x.md");
    expect(md).toContain("## Resolver rules applied");
    expect(md).toContain(`${report.scanned} tracked files`);
    expect(md).toContain("`src/lib/spec-only.ts`");
    expect(md).toContain("`timeAgo`");
    expect(md).toContain("`gifenc`");
    expect(md).toContain("`ffmpeg-static`");
    expect(md).toContain("## Dynamic imports (reported, never guessed)");
    expect(md).toContain("## Barrel files");
  });

  it("emits ONE row per scanned file — a referenced file is a finding too", () => {
    const report = virtualRepo();
    const md = renderEvidence(report, { command: "x", date: "2026-08-27" });
    const inventory = md.split("## Every scanned file")[1].split("\n## ")[0];
    const rows = inventory.split("\n").filter((l) => l.startsWith("| `"));
    expect(rows.length).toBe(report.files.length);
    for (const f of report.files) {
      expect(inventory, f.path).toContain(`\`${f.path}\``);
    }
    // and every verdict is one of the three the criterion allows
    for (const f of report.files) {
      expect(["referenced", "unreferenced", "INDETERMINATE"], f.path).toContain(f.status);
    }
  });

  it("never truncates a reference list without saying how much it dropped", () => {
    const many: Record<string, string> = {};
    for (let i = 0; i < 8; i++) many[`docs/note-${i}.md`] = "docs-mention.md.fixture";
    const report = virtualRepo(many);
    const utils = fileFinding(report, "src/lib/utils.ts");
    expect(utils.referenceCount).toBeGreaterThan(utils.referencedBy.length);
    const md = renderEvidence(report, { command: "x", date: "2026-08-27" });
    expect(md).toContain(`(${utils.referenceCount} total)`);
  });

  it("keeps a dependency that is imported and declared but absent from the lockfile", () => {
    const report = analyze({
      trackedFiles: ["src/app/page.tsx"],
      read: () => 'import x from "ghost-pkg";\nexport default x;\n',
      tsconfigText: manifest.tsconfig,
      packageJsonText: JSON.stringify({ dependencies: { "ghost-pkg": "^1.0.0" } }),
      packageLockText: '{ "packages": {} }',
      gitignoreText: "",
    });
    const ghost = must(report.dependencies.find((d) => d.name === "ghost-pkg"), "ghost-pkg");
    expect(ghost).toMatchObject({ status: "referenced", inLockfile: false });
    const md = renderEvidence(report, { command: "x", date: "2026-08-27" });
    // It survives npm install and dies under npm ci, so it is a finding.
    expect(md).toContain("`ghost-pkg`");
  });
});

/**
 * The DEAD-PROVEN table of docs/design/hygiene.md §13.6, read from the document
 * itself. Column one holds backticked things — file paths, a path plus its dead
 * symbols, a package name — and one row uses brace form for five siblings.
 * The disposition column (third) says who owns each row; `hyg-05` rows name
 * things hyg-05 has since DELETED, so they are returned separately — they must
 * appear in the COMMITTED evidence but can never appear in a fresh report.
 */
function deadProvenEntries(): { kept: string[]; deleted: string[] } {
  const doc = readFileSync(path.resolve(__dirname, "..", "docs", "design", "hygiene.md"), "utf8");
  const start = doc.indexOf("DEAD-PROVEN");
  expect(start, "the DEAD-PROVEN table").toBeGreaterThan(-1);
  const out: { kept: string[]; deleted: string[] } = { kept: [], deleted: [] };
  for (const line of doc.slice(start).split("\n")) {
    if (!line.startsWith("|")) {
      if (out.kept.length + out.deleted.length > 0) break; // the table has ended
      continue;
    }
    const columns = line.split("|");
    const disposition = (columns[3] ?? "").trim();
    const bucket = disposition.includes("hyg-05") ? out.deleted : out.kept;
    for (const m of (columns[1] ?? "").matchAll(/`([^`]+)`/g)) {
      const token = m[1].trim();
      const braces = token.match(/^(.*)\{([^}]*)\}(.*)$/);
      if (braces) bucket.push(...braces[2].split(",").map((p) => braces[1] + p.trim() + braces[3]));
      else bucket.push(token);
    }
    // "`src/lib/utils.ts` → `formatDate`, `timeAgo`, `formatDateTime`" also
    // yields the three symbols, which the loop above already collected.
  }
  return out;
}

describe("the real tree — the findings the hygiene audit recorded", () => {
  const report = analyzeRepo();
  const find = (p: string) => must(report.files.find((f) => f.path === p), p);
  const dep = (n: string) => must(report.dependencies.find((d) => d.name === n), n);

  it("no longer reports the three legacy components hyg-05 deleted — and the four live ones keep their references", () => {
    // hyg-05 removed Button/Card/Field with committed evidence; a report that
    // still lists them would mean the deletion never landed on this tree.
    for (const p of [
      "src/components/legacy/Button.tsx",
      "src/components/legacy/Card.tsx",
      "src/components/legacy/Field.tsx",
    ]) {
      expect(report.files.find((f) => f.path === p), p).toBeUndefined();
      expect(report.exports.find((e) => e.file === p), p).toBeUndefined();
    }
    // …while the live ones in the same directory are not touched.
    // hyg-06 moved the four survivors to common/ — the live list follows
    // the rename; the deleted three above stay as historical literals.
    for (const p of [
      "src/components/common/Avatar.tsx",
      "src/components/common/Badge.tsx",
      "src/components/common/EmptyState.tsx",
      "src/components/common/Spinner.tsx",
    ]) {
      expect(find(p).codeReferenceCount, p).toBeGreaterThan(0);
    }
  });

  it("no longer reports the three dead exports of src/lib/utils.ts — and none of the live ones", () => {
    const utils = (name: string) =>
      report.exports.find((e) => e.file === "src/lib/utils.ts" && e.name === name);
    for (const name of ["formatDate", "formatDateTime", "timeAgo"]) {
      expect(utils(name), `utils.ts ${name}`).toBeUndefined();
    }
    for (const name of ["cn", "jsonSafe", "initials"]) {
      expect(must(utils(name), `utils.ts ${name}`).status, name).toBe("referenced");
    }
  });

  it("still reports the five unused shadcn primitives (kept — §14 q31)", () => {
    for (const n of ["avatar", "badge", "scroll-area", "skeleton", "tooltip"]) {
      expect(find(`src/components/ui/${n}.tsx`).status, n).toBe("unreferenced");
    }
  });

  it("ffmpeg-static stays claimed-absent; gifenc flipped at hyg-05 and sharp RETIRED at hyg-09 (the media allow-list)", () => {
    // hyg-05 removed the real devDependency, so the name survives only inside
    // the scanner's own unit fixture as TEST DATA — a claimed-absent package,
    // the same shape as the media rig's comment claim below.
    expect(dep("gifenc")).toMatchObject({ status: "claimed-absent", declaredIn: null });
    expect(dep("gifenc").usedBy[0].file).toContain("virtual-repo");
    // hyg-09: sharp is imported (guarded, dynamically) by scripts/media
    // only, and the media-imports allow-list covers exactly that — the
    // finding is gone, and with it its baseline row.
    expect(report.dependencies.find((d) => d.name === "sharp")).toBeUndefined();
    // The design doc says the media rig "uses" that package. It does not: the
    // name appears only in a comment claiming the tree carries it, and the
    // lockfile never has. The scanner reports the true shape. (Written without
    // the literal name and path: this comment is inside the scan set, and a
    // literal here would show up as a second location for the finding.)
    expect(dep("ffmpeg-static")).toMatchObject({ status: "claimed-absent", inLockfile: false });
    expect(dep("ffmpeg-static").usedBy[0].file).toBe("scripts/media/record-hero.mjs");
  });

  it("never reports a never-delete path as deletable", () => {
    const deletable = report.files.filter((f) => f.status === "unreferenced" && !f.keep);
    for (const f of deletable) {
      expect(f.path.startsWith("agents/"), f.path).toBe(false);
      expect(f.path.startsWith("skills/"), f.path).toBe(false);
      expect(f.path.startsWith("servo_design_system/"), f.path).toBe(false);
      expect(f.path.startsWith("prisma/"), f.path).toBe(false);
      expect(f.path.startsWith("tests/fixtures/"), f.path).toBe(false);
    }
  });

  it("the CLI exits 0 and writes an evidence file", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "repo-refs-"));
    const out = path.join(dir, "evidence.md");
    try {
      const stdout = execFileSync("node", ["scripts/repo-refs.mjs", "--evidence", out], {
        encoding: "utf8",
        cwd: path.resolve(__dirname, ".."),
      });
      // A missing path must fail loudly: exiting 0 would let a deletion item
      // believe evidence had been written.
      expect(() =>
        execFileSync("node", ["scripts/repo-refs.mjs", "--evidence"], {
          encoding: "utf8",
          cwd: path.resolve(__dirname, ".."),
          stdio: "pipe",
        }),
      ).toThrow();
      expect(stdout).toContain("report complete");
      const md = readFileSync(out, "utf8");
      // Every entry of the DEAD-PROVEN table appears in the committed evidence.
      // The list is READ from the design document rather than copied here: a
      // path written literally in this file would be a path mention in the
      // scan set, and the test would change the verdict it is checking.
      const { kept, deleted } = deadProvenEntries();
      expect(deleted.length).toBeGreaterThanOrEqual(8); // hyg-05's removals, still named by the table
      expect(kept.length).toBeGreaterThanOrEqual(5); // the shadcn keep row (§14 q31)
      for (const entry of kept) {
        expect(md, entry).toContain(entry);
      }
      // The hyg-05-disposed rows are the DELETED things. The COMMITTED
      // pre-deletion evidence names every one of them (that is §13.1: the
      // proof exists before anything is removed)…
      const committed = readFileSync(
        path.resolve(__dirname, "..", "docs", "hygiene", "hyg-05-evidence.md"),
        "utf8",
      );
      for (const entry of deleted) {
        expect(committed, entry).toContain(entry);
      }
      // …while a FRESH report can no longer list the three deleted FILES.
      // (The dead symbols are covered by their own test above; the package
      // name survives as a claimed-absent finding — the fixture's test data.)
      for (const entry of deleted.filter((t) => t.startsWith("src/components/legacy/"))) {
        expect(md, entry).not.toContain(entry);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
