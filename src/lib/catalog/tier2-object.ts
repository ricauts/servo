// Tier-2 object sampling (cat-05): WHICH objects to open, and what comes
// back. Selection is deterministic and listing-order independent — per
// (prefix, extension) group, the objectsOpened objects with the
// lexicographically smallest sha256(key) are chosen, so a second run over
// an unchanged bucket re-selects exactly the same objects.
//
// Fetches themselves go through safeFetch (egress-guarded) and the bytes
// go to the kb-05 forked worker for parsing by the kb-06/kb-07 extractors
// — NO new parser, NO new dependency. This module only picks.

import { createHash } from "node:crypto";
import type { ListedObject } from "./tier1-object";

export interface SampleSelection {
  /** The chosen objects, sorted by key. */
  selected: ListedObject[];
  /** group → count, so the run's stats can say what was sampled. */
  byGroup: Record<string, number>;
}

/**
 * Select per (prefix, extension) group. Deterministic: the ordering key is
 * sha256(key) as a hex string (lexicographic on the digest), ties broken
 * by the key itself — so shuffling the input cannot change the outcome.
 */
export function selectSamples(
  objects: ListedObject[],
  objectsOpened: number,
): SampleSelection {
  const groups = new Map<string, ListedObject[]>();
  for (const obj of objects) {
    const parts = obj.key.split("/");
    const prefix = parts.slice(0, -1).join("/") + "/";
    const ext = (parts.pop() ?? "").includes(".")
      ? (obj.key.split(".").pop() ?? "").toLowerCase()
      : "";
    const group = `${prefix}|${ext}`;
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group)!.push(obj);
  }

  const byGroup: Record<string, number> = {};
  const selected: ListedObject[] = [];
  for (const [group, members] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const ranked = [...members].sort((a, b) => {
      const da = digest(a.key);
      const db = digest(b.key);
      return da < db ? -1 : da > db ? 1 : a.key < b.key ? -1 : 1;
    });
    const take = ranked.slice(0, objectsOpened);
    byGroup[group] = take.length;
    selected.push(...take);
  }
  selected.sort((a, b) => (a.key < b.key ? -1 : 1));
  return { selected, byGroup };
}

function digest(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/** What a successfully parsed xlsx sample contributes — the STRUCTURE,
 *  never a cell: sheet names, used-range dimensions, and the header row
 *  (headers are column NAMES; values still pass the cat-02 gate at write). */
export interface XlsxSampleShape {
  kind: "xlsx";
  sheets: { name: string; rows: number; columns: number; header: string[] }[];
}

/** What a parsed PDF sample contributes — page count and the kb-08
 *  keyword/entity set ONLY. No sentence from any page is ever kept. */
export interface PdfSampleShape {
  kind: "pdf";
  pageCount: number;
  keywords: string[];
}

export type SampleShape = XlsxSampleShape | PdfSampleShape;
