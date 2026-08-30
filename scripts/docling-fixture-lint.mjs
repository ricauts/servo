#!/usr/bin/env node
// The Docling fixture provenance lint (dcl-03).
//
// Every fixture under tests/fixtures/kb/docling must have a MANIFEST.json
// entry declaring its provenance: "recorded" (with the docling-serve
// version and image digest) or "synthetic": true (with a reason).
//
// THE BRANCH RULE: while docker-compose.docling.yml does NOT exist in the
// tree, synthetic entries are legal — there is no sidecar to record with.
// The moment it exists, synthetic entries FAIL: a hand-authored fixture
// must not survive the arrival of the sidecar that can replace it. Both
// branches are tested in tests/kb-docling-map.test.ts.
//
// Usage: node scripts/docling-fixture-lint.mjs [--root <dir>]   (default: repo root)

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const rootFlag = process.argv.indexOf("--root");
const root = rootFlag > 0 && process.argv[rootFlag + 1] ? process.argv[rootFlag + 1] : ".";
const dir = join(root, "tests/fixtures/kb/docling");
const composePath = join(root, "docker-compose.docling.yml");
const sidecarExists = existsSync(composePath);

const failures = [];
if (!existsSync(dir)) {
  console.error("docling-fixture-lint: no fixture directory — nothing to check");
  process.exit(0);
}

const manifestPath = join(dir, "MANIFEST.json");
if (!existsSync(manifestPath)) {
  console.error("docling-fixture-lint: MANIFEST.json is missing");
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const entries = new Map((manifest.fixtures ?? []).map((f) => [f.file, f]));

const doclingFiles = readdirSync(dir).filter((f) => f.endsWith(".doclingdocument.json"));
const manifestFiles = [...entries.keys()];

for (const file of doclingFiles) {
  const entry = entries.get(file);
  if (!entry) {
    failures.push(`${file}: no MANIFEST entry — every fixture declares provenance`);
    continue;
  }
  if (entry.synthetic === true) {
    if (!entry.reason || !entry.reason.trim()) {
      failures.push(`${file}: synthetic entry carries no reason`);
    }
    if (sidecarExists) {
      failures.push(
        `${file}: synthetic entries are not allowed once docker-compose.docling.yml exists — record it from the live sidecar with scripts/record-docling-fixture.mjs`,
      );
    }
  } else if (entry.provenance === "recorded") {
    if (!entry.docling_serve_version) {
      failures.push(`${file}: recorded entry names no docling-serve version`);
    }
    if (!entry.source_filename) {
      failures.push(`${file}: recorded entry names no source filename`);
    }
    // digest is strongly expected but a local build may not carry one;
    // its absence is a note, not a failure.
    if (!entry.image_digest) {
      console.log(`docling-fixture-lint: note: ${file} records no image digest`);
    }
  } else {
    failures.push(`${file}: provenance must be "recorded" or "synthetic": true`);
  }
}
for (const file of manifestFiles) {
  if (!doclingFiles.includes(file)) {
    failures.push(`${file}: MANIFEST entry with no fixture file`);
  }
}

if (failures.length > 0) {
  for (const f of failures) console.error(`docling-fixture-lint: ${f}`);
  console.error(`docling-fixture-lint: FAILED (${failures.length}) — sidecar ${sidecarExists ? "present" : "absent"}`);
  process.exit(1);
}
console.log(`docling-fixture-lint: OK (${doclingFiles.length} fixture(s), sidecar ${sidecarExists ? "present" : "absent"} — synthetic entries ${sidecarExists ? "banned" : "permitted"})`);
