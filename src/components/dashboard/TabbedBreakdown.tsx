"use client";

import { useState } from "react";
import CardHeading from "@/components/dashboard/CardHeading";
import CategoryBars from "@/components/dashboard/CategoryBars";
import MonoTabs from "@/components/dashboard/MonoTabs";
import PriorityBars from "@/components/dashboard/PriorityBars";
import RankedBars from "@/components/dashboard/RankedBars";
import { SERIES } from "@/lib/chart-series";
import type { KpiResponse } from "@/lib/types";

const TABS = [
  { id: "category", label: "Category", heading: "Open load by category" },
  { id: "priority", label: "Priority", heading: "Open load by priority" },
  { id: "requesters", label: "Requesters", heading: "Top requesters — 30d" },
] as const;

type TabId = (typeof TABS)[number]["id"];

function shortName(name: string): string {
  return name.length > 16 ? `${name.slice(0, 15)}…` : name;
}

/**
 * One card, three breakdowns: the open load by category and by priority,
 * and who is filing the most tickets. Tabs are local state — the page stays
 * a single route.
 */
export default function TabbedBreakdown({
  byCategory,
  byPriority,
  topRequesters,
}: Pick<KpiResponse, "byCategory" | "byPriority" | "topRequesters">) {
  const [tab, setTab] = useState<TabId>("category");
  const heading = TABS.find((t) => t.id === tab)?.heading ?? "";

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <CardHeading>{heading}</CardHeading>
        <MonoTabs tabs={TABS} value={tab} onChange={(id) => setTab(id as TabId)} label="Breakdown" />
      </div>
      <div
        role="tabpanel"
        id={`panel-${tab}`}
        aria-labelledby={`tab-${tab}`}
        className="min-h-0 xl:flex-1"
      >
        {tab === "category" && <CategoryBars data={byCategory} />}
        {tab === "priority" && <PriorityBars data={byPriority} />}
        {tab === "requesters" && (
          <RankedBars
            rows={topRequesters.map((r) => ({ label: shortName(r.name), count: r.count }))}
            valueLabel="Created"
            fill={SERIES.brand}
            yWidth={104}
            emptyText="No tickets created in the last 30 days."
          />
        )}
      </div>
    </>
  );
}
