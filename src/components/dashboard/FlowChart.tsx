"use client";

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

interface Point {
  date: string; // YYYY-MM-DD
  created: number;
  resolved: number;
}

const config = {
  created: { label: "Created", color: "var(--chart-2)" },
  resolved: { label: "Resolved", color: "var(--chart-1)" },
} satisfies ChartConfig;

function fmtDate(d: string): string {
  return new Date(d + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export default function FlowChart({ data }: { data: Point[] }) {
  const empty = data.every((p) => p.created === 0 && p.resolved === 0);
  if (empty) {
    return (
      <div className="flex h-[clamp(140px,24vh,220px)] items-center justify-center font-sans text-sm text-muted-foreground">
        No ticket activity in the last 30 days.
      </div>
    );
  }

  return (
    <ChartContainer config={config} className="aspect-auto h-[220px] w-full xl:h-full xl:min-h-0">
      <AreaChart data={data} margin={{ left: 0, right: 12, top: 8 }}>
        <defs>
          <linearGradient id="fillCreated" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--chart-3)" stopOpacity={0.5} />
            <stop offset="95%" stopColor="var(--chart-3)" stopOpacity={0.04} />
          </linearGradient>
          <linearGradient id="fillResolved" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.5} />
            <stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0.04} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          tickMargin={10}
          minTickGap={48}
          tickFormatter={fmtDate}
        />
        <YAxis
          width={28}
          tickLine={false}
          axisLine={false}
          allowDecimals={false}
          tickMargin={6}
        />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              indicator="dot"
              labelFormatter={(value) => fmtDate(String(value))}
            />
          }
        />
        <Area
          dataKey="created"
          type="monotone"
          fill="url(#fillCreated)"
          stroke="var(--chart-3)"
          strokeWidth={2}
          isAnimationActive={false}
        />
        <Area
          dataKey="resolved"
          type="monotone"
          fill="url(#fillResolved)"
          stroke="var(--chart-1)"
          strokeWidth={2}
          isAnimationActive={false}
        />
        <ChartLegend content={<ChartLegendContent />} />
      </AreaChart>
    </ChartContainer>
  );
}
