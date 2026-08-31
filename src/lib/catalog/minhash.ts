// Salty MinHash + LSH bands (cat-04, canon: docs/design/data-fabric.md
// "What a sample IS"). 128 permutations over salted value hashes, 16 LSH
// bands of 8 — the banded bucketing is what makes the edge pass tractable
// (only within-band pairs are ever compared).
//
// THE RESIDUAL RISK, in one sentence: a signature is a membership oracle
// for a holder of both the database and the salt — strictly less than
// reading the source, smaller than what most_common_vals gives any reader
// of the source, and written into the risk list rather than found later.
//
// This module makes no change to the app's secret handling: the salt
// arrives as an argument, read by the CALLER from the existing encrypted
// store and never persisted beside the signatures. Arithmetic is 32-bit
// by design (no BigInt dependencies, identical on every JS engine).

import { createHash } from "node:crypto";

export const PERMUTATIONS = 128;
export const BANDS = 16;
export const BAND_ROWS = 8; // 16 × 8 = 128

/** A salted 64-bit value hash split into two 32-bit lanes. */
function hashed(value: string, salt: string): [number, number] {
  const digest = createHash("sha256").update(`${salt}\u0000${value}`).digest();
  return [digest.readUInt32BE(0), digest.readUInt32BE(4)];
}

/** Permutation i mixes the lanes with mulberry-style constants derived
 *  from the index — deterministic across runs and installs given the same
 *  salt, so signatures COMPARE. */
function permutationAt(i: number): (lo: number, hi: number) => number {
  // 2-universal shape: an affine combine of the lanes (odd multipliers keep
  // it invertible mod 2^32) followed by the murmur3 finalizer, seeded per
  // permutation. Pairwise independence is what min-hash needs; without the
  // finalizer the affine map alone stays too correlated for the estimate.
  const digest = createHash("sha256").update(`perm:${i}`).digest();
  const a = digest.readUInt32BE(0) | 1;
  const b = digest.readUInt32BE(4) | 1;
  const c = digest.readUInt32BE(8);
  const d = digest.readUInt32BE(12);
  return (lo, hi) => {
    let x = (Math.imul(lo, a) + Math.imul(hi, b) + c) >>> 0;
    x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
    x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
    x = (x ^ (x >>> 16)) >>> 0;
    return (x + d) >>> 0;
  };
}
const PERMUTATION_FNS = Array.from({ length: PERMUTATIONS }, (_, i) => permutationAt(i));

/** The 128-permutation signature of a value set. Identical sets produce
 *  identical signatures — asserted on fixtures. */
export function signature(values: Iterable<string>, salt: string): number[] {
  const hashes: [number, number][] = [];
  for (const v of values) hashes.push(hashed(v, salt));
  if (hashes.length === 0) return new Array(PERMUTATIONS).fill(0);
  return PERMUTATION_FNS.map((perm) => {
    let min = 0xffffffff;
    for (const h of hashes) {
      const p = perm(h[0], h[1]);
      if (p < min) min = p;
    }
    return min;
  });
}

/** The 16 band bucket keys: band i hashes rows [8i, 8i+8) of the signature.
 *  Two signatures sharing ANY band key are candidates for comparison. */
export function bandKeys(sig: number[]): string[] {
  if (sig.length !== PERMUTATIONS) throw new Error(`signature must have ${PERMUTATIONS} rows`);
  const keys: string[] = [];
  for (let b = 0; b < BANDS; b++) {
    const slice = sig.slice(b * BAND_ROWS, (b + 1) * BAND_ROWS);
    keys.push(createHash("sha1").update(slice.join(",")).digest("hex").slice(0, 16));
  }
  return keys;
}

/** Estimated Jaccard from two signatures: shared rows / PERMUTATIONS. */
export function estimatedJaccard(a: number[], b: number[]): number {
  let shared = 0;
  for (let i = 0; i < PERMUTATIONS; i++) if (a[i] === b[i]) shared++;
  return shared / PERMUTATIONS;
}

/** Containment in BOTH directions. With |A∩B| = J·|A∪B| and the two set
 *  sizes known to the caller, the practical edge-builder signal is the
 *  agreement-based estimate: high when one set's values largely live
 *  inside the other's, reported each way. */
export function containment(a: number[], b: number[], sizeA: number, sizeB: number): { aInB: number; bInA: number } {
  const j = estimatedJaccard(a, b);
  const union = j > 0 ? sizeA + sizeB - (j * (sizeA + sizeB)) / (1 + j) : sizeA + sizeB;
  const inter = j * union;
  return {
    aInB: sizeA > 0 ? Math.min(1, inter / sizeA) : 0,
    bInA: sizeB > 0 ? Math.min(1, inter / sizeB) : 0,
  };
}
