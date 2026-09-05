"use client";

import { Bar, BarChart, Cell, LabelList, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { CHART_CHROME } from "@/lib/chart-series";

export interface RankedRow {
  label: string;
  count: number;
  /** Per-row fill token; falls back to the chart's `fill`. */
  fill?: string;
}

/**
 * Horizontal ranked bars: every row gets a quiet track behind it so the
 * empty share reads as space, not as absence, and the label carries both
 * the count and its share of the whole ("12 · 34%"). No grid — the track is
 * the scale.
 */
export default function RankedBars({
  rows,
  valueLabel,
  fill,
  yWidth,
  emptyText,
}: {
  rows: RankedRow[];
  /** Tooltip name of the value ("Open", "Created"). */
  valueLabel: string;
  /** Default bar fill token. */
  fill: string;
  /** Width reserved for the row labels. */
  yWidth: number;
  emptyText: string;
}) {
  const total = rows.reduce((s, r) => s + r.count, 0);

  if (rows.length === 0 || total === 0) {
    return (
      <div className="flex h-[clamp(140px,24vh,220px)] items-center justify-center font-sans text-sm text-muted-foreground xl:h-full">
        {emptyText}
      </div>
    );
  }

  const config = { count: { label: valueLabel, color: fill } } satisfies ChartConfig;
  const data = rows.map((r) => ({
    ...r,
    share: `${r.count} · ${Math.round((r.count / total) * 100)}%`,
  }));

  return (
    <ChartContainer
      config={config}
      className="aspect-auto h-[220px] w-full xl:h-full xl:min-h-0"
    >
      <BarChart data={data} layout="vertical" margin={{ left: 0, right: 64, top: 2, bottom: 2 }}>
        <XAxis type="number" hide domain={[0, "dataMax"]} />
        <YAxis
          dataKey="label"
          type="category"
          tickLine={false}
          axisLine={false}
          width={yWidth}
          tickMargin={8}
          interval={0}
          tick={{
            fontSize: 12,
            style: { fill: "var(--text-muted)", fontFamily: "var(--font-core)" },
          }}
        />
        <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
        <Bar
          dataKey="count"
          fill={fill}
          radius={4}
          barSize={16}
          background={{ fill: CHART_CHROME.track, radius: 4 }}
          isAnimationActive={false}
        >
          {data.map((r) => (
            <Cell key={r.label} fill={r.fill ?? fill} />
          ))}
          <LabelList
            dataKey="share"
            position="right"
            offset={8}
            className="fill-(--text-body) font-mono"
            fontSize={11}
          />
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}
