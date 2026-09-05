"use client";

import RankedBars from "@/components/dashboard/RankedBars";
import { PRIORITY_SERIES, SERIES } from "@/lib/chart-series";
import { PRIORITY_LABEL } from "@/lib/labels";
import { PRIORITIES, type Priority } from "@/lib/types";

/**
 * Open load by priority: the fixed severity ladder, Urgent first, zeros
 * included so the shape is stable, each rung in its status colour.
 */
export default function PriorityBars({
  data,
}: {
  data: { priority: Priority; count: number }[];
}) {
  const rows = [...PRIORITIES].reverse().map((p) => ({
    label: PRIORITY_LABEL[p],
    count: data.find((d) => d.priority === p)?.count ?? 0,
    fill: PRIORITY_SERIES[p],
  }));

  return (
    <RankedBars
      rows={rows}
      valueLabel="Open"
      fill={SERIES.brand}
      yWidth={60}
      emptyText="No open tickets right now."
    />
  );
}
