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
import CategoryBars from "@/components/dashboard/CategoryBars";
import PriorityBars from "@/components/dashboard/PriorityBars";
import AiVsHumanBar from "@/components/dashboard/AiVsHumanBar";
import ApprovalsTile from "@/components/dashboard/ApprovalsTile";
import SkillsTile from "@/components/dashboard/SkillsTile";
import DraftRepliesTile from "@/components/dashboard/DraftRepliesTile";

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
  const { totals, approvalStats, draftStats, skills } = kpis;

  const aiResolved = kpis.aiVsHuman.find((r) => r.resolver === "AI")?.count ?? 0;
  const humanResolved =
    kpis.aiVsHuman.find((r) => r.resolver === "HUMAN")?.count ?? 0;

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Operational KPIs across tickets, agents and approvals — last 30 days."
      />
      <div className="grid grid-cols-12 gap-3 p-4 md:px-8 md:py-4 xl:h-[calc(100vh-97px)] xl:grid-rows-[auto_minmax(0,5fr)_minmax(0,4fr)] xl:overflow-hidden">
        {/* Stat tile row */}
        <div className="col-span-12 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
          <StatTile label="Open tickets" value={String(totals.open)} />
          <StatTile
            label="Resolved · 30d"
            value={String(totals.resolvedLast30d)}
          />
          <StatTile
            label="Avg first response"
            value={
              totals.avgFirstResponseMinutes === null
                ? "—"
                : String(totals.avgFirstResponseMinutes)
            }
            unit={totals.avgFirstResponseMinutes === null ? undefined : "min"}
          />
          <StatTile
            label="Avg resolution"
            value={
              totals.avgResolutionHours === null
                ? "—"
                : String(totals.avgResolutionHours)
            }
            unit={totals.avgResolutionHours === null ? undefined : "h"}
          />
          <StatTile
            label="AI resolution rate"
            value={String(Math.round(totals.aiResolutionRate * 100))}
            unit="%"
          />
          <StatTile
            label="Pending approvals"
            value={String(totals.pendingApprovals)}
            highlight={totals.pendingApprovals > 0}
          />
          <StatTile
            label="SLA breached"
            value={String(totals.slaBreached)}
            highlight={totals.slaBreached > 0}
            tone="critical"
          />
        </div>

        {/* Ticket flow */}
        <Card className="col-span-12 gap-3 px-5 py-4 xl:col-span-8 xl:min-h-0">
          <CardHeading>Ticket flow — last 30 days</CardHeading>
          <FlowChart data={kpis.createdByDay} />
        </Card>

        {/* Open load by category */}
        <Card className="col-span-12 gap-3 px-5 py-4 xl:col-span-4 xl:min-h-0">
          <CardHeading>Open load by category</CardHeading>
          <CategoryBars data={kpis.byCategory} />
        </Card>

        {/* By priority */}
        <Card className="col-span-12 gap-3 px-5 py-4 md:col-span-6 xl:col-span-3 xl:min-h-0">
          <CardHeading>By priority</CardHeading>
          <PriorityBars data={kpis.byPriority} />
        </Card>

        {/* AI vs human resolutions */}
        <Card className="col-span-12 gap-3 px-5 py-4 md:col-span-6 xl:col-span-4 xl:min-h-0">
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
        <Card className="col-span-12 gap-2 px-5 py-4 md:col-span-6 xl:col-span-2 xl:min-h-0">
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
