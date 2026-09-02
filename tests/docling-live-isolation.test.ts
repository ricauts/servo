// dcl-07: the SEPARATION tests — all offline, all in the default suite. The
// live lane itself (tests/live/docling.live.ts) never runs here; these
// prove it CANNOT run here, that CI knows nothing of docling, that the two
// compose files agree on the digest, and that the npm script is gated.
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import yaml from "js-yaml";

const REPO = path.resolve(__dirname, "..");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(path.relative(REPO, p).split(path.sep).join("/"));
  }
  return out;
}

/**
 * A tiny glob matcher for the two patterns the configs actually use: the
 * default suite's `tests/` + any-depth + `.test.ts`, and the live lane's
 * `tests/live/` + any-depth + `.live.ts`. (Written in words here: the
 * literal glob would terminate this very block comment.)
 */
function matches(pattern: string, file: string): boolean {
  const prefix = pattern.includes("**/") ? pattern.split("**/")[0] : "";
  const suffix = (pattern.split("**/")[1] ?? pattern).replaceAll("*", "");
  return file.startsWith(prefix) && file.endsWith(suffix);
}

const defaultConfig = readFileSync(path.join(REPO, "vitest.config.ts"), "utf8");
const liveConfigText = readFileSync(path.join(REPO, "vitest.live.config.ts"), "utf8");
const defaultIncludes = [...defaultConfig.matchAll(/"([^"]+)"/g)]
  .map((m) => m[1])
  .filter((s) => s.includes("*"));
const liveFiles = walk(path.join(REPO, "tests", "live"));

describe("dcl-07 · the live lane is a separate lane", () => {
  it("the default include matches ZERO files under tests/live/", () => {
    expect(liveFiles.length).toBeGreaterThan(0); // the lane exists…
    for (const pattern of defaultIncludes) {
      for (const f of liveFiles) {
        expect(matches(pattern, f), `${pattern} must not match ${f}`).toBe(false);
      }
    }
  });

  it("the live config includes only tests/live and never a *.test.ts pattern", () => {
    expect(liveConfigText).toContain('include: ["tests/live/**/*.live.ts"]');
    expect(liveConfigText).not.toContain("globalSetup"); // no postgres prerequisite
    const liveIncludes = [...liveConfigText.matchAll(/"([^"]+)"/g)]
      .map((m) => m[1])
      .filter((s) => s.includes("*"));
    for (const pattern of liveIncludes) {
      for (const f of walk(path.join(REPO, "tests"))) {
        const hit = matches(pattern, f);
        if (f.startsWith("tests/live/")) expect(hit, `${f} must be matched`).toBe(true);
        else expect(hit, `${f} must NOT be matched by the live lane`).toBe(false);
      }
    }
  });

  it(".github/workflows/ci.yml contains no docling anywhere", () => {
    const ci = readFileSync(path.join(REPO, ".github", "workflows", "ci.yml"), "utf8");
    expect(ci.toLowerCase().includes("docling")).toBe(false);
  });

  it("npm test neither invokes the live lane nor is test:docling part of it", () => {
    const pkg = JSON.parse(readFileSync(path.join(REPO, "package.json"), "utf8"));
    const script = pkg.scripts["test:docling"];
    expect(script).toBeDefined();
    expect(script).toContain("SERVO_TEST_DOCLING");
    expect(script).toContain("docker-compose.docling.test.yml");
    expect(script).toContain("vitest.live.config.ts");
    expect(pkg.scripts.test).not.toContain("test:docling");
    expect(pkg.scripts.test).not.toContain("vitest.live.config.ts");
  });

  it("the test rig's image digest EQUALS the overlay's (and MANIFEST.json's)", () => {
    const overlay = yaml.load(readFileSync(path.join(REPO, "docker-compose.docling.yml"), "utf8")) as {
      services: Record<string, { image?: string }>;
    };
    const rig = yaml.load(readFileSync(path.join(REPO, "docker-compose.docling.test.yml"), "utf8")) as {
      services: Record<string, { image?: string; read_only?: boolean; cap_drop?: string[]; environment?: Record<string, string> }>;
    };
    const overlayImage = overlay.services.docling.image ?? "";
    const rigImage = rig.services.docling.image ?? "";
    expect(overlayImage).toMatch(/@sha256:[0-9a-f]{64}$/);
    expect(rigImage, "re-record the fixtures with scripts/record-docling-fixture.mjs").toBe(overlayImage);
    const manifest = JSON.parse(
      readFileSync(path.join(REPO, "tests", "fixtures", "kb", "docling", "MANIFEST.json"), "utf8"),
    );
    for (const f of manifest.fixtures) {
      expect(f.image_digest, "re-record the fixtures with scripts/record-docling-fixture.mjs").toBe(
        overlayImage.split("@")[1],
      );
    }
  });

  it("the rig keeps the overlay's controls: local engine only, cap_drop, read_only, no volumes", () => {
    const rig = yaml.load(readFileSync(path.join(REPO, "docker-compose.docling.test.yml"), "utf8")) as {
      services: Record<string, { read_only?: boolean; cap_drop?: string[]; volumes?: unknown[]; environment?: Record<string, string>; ports?: string[]; tmpfs?: string[] }>;
    };
    const d = rig.services.docling;
    expect(d.environment?.DOCLING_SERVE_ENGINE).toBe("local");
    // No environment key that could enable remote services — same rule as
    // the overlay, checked by name pattern.
    for (const key of Object.keys(d.environment ?? {})) {
      expect(/remote|tao|api_?key|token|url/i.test(key), `forbidden env key: ${key}`).toBe(false);
    }
    expect(d.cap_drop).toContain("ALL");
    // THE RECORDED DEVIATION, observed live by the lane: this image does
    // not boot read-only (exit 3 during model load even with tmpfs on /tmp
    // AND /root/.cache; bisected — every other control is exonerated). The
    // rig drops read_only and keeps everything else; the overlay keeps the
    // YAML shape per dcl-06 with the deviation documented in KB-DOCLING.md.
    expect(d.read_only ?? false).toBe(false);
    expect(d.volumes).toEqual([]);
    expect([...(d.tmpfs ?? [])]).toEqual(["/tmp"]);
    // The CORRECTED artifacts assertion: the models live under
    // /opt/app-root; the dcl-06 artifacts-path knob is not implemented by
    // the image (observed live — see the lane's settled block).
    const rigText = readFileSync(path.join(REPO, "docker-compose.docling.test.yml"), "utf8");
    expect(rigText).toContain("ls -A /opt/app-root");
    // The env map carries ONLY the engine key — the artifacts-path knob the
    // image does not implement is gone from the rig's environment.
    expect(Object.keys(d.environment ?? {}).sort()).toEqual(["DOCLING_SERVE_ENGINE"]);
    // The rig's one deliberate reachability delta: loopback-only publish.
    expect(d.ports?.every((p) => p.startsWith("127.0.0.1:"))).toBe(true);
  });
});
