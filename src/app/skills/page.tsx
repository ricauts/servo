import { Lock } from "lucide-react";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { parseCategories } from "@/lib/skills";
import PageHeader from "@/components/shell/PageHeader";
import EmptyState from "@/components/legacy/EmptyState";
import SkillsManager, { type SkillView } from "@/components/skills/SkillsManager";
import { distillPrefill, resolutionOfRecord } from "@/lib/skill-distill";

export const dynamic = "force-dynamic";

export default async function SkillsPage({
  searchParams,
}: {
  searchParams: Promise<{ distill?: string }>;
}) {
  const user = await getCurrentUser();
  if (!can(user, "skills.view")) {
    return (
      <>
        <PageHeader
          title="Skills"
          description="Procedures the desk has agreed to follow, defined as .md documents."
        />
        <div className="p-4 md:p-8">
          <EmptyState
            icon={Lock}
            title="Agent access required"
            hint="Only admins and agents can see the desk's skills. Switch users from the sidebar."
          />
        </div>
      </>
    );
  }

  const rows = await db.skill.findMany({ orderBy: { createdAt: "asc" } });
  const sourceIds = [...new Set(rows.map((s) => s.sourceTicketId).filter((v): v is string => v !== null))];
  const sourceTickets = await db.ticket.findMany({
    where: { id: { in: sourceIds } },
    select: { id: true, number: true },
  });
  const ticketNumberById = new Map(sourceTickets.map((t) => [t.id, t.number]));
  const skills: SkillView[] = rows.map((s) => ({
    id: s.id,
    slug: s.slug,
    name: s.name,
    description: s.description,
    categories: parseCategories(s.categories),
    markdown: s.markdown,
    enabled: s.enabled,
    sourceTicketId: s.sourceTicketId,
    sourceTicketNumber: s.sourceTicketId ? ticketNumberById.get(s.sourceTicketId) ?? null : null,
  }));

  // ?distill=<ticketId>: open the editor with the DETERMINISTIC prefill —
  // title → name, [category], the recorded resolution as the scaffold
  // (reb-05). No model call; the created skill lands disabled server-side.
  const params = await searchParams;
  let prefillMarkdown: string | null = null;
  let prefillSourceTicketId: string | null = null;
  if (params.distill && can(user, "skills.manage")) {
    const ticket = await db.ticket.findUnique({
      where: { id: params.distill },
      include: { runs: { select: { kind: true, status: true, summary: true } } },
    });
    if (ticket && (ticket.status === "RESOLVED" || ticket.status === "CLOSED")) {
      prefillSourceTicketId = ticket.id;
      prefillMarkdown = distillPrefill({
        number: ticket.number,
        title: ticket.title,
        category: ticket.category,
        runSummary: resolutionOfRecord(ticket.runs),
      });
    }
  }

  return (
    <>
      <PageHeader
        title="Skills"
        description="What the desk has decided to always do. Each skill is Markdown with frontmatter (name, description, categories); resolvers see only the name and description, and load the body with read_skill when a ticket calls for it. QA reviews the run against the skills that applied."
      />
      <div className="space-y-4 p-4 md:p-8">
        <SkillsManager
          skills={skills}
          canManage={can(user, "skills.manage")}
          prefillMarkdown={prefillMarkdown}
          prefillSourceTicketId={prefillSourceTicketId}
        />
      </div>
    </>
  );
}
