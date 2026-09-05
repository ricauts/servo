import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { entitledDocumentIds } from "@/lib/kb/entitlement";
import Link from "next/link";
import { BookOpen, Lock, Settings2, Waypoints } from "lucide-react";
import EmptyState from "@/components/common/EmptyState";
import KbUpload from "@/components/kb/KbUpload";
import KbDocumentList from "@/components/kb/KbDocumentList";
import KbAdminPanel from "@/components/kb/KbAdminPanel";
import KbSearch from "@/components/kb/KbSearch";
import { BTN_OUTLINE, LABEL } from "@/components/kb/kb-controls";
import PageHeader from "@/components/shell/PageHeader";
import { stringList } from "@/lib/kb/library";
import { getEnrichSettings } from "@/lib/kb/enrich";

export const dynamic = "force-dynamic";

/** The Knowledge area (kb-16): the company's own documents, ACL-filtered
 *  through the same entitlement resolver retrieval uses. Requesters meet
 *  the KB only as cited answers — the nav entry is absent for them and the
 *  route denies (kb.view). */
export default async function KnowledgePage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string | string[] }>;
}) {
  const user = await getCurrentUser();
  // kb-lib-1: a keyword chip on a document page lands here pre-filtered.
  const params = (await searchParams) ?? {};
  const initialText = typeof params.q === "string" ? params.q.slice(0, 80) : "";
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
  const rows = await db.document.findMany({
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
      keywords: true,
      topics: true,
      aiSummary: true,
      collectionId: true,
      collection: { select: { name: true } },
    },
    orderBy: { updatedAt: "desc" },
  });
  // kb-lib-1: the library rows — keywords/topics as plain string[] (the
  // columns are Json) and the collection name flattened for the filter chips.
  const documents = rows.map(({ collection, keywords, topics, ...doc }) => ({
    ...doc,
    keywords: stringList(keywords),
    topics: stringList(topics),
    collectionName: collection?.name ?? null,
  }));
  // The collection filter lists every collection with at least one readable
  // document — the same scoping /api/kb/collections applies (kb-17).
  const filterCollections = Array.from(
    new Map(
      documents
        .filter((d) => d.collectionId && d.collectionName)
        .map((d) => [d.collectionId as string, { id: d.collectionId as string, name: d.collectionName as string }]),
    ).values(),
  ).sort((a, b) => a.name.localeCompare(b.name));
  const agentGrants = await db.kbGrant.count({ where: { subjectType: "AGENT" } });

  // The admin panel (kb-17): collections, embeddings with the query-egress
  // warning beside the field, auto-delivery toggles — kb.manage only.
  const manages = can(user, "kb.manage");
  let admin: React.ReactNode = null;
  if (manages) {
    const [settings, collections, health, fallbackQueue, enrich, enrichPending] = await Promise.all([
      db.setting.findMany({ where: { key: { startsWith: "kb." } } }),
      db.collection.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } } ),
      // dcl-09: the extractor health surface and the fallback queue.
      import("@/lib/kb/extractors/docling").then((m) => m.extractorHealth(db)),
      db.document.findMany({
        where: { extractorFallback: { not: null } },
        orderBy: { extractedAt: "asc" },
        select: { id: true, name: true, extractorFallback: true },
      }),
      // kb-lib-2: the enrichment switch and how many documents await it.
      getEnrichSettings(),
      db.document.count({ where: { textStatus: "EXTRACTED", kind: "FILE", enrichedAt: null } }),
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
          enrichEnabled: enrich.enabled,
          enrichAutoFile: enrich.autoFile,
          enrichPending,
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
      <PageHeader
        title="Knowledge"
        description="The company's own documents — manuals, spreadsheets, procedures — searchable by the desk's agents with citations back to the exact page, sheet or lines."
        actions={
          <>
            {manages && (
              <a href="#kb-admin" className={BTN_OUTLINE}>
                <Settings2 size={13} /> Admin
              </a>
            )}
            <Link href="/kb/graph" className={BTN_OUTLINE}>
              <Waypoints size={13} /> Graph
            </Link>
            {can(user, "kb.upload") && <KbUpload />}
          </>
        }
      />
      <div className="mx-auto w-full max-w-5xl px-4 py-6 md:px-6">
        {/* ext-08: search with the parse shown back as removable chips. */}
        <KbSearch />
        <KbDocumentList
          documents={documents}
          collections={filterCollections}
          anyAgentGrant={agentGrants > 0}
          initialText={initialText}
        />
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
          <section id="kb-audit" className="mt-6 scroll-mt-20 overflow-hidden rounded-lg border border-border bg-card">
            <h2 className={`${LABEL} border-b border-border bg-(--surface-2) px-4 py-2.5`}>
              Auto-delivered replies · audit
            </h2>
            <ul className="divide-y divide-border">
              {autoDelivered.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center gap-2 px-4 py-2 text-xs">
                  <span className="font-mono text-[10.5px] text-muted-foreground">#{d.ticket.number}</span> {/* no-hex-lint:allow */}
                  <Link href={`/tickets/${d.ticketId}`} className="min-w-0 flex-1 truncate font-medium underline-offset-2 hover:underline">
                    {d.ticket.title}
                  </Link>
                  <span className="font-mono text-[10.5px] text-muted-foreground">
                    sent {d.decidedAt?.toISOString().slice(0, 16).replace("T", " ")} UTC
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
