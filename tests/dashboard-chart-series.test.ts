// Colour truth for the dashboard charts (ds colors-charts): the created
// series is chart-2 (brand), the resolved series is chart-1 (the positive
// green, by rule), every series is a var(--token) and never a literal, and
// the priority ladder maps onto the status vocabulary — URGENT critical,
// HIGH serious, MEDIUM the brand series, LOW the faintest ink.

import { describe, expect, it } from "vitest";
import {
  CHART_CHROME,
  FILL_OPACITY,
  PRIORITY_SERIES,
  SERIES,
  STROKE_WIDTH,
} from "@/lib/chart-series";

const TOKEN = /^var\(--[a-z0-9-]+\)$/;

describe("chart-series", () => {
  it("created is the brand series and resolved is the positive green", () => {
    expect(SERIES.created).toBe("var(--chart-2)");
    expect(SERIES.resolved).toBe("var(--chart-1)");
    expect(SERIES.brand).toBe(SERIES.created);
  });

  it("AI and human resolvers are two distinct series, AI on brand", () => {
    expect(SERIES.ai).toBe("var(--chart-2)");
    expect(SERIES.human).not.toBe(SERIES.ai);
  });

  it("the priority ladder speaks the status vocabulary", () => {
    expect(PRIORITY_SERIES).toEqual({
      URGENT: "var(--critical)",
      HIGH: "var(--serious)",
      MEDIUM: "var(--chart-2)",
      LOW: "var(--text-faint)",
    });
  });

  it("every colour is a design-system token, never a literal", () => {
    const all = [
      ...Object.values(SERIES),
      ...Object.values(PRIORITY_SERIES),
      ...Object.values(CHART_CHROME),
    ];
    for (const c of all) expect(c).toMatch(TOKEN);
  });

  it("grid and axis route through the dataviz chrome tokens", () => {
    expect(CHART_CHROME.grid).toBe("var(--chart-grid)");
    expect(CHART_CHROME.axis).toBe("var(--chart-axis)");
  });

  it("strokes are 1.75px and area fills about 13%", () => {
    expect(STROKE_WIDTH).toBe(1.75);
    expect(FILL_OPACITY).toBeCloseTo(0.13, 2);
  });
});
