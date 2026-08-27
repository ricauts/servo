"use client";

import { Bar, BarChart, CartesianGrid, LabelList, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { PRIORITY_LABEL } from "@/lib/labels";
import { PRIORITIES, type Priority } from "@/lib/types";

const config = {
  count: { label: "Open", color: "var(--chart-1)" },
} satisfies ChartConfig;

export default function PriorityBars({
  data,
}: {
  data: { priority: Priority; count: number }[];
}) {
  // Fixed severity ladder, Urgent first, zeros included so the shape is stable.
  const rows = [...PRIORITIES].reverse().map((p) => ({
    label: PRIORITY_LABEL[p],
    count: data.find((d) => d.priority === p)?.count ?? 0,
  }));
  const total = rows.reduce((s, r) => s + r.count, 0);

  if (total === 0) {
    return (
      <div className="flex h-[clamp(120px,19vh,180px)] items-center justify-center font-sans text-sm text-muted-foreground">
        No open tickets right now.
      </div>
    );
  }

  return (
    <ChartContainer config={config} className="aspect-auto h-[180px] w-full xl:h-full xl:min-h-0">
      <BarChart data={rows} layout="vertical" margin={{ left: 4, right: 28 }}>
        <CartesianGrid horizontal={false} />
        <XAxis type="number" hide />
        <YAxis
          dataKey="label"
          type="category"
          tickLine={false}
          axisLine={false}
          width={64}
          tick={{ fontSize: 12 }}
        />
        <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
        <Bar
          dataKey="count"
          fill="var(--chart-2)"
          radius={4}
          barSize={18}
          isAnimationActive={false}
        >
          <LabelList
            dataKey="count"
            position="right"
            className="fill-foreground font-sans"
            fontSize={12}
          />
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}
