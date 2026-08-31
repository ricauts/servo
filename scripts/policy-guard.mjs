// The quarantine rail as code — spec item loop-06, §0.8 rail 4. Every tool
// from a non-core source (MCP server, plugin bundle, mined integration)
// exists ONLY as a ToolPolicy row carrying the triple:
//
//     enabled: false    requiresApproval: true    riskLevel: "HIGH"
//
// A risk level declared in a manifest is RECORDED by the caller's snapshot
// but never used to set policy — there is no max(declared, MEDIUM) floor
// anywhere. Only a human downgrade in the UI changes any of the three
// fields. quarantineRow() below is the single way future intake code
// (cnp-02, cnp-06) mints a non-core policy row; policy-creation sites in
// src/ are allowlisted by the invariant test so an ungated new source fails
// npm test.
//
//   node scripts/policy-guard.mjs    # verifies DEFAULT rows vs the baseline

import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");

export const QUARANTINE_TRIPLE = Object.freeze({
  enabled: false,
  requiresApproval: true,
  riskLevel: "HIGH",
});

/**
 * The canonical policy row for a tool from any non-core source. `declared`
 * (a manifest's annotation) is accepted and deliberately ignored for policy;
 * the caller records it in its own snapshot if it wants the audit trail.
 * @param {string} toolName
 * @param {string} description
 * @param {{ riskLevel?: string } | null} [declared]
 */
export function quarantineRow(toolName, description, declared = null) {
  return {
    toolName,
    description: String(description ?? ""),
    ...QUARANTINE_TRIPLE,
    declaredRiskLevel: declared?.riskLevel ?? null, // recorded, never applied
  };
}

/** Parse DEFAULT_TOOL_POLICIES rows out of tool-policies.ts source text.
 * Diff fragments carry only row objects without the array header, so when
 * the header is absent the whole text is scanned — the row field triplet
 * appears nowhere else. */
export function parseDefaultRows(text) {
  const rows = [];
  const source = String(text ?? "");
  const block = source.match(/DEFAULT_TOOL_POLICIES[^=]*=\s*\[([\s\S]*)\]/);
  const body = block ? block[1] : source;
  for (const m of body.matchAll(
    /toolName:\s*"([^"]+)"[\s\S]*?riskLevel:\s*"(LOW|MEDIUM|HIGH)"[\s\S]*?requiresApproval:\s*(true|false)/g,
  )) {
    rows.push({ toolName: m[1], riskLevel: m[2], requiresApproval: m[3] === "true" });
  }
  return rows;
}

