// Source pins for the dashboard recipes the design system fixes. There is no
// DOM harness in this repo (tsconfig keeps jsx: preserve for Next), so, as
// kb-facts-ui does, this reads the component sources and pins the strings
// that carry the rule: the KPI tile highlights with the OPAQUE chip triple
// (surface + hairline + ink, never an alpha tint), the sparkline is 64x22 on
// the brand series, the chart primitive routes grid/axis through the dataviz
// tokens, the flow chart's grid is horizontal-only and dashed 3 3 with the
// period average as a dashed reference, ranked bars carry a quiet track and a
// "count · share%" label, and nothing animates.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(path.resolve(__dirname, "..", rel), "utf8");

const statTile = read("src/components/dashboard/StatTile.tsx");
const sparkline = read("src/components/dashboard/Sparkline.tsx");
const chart = read("src/components/ui/chart.tsx");
const flow = read("src/components/dashboard/FlowChart.tsx");
const ranked = read("src/components/dashboard/RankedBars.tsx");
const priority = read("src/components/dashboard/PriorityBars.tsx");
const category = read("src/components/dashboard/CategoryBars.tsx");
const page = read("src/app/dashboard/page.tsx");

describe("KPI tile", () => {
  it("highlights with the opaque warn / critical chip triples", () => {
    expect(statTile).toContain("bg-warn-chip ring-1 ring-warn-chip-line");
    expect(statTile).toContain("bg-critical-chip ring-1 ring-critical-chip-line");
    expect(statTile).toContain("text-warn-chip-ink");
    expect(statTile).toContain("text-critical-chip-ink");
  });

  it("the delta chip uses good / critical / neutral chip triples", () => {
    for (const tone of ["good", "critical", "neutral"]) {
      expect(statTile).toContain(`bg-${tone}-chip text-${tone}-chip-ink ring-${tone}-chip-line`);
    }
    expect(statTile).toContain("vs prev 30d");
  });

  it("never reaches for an alpha tint", () => {
    expect(statTile).not.toMatch(/\b(bg|text|ring|border)-[a-z-]+\/\d+/);
    expect(statTile).not.toMatch(/-\(--[a-z-]+\)\/\d+/);
  });

  it("the sparkline is 64x22 on the brand series", () => {
    expect(sparkline).toContain("const W = 64;");
    expect(sparkline).toContain("const H = 22;");
    expect(sparkline).toContain("SERIES.created");
    expect(sparkline).toContain("if (points.length < 2) return null;");
  });

  it("the page wires the highlighted tiles to pending approvals and SLA", () => {
    expect(page).toContain("highlight={totals.pendingApprovals > 0}");
    expect(page).toContain("highlight={totals.slaBreached > 0}");
    expect(page).toContain('tone="critical"');
  });
});

describe("chart primitive", () => {
  it("routes grid, axis and cursor through the dataviz tokens", () => {
    expect(chart).toContain("[&_.recharts-cartesian-axis-tick_text]:fill-(--chart-axis)");
    expect(chart).toContain("[&_.recharts-cartesian-grid_line[stroke='#ccc']]:stroke-(--chart-grid)");
    expect(chart).toContain("[&_.recharts-cartesian-axis-tick_text]:font-mono");
  });

  it("the tooltip is a quiet popover card", () => {
    expect(chart).toContain("bg-popover");
    expect(chart).not.toContain("shadow-xl");
  });
});

describe("flow chart", () => {
  it("grid is horizontal only, dashed 3 3, on the grid token", () => {
    const grids = flow.match(/<CartesianGrid[^>]*\/>/g) ?? [];
    expect(grids.length).toBeGreaterThan(0);
    for (const g of grids) {
      expect(g).toContain("vertical={false}");
      expect(g).toContain('strokeDasharray="3 3"');
      expect(g).toContain("stroke={CHART_CHROME.grid}");
    }
  });

  it("draws created and resolved from the series registry at 1.75px / 13%", () => {
    expect(flow).toContain("fill={SERIES.created}");
    expect(flow).toContain("stroke={SERIES.created}");
    expect(flow).toContain("fill={SERIES.resolved}");
    expect(flow).toContain("stroke={SERIES.resolved}");
    expect(flow).toContain("strokeWidth={STROKE_WIDTH}");
    expect(flow).toContain("fillOpacity={FILL_OPACITY}");
    expect(flow).not.toContain("linearGradient");
  });

  it("marks the period average with a dashed reference labelled avg", () => {
    expect(flow).toContain("<ReferenceLine");
    expect(flow).toContain("`avg ${avg.toFixed(1)}`");
  });

  it("has a Resolutions view stacking AI and human per day", () => {
    expect(flow).toContain('id: "resolutions"');
    expect(flow).toContain('dataKey="resolvedAi"');
    expect(flow).toContain('dataKey="resolvedHuman"');
    expect(flow).toContain('stackId="resolved"');
  });
});

describe("ranked bars", () => {
  it("no grid, a quiet track behind each bar, radius 4, count · share label", () => {
    expect(ranked).not.toContain("CartesianGrid");
    expect(ranked).toContain("background={{ fill: CHART_CHROME.track, radius: 4 }}");
    expect(ranked).toContain("radius={4}");
    expect(ranked).toContain("`${r.count} · ${Math.round((r.count / total) * 100)}%`");
  });

  it("priority rungs take their status fill per cell; categories stay monochrome brand", () => {
    expect(priority).toContain("PRIORITY_SERIES[p]");
    expect(ranked).toContain("<Cell key={r.label} fill={r.fill ?? fill} />");
    expect(category).toContain("fill={SERIES.brand}");
    expect(category).not.toContain("PRIORITY_SERIES");
  });
});

describe("motion", () => {
  it("no chart animates", () => {
    for (const src of [flow, ranked, read("src/components/dashboard/AiVsHumanBar.tsx")]) {
      const marks = src.match(/<(Area|Bar|Pie)\b/g) ?? [];
      const offs = src.match(/isAnimationActive=\{false\}/g) ?? [];
      expect(offs.length).toBeGreaterThanOrEqual(marks.length);
    }
  });
});
