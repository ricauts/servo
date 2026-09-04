// hyg-09: scripts/ has its shape — ops/, dev/, media/ — and the media rig is
// archived, not deleted. These tests pin the shape, the guarded optional
// imports' exact message, the required-argument rails, and the
// media-imports allow-list the hygiene check reads. No socket, no browser,
// no sharp/ffmpeg needed: the missing-module path is exercised with a module
// that genuinely does not exist.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { mediaImportAllowlist } from "../scripts/repo-refs.mjs";
import { analyze } from "../scripts/repo-refs.mjs";

const REPO = path.resolve(__dirname, "..");

describe("hyg-09 — scripts/ has a shape", () => {
  it("the loop scripts and the entrypoint STAY at scripts/ root", () => {
    for (const f of [
      "docker-entrypoint.sh",
      "loop-guard.mjs",
      "spec-lint.mjs",
      "migration-guard.mjs",
      "permissions-guard.mjs",
      "landing-tier.mjs",
      "policy-guard.mjs",
      "claims-audit.mjs",
      "no-hex-lint.mjs",
      "repo-refs.mjs",
    ]) {
      expect(existsSync(path.join(REPO, "scripts", f)), f).toBe(true);
    }
  });

  it("ops/, dev/ and media/ hold exactly the named files — nothing else moved, nothing deleted", () => {
    expect(readdirSync(path.join(REPO, "scripts", "ops")).sort()).toEqual([
      // kb-backfill-keywords.ts arrived with kb-lib-1 (the library view), after the move.
      "encrypt-secrets.cjs", "imap-relay.mjs", "kb-backfill-keywords.ts", "reset-sso.cjs", "run-relay.ts",
    ]);
    expect(readdirSync(path.join(REPO, "scripts", "dev")).sort()).toEqual([
      "color-audit.mjs", "mock-idp.mjs", "permissions-audit.mjs", "responsive-audit.mjs",
    ]);
    expect(readdirSync(path.join(REPO, "scripts", "media")).sort()).toEqual([
      "_deps.mjs", "make-before-after.mjs", "make-capture-db.mjs", "readme-screenshots.mjs",
      "record-approval.mjs", "record-cursor.mjs", "record-hero.mjs", "screenshot.mjs",
      "shoot-og.mjs",
    ]);
  });

  it("no live surface names a script at the old root path", () => {
    const moved = [
      "scripts/encrypt-secrets.cjs", "scripts/reset-sso.cjs", "scripts/imap-relay.mjs",
      "scripts/run-relay.ts", "scripts/mock-idp.mjs", "scripts/permissions-audit.mjs",
      "scripts/responsive-audit.mjs", "scripts/color-audit.mjs", "scripts/record-hero.mjs",
      "scripts/record-approval.mjs", "scripts/record-cursor.mjs", "scripts/make-capture-db.mjs",
      "scripts/make-before-after.mjs", "scripts/screenshot.mjs", "scripts/shoot-og.mjs",
      "scripts/readme-screenshots.mjs",
    ];
    // The surfaces named by the item's acceptance...
    const surfaces = [
      "README.md", "SECURITY.md", "docs/USER-GUIDE.md", "docs/DESIGN.md",
      "docs/MEDIA-GUIDE.md", "docs/design/postgres.md", "docs/design/hygiene.md",
      ".env.example", "src/lib/secret-store.ts", "package.json",
    ];
    // ...plus every tracked file under scripts/ itself, which the first pass of
    // this test did NOT cover. That gap let fourteen pre-move paths survive the
    // move: each script's own usage line still printed the path it had before
    // it was moved, so an operator copy-pasting the header of the file they
    // were reading got "cannot find module". `npm run relay` was worse than
    // misleading — scripts/ops/run-relay.ts spawned scripts/imap-relay.mjs,
    // which no longer exists, so the command hyg-09 added and documented
    // failed at runtime. Neither claims-audit (its dead-path scan set is
    // README/SECURITY/ROADMAP/THIRD_PARTY plus docs/**) nor this test could
    // see any of it.
    const inScripts = execFileSync("git", ["ls-files", "scripts"], {
      cwd: REPO,
      encoding: "utf8",
    })
      .split("\n")
      .filter(Boolean)
      // .sh and .sql carry no module paths; keeping the filter narrow keeps the
      // failure message pointed at real code.
      .filter((f) => /\.(mjs|cjs|ts|js)$/.test(f));
    expect(inScripts.length).toBeGreaterThan(15);

    for (const f of [...surfaces, ...inScripts]) {
      const text = readFileSync(path.join(REPO, f), "utf8");
      for (const old of moved) {
        expect(text.includes(old), `${f} still names ${old}`).toBe(false);
      }
    }
  });

  it("run-relay spawns a relay that exists", () => {
    // The spawn target is COMPOSED (path.join(cwd, "scripts", ...)), so no
    // grep for a literal "scripts/imap-relay.mjs" can see it — which is exactly
    // why the move missed it and why this assertion resolves the segments
    // instead of matching a string.
    const src = readFileSync(path.join(REPO, "scripts/ops/run-relay.ts"), "utf8");
    const segments = /path\.join\(process\.cwd\(\),([^)]*)\)/.exec(src)?.[1];
    expect(segments, "run-relay.ts no longer composes its spawn target").toBeDefined();
    const parts = [...segments!.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(parts.length).toBeGreaterThan(0);
    expect(existsSync(path.join(REPO, ...parts)), parts.join("/")).toBe(true);
  });
});

