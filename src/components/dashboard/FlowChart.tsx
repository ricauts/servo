"use client";

import { useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";
import CardHeading from "@/components/dashboard/CardHeading";
import MonoTabs from "@/components/dashboard/MonoTabs";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { CHART_CHROME, FILL_OPACITY, SERIES, STROKE_WIDTH } from "@/lib/chart-series";
import type { KpiResponse } from "@/lib/types";

type Point = KpiResponse["createdByDay"][number];

const config = {
  created: { label: "Created", color: SERIES.created },
  resolved: { label: "Resolved", color: SERIES.resolved },
  resolvedAi: { label: "AI agents", color: SERIES.ai },
  resolvedHuman: { label: "Humans", color: SERIES.human },
} satisfies ChartConfig;

const TABS = [
  { id: "flow", label: "Flow", heading: "Ticket flow — last 30 days" },
  { id: "resolutions", label: "Resolutions", heading: "Resolutions by resolver — last 30 days" },
] as const;

type TabId = (typeof TABS)[number]["id"];

const CHART_CLASS = "aspect-auto h-[220px] w-full xl:h-full xl:min-h-0";
const EMPTY_CLASS =
  "flex h-[clamp(140px,24vh,220px)] items-center justify-center font-sans text-sm text-muted-foreground xl:h-full";

function fmtDate(d: string): string {
  return new Date(d + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

/** Shared axes: mono ticks, no lines, dates thinned so they never collide. */
function axes() {
  return (
    <>
      <XAxis
        dataKey="date"
        tickLine={false}
        axisLine={false}
        tickMargin={10}
        minTickGap={48}
        tickFormatter={fmtDate}
      />
      <YAxis width={28} tickLine={false} axisLine={false} allowDecimals={false} tickMargin={6} />
    </>
  );
}

function FlowPanel({ data }: { data: Point[] }) {
  if (data.every((p) => p.created === 0 && p.resolved === 0)) {
    return <div className={EMPTY_CLASS}>No ticket activity in the last 30 days.</div>;
  }
  // The dashed reference is the mean daily intake over the period.
  const avg = data.reduce((s, p) => s + p.created, 0) / data.length;

  return (
    <ChartContainer config={config} className={CHART_CLASS}>
      <AreaChart data={data} margin={{ left: 0, right: 12, top: 12 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" stroke={CHART_CHROME.grid} />
        {axes()}
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              indicator="dot"
              labelFormatter={(value) => fmtDate(String(value))}
            />
          }
        />
        <ReferenceLine
          y={avg}
          stroke={CHART_CHROME.axis}
          strokeDasharray="4 4"
          strokeWidth={1}
          ifOverflow="extendDomain"
          label={{
            value: `avg ${avg.toFixed(1)}`,
            position: "insideBottomLeft",
            fill: "var(--text-muted)",
            fontSize: 10.5,
            fontFamily: "var(--font-mono)",
          }}
        />
        <Area
          dataKey="created"
          type="monotone"
          fill={SERIES.created}
          fillOpacity={FILL_OPACITY}
          stroke={SERIES.created}
          strokeWidth={STROKE_WIDTH}
          isAnimationActive={false}
        />
        <Area
          dataKey="resolved"
          type="monotone"
          fill={SERIES.resolved}
          fillOpacity={FILL_OPACITY}
          stroke={SERIES.resolved}
          strokeWidth={STROKE_WIDTH}
          isAnimationActive={false}
        />
        <ChartLegend content={<ChartLegendContent />} />
      </AreaChart>
    </ChartContainer>
  );
}

function ResolutionsPanel({ data }: { data: Point[] }) {
  if (data.every((p) => p.resolved === 0)) {
    return <div className={EMPTY_CLASS}>No resolutions in the last 30 days.</div>;
  }

  return (
    <ChartContainer config={config} className={CHART_CLASS}>
      <BarChart data={data} margin={{ left: 0, right: 12, top: 12 }} barCategoryGap="30%">
        <CartesianGrid vertical={false} strokeDasharray="3 3" stroke={CHART_CHROME.grid} />
        {axes()}
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              indicator="dot"
              labelFormatter={(value) => fmtDate(String(value))}
            />
          }
        />
        <Bar
          dataKey="resolvedAi"
          stackId="resolved"
          fill={SERIES.ai}
          maxBarSize={18}
          isAnimationActive={false}
        />
        <Bar
          dataKey="resolvedHuman"
          stackId="resolved"
          fill={SERIES.human}
          maxBarSize={18}
          isAnimationActive={false}
        />
        <ChartLegend content={<ChartLegendContent />} />
      </BarChart>
    </ChartContainer>
  );
}

/**
 * The flow card: created vs resolved per day, with a second view that
 * splits each day's resolutions between AI agents and people. Series colours
 * come from chart-series so the legend, the tooltip and the drawn stroke
 * are the same token by construction.
 */
export default function FlowChart({ data }: { data: Point[] }) {
  const [tab, setTab] = useState<TabId>("flow");
  const heading = TABS.find((t) => t.id === tab)?.heading ?? "";

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <CardHeading>{heading}</CardHeading>
        <MonoTabs tabs={TABS} value={tab} onChange={(id) => setTab(id as TabId)} label="Flow view" />
      </div>
      <div
        role="tabpanel"
        id={`panel-${tab}`}
        aria-labelledby={`tab-${tab}`}
        className="min-h-0 xl:flex-1"
      >
        {tab === "flow" ? <FlowPanel data={data} /> : <ResolutionsPanel data={data} />}
      </div>
    </>
  );
}
