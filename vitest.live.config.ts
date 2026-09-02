import path from "path";
import { defineConfig } from "vitest/config";

// dcl-07: the live Docling lane's OWN config. The default vitest.config.ts
// includes tests/**/*.test.ts; this lane's files are tests/live/*.live.ts —
// a different suffix on purpose, so the default suite cannot pick them up
// even by accident and a live test never has to self-skip (§0.2 step 9:
// a skipped test reading as green is forbidden). tests/docling-live-
// isolation.test.ts asserts the separation from both sides.
//
// No global setup hook: the postgres harness is irrelevant to an HTTP lane,
// and requiring a database to run these tests would be a false prerequisite.
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    include: ["tests/live/**/*.live.ts"],
    testTimeout: 900_000, // real OCR on a small VM is minutes-slow per file, not ms-slow
    hookTimeout: 900_000,
  },
});
