// String unions for the catalog (cat-01, canonized in
// docs/design/data-fabric.md). String unions, never Prisma enums — the
// values live in one place (here) and the columns stay plain TEXT.

export type CatalogLevel = "SOURCE" | "DATASET" | "FIELD";

export type ProfileStatus =
  | "PENDING"
  | "PROFILING"
  | "PROFILED"
  | "PARTIAL"
  | "FAILED"
  | "DROPPED"
  | "UNREADABLE";

export type Sensitivity = "SHAPE_ONLY" | "INTERNAL" | "UNKNOWN";

export type ValuesStatus = "ABSENT" | "PARTIAL" | "COMPLETE";

export type CatalogRunTrigger = "CONNECT" | "SCHEDULED" | "MANUAL";

export type CatalogRunTier = "TIER1" | "TIER2" | "EDGES";

export type CatalogRunStatus = "RUNNING" | "COMPLETE" | "PARTIAL" | "FAILED";

export type BudgetHit =
  | "WALL_CLOCK"
  | "BYTES"
  | "OBJECTS"
  | "ROWS"
  | "PAIRS"
  | "STATEMENT_TIMEOUT";

/**
 * The DocumentChunk locator union, extended to its FOURTH shape (cat-01).
 * Field entries get no Document of their own: a field is rendered as a
 * window of its dataset card's `columns` section and cited as
 * {"entry": <CatalogEntry id>, "section": "columns", "from": "net_pay"}.
 * Existing shapes keep their meaning forever; new keys are additive; no
 * consumer may require a key it did not previously require (the rule
 * src/lib/kb/locator.ts will canonize when it lands).
 */
export type ChunkLocator =
  | { lines: string }
  | { sheet: string; range: string }
  | { page: number; part?: number }
  | { entry: string; section: string; from?: string };

/** What a Document is: an uploaded file, or a rendered catalog card. */
export type DocumentKind = "FILE" | "CATALOG";