/** Parse baseline keys (and their values) out of policy-baseline.json text. */
export function parseBaseline(text) {
  const out = new Map();
  for (const m of String(text ?? "").matchAll(/"([a-z0-9_]+)":\s*\{\s*"riskLevel":\s*"(LOW|MEDIUM|HIGH)",\s*"requiresApproval":\s*(true|false)/g)) {
    out.set(m[1], { riskLevel: m[2], requiresApproval: m[3] === "true" });
  }
  return out;
}

// --- diff classification: the seam scripts/landing-tier.mjs calls ----------

function splitSides(diffText, fileTest) {
  const oldLines = [];
  const newLines = [];
  let file = "";
  let inTarget = false;
  for (const raw of String(diffText ?? "").split("\n")) {
    if (raw.startsWith("+++ ")) {
      file = raw.slice(4).replace(/^b\//, "");
      inTarget = fileTest(file);
      continue;
    }
    if (raw.startsWith("--- ") || raw.startsWith("@@") || raw.startsWith("diff ")) continue;
    if (!inTarget) continue;
    if (raw.startsWith("-")) oldLines.push(raw.slice(1));
    else if (raw.startsWith("+")) newLines.push(raw.slice(1));
    else {
      oldLines.push(raw.slice(1));
      newLines.push(raw.slice(1));
    }
  }
  return { oldLines, newLines };
}

/**
 * @typedef {object} PolicyVerdict
 * @property {"additive"|"destructive"} verdict
 * @property {string[]} reasons
 * @property {boolean} baselineChanged  // additions allowed, flagged for owner sign-off
 */

/**
 * Classify a staged diff touching src/lib/ai/tool-policies.ts and/or
 * tests/fixtures/policy-baseline.json. Additive means: existing DEFAULT rows
 * untouched; appended rows carry the quarantine triple OR are added to the
 * baseline in the same diff (a built-in landing ungated — an owner sign-off
 * event); baseline keys never change or disappear.
 * @param {string} diffText
 * @returns {PolicyVerdict}
 */
export function classifyToolPoliciesDiff(diffText) {
  const reasons = [];
  const policies = splitSides(diffText, (f) => f === "src/lib/ai/tool-policies.ts");
  const before = parseDefaultRows(policies.oldLines.join("\n"));
  const after = parseDefaultRows(policies.newLines.join("\n"));
  const beforeByname = new Map(before.map((r) => [r.toolName, r]));
  const afterByName = new Map(after.map((r) => [r.toolName, r]));

  for (const row of before) {
    const now = afterByName.get(row.toolName);
    if (!now) {
      reasons.push(`default policy row "${row.toolName}" removed`);
    } else if (now.riskLevel !== row.riskLevel || now.requiresApproval !== row.requiresApproval) {
      reasons.push(
        `default policy row "${row.toolName}" changed (${row.riskLevel}/${row.requiresApproval} -> ${now.riskLevel}/${now.requiresApproval})`,
      );
    }
  }

  const baseline = splitSides(diffText, (f) => f === "tests/fixtures/policy-baseline.json");
  const baselineBefore = parseBaseline(baseline.oldLines.join("\n"));
  const baselineAfter = parseBaseline(baseline.newLines.join("\n"));
  for (const [name, value] of baselineBefore) {
    const now = baselineAfter.get(name);
    if (!now) reasons.push(`baseline entry "${name}" removed`);
    else if (now.riskLevel !== value.riskLevel || now.requiresApproval !== value.requiresApproval) {
      reasons.push(`baseline entry "${name}" changed — owner sign-off territory`);
    }
  }
  const baselineAdded = [...baselineAfter.keys()].filter((k) => !baselineBefore.has(k));
  const baselineChanged = baselineAdded.length > 0 || baselineBefore.size !== baselineAfter.size;

  for (const row of after) {
    if (beforeByname.has(row.toolName)) continue;
    const carriesTriple = row.riskLevel === "HIGH" && row.requiresApproval === true;
    if (!carriesTriple && !baselineAfter.has(row.toolName)) {
      reasons.push(
        `appended tool "${row.toolName}" is neither quarantined (HIGH + approval) nor baselined — a new ungated tool needs the baseline and owner sign-off`,
      );
    }
  }
  return {
    verdict: reasons.length === 0 ? "additive" : "destructive",
    reasons,
    baselineChanged,
  };
}

// --- CLI --------------------------------------------------------------------

function main() {
  const rows = parseDefaultRows(
    readFileSync(path.join(REPO_ROOT, "src/lib/ai/tool-policies.ts"), "utf8"),
  );
  const baselineText = readFileSync(path.join(REPO_ROOT, "tests/fixtures/policy-baseline.json"), "utf8");
  const baseline = parseBaseline(baselineText);
  const violations = [];
  for (const row of rows) {
    const snap = baseline.get(row.toolName);
    if (!snap) {
      if (!(row.riskLevel === "HIGH" && row.requiresApproval)) {
        violations.push(
          `"${row.toolName}" is not in the baseline and does not carry the quarantine triple`,
        );
      }
    } else if (snap.riskLevel !== row.riskLevel || snap.requiresApproval !== row.requiresApproval) {
      violations.push(`"${row.toolName}" drifted from its baseline snapshot (owner sign-off required)`);
    }
  }
  for (const v of violations) console.error(`policy-guard: ${v}`);
  if (violations.length > 0) process.exit(1);
  console.log(`policy-guard: OK (${rows.length} default rows, baseline in sync)`);
}

// CLI only — not when the tests import the module.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
