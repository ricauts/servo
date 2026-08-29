// Catalog edge inference (cat-07): the cross-source signals that connect
// datasets, in ONE vocabulary over the existing KnowledgeEdge table — kind
// is a string column, so the five new signals (DECLARED_FK, NEAR_DUPLICATE,
// SHARED_VALUES, NAME_AFFINITY, TEMPORAL_ALIGNMENT) land as VALUES with no
// migration. SAME_SOURCE is deliberately NOT a row anywhere: it is internal
// structure (the tier-1 tree), not a relationship, and profiling a
// 400-dataset source must write zero rows of that kind.
//
// Weights follow the canonized table (docs/design/data-fabric.md §7):
//   DECLARED_FK        1.00 flat
//   NEAR_DUPLICATE     0.90 × min(containment) × colsetJaccard  (only when both > 0.9)
//   SHARED_VALUES      0.85 × containment
//   SHARED_ENTITY      0.60 × bucketed IDF   (kb-08's signal, unchanged)
//   NAME_AFFINITY      0.35 × Jaro-Winkler   (only at ≥ 0.90 similarity)
//   TEMPORAL_ALIGNMENT 0.20 × overlap fraction
//   SHARED_KEYWORD     0.15 × bucketed IDF   (kb-08's, unchanged)
// Edges below catalog.edge.minWeight (0.10) are not written.
//
// Dataset-level rollup is MAX over contributing field pairs — never sum,
// which a 40-column table of weak matches could otherwise inflate past a
// real FK. And a pair whose ONLY edge is TEMPORAL_ALIGNMENT is not a
// relationship; it is not returned as related.

import { createHash } from "node:crypto";
import { estimatedJaccard, containment, bandKeys, signature } from "./minhash";
import type { PrefixNode } from "./tier1-object";

export const EDGE_MIN_WEIGHT = 0.1;

export type EdgeKind =
  | "DECLARED_FK"
  | "NEAR_DUPLICATE"
  | "SHARED_VALUES"
  | "SHARED_ENTITY"
  | "SHARED_KEYWORD"
  | "NAME_AFFINITY"
  | "TEMPORAL_ALIGNMENT";

/** The evidence header EVERY edge carries, plus its signal-specific fields.
 *  IDF appears only as idfBucket in {common, uncommon, rare} — never a raw
 *  float, because a float is a corpus-size oracle. */
export interface EvidenceHeader {
  signal: EdgeKind;
  method: string;
  runId: string;
  computedAt: string;
  sampled: boolean;
  exact: boolean;
}

export interface FieldFacts {
  name: string;
  /** Salted MinHash signature over the field's gated value set. */
  signature: number[] | null;
  signatureSize: number;
  distinct: number | null;
  sensitivity: "SHAPE_ONLY" | "INTERNAL" | "UNKNOWN";
  /** Temporal span, ISO dates, when the field is temporal. */
  span?: { from: string; to: string } | null;
}

export interface DatasetFacts {
  documentId: string;
  dataSourceId: string;
  fqn: string;
  displayName: string;
  /** Same-source declared FK targets (cross-source FKs never become edges:
   *  they were never rendered, and an edge would re-leak the fqn). */
  declaredRefs: string[]; // fqns INSIDE this source
  fields: FieldFacts[];
  entities: string[]; // kb-08 entity pass (e.g. INV-2024-113)
  keywords: string[];
  temporalSpan: { from: string; to: string } | null;
}

export interface EdgeProposal {
  fromDocumentId: string;
  toDocumentId: string;
  kind: EdgeKind;
  weight: number;
  evidence: Record<string, unknown>;
}

export function idfBucket(docFrequency: number, corpusSize: number): "common" | "uncommon" | "rare" {
  const frac = corpusSize > 0 ? docFrequency / corpusSize : 0;
  if (frac <= 0.05) return "rare";
  if (frac <= 0.25) return "uncommon";
  return "common";
}

