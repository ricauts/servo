// The deterministic mock embedder (spec kb-09), mirroring MockProvider:
// selected only when configuration says so, never silently in production.
// Tokenize, hash each token into one of 256 dimensions, accumulate, L2-
// normalize, zero-pad to 1536. Deterministic and offline — and cosine
// genuinely correlates with token overlap, so ranking assertions in tests
// mean something.

import { createHash } from "node:crypto";
import { padVector } from "@/lib/kb/embed";

export const MOCK_EMBEDDER_MODEL = "mock";
const MOCK_NATIVE_DIMS = 256;

export function mockEmbed(text: string): number[] {
  const buckets = new Array<number>(MOCK_NATIVE_DIMS).fill(0);
  const tokens = text.toLowerCase().match(/[a-z0-9][a-z0-9-]{1,}/g) ?? [];
  for (const token of tokens) {
    const hash = createHash("sha256").update(token).digest();
    const bucket = hash.readUInt16BE(0) % MOCK_NATIVE_DIMS;
    buckets[bucket] += 1;
  }
  const norm = Math.sqrt(buckets.reduce((sum, v) => sum + v * v, 0));
  const normalized = norm === 0 ? buckets : buckets.map((v) => v / norm);
  return padVector(normalized, MOCK_EMBEDDER_MODEL).vector;
}
