import { Lock } from "lucide-react";
import { Card } from "@/components/ui/card";
import EmptyState from "@/components/common/EmptyState";
import PageHeader from "@/components/shell/PageHeader";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getKpis } from "@/lib/tickets";
import type { KpiResponse } from "@/lib/types";
import CardHeading from "@/components/dashboard/CardHeading";
import StatTile from "@/components/dashboard/StatTile";
import FlowChart from "@/components/dashboard/FlowChart";
import TabbedBreakdown from "@/components/dashboard/TabbedBreakdown";
import AiVsHumanBar from "@/components/dashboard/AiVsHumanBar";
import ApprovalsTile from "@/components/dashboard/ApprovalsTile";
import SkillsTile from "@/components/dashboard/SkillsTile";
import DraftRepliesTile from "@/components/dashboard/DraftRepliesTile";
import { kpiDelta } from "@/components/dashboard/kpi-delta";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await getCurrentUser();

  if (!can(user, "kpi.view")) {
    return (
      <>
        <PageHeader
          title="Dashboard"
          description="Operational KPIs across tickets, agents and approvals."
        />
        <div className="p-4 md:p-8">
          <EmptyState
            icon={Lock}
            title="KPIs are restricted"
            hint="Only admins and agents can view the dashboard. Switch to an admin or agent user from the sidebar."
          />
        </div>
      </>
    );
  }

  const kpis: KpiResponse = await getKpis();
  const { totals, previous, approvalStats, draftStats, skills } = kpis;

  const aiResolved = kpis.aiVsHuman.find((r) => r.resolver === "AI")?.count ?? 0;
  const humanResolved =
    kpis.aiVsHuman.find((r) => r.resolver === "HUMAN")?.count ?? 0;

  // Sparklines read the last two weeks of the daily series.
  const last14 = kpis.createdByDay.slice(-14);

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Operational KPIs across tickets, agents and approvals — last 30 days."
      />
      {/* One viewport at xl when it fits; the board scrolls rather than clips
          when the rows' floors need more height than the window has. */}
      <div className="grid grid-cols-12 gap-3 p-4 md:px-8 md:py-4 xl:h-[calc(100vh-97px)] xl:grid-rows-[auto_minmax(260px,5fr)_minmax(224px,4fr)] xl:overflow-y-auto">
        {/* KPI tile row */}
        <div className="col-span-12 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
          <StatTile
            label="Open tickets"
            value={String(totals.open)}
            caption={`${totals.createdLast30d} created · 30d`}
            sparkline={last14.map((p) => p.created)}
            sparklineLabel="New tickets per day, last 14 days"
          />
          <StatTile
            label="Resolved · 30d"
            value={String(totals.resolvedLast30d)}
            delta={kpiDelta(totals.resolvedLast30d, previous.resolved, { kind: "count", better: "up" })}
            sparkline={last14.map((p) => p.resolved)}
            sparklineLabel="Resolved per day, last 14 days"
          />
          <StatTile
            label="Avg first response"
            value={
              totals.avgFirstResponseMinutes === null
                ? "—"
                : String(totals.avgFirstResponseMinutes)
            }
            unit={totals.avgFirstResponseMinutes === null ? undefined : "min"}
            delta={kpiDelta(totals.avgFirstResponseMinutes, previous.avgFirstResponseMinutes, {
              kind: "duration",
              better: "down",
              unit: "min",
            })}
            caption="no responses yet"
          />
          <StatTile
            label="Avg resolution"
            value={
              totals.avgResolutionHours === null
                ? "—"
                : String(totals.avgResolutionHours)
            }
            unit={totals.avgResolutionHours === null ? undefined : "h"}
            delta={kpiDelta(totals.avgResolutionHours, previous.avgResolutionHours, {
              kind: "duration",
              better: "down",
              unit: "h",
            })}
            caption="nothing resolved yet"
          />
          <StatTile
            label="AI resolution rate"
            value={String(Math.round(totals.aiResolutionRate * 100))}
            unit="%"
            delta={kpiDelta(totals.aiResolutionRate, previous.aiResolutionRate, { kind: "rate", better: "up" })}
            sparkline={last14.map((p) => p.resolvedAi)}
            sparklineLabel="Resolved by AI per day, last 14 days"
          />
          <StatTile
            label="Pending approvals"
            value={String(totals.pendingApprovals)}
            highlight={totals.pendingApprovals > 0}
            caption={totals.pendingApprovals > 0 ? "waiting on a person" : "nothing waiting"}
          />
          <StatTile
            label="SLA breached"
            value={String(totals.slaBreached)}
            highlight={totals.slaBreached > 0}
            tone="critical"
            caption={totals.slaBreached > 0 ? "open, past target" : "all within target"}
          />
        </div>

        {/* Ticket flow / resolutions by resolver */}
        <Card className="col-span-12 gap-3 px-5 py-4 xl:col-span-8 xl:min-h-0">
          <FlowChart data={kpis.createdByDay} />
        </Card>

        {/* Open load by category / priority, top requesters */}
        <Card className="col-span-12 gap-3 px-5 py-4 xl:col-span-4 xl:min-h-0">
          <TabbedBreakdown
            byCategory={kpis.byCategory}
            byPriority={kpis.byPriority}
            topRequesters={kpis.topRequesters}
          />
        </Card>

        {/* AI vs human resolutions */}
        <Card className="col-span-12 gap-3 px-5 py-4 md:col-span-6 xl:col-span-3 xl:min-h-0">
          <CardHeading>AI vs human resolutions — 30d</CardHeading>
          <AiVsHumanBar ai={aiResolved} human={humanResolved} />
        </Card>

        {/* AI reply drafts mini-tile */}
        <Card className="col-span-12 gap-2 px-5 py-4 md:col-span-6 xl:col-span-3 xl:min-h-0">
          <CardHeading>AI replies — 30d</CardHeading>
          <DraftRepliesTile
            pending={draftStats.pending}
            sentAsIs={draftStats.sentAsIs}
            edited={draftStats.edited}
            discarded={draftStats.discarded}
          />
        </Card>

        {/* Approvals mini-tile */}
        <Card className="col-span-12 gap-2 px-5 py-4 md:col-span-6 xl:col-span-3 xl:min-h-0">
          <CardHeading>Approvals</CardHeading>
          <ApprovalsTile
            approved={approvalStats.approved}
            rejected={approvalStats.rejected}
            pending={approvalStats.pending}
          />
        </Card>

        {/* Skills row (reb-06): informed runs, distilled skills, coverage.
            null renders "n/a" — a zero-run or zero-skill install must never
            show NaN. */}
        <Card className="col-span-12 gap-2 px-5 py-4 md:col-span-6 xl:col-span-3 xl:min-h-0">
          <CardHeading>Skills — 30d</CardHeading>
          <SkillsTile skills={skills} />
        </Card>
      </div>
    </>
  );
}
