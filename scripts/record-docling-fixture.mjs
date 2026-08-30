#!/usr/bin/env node
// Record a DoclingDocument fixture from a LIVE docling-serve sidecar
// (dcl-03). Writes the conversion into tests/fixtures/kb/docling/ and a
// MANIFEST.json entry carrying the source filename, the docling-serve
// version (from /openapi.json) and the image DIGEST the operator names.
//
// REFUSES TO RUN IN CI: a recorded fixture is provenance, and provenance
// recorded by an unattended runner is not provenance. CI=true, or the
// presence of the CI env convention, exits non-zero before any request.
//
// Usage:
//   node scripts/record-docling-fixture.mjs --source path/to/file.pdf \
//     [--name fixture-name] [--base-url http://127.0.0.1:9998] \
//     [--digest sha256:...] [--key $SERVO_DOCLING_API_KEY]
//
// The client it drives is the SAME one production uses — no recording
// backdoor, so what the fixture recorded is what the live lane will get.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { basename, join } from "node:path";

function arg(name, fallback = undefined) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

if (process.env.CI === "true" || process.env.CI === "1") {
  console.error("record-docling-fixture: refusing to run in CI — fixtures are recorded by a human, with provenance");
  process.exit(1);
}

const source = arg("source");
if (!source || !existsSync(source)) {
  console.error("record-docling-fixture: --source <file> is required and must exist");
  process.exit(1);
}

// Drive the PRODUCTION client — TypeScript, so this script runs under tsx
// (the usage note at the top says so); there is no recording backdoor, so
// what the fixture recorded is what the live lane will get.
const { DoclingClient } = await import("../src/lib/kb/extractors/docling-client.ts");

const name = arg("name", basename(source).replace(/\.[a-z0-9]+$/i, ""));
const baseUrl = arg("base-url", process.env.SERVO_DOCLING_URL ?? "http://127.0.0.1:9998");
const digest = arg("digest");
const apiKey = arg("key", process.env.SERVO_DOCLING_API_KEY ?? "");

const client = new DoclingClient({ baseUrl, apiKey: apiKey || undefined, deadlineMs: 600_000 });
const bytes = new Uint8Array(readFileSync(source));
const contentType = source.toLowerCase().endsWith(".pdf") ? "application/pdf" : "application/octet-stream";

const { document, serverVersion } = await client.convertFile(basename(source), bytes, contentType);

const dir = "tests/fixtures/kb/docling";
writeFileSync(join(dir, `${name}.doclingdocument.json`), JSON.stringify(document, null, 2) + "\n", "utf8");

const manifestPath = join(dir, "MANIFEST.json");
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : { fixtures: [] };
const entry = {
  file: `${name}.doclingdocument.json`,
  source_filename: basename(source),
  provenance: "recorded",
  synthetic: false,
  docling_serve_version: serverVersion,
  image_digest: digest ?? null,
};
manifest.fixtures = manifest.fixtures.filter((f) => f.file !== entry.file).concat([entry]);
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
console.log(`recorded ${entry.file} from ${entry.source_filename} (${serverVersion}${digest ? `, ${digest}` : ""})`);