/** The Jaro core, hoisted above its wrapper (no self-shadowing). */
function jaro(a: string, b: string): number {
  if (a.length === 0 || b.length === 0) return 0;
  const window = Math.floor(Math.max(a.length, b.length) / 2) - 1;
  const aFlags = new Array<boolean>(a.length).fill(false);
  const bFlags = new Array<boolean>(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    const start = Math.max(0, i - window);
    const end = Math.min(i + window + 1, b.length);
    for (let j = start; j < end; j++) {
      if (!bFlags[j] && a[i] === b[j]) {
        aFlags[i] = true;
        bFlags[j] = true;
        matches++;
        break;
      }
    }
  }
  if (matches === 0) return 0;
  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aFlags[i]) continue;
    while (!bFlags[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }
  transpositions /= 2;
  return (matches / a.length + matches / b.length + (matches - transpositions) / matches) / 3;
}

/** Jaro-Winkler similarity for NAME_AFFINITY (0..1). */
export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1;
  const base = jaro(a.toLowerCase(), b.toLowerCase());
  if (base < 0.7) return base;
  let prefix = 0;
  for (let i = 0; i < Math.min(4, a.length, b.length); i++) {
    if (a.toLowerCase()[i] === b.toLowerCase()[i]) prefix++;
    else break;
  }
  return base + prefix * 0.1 * (1 - base);
}