describe("hyg-09 — guarded optional imports", () => {
  it("a missing module is the exact message and exit 1 — never a stack trace", () => {
    const r = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", 'import { loadOptional } from "./scripts/media/_deps.mjs"; await loadOptional("definitely-not-a-real-module-xyz");'],
      { cwd: REPO, encoding: "utf8" },
    );
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("error: definitely-not-a-real-module-xyz is not installed");
    expect(r.stderr).toContain("run: npm i --no-save definitely-not-a-real-module-xyz");
    expect(r.stderr).toContain("nothing is added to package.json");
    expect(r.stderr).not.toMatch(/at \w+ /); // no stack frames
  });

  it("onMissing returning true handles the absence without exiting", async () => {
    const { loadOptional } = await import("../scripts/media/_deps.mjs");
    const out = await loadOptional("definitely-not-a-real-module-xyz", () => true);
    expect(out).toBeUndefined();
  });

  it("the media scripts import the guarded modules dynamically, not statically", () => {
    const ba = readFileSync(path.join(REPO, "scripts", "media", "make-before-after.mjs"), "utf8");
    expect(ba).toContain('loadOptional("sharp")');
    expect(ba).not.toMatch(/^import sharp/m);
    const rh = readFileSync(path.join(REPO, "scripts", "media", "record-hero.mjs"), "utf8");
    expect(rh).toContain('loadOptional("ffmpeg-static"');
  });
});

describe("hyg-09 — required-argument rails", () => {
  it("shoot-og takes the site directory as a REQUIRED argument — no default path into servoai-site", () => {
    const r = spawnSync(process.execPath, [path.join(REPO, "scripts", "media", "shoot-og.mjs")], { encoding: "utf8" });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("usage: node scripts/media/shoot-og.mjs <servoai-site-directory>");
    expect(r.stderr).toContain("may never");
    const src = readFileSync(path.join(REPO, "scripts", "media", "shoot-og.mjs"), "utf8");
    expect(src).not.toContain("C:/Desarrollos/servoai-site");
  });

  it("make-capture-db carries NO database-path argument at all (stronger than a required one)", () => {
    const src = readFileSync(path.join(REPO, "scripts", "media", "make-capture-db.mjs"), "utf8");
    expect(src).not.toContain("dev.db");
    expect(src).not.toContain("C:/Desarrollos");
    expect(src).toContain("servo_capture");
  });
});

describe("hyg-09 — the media-imports allow-list the hygiene check reads", () => {
  it("parses the fenced block from MEDIA-GUIDE.md", () => {
    const guide = readFileSync(path.join(REPO, "docs", "MEDIA-GUIDE.md"), "utf8");
    const set = mediaImportAllowlist(guide);
    expect(set.has("sharp")).toBe(true);
    expect(set.has("ffmpeg-static")).toBe(true);
    expect(set.has("#")).toBe(false); // comments are not entries
  });

  it("text without the fence yields an empty set, not an error", () => {
    expect(mediaImportAllowlist("no fence here").size).toBe(0);
    const empty = mediaImportAllowlist("");
    expect(empty.size === 0).toBe(true);
  });

  it("a media script's allow-listed import reports nothing; the same import OUTSIDE media/ still reports", () => {
    const base: Record<string, unknown> = {
      trackedFiles: ["scripts/media/x.mjs", "src/a.ts"],
      tsconfigText: "{}",
      packageJsonText: JSON.stringify({ name: "t", devDependencies: {} }),
      packageLockText: '{ "packages": {} }',
      gitignoreText: "",
    };
    const mediaOnly = analyze({
      ...base,
      read: { "scripts/media/x.mjs": 'const sharp = await import("sharp");\n' },
    } as unknown as Parameters<typeof analyze>[0]);
    expect(mediaOnly.dependencies.filter((d) => d.name === "sharp")).toEqual([]);
    const srcOnly = analyze({
      ...base,
      read: { "src/a.ts": 'const sharp = await import("sharp");\nexport default sharp;\n' },
    } as unknown as Parameters<typeof analyze>[0]);
    const undeclared = srcOnly.dependencies.filter((d) => d.name === "sharp" && d.status === "undeclared");
    expect(undeclared).toHaveLength(1);
    expect(undeclared[0].usedBy[0].file).toBe("src/a.ts");
  });
});
