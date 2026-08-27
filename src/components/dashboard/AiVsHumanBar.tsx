"use client";

import { Label, Pie, PieChart } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

const config = {
  count: { label: "Resolved" },
  ai: { label: "AI agents", color: "var(--chart-1)" },
  human: { label: "Humans", color: "var(--chart-2)" },
} satisfies ChartConfig;

export default function AiVsHumanBar({
  ai,
  human,
}: {
  ai: number;
  human: number;
}) {
  const total = ai + human;

  if (total === 0) {
    return (
      <div className="flex h-[clamp(120px,19vh,180px)] items-center justify-center font-sans text-sm text-muted-foreground">
        No resolutions in the last 30 days.
      </div>
    );
  }

  const data = [
    { kind: "ai", count: ai, fill: "var(--chart-2)" },
    { kind: "human", count: human, fill: "var(--chart-1)" },
  ];

  return (
    <div className="flex flex-col items-center gap-1 xl:h-full xl:min-h-0 xl:justify-center">
      <ChartContainer config={config} className="aspect-square h-[160px] xl:h-auto xl:min-h-0 xl:flex-1">
        <PieChart>
          <ChartTooltip
            cursor={false}
            content={<ChartTooltipContent hideLabel nameKey="kind" />}
          />
          <Pie
            data={data}
            dataKey="count"
            nameKey="kind"
            innerRadius="55%" outerRadius="85%"
            strokeWidth={2}
            stroke="var(--card)"
            isAnimationActive={false}
          >
            <Label
              content={({ viewBox }) => {
                if (viewBox && "cx" in viewBox && "cy" in viewBox) {
                  return (
                    <text
                      x={viewBox.cx}
                      y={viewBox.cy}
                      textAnchor="middle"
                      dominantBaseline="middle"
                    >
                      <tspan
                        x={viewBox.cx}
                        y={viewBox.cy}
                        className="fill-foreground font-heading text-2xl font-bold"
                      >
                        {total}
                      </tspan>
                      <tspan
                        x={viewBox.cx}
                        y={(viewBox.cy ?? 0) + 20}
                        className="fill-muted-foreground font-sans text-xs"
                      >
                        resolved
                      </tspan>
                    </text>
                  );
                }
                return null;
              }}
            />
          </Pie>
        </PieChart>
      </ChartContainer>

      <div className="flex items-center gap-5 font-sans text-[12.5px]">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-[3px] bg-[var(--chart-1)]" />
          <span className="font-mono font-semibold">{ai}</span>
          <span>AI agents</span>
          <span className="text-muted-foreground">
            ({Math.round((ai / total) * 100)}%)
          </span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-[3px] bg-[var(--chart-2)]" />
          <span className="font-mono font-semibold">{human}</span>
          <span>Humans</span>
          <span className="text-muted-foreground">
            ({Math.round((human / total) * 100)}%)
          </span>
        </span>
      </div>
    </div>
  );
}
