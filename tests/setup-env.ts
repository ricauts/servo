// Per-worker environment scrub (spec item loop-05, rail 2 of §0.8).
//
// src/lib/ai/settings.ts resolves an API key as `envKey || dbKey` — the
// environment WINS over the database. So a developer with ANTHROPIC_API_KEY
// exported in their shell, running a suite that writes `provider = anthropic`
// into a Setting row, gets a real provider and a real billed model call out of
// a run everything else calls "mock". Nothing in the assertions would show it:
// the run would simply pass, or fail for a reason that looks like flakiness.
//
// Registered as a vitest `setupFiles` entry, not `globalSetup`: globalSetup
// runs once in the main process, while settings.ts reads `process.env` inside
// the worker that actually runs the test. The scrub has to happen where the
// read happens.
//
// The list itself lives in tests/helpers/provider-env.ts so that the test
// asserting this scrub can import the names WITHOUT importing this file's side
// effect. tests/engine-approval-e2e.test.ts also closes the drift gap from the
// other side, asserting the list covers every name envKeyNameFor() can return
// for every AiProviderKind — so a fourth provider cannot be added without this
// list growing too.

import { PROVIDER_KEY_ENV_VARS, SCRUB_MARKER } from "./helpers/provider-env";

// NEUTRALISE, not merely delete: @prisma/client's runtime loads the repo's
// .env into process.env at first client construction — AFTER this file ran —
// and dotenv does not override keys that already exist. A developer with a
// real key in .env therefore gets it re-injected mid-suite under a
// delete-only scrub (reproduced: a Prisma-importing file sees the key, a
// Prisma-free one does not). Setting the empty string holds the slot open
// against every dotenv loader, and settings.ts treats "" as absent, so the
// resolved provider stays exactly "mock".
for (const name of PROVIDER_KEY_ENV_VARS) {
  process.env[name] = "";
}

// Proof of registration, not of effect: lets a test tell "the setup file ran
// and found nothing" apart from "the setup file never ran".
process.env[SCRUB_MARKER] = "1";
