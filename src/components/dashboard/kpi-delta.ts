// The "vs previous 30 days" chip on a KPI tile: a label and a tone, from the
// two window values. Tone follows the metric's good direction — fewer
// minutes to first response is good, fewer resolutions is not — and flat is
// neutral. A null on either side (not applicable) yields no chip at all.

export type DeltaTone = "good" | "critical" | "neutral";

export interface DeltaChip {
  label: string;
  tone: DeltaTone;
  direction: "up" | "down" | "flat";
}

export interface DeltaOptions {
  /** count/duration compare relatively (%), rate in percentage points. */
  kind: "count" | "duration" | "rate";
  /** Which way the metric should move. */
  better: "up" | "down";
  /** Shown on an absolute label when the previous window was zero ("+37 min"). */
  unit?: string;
}

const MINUS = "−";

function signed(n: number, suffix: string): string {
  if (n === 0) return `0${suffix}`;
  return `${n > 0 ? "+" : MINUS}${Math.abs(n)}${suffix}`;
}

export function kpiDelta(
  current: number | null,
  previous: number | null,
  opts: DeltaOptions,
): DeltaChip | null {
  if (current === null || previous === null) return null;

  let diff: number;
  let label: string;
  if (opts.kind === "rate") {
    diff = Math.round((current - previous) * 100);
    label = signed(diff, " pt");
  } else if (previous === 0) {
    // No base to compare against: say the absolute movement instead.
    diff = current;
    label = signed(current, opts.unit ? ` ${opts.unit}` : "");
  } else {
    diff = Math.round(((current - previous) / previous) * 100);
    label = signed(diff, "%");
  }

  const direction = diff === 0 ? "flat" : diff > 0 ? "up" : "down";
  const tone: DeltaTone =
    direction === "flat" ? "neutral" : direction === opts.better ? "good" : "critical";
  return { label, tone, direction };
}
