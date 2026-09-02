// /runs — the runs console (spec ux-05): a read-only, cross-ticket monitor
// of agent activity for admins and desk agents. The first paint renders
// server-side through the same listRuns query GET /api/runs serves, so the
// console and its API can never disagree about what a run is.

import { Lock } from "lucide-react";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import PageHeader from "@/components/shell/PageHeader";
import EmptyState from "@/components/common/EmptyState";
import RunsManager from "@/components/runs/RunsManager";
import { listRuns } from "@/lib/runs-views";

export const dynamic = "force-dynamic";

export default async function RunsPage() {
  const user = await getCurrentUser();
  if (!can(user, "agents.view")) {
    return (
      <>
        <PageHeader
          title="Runs"
          description="Every agent run across every ticket, with its full step trace."
        />
        <div className="p-4 md:p-8">
          <EmptyState
            icon={Lock}
            title="Agent access required"
            hint="Only admins and agents can monitor agent runs. Switch users from the sidebar."
          />
        </div>
      </>
    );
  }

  const runs = await listRuns();
  return (
    <>
      <PageHeader
        title="Runs"
        description="Every agent run across every ticket — summary, steps and raw tool calls, read-only."
      />
      <RunsManager initialRuns={runs} />
    </>
  );
}
