// External citations as TEXT (xds-07): src/lib/kb/citation.ts renders an
// externalLocator for a human reader. No URL, no token, no
// browseUrlTemplate in v1 — the citation names WHERE the record lives in
// the operator's own words: which source, which table, which row; or
// which key, which page. A citation from a source whose
// lastCompleteSyncAt is older than its lastSyncAt, or whose status is
// UNREACHABLE, carries its staleness age so a reader can weigh it.

/** A crawled document's locator, as xds-01 canonized it. */
export interface ExternalLocator {
  kind?: "S3" | "POSTGRES" | string;
  source?: string;
  schema?: string;
  table?: string;
  idColumn?: string;
  id?: string;
  bucket?: string;
  key?: string;
  etag?: string;
}

/** The staleness half of the source's own sync bookkeeping. */
export interface SourceFreshness {
  name: string;
  status: string;
  lastSyncAt: Date | null;
  lastCompleteSyncAt: Date | null;
}

/** "erp - public.invoices - row INV-2024-113" / "contracts/2026/q1/x.pdf - page 3". */
export function renderExternalCitation(
  locator: unknown,
  page?: number,
  source?: SourceFreshness | null,
): string {
  const loc = (locator ?? {}) as ExternalLocator;
  let base: string;
  if (loc.kind === "POSTGRES") {
    base = `${loc.source ?? "source"} - ${loc.schema ?? "?"}.${loc.table ?? "?"} - row ${loc.id ?? "?"}`;
  } else if (loc.kind === "S3") {
    base = `${loc.key ?? "?"}`;
  } else if (typeof loc.key === "string" && loc.key) {
    base = loc.key;
  } else {
    base = "external record";
  }
  if (typeof page === "number" && page > 0) base += ` - page ${page}`;
  const staleness = stalenessAge(source);
  return staleness ? `${base} (last complete crawl ${staleness})` : base;
}

/** The staleness suffix: only a source that may be behind carries one. */
export function stalenessAge(source?: SourceFreshness | null): string | null {
  if (!source) return null;
  if (source.status === "UNREACHABLE") return "unavailable now";
  if (!source.lastCompleteSyncAt || !source.lastSyncAt) return null;
  if (source.lastCompleteSyncAt >= source.lastSyncAt) return null; // complete through the latest run
  const ageMs = Date.now() - source.lastCompleteSyncAt.getTime();
  const hours = Math.floor(ageMs / 3_600_000);
  if (hours < 1) return "less than an hour ago";
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
