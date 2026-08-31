// Catalog freshness (cat-08): cadence, drift, DROPPED versus UNREADABLE,
// retention. Tier 1 re-runs per DataSource every catalog.reprofile.hours;
// tier 2 only when the tier-1 fingerprint changed, or
// catalog.resample.days elapsed, or a PARTIAL cursor remains — a stable,
// fully-profiled source converges and then opens NO object and samples NO
// row, which the caller proves by counting statements.
//
// DROPPED vs UNREADABLE is the item's sharpest edge: absence from pg_class
// is DROPPED (the row survives with its human note; the CHUNKS go, so the
// card vanishes from search with ZERO change to the retrieval statement);
// present-but-revoked is UNREADABLE (chunks, exemplars AND signature go
// immediately, the entitlement CTE excludes it, and read_document says
// access was withdrawn). Confusing the two would make a failed listing
// indistinguishable from a DROP TABLE.

export const REPORFILE_HOURS = 24;
export const RESAMPLE_DAYS = 30;
export const RETAIN_DROPPED_DAYS = 90;
export const MANUAL_MIN_INTERVAL_MINUTES = 15;

export type FreshnessVerdict =
  | { action: "none"; reason: "converged" | "recent" }
  | { action: "tier1"; reason: "cadence" }
  | { action: "tier1+tier2"; reason: "fingerprint-changed" | "resample-due" | "cursor-remains" };

/** Should tier 1 run for this source now? Pure over the recorded facts. */
export function tier1Due(lastRunAt: Date | null, now: Date): boolean {
  if (lastRunAt === null) return true;
  return now.getTime() - lastRunAt.getTime() >= REPORFILE_HOURS * 3_600_000;
}

/** Should tier 2 run for this entry after tier 1 completed? Pure. */
export function tier2Due(
  entry: {
    fingerprint: string;
    profileStatus: string;
    lastSeenAt: Date;
    valuesStatus: string;
  },
  freshFingerprint: string,
  cursorRemains: boolean,
  now: Date,
): boolean {
  if (cursorRemains) return true; // finish what a PARTIAL run started
  if (entry.fingerprint !== freshFingerprint) return true; // drift
  if (entry.profileStatus === "UNREADABLE") return false; // excluded, not resampled
  if (now.getTime() - entry.lastSeenAt.getTime() >= RESAMPLE_DAYS * 86_400_000) return true;
  return entry.valuesStatus !== "COMPLETE"; // not finished the first time
}

export interface DriftDiff {
  added: string[];
  removed: string[];
  retyped: string[];
}

/** Structural drift between the recorded profile and the fresh tier-1
 *  listing — CatalogRun.stats' diff, no drift table anywhere. */
export function drift(
  before: { fqn: string; columns: { name: string; type: string }[] }[],
  after: { fqn: string; columns: { name: string; type: string }[] }[],
): DriftDiff {
  const beforeKeys = new Set(before.map((e) => e.fqn));
  const afterKeys = new Set(after.map((e) => e.fqn));
  const added = [...afterKeys].filter((k) => !beforeKeys.has(k)).sort();
  const removed = [...beforeKeys].filter((k) => !afterKeys.has(k)).sort();

  const retyped: string[] = [];
  const afterByFqn = new Map(after.map((e) => [e.fqn, e]));
  for (const prior of before) {
    const fresh = afterByFqn.get(prior.fqn);
    if (!fresh) continue;
    const priorTypes = new Map(prior.columns.map((c) => [c.name, c.type]));
    for (const c of fresh.columns) {
      const was = priorTypes.get(c.name);
      if (was !== undefined && was !== c.type) retyped.push(`${prior.fqn}:${c.name}`);
    }
  }
  return { added, removed, retyped: retyped.sort() };
}

/** Absence from pg_class (or the listing) → DROPPED: the row survives with
 *  its human note and inferredPurpose; the CHUNKS are deleted so the card
 *  vanishes from search without touching the retrieval statement. Present
 *  but revoked (absent from pg_stats) → UNREADABLE: chunks, exemplars AND
 *  signature go immediately. The classification is the caller's SQL facts:
 *  {inCatalog, inStats}. */
export function classifyPresence(
  fqn: string,
  presence: { inCatalog: boolean; inStats: boolean },
): "DROPPED" | "UNREADABLE" | "OK" {
  if (!presence.inCatalog) return "DROPPED";
  if (!presence.inStats) return "UNREADABLE";
  void fqn;
  return "OK";
}

/** The card header a DROPPED entry's read_document shows — dated, honest,
 *  and the ONLY thing added to the card. */
export function droppedHeader(asOf: string): string {
  return `this dataset no longer exists as of ${asOf}`;
}

/** What an UNREADABLE entry's read_document returns: the identity line plus
 *  the withdrawal line, and NOTHING else — no columns, no members. */
export function unreadableCard(name: string, fqn: string, withdrawnOn: string): string {
  return `${name} (${fqn})\naccess to this dataset was withdrawn on ${withdrawnOn}`;
}

/** Retention: a DROPPED entry hard-deletes (entry + Document + chunks +
 *  edges, one transaction) after RETAIN_DROPPED_DAYS. Pure predicate. */
export function retentionDue(droppedAt: Date | null, now: Date): boolean {
  if (droppedAt === null) return false;
  return now.getTime() - droppedAt.getTime() >= RETAIN_DROPPED_DAYS * 86_400_000;
}

/** Manual-trigger rate limit: one run per source per interval. Pure. */
export function manualTriggerAllowed(
  lastManualRunAt: Date | null,
  now: Date,
): boolean {
  if (lastManualRunAt === null) return true;
  return now.getTime() - lastManualRunAt.getTime() >= MANUAL_MIN_INTERVAL_MINUTES * 60_000;
}
