import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { entitledDocumentIds } from "@/lib/kb/entitlement";
import Link from "next/link";
import { BookOpen, Lock } from "lucide-react";
import EmptyState from "@/components/legacy/EmptyState";
import KbUpload from "@/components/kb/KbUpload";
import KbDocumentList from "@/components/kb/KbDocumentList";
import KbAdminPanel from "@/components/kb/KbAdminPanel";
import KbSearch from "@/components/kb/KbSearch";
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

  // The admin panel (kb-17): collections, embeddings with the query-egress
  // warning beside the field, auto-delivery toggles — kb.manage only.
  let admin: React.ReactNode = null;
  if (can(user, "kb.manage")) {
    const [settings, collections, health, fallbackQueue] = await Promise.all([
      db.setting.findMany({ where: { key: { startsWith: "kb." } } }),
      db.collection.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } } ),
      // dcl-09: the extractor health surface and the fallback queue.
      import("@/lib/kb/extractors/docling").then((m) => m.extractorHealth(db)),
      db.document.findMany({
        where: { extractorFallback: { not: null } },
        orderBy: { extractedAt: "asc" },
        select: { id: true, name: true, extractorFallback: true },
      }),
    ]);
    const map = new Map(settings.map((s) => [s.key, s.value]));
    const autodeliverCategories = settings
      .filter((s) => s.key.startsWith("kb.autodeliver.") && s.key !== "kb.autodeliver.dailyCap" && s.value === "true")
      .map((s) => s.key.slice("kb.autodeliver.".length));
    admin = (
      <KbAdminPanel
        settings={{
          embedBaseUrl: map.get("kb.embed.baseUrl") ?? "",
          embedModel: map.get("kb.embed.model") ?? "",
          embedDimensions: map.get("kb.embed.dimensions") ?? "",
          autodeliverCategories,
          dailyCap: map.get("kb.autodeliver.dailyCap") ?? "",
        }}
        collections={collections}
        extractorHealth={health}
        fallbackQueue={fallbackQueue.map((q) => ({ ...q, extractorFallback: q.extractorFallback ?? "" }))}
      />
    );
  }

  // The audit view (kb-17): auto-delivered replies, always visible after
  // the fact — full timeline/webhook parity shipped with kb-14.
  const autoDelivered = await db.replyDraft.findMany({
    where: { status: "SENT", autoDelivered: true },
    include: { ticket: { select: { number: true, title: true } } },
    orderBy: { decidedAt: "desc" },
    take: 10,
  });

  return (
    <div>
      <PageHeader title="Knowledge" description="The company's own documents — manuals, spreadsheets, procedures — searchable by the desk's agents with citations back to the exact page, sheet or lines." />
      <div className="mx-auto w-full max-w-5xl px-4 py-6 md:px-6">
      {can(user, "kb.upload") && <KbUpload />}
      {/* ext-08: search with the parse shown back as removable chips. */}
      <KbSearch />
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
        {admin}

        {autoDelivered.length > 0 && (
          <section className="mt-6 rounded-md border border-border bg-card p-4">
            <h2 className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
              Auto-delivered replies · audit
            </h2>
            <ul className="mt-2 flex flex-col gap-1.5">
              {autoDelivered.map((d) => (
                <li key={d.id} className="text-xs text-muted-foreground">
                  <span className="font-mono">#{d.ticket.number}</span>{" "}
                  <Link href={`/tickets/${d.ticketId}`} className="underline-offset-2 hover:underline">
                    {d.ticket.title}
                  </Link>{" "}
                  · sent {d.decidedAt?.toISOString().slice(0, 16).replace("T", " ")} UTC
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
