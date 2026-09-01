// dcl-06: the sidecar overlay, checked by PARSING THE YAML OFFLINE. No
// container is started, nothing is pulled, and this file runs in the
// default npm test — a PR deleting a control goes red in the lane
// everyone runs. The digest agreement half detects fixture rot WITHOUT
// the image: MANIFEST.json's recorded digest must equal the digest the
// compose file pins.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import yaml from "js-yaml";

interface ComposeFile {
  services: Record<string, {
    image?: string;
    network_mode?: string;
    cap_drop?: string[];
    security_opt?: string[];
    volumes?: unknown[];
    mem_limit?: string;
    cpus?: number | string;
    pids_limit?: number;
    read_only?: boolean;
    tmpfs?: string | string[];
    healthcheck?: { test?: string | string[] };
    depends_on?: Record<string, { condition?: string }>;
    environment?: unknown;
  }>;
  networks?: Record<string, { internal?: boolean }>;
}

const overlayText = readFileSync("docker-compose.docling.yml", "utf8");
const overlay = yaml.load(overlayText) as ComposeFile;
const baseText = readFileSync("docker-compose.yml", "utf8");

const DIGEST_RE = /@(sha256:[0-9a-f]{64})/;

describe("the overlay is a SEPARATE file", () => {
  it("docker-compose.yml contains no docling service — the default up is byte-identical to today", () => {
    const base = yaml.load(baseText) as ComposeFile;
    expect(Object.keys(base.services ?? {})).not.toContain("docling");
    expect(baseText).not.toContain("docling");
  });
});

describe("the sidecar's controls, from the YAML", () => {
  it("image pinned by DIGEST, not tag", () => {
    const image = overlay.services.docling.image ?? "";
    expect(image).toMatch(/^[\w.\-/]+@sha256:[0-9a-f]{64}$/);
    expect(DIGEST_RE.exec(image)![1]).toBe("sha256:7deed6ddba54908925c039d69a95806416c90cfc9b5486ca8554d3ce30a50289");
  });

  it("internal network, all caps dropped, no-new-privileges, no volumes", () => {
    expect(overlay.services.docling.network_mode).toBe("internal");
    expect(overlay.networks?.internal?.internal).toBe(true);
    expect(overlay.services.docling.cap_drop).toEqual(["ALL"]);
    expect(overlay.services.docling.security_opt).toContain("no-new-privileges:true");
    expect(overlay.services.docling.volumes ?? []).toEqual([]);
  });

  it("mem_limit, cpus and pids_limit all present", () => {
    expect(overlay.services.docling.mem_limit).toBeTruthy();
    expect(overlay.services.docling.cpus).toBeTruthy();
    expect(overlay.services.docling.pids_limit).toBeGreaterThan(0);
  });

  it("read_only true with tmpfs declared", () => {
    expect(overlay.services.docling.read_only).toBe(true);
    const tmpfs = overlay.services.docling.tmpfs;
    const entries = Array.isArray(tmpfs) ? tmpfs : tmpfs ? [tmpfs] : [];
    expect(entries.length).toBeGreaterThan(0);
  });

  it("the healthcheck asserts the artifacts path exists and is non-empty", () => {
    const test = overlay.services.docling.healthcheck?.test ?? [];
    const joined = Array.isArray(test) ? test.join(" ") : String(test);
    expect(joined).toMatch(/DOCLING_SERVE_ARTIFACTS_PATH|\/opt\/artifacts/);
    expect(joined).toMatch(/test -n|ls -A/);
  });

  it("servo depends_on docling with condition service_healthy", () => {
    expect(overlay.services.servo?.depends_on?.docling?.condition).toBe("service_healthy");
  });

  it("NO environment key that could enable remote services", () => {
    const env = overlay.services.docling.environment;
    expect(env).toBeDefined();
    const entries = typeof env === "object" && env !== null ? Object.entries(env as Record<string, unknown>) : [];
    for (const [key, value] of entries) {
      expect(key.toUpperCase()).not.toMatch(/REMOTE|URL|TOKEN|API_KEY|HF_|HUGGING/);
      expect(String(value)).not.toMatch(/https?:\/\/|hf_|huggingface/i);
    }
  });

  it("the header records WHY the digest, the amd64 note and the arm64 line", () => {
    // Comments wrap the sentence across lines — strip the comment markers
    // first so the assertion reads the PROSE, not the wrapping.
    const prose = overlayText.split("\n").map((l) => l.replace(/^\s*#/, "")).join(" ").replace(/\s+/g, " ");
    expect(prose).toContain("moving tag would silently change extraction output");
    expect(overlayText).toMatch(/arm64/i);
    expect(overlayText).toMatch(/docker manifest inspect/);
    expect(overlayText).toMatch(/UNVERIFIED/i);
  });

  it("the healthcheck comment records the no-entrypoint-override reason", () => {
    expect(overlayText).toMatch(/dcl-08 commits to pulling the upstream image|nowhere to inject/);
  });
});

describe("the digest agreement — fixture rot detected WITHOUT the image", () => {
  it("MANIFEST.json's imageDigest equals the compose digest, or the exact re-record instruction fires", () => {
    const manifest = JSON.parse(readFileSync("tests/fixtures/kb/docling/MANIFEST.json", "utf8")) as {
      fixtures: Array<{ file: string; image_digest?: string | null }>;
    };
    const composeDigest = DIGEST_RE.exec(overlay.services.docling.image ?? "")?.[1] ?? null;
    expect(composeDigest).toBeTruthy();
    for (const entry of manifest.fixtures) {
      expect(
        entry.image_digest,
        `${entry.file}: image_digest ${entry.image_digest} != compose digest ${composeDigest} — re-record the fixtures with scripts/record-docling-fixture.mjs`,
      ).toBe(composeDigest);
    }
  });
});
