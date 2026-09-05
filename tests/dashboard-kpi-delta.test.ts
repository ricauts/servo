// The dashboard's "vs previous 30 days" chip: the label is exact and the
// tone follows the metric's good direction — fewer minutes to first response
// is good, fewer resolutions is not — flat is neutral, and a not-applicable
// window (null) yields no chip rather than a NaN.

import { describe, expect, it } from "vitest";
import { kpiDelta } from "@/components/dashboard/kpi-delta";

describe("kpiDelta", () => {
  it("counts compare relatively and read good when they grow", () => {
    expect(kpiDelta(56, 50, { kind: "count", better: "up" })).toEqual({
      label: "+12%",
      tone: "good",
      direction: "up",
    });
    expect(kpiDelta(40, 50, { kind: "count", better: "up" })).toEqual({
      label: "−20%",
      tone: "critical",
      direction: "down",
    });
  });

  it("durations read good when they shrink", () => {
    expect(kpiDelta(30, 37, { kind: "duration", better: "down", unit: "min" })).toMatchObject({
      label: "−19%",
      tone: "good",
    });
    expect(kpiDelta(4.4, 4.0, { kind: "duration", better: "down", unit: "h" })).toMatchObject({
      label: "+10%",
      tone: "critical",
    });
  });

  it("rates move in percentage points", () => {
    expect(kpiDelta(0.54, 0.5, { kind: "rate", better: "up" })).toEqual({
      label: "+4 pt",
      tone: "good",
      direction: "up",
    });
    expect(kpiDelta(0.5, 0.5, { kind: "rate", better: "up" })).toEqual({
      label: "0 pt",
      tone: "neutral",
      direction: "flat",
    });
  });

  it("flat is neutral, whatever the good direction", () => {
    expect(kpiDelta(12, 12, { kind: "count", better: "up" })).toMatchObject({
      label: "0%",
      tone: "neutral",
      direction: "flat",
    });
  });

  it("a zero previous window states the absolute movement with its unit", () => {
    expect(kpiDelta(37, 0, { kind: "duration", better: "down", unit: "min" })).toMatchObject({
      label: "+37 min",
      tone: "critical",
    });
    expect(kpiDelta(3, 0, { kind: "count", better: "up" })).toMatchObject({ label: "+3", tone: "good" });
    expect(kpiDelta(0, 0, { kind: "count", better: "up" })).toMatchObject({ label: "0", tone: "neutral" });
  });

  it("not applicable on either side yields no chip", () => {
    expect(kpiDelta(null, 37, { kind: "duration", better: "down" })).toBeNull();
    expect(kpiDelta(37, null, { kind: "duration", better: "down" })).toBeNull();
  });
});