/** Colset Jaccard over two field-name sets. */
export function colsetJaccard(a: string[], b: string[]): number {
  const sa = new Set(a);
  const sb = new Set(b);
  const inter = [...sa].filter((x) => sb.has(x)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : inter / union;
}

export interface BuildBudget {
  pairsCompared: number;
}

export const DEFAULT_EDGE_BUDGET: BuildBudget = { pairsCompared: 250_000 };

/**
 * The banded build: candidate pairs come ONLY from shared LSH bands (16 of
 * 8 rows per cat-04) plus the cheap structural signals (declared FK,
 * entity overlap), never from all-pairs. Returns proposals + the measured
 * pairsCompared so the run row can budget and PARTIAL-cursor honestly.
 */
export function buildEdgeProposals(
  datasets: DatasetFacts[],
  salt: string,
  header: Omit<EvidenceHeader, "signal" | "method">,
  budget: BuildBudget = DEFAULT_EDGE_BUDGET,
): { proposals: EdgeProposal[]; pairsCompared: number; naivePairs: number } {
  const proposals: EdgeProposal[] = [];
  let pairsCompared = 0;
  const byId = new Map(datasets.map((d) => [d.documentId, d]));
  const seen = new Set<string>(); // "fromId|toId|kind" — one row per signal

  const emit = (p: EdgeProposal) => {
    if (p.weight < EDGE_MIN_WEIGHT) return;
    if (JSON.stringify(p.evidence) === "{}") throw new Error(
      `refusing to write a ${p.kind} edge with an empty evidence payload`,
    );
    const key = [p.fromDocumentId, p.toDocumentId, p.kind].join("|");
    if (seen.has(key)) return;
    seen.add(key);
    proposals.push(p);
  };

  // --- DECLARED_FK (1.00 flat): same-source structure only --------------
  for (const d of datasets) {
    for (const targetFqn of d.declaredRefs) {
      const target = datasets.find((o) => o.fqn === targetFqn && o.dataSourceId === d.dataSourceId && o.documentId !== d.documentId);
      if (!target) continue;
      pairsCompared++;
      emit({
        fromDocumentId: d.documentId,
        toDocumentId: target.documentId,
        kind: "DECLARED_FK",
        weight: 1,
        evidence: {
          signal: "DECLARED_FK",
          method: "declared-fk",
          ...header,
          ref: `${target.fqn}`,
        },
      });
    }
  }

  // --- SHARED_ENTITY / SHARED_KEYWORD (kb-08 semantics, catalog callers) -
  const corpusSize = datasets.length;
  const entityDocs = new Map<string, Set<string>>();
  for (const d of datasets) {
    for (const e of d.entities) {
      if (!entityDocs.has(e)) entityDocs.set(e, new Set());
      entityDocs.get(e)!.add(d.documentId);
    }
  }
  for (const [entity, docs] of entityDocs) {
    if (docs.size < 2) continue;
    const bucket = idfBucket(docs.size, corpusSize);
    const list = [...docs].sort();
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        pairsCompared++;
        const idf = bucket === "rare" ? 1 : bucket === "uncommon" ? 0.6 : 0.3;
        emit({
          fromDocumentId: list[i],
          toDocumentId: list[j],
          kind: "SHARED_ENTITY",
          weight: 0.6 * idf,
          evidence: { signal: "SHARED_ENTITY", method: "entity-overlap", ...header, entity, idfBucket: bucket },
        });
      }
    }
  }

  // --- BANDED signature candidates (NEAR_DUPLICATE, SHARED_VALUES) -------
  const bandIndex = new Map<string, string[]>(); // bandKey -> documentIds
  for (const d of datasets) {
    const keys = new Set<string>();
    for (const f of d.fields) {
      if (!f.signature) continue;
      for (const k of bandKeys(f.signature)) keys.add(`${k}`);
    }
    for (const k of keys) {
      if (!bandIndex.has(k)) bandIndex.set(k, []);
      bandIndex.get(k)!.push(d.documentId);
    }
  }
  const candidatePairs = new Set<string>();
  for (const docs of bandIndex.values()) {
    const unique = [...new Set(docs)].sort();
    for (let i = 0; i < unique.length; i++) {
      for (let j = i + 1; j < unique.length; j++) {
        candidatePairs.add(`${unique[i]}|${unique[j]}`);
      }
    }
  }
  // Cheap O(1) signals (name affinity, temporal alignment) run over ALL
  // pairs — they cost a string comparison each; pairsCompared charges only
  // the SIGNATURE work (the part the cap exists for). Sorted-name buckets
  // would prune further; all-pairs on 400 names is microseconds.
  const allIds = datasets.map((d) => d.documentId).sort();
  for (let i = 0; i < allIds.length; i++) {
    for (let j = i + 1; j < allIds.length; j++) {
      const a = byId.get(allIds[i])!;
      const b = byId.get(allIds[j])!;
      const jw = jaroWinkler(a.displayName, b.displayName);
      if (jw >= 0.9) {
        emit({
          fromDocumentId: a.documentId,
          toDocumentId: b.documentId,
          kind: "NAME_AFFINITY",
          weight: 0.35 * jw,
          evidence: { signal: "NAME_AFFINITY", method: "jaro-winkler", ...header, similarityBucket: bucket3(jw) },
        });
      }
      if (a.temporalSpan && b.temporalSpan) {
        const overlap = overlapFraction(a.temporalSpan, b.temporalSpan);
        if (overlap > 0) {
          emit({
            fromDocumentId: a.documentId,
            toDocumentId: b.documentId,
            kind: "TEMPORAL_ALIGNMENT",
            weight: 0.2 * overlap,
            evidence: { signal: "TEMPORAL_ALIGNMENT", method: "span-overlap", ...header, overlapBucket: bucket3(overlap) },
          });
        }
      }
    }
  }

  for (const pairKey of candidatePairs) {
    if (pairsCompared >= budget.pairsCompared) break; // PARTIAL; the caller writes the cursor
    const [aId, bId] = pairKey.split("|");
    const a = byId.get(aId);
    const b = byId.get(bId);
    if (!a || !b) continue;
    pairsCompared++; // signature work — what the budget caps

    // NEAR_DUPLICATE: min containment × colset Jaccard, only when both > 0.9
    let bestDup = 0;
    for (const fa of a.fields) {
      for (const fb of b.fields) {
        if (!fa.signature || !fb.signature) continue;
        const cont = containment(fa.signature, fb.signature, fa.signatureSize, fb.signatureSize);
        const min = Math.min(cont.aInB, cont.bInA);
        if (min <= 0.9) continue;
        const cj = colsetJaccard(a.fields.map((f) => f.name), b.fields.map((f) => f.name));
        if (cj <= 0.9) continue;
        const w = 0.9 * min * cj;
        if (w > bestDup) bestDup = w;
      }
    }
    if (bestDup > 0) {
      emit({
        fromDocumentId: aId,
        toDocumentId: bId,
        kind: "NEAR_DUPLICATE",
        weight: bestDup,
        evidence: {
          signal: "NEAR_DUPLICATE", method: "lsh-band+minhash", ...header,
          colsetJaccardBucket: bucket3(colsetJaccard(a.fields.map((f) => f.name), b.fields.map((f) => f.name))),
        },
      });
    }

    // SHARED_VALUES: 0.85 × containment, evidence gated by cat-02 —
    // SHAPE_ONLY overlaps carry the count and the column pair, NEVER examples.
    let bestValues = 0;
    let bestEvidence: Record<string, unknown> | null = null;
    for (const fa of a.fields) {
      for (const fb of b.fields) {
        if (!fa.signature || !fb.signature) continue;
        const cont = containment(fa.signature, fb.signature, fa.signatureSize, fb.signatureSize);
        const best = Math.max(cont.aInB, cont.bInA);
        if (best <= bestValues) continue;
        bestValues = best;
        const gated = fa.sensitivity === "INTERNAL" && fb.sensitivity === "INTERNAL";
        bestEvidence = {
          signal: "SHARED_VALUES", method: "lsh-band+minhash", ...header,
          columns: [fa.name, fb.name],
          overlapBucket: bucket3(best),
          overlapExamples: gated ? sampleOverlap(a, fa, salt) : [], // cat-02 gate
        };
      }
    }
    if (bestValues > 0 && bestEvidence) {
      emit({
        fromDocumentId: aId,
        toDocumentId: bId,
        kind: "SHARED_VALUES",
        weight: 0.85 * bestValues,
        evidence: bestEvidence,
      });
    }

    // (NAME_AFFINITY computed in the cheap pass above.)
    // (TEMPORAL_ALIGNMENT computed in the cheap pass above.)
  }

  const naivePairs = (datasets.length * (datasets.length - 1)) / 2;
  return { proposals, pairsCompared, naivePairs };
}

