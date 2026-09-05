"use client";

import { Label, Pie, PieChart } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { SERIES } from "@/lib/chart-series";

// AI = the brand series, people = teal — the same pair the flow card's
// Resolutions view stacks per day.
const config = {
  count: { label: "Resolved" },
  ai: { label: "AI agents", color: SERIES.ai },
  human: { label: "Humans", color: SERIES.human },
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
      <div className="flex h-[clamp(120px,19vh,180px)] items-center justify-center font-sans text-sm text-muted-foreground xl:h-full">
        No resolutions in the last 30 days.
      </div>
    );
  }

  const data = [
    { kind: "ai", count: ai, fill: SERIES.ai },
    { kind: "human", count: human, fill: SERIES.human },
  ];
  const legend = [
    { key: "ai", label: "AI agents", value: ai, fill: SERIES.ai },
    { key: "human", label: "Humans", value: human, fill: SERIES.human },
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
            innerRadius="58%"
            outerRadius="86%"
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
                        className="fill-(--text-strong) font-heading text-2xl font-semibold tracking-tight"
                      >
                        {total}
                      </tspan>
                      <tspan
                        x={viewBox.cx}
                        y={(viewBox.cy ?? 0) + 18}
                        className="fill-(--text-faint) font-mono text-[10px] uppercase tracking-[0.12em]"
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
        {legend.map((l) => (
          <span key={l.key} className="flex items-center gap-1.5">
            <span
              className="h-2 w-2 shrink-0 rounded-[2px]"
              style={{ background: l.fill }}
              aria-hidden="true"
            />
            <span className="font-mono font-semibold tabular-nums text-foreground">{l.value}</span>
            <span className="text-muted-foreground">{l.label}</span>
            <span className="font-mono text-[11px] text-(--text-faint)">
              {Math.round((l.value / total) * 100)}%
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
