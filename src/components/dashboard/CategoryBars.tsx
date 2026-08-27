"use client";

import { Bar, BarChart, CartesianGrid, LabelList, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { CATEGORY_LABEL } from "@/lib/labels";
import type { Category } from "@/lib/types";

const config = {
  count: { label: "Open", color: "var(--chart-1)" },
} satisfies ChartConfig;

export default function CategoryBars({
  data,
}: {
  data: { category: Category; count: number }[];
}) {
  const rows = data
    .filter((d) => d.count > 0)
    .sort((a, b) => b.count - a.count)
    .map((d) => ({ label: CATEGORY_LABEL[d.category], count: d.count }));

  if (rows.length === 0) {
    return (
      <div className="flex h-[clamp(140px,24vh,220px)] items-center justify-center font-sans text-sm text-muted-foreground">
        No open tickets right now.
      </div>
    );
  }

  return (
    <ChartContainer config={config} className="aspect-auto h-[220px] w-full xl:h-full xl:min-h-0">
      <BarChart data={rows} layout="vertical" margin={{ left: 4, right: 28 }}>
        <CartesianGrid horizontal={false} />
        <XAxis type="number" hide />
        <YAxis
          dataKey="label"
          type="category"
          tickLine={false}
          axisLine={false}
          width={112}
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