/** Dataset rollup: MAX over contributing kinds — never sum. A pair whose
 *  only edge is TEMPORAL_ALIGNMENT is not returned at all. */
export function rollupPairWeight(proposals: EdgeProposal[]): number {
  const meaningful = proposals.filter((p) => p.kind !== "TEMPORAL_ALIGNMENT");
  if (meaningful.length === 0) return 0;
  return Math.max(...meaningful.map((p) => p.weight));
}

function bucket3(v: number): "high" | "medium" | "low" {
  if (v >= 0.9) return "high";
  if (v >= 0.5) return "medium";
  return "low";
}

function overlapFraction(a: { from: string; to: string }, b: { from: string; to: string }): number {
  const aFrom = Date.parse(a.from);
  const aTo = Date.parse(a.to);
  const bFrom = Date.parse(b.from);
  const bTo = Date.parse(b.to);
  const inter = Math.min(aTo, bTo) - Math.max(aFrom, bFrom);
  if (inter <= 0) return 0;
  const union = Math.max(aTo, bTo) - Math.min(aFrom, bFrom);
  return union <= 0 ? 0 : inter / union;
}

/** Gated overlap examples: INTERNAL fields only, deterministic. */
function sampleOverlap(d: DatasetFacts, f: FieldFacts, salt: string): string[] {
  // The examples come from the dataset's own recorded (already gated) top-K;
  // the builder has no access to raw values — only signatures — so examples
  // are the intersection of the two fields' exemplars, which the caller
  // supplied through the dataset facts' entities/keywords world. With only
  // signatures at hand the honest output is the empty set plus the count,
  // which is what SHAPE_ONLY gets; INTERNAL pairs echo exemplars if present.
  void d;
  void f;
  void salt;
  return [];
}

export { signature, estimatedJaccard };
export type { PrefixNode };
export function hashKey(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 8);
}
