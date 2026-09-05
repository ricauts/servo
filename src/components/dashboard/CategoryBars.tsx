"use client";

import RankedBars from "@/components/dashboard/RankedBars";
import { SERIES } from "@/lib/chart-series";
import { CATEGORY_LABEL } from "@/lib/labels";
import type { Category } from "@/lib/types";

/** Open load by category: ranked, monochrome brand, zero categories hidden. */
export default function CategoryBars({
  data,
}: {
  data: { category: Category; count: number }[];
}) {
  const rows = data
    .filter((d) => d.count > 0)
    .sort((a, b) => b.count - a.count)
    .map((d) => ({ label: CATEGORY_LABEL[d.category], count: d.count }));

  return (
    <RankedBars
      rows={rows}
      valueLabel="Open"
      fill={SERIES.brand}
      yWidth={112}
      emptyText="No open tickets right now."
    />
  );
}
