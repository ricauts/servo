// The names the env scrub owns (spec item loop-05). Data only — importing
// this module must never scrub anything.
//
// Kept in sync with src/lib/ai/settings.ts by a COMPILER-enforced check in
// tests/engine-approval-e2e.test.ts, not by anyone remembering: that test maps
// every AiProviderKind to its env var name through a Record<AiProviderKind, …>,
// so a fifth provider fails `npm run typecheck` until it is accounted for, and
// pins each entry against envKeyNameFor() so the map cannot drift from the
// resolver either.
//
// The split is deliberate and load-bearing. The scrub lives in
// tests/setup-env.ts as a top-level side effect; if the test that checks the
// scrub imported THAT module for its list, the import would perform the scrub
// itself and the test would pass even with the `setupFiles` registration
// deleted from vitest.config.ts — a test that cannot fail. Keeping the list
// here means the assertions observe only what the registered setup file did.

/** Every env var src/lib/ai/settings.ts consults for a provider API key. */
export const PROVIDER_KEY_ENV_VARS = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "ZAI_API_KEY",
] as const;

/**
 * Set by tests/setup-env.ts so a test can prove the setup file actually ran in
 * this worker. Without it, a developer whose shell happens to hold no provider
 * key could delete the `setupFiles` line and every assertion would still pass.
 */
export const SCRUB_MARKER = "SERVO_TEST_PROVIDER_ENV_SCRUBBED";
