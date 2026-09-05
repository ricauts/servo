import Link from "next/link";
import { ArrowLeft, Lock } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import EmptyState from "@/components/common/EmptyState";
import PageHeader from "@/components/shell/PageHeader";
import KbGraph from "@/components/kb/KbGraph";
import { BTN_OUTLINE } from "@/components/kb/kb-controls";

export const dynamic = "force-dynamic";

/** The knowledge graph page (kb-lib-3). The same route gate as the list:
 *  requesters meet the KB only as cited answers. The data arrives from
 *  /api/kb/graph, already entitlement-filtered. */
export default async function KnowledgeGraphPage() {
  const user = await getCurrentUser();
  if (!can(user, "kb.view")) {
    return (
      <>
        <PageHeader title="Knowledge graph" description="How the company's documents relate." />
        <div className="p-4 md:p-8">
          <EmptyState icon={Lock} title="Agent access required" hint="Only admins and agents can browse the knowledge base." />
        </div>
      </>
    );
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="Knowledge graph"
        description="Every document you can read, the shelf it sits on, and what links it to the others — shared names, keywords and facts. Search highlights; click a node for its details; hover a link for what it shares."
        actions={
          <Link href="/kb" className={BTN_OUTLINE}>
            <ArrowLeft size={13} /> Library
          </Link>
        }
      />
      <div className="min-h-0 flex-1 p-4 md:p-6">
        <KbGraph />
      </div>
    </div>
  );
}
