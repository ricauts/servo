import { Lock } from "lucide-react";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { groupInclude } from "@/lib/groups";
import PageHeader from "@/components/shell/PageHeader";
import EmptyState from "@/components/common/EmptyState";
import GroupsManager, {
  type GroupView,
  type MemberOption,
} from "@/components/groups/GroupsManager";

export const dynamic = "force-dynamic";

export default async function GroupsPage() {
  const user = await getCurrentUser();
  if (!can(user, "group.view")) {
    return (
      <>
        <PageHeader
          title="Groups"
          description="Assignment groups and escalation tiers."
        />
        <div className="p-4 md:p-8">
          <EmptyState
            icon={Lock}
            title="Agent access required"
            hint="Only admins and agents can see groups. Switch to an admin or agent user from the sidebar."
          />
        </div>
      </>
    );
  }

  const [groups, humans] = await Promise.all([
    db.group.findMany({ include: groupInclude, orderBy: { createdAt: "asc" } }),
    db.user.findMany({
      where: { role: { in: ["ADMIN", "AGENT"] } },
      orderBy: { name: "asc" },
      select: { id: true, name: true, color: true, role: true },
    }),
  ]);

  const groupViews: GroupView[] = groups.map((g) => ({
    id: g.id,
    name: g.name,
    description: g.description,
    categories: JSON.parse(g.categories) as string[],
    openTickets: g._count.tickets,
    members: g.members.map((m) => ({
      userId: m.user.id,
      name: m.user.name,
      color: m.user.color,
      seniority: m.seniority,
    })),
  }));

  const memberOptions: MemberOption[] = humans;

  return (
    <>
      <PageHeader
        title="Groups"
        description="Assignment groups with JUNIOR → MID → SENIOR escalation tiers. Triage routes tickets to the group that owns their category; priority sets the minimum tier."
      />
      <div className="p-4 md:p-8">
        <GroupsManager
          groups={groupViews}
          users={memberOptions}
          canManage={can(user, "group.manage")}
        />
      </div>
    </>
  );
}
