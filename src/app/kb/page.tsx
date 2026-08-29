import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { entitledDocumentIds } from "@/lib/kb/entitlement";
import { BookOpen, Lock } from "lucide-react";
import EmptyState from "@/components/legacy/EmptyState";
import KbUpload from "@/components/kb/KbUpload";
import KbDocumentList from "@/components/kb/KbDocumentList";
import PageHeader from "@/components/shell/PageHeader";

export const dynamic = "force-dynamic";

/** The Knowledge area (kb-16): the company's own documents, ACL-filtered
 *  through the same entitlement resolver retrieval uses. Requesters meet
 *  the KB only as cited answers — the nav entry is absent for them and the
 *  route denies (kb.view). */
export default async function KnowledgePage() {
  const user = await getCurrentUser();
  if (!can(user, "kb.view")) {
    // The route-level EmptyState (the nav entry is already absent for this
    // role); the API routes answer 403 — asserted in kb-ui-permissions.
    return (
      <>
        <PageHeader title="Knowledge" description="The company's own documents." />
        <div className="p-4 md:p-8">
          <EmptyState
            icon={Lock}
            title="Agent access required"
            hint="Only admins and agents can browse the knowledge base. Requesters meet it as cited answers."
          />
        </div>
      </>
    );
  }

  const ids = await entitledDocumentIds(db, { humanId: user.id, agentId: null });
  const documents = await db.document.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      name: true,
      contentType: true,
      byteSize: true,
      textStatus: true,
      textError: true,
      summary: true,
      visibility: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: "desc" },
  });
  const agentGrants = await db.kbGrant.count({ where: { subjectType: "AGENT" } });

  return (
    <div>
      <PageHeader title="Knowledge" description="The company's own documents — manuals, spreadsheets, procedures — searchable by the desk's agents with citations back to the exact page, sheet or lines." />
      <div className="mx-auto w-full max-w-5xl px-4 py-6 md:px-6">
      {can(user, "kb.upload") && <KbUpload />}
      <KbDocumentList documents={documents} anyAgentGrant={agentGrants > 0} />
      {documents.length === 0 && (
        <div className="mt-6">
        <EmptyState
          icon={BookOpen}
          title="No documents yet"
          hint="Upload a manual or spreadsheet; agents can only search what someone shared with them."
        />
        </div>
      )}
      </div>
    </div>
  );
}
