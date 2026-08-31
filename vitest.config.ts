import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    globalSetup: "tests/setup/postgres.ts",
    // Runs inside every worker, before its test files (loop-05): deletes the
    // provider key env vars so env-over-DB precedence in src/lib/ai/settings.ts
    // cannot pull a developer's shell key into a "mock" run.
    setupFiles: ["tests/setup-env.ts"],
  },
});
