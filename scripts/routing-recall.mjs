#!/usr/bin/env node
// routing-recall (fed-06): a DETERMINISTIC, offline eval set for the
// router with HARD NEGATIVES — over the 400-table fixture, questions must
// find the payroll-truth table among three payroll-shaped decoys (a table,
// its view, its CSV export) and 396 noise tables. A fixed synonym pass
// keeps questions from reusing card tokens. No provider call; the router
// runs on the seeded servo_catalog_src.
//
//   node scripts/routing-recall.mjs [--zero-terms]   # --zero-terms: graph/alt/dup zeroed (the control)
//
// Reports recall@1 and recall@3, listing per-question misses on failure.


const ZERO = process.argv.includes("--zero-terms");

// The eval set: deterministic questions over the seeded world. Synonyms
// deliberately avoid card tokens ("payroll" appears in cards; the
// questions say "salaries"/"take-home"/"net compensation").
// The questions speak PAYROLL — the token only the three decoys carry;
// the truth ranks through the entity edge. Same list as the test's offline
// default; keeping them in sync is what --record/CI checks.
const QUESTIONS = [
  { q: "payroll totals by department", truth: "ds_true_payroll" },
  { q: "payroll amounts per employee", truth: "ds_true_payroll" },
  { q: "payroll records INV-2024-113", truth: "ds_true_payroll" },
  { q: "monthly payroll wage totals", truth: "ds_true_payroll" },
  { q: "employee payroll earnings history", truth: "ds_true_payroll" },
  { q: "what did payroll pay last quarter", truth: "ds_true_payroll" },
  { q: "payroll stub data with withholdings", truth: "ds_true_payroll" },
  { q: "payroll reconciliation export", truth: "ds_true_payroll" },
  { q: "staff payroll by pay cycle", truth: "ds_true_payroll" },
  { q: "gross and net payroll figures", truth: "ds_true_payroll" },
];

// The probe runs inside vitest (the harness owns the database); this CLI
// shells to a tiny vitest run that loads the seeded world and prints JSON.
// Drive vitest through its Node API entry (the local vitest runner) rather
// than shelling npx — spawn portability across hosts is not this script's
// subject. The .mjs entry runs the same suite with the same reporter.
const { execSync } = await import("node:child_process");
const { resolve } = await import("node:path");
const vitestBin = resolve("node_modules/vitest/vitest.mjs");
// -t takes ONE quoted token; an unquoted two-word filter silently ran
// both tests and the first (headline) JSON masked the control.
const target = ZERO ? "control" : "headline";
const out = execSync(
  `node "${vitestBin}" run tests/routing-recall.test.ts -t ${JSON.stringify(target)}`,
  { encoding: "utf8", env: { ...process.env, RECALL_QUESTIONS: JSON.stringify(QUESTIONS) }, timeout: 300_000 },
);
const match = out.match(/RECALL_JSON: (\{.*\})/);
if (!match) {
  console.error("routing-recall: no RECALL_JSON in the harness output");
  process.exit(2);
}
const { recall1, recall3, misses } = JSON.parse(match[1]);

console.log(`recall@1 = ${recall1.toFixed(2)}  recall@3 = ${recall3.toFixed(2)}${ZERO ? "  (control: graph/alt/dup zeroed)" : ""}`);
if (misses.length > 0) {
  console.log("misses:");
  for (const m of misses) console.log(`  - "${m.q}" → truth ${m.truth}, got [${m.got.join(", ")}]`);
}
const ok1 = recall1 >= 0.7;
const ok3 = recall3 >= 0.9;
if (!ZERO && (!ok1 || !ok3)) process.exit(1);
if (ZERO && ok1 && ok3) {
  console.error("routing-recall: the CONTROL passed — the metric cannot catch a scoring regression (expected worse with terms zeroed)");
  process.exit(1);
}
