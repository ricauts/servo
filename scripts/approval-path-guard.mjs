#!/usr/bin/env node
// approval-path-guard (fed-05): proves MECHANICALLY that the policy and
// approval path inside driveResolverLoop is unchanged by a diff. The
// acceptance is explicit: a PR-description diff check is NOT the criterion
// — this offline script is. It hashes the statement range covering the
// policy read, the requiresApproval branch, the APPROVAL_REQUEST step and
// the sibling-closing loop, and fails on any change.
//
//   node scripts/approval-path-guard.mjs          # verify against the recorded hash
//   node scripts/approval-path-guard.mjs --record # re-record after an OWNER-approved change
//
// The recorded hash lives in this file's BASELINE constant; changing it is
// an owner sign-off event, flagged in the commit message.

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const BASELINE = "c8556ef07f020e45";

/** The protected path, extracted from engine.ts source text. */
function extractApprovalPath(source) {
  const start = source.indexOf("const policy = ");
  if (start === -1) throw new Error("policy read not found — the approval path moved");
  const end = source.indexOf('return "paused";', start);
  if (end === -1) throw new Error("the paused return not found after the policy read");
  return source.slice(start, end);
}

const source = readFileSync("src/lib/ai/engine.ts", "utf8");
const path = extractApprovalPath(source);
const hash = createHash("sha256").update(path).digest("hex").slice(0, 16);

if (process.argv.includes("--record")) {
  console.log(`approval-path-guard: new baseline ${hash} — record it in BASELINE with the owner sign-off`);
  process.exit(0);
}

if (BASELINE === "RECORD_ME") {
  console.log(`approval-path-guard: no baseline recorded yet; current ${hash} (run with --record)`);
  process.exit(0);
}

if (hash !== BASELINE) {
  console.error(`approval-path-guard: CHANGED — expected ${BASELINE}, got ${hash}.`);
  console.error("The policy/approval path inside driveResolverLoop must not change under fed-05;");
  console.error("if the owner approved a change, re-record with --record and say so in the commit.");
  process.exit(1);
}
console.log(`approval-path-guard: approval path unchanged (${hash})`);
