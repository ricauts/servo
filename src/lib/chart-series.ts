// Chart series colours — the single place a dashboard series picks its token
// (ds colors-charts: fixed order, green is ALWAYS the resolved/positive
// series, chart-2 is the brand series). Components read these by name so a
// legend swatch, a ChartConfig entry and the drawn stroke cannot disagree.

import type { Priority } from "@/lib/types";

/** Named series → design-system token. Never a literal colour. */
export const SERIES = {
  /** Tickets created — the brand series. */
  created: "var(--chart-2)",
  /** Tickets resolved — green, the positive series, by rule. */
  resolved: "var(--chart-1)",
  /** Resolved by an AI agent — brand (Servo's own worker). */
  ai: "var(--chart-2)",
  /** Resolved by a person — teal. */
  human: "var(--chart-3)",
  /** Monochrome ranked bars (categories, requesters). */
  brand: "var(--chart-2)",
} as const;

/** Per-priority fills for the priority ladder (status vocabulary, not series). */
export const PRIORITY_SERIES: Record<Priority, string> = {
  URGENT: "var(--critical)",
  HIGH: "var(--serious)",
  MEDIUM: "var(--chart-2)",
  LOW: "var(--text-faint)",
};

/** Chart chrome: hairline grid, mono axis ink, the bar track behind ranked bars. */
export const CHART_CHROME = {
  grid: "var(--chart-grid)",
  axis: "var(--chart-axis)",
  track: "var(--surface-2)",
} as const;

/** Stroke and fill discipline from the ds charts card. */
export const STROKE_WIDTH = 1.75;
export const FILL_OPACITY = 0.13;
