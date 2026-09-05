import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Download, FolderOpen, Lock } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { entitledDocumentIds } from "@/lib/kb/entitlement";
import { relatedDocuments } from "@/lib/kb/graph";
import { statusCopy, stringList } from "@/lib/kb/library";
import { canAdministerDocument } from "@/lib/kb/grants";
import { getEnrichSettings } from "@/lib/kb/enrich";
import KbDocumentFiling from "@/components/kb/KbDocumentFiling";
import KbSharePanel from "@/components/kb/KbSharePanel";
import KbReextractButton from "@/components/kb/KbReextractButton";
import KbFactChips from "@/components/kb/KbFactChips";
import KbChunkList from "@/components/kb/KbChunkList";
import { Chip, chipClass, textStatusTone, visibilityTone, type ChipTone } from "@/components/kb/KbChip";
import { BTN_OUTLINE, LABEL, NOTE_WARN } from "@/components/kb/kb-controls";
import PageHeader from "@/components/shell/PageHeader";
import EmptyState from "@/components/common/EmptyState";

export const dynamic = "force-dynamic";

/** The graph's edge kinds → the chip tone the related-files list uses; the
 *  same mapping the graph page draws its links with. */
const RELATED_TONE: Record<string, ChipTone> = {
  SHARED_ENTITY: "brand",
  SHARED_FACT: "warn",
  SHARED_KEYWORD: "neutral",
  SAME_COLLECTION: "neutral",
};

function kb(size: number): string {
  return size > 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(size / 1024))} KB`;
}

/** Document detail (kb-16): chunk locators, the ACL-filtered related-files
 *  panel, and download. The anchor id resolves through the same entitlement
 *  oracle as retrieval — a non-entitled id is a 404, not a hint. */
export default async function KbDocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!can(user, "kb.view")) {
    return (
      <>
        <PageHeader title="Knowledge" description="The company's own documents." />
        <div className="p-4 md:p-8">
          <EmptyState icon={Lock} title="Agent access required" hint="Only admins and agents can browse the knowledge base." />
        </div>
      </>
    );
  }

  const { id } = await params;
  const readable = await entitledDocumentIds(db, { humanId: user.id, agentId: null });
  if (!readable.includes(id)) notFound();

  const doc = await db.document.findUnique({
    where: { id },
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
      ownerId: true,
      kind: true,
      keywords: true,
      topics: true,
      aiSummary: true,
      enrichedAt: true,
      enrichModel: true,
      collectionId: true,
      collection: { select: { name: true } },
      extractor: true,
      extractorVersion: true,
      extractorFallback: true,
      extractedAt: true,
    },
  });
  if (!doc) notFound();

  const canFile = doc.kind !== "CATALOG" && (can(user, "kb.manage") || (await canAdministerDocument(user.id, id)));
  const [chunks, related, agentReaders, collections, enrich] = await Promise.all([
    db.documentChunk.findMany({
      where: { documentId: id },
      select: { id: true, index: true, text: true, locator: true },
      orderBy: { index: "asc" },
    }),
    relatedDocuments(db, { humanId: user.id, agentId: null }, id),
    db.kbGrant.count({ where: { subjectType: "AGENT" } }),
    canFile ? db.collection.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }) : [],
    canFile ? getEnrichSettings() : null,
  ]);
  const status = statusCopy(doc);
  const keywords = stringList(doc.keywords);
  const topics = stringList(doc.topics);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 md:px-6">
      <Link href="/kb" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft size={13} /> Knowledge
      </Link>

      {/* The title band: name, then the document's state as chips. */}
      <div className="mt-3 flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="break-words font-heading text-[22px] font-bold tracking-tight">{doc.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Chip tone={textStatusTone(doc.textStatus)} caps>{status.label}</Chip>
            <Chip tone={visibilityTone(doc.visibility)} caps>{doc.visibility}</Chip>
            {doc.collection ? (
              <Chip tone="neutral" icon={<FolderOpen size={11} />} title="Shelf">{doc.collection.name}</Chip>
            ) : (
              <Chip tone="neutral">uncategorized</Chip>
            )}
            {doc.kind === "CATALOG" && <Chip tone="info" caps className="border-dashed">catalog card</Chip>}
            <span className="font-mono text-[10.5px] text-muted-foreground">
              {kb(doc.byteSize)} · {doc.contentType} · updated {doc.updatedAt.toISOString().slice(0, 10)}
            </span>
          </div>
        </div>
        <a href={`/api/kb/documents/${doc.id}/download`} className={BTN_OUTLINE}>
          <Download size={13} /> Download
        </a>
      </div>
      {status.hint && <p className="mt-2 text-xs text-muted-foreground">{status.hint}</p>}
      {/* kb-lib-2: the model's summary when there is one, the deterministic
          extract otherwise — never both, never blended. */}
      {doc.aiSummary ? (
        <p className="mt-3 max-w-3xl text-[13.5px] leading-relaxed" title={`Written by ${doc.enrichModel}`}>{doc.aiSummary}</p>
      ) : (
        doc.summary && <p className="mt-3 max-w-3xl text-[13.5px] leading-relaxed text-muted-foreground">{doc.summary}</p>
      )}

      {/* kb-lib-1: the document-level keyword profile. Chips link back to the
          library pre-filtered on that keyword; topics (kb-lib-2) come first
          when the model wrote any. */}
      {(keywords.length > 0 || topics.length > 0) && (
        <div className="mt-3 flex flex-wrap items-center gap-1" aria-label="Keywords">
          {topics.map((t) => (
            <Link
              key={`t:${t}`}
              href={`/kb?q=${encodeURIComponent(t)}`}
              className={`${chipClass("brand", { face: "ui" })} hover:border-(--brand)`}
              title={`Find documents about "${t}"`}
            >
              {t}
            </Link>
          ))}
          {keywords.map((k) => (
            <Link
              key={k}
              href={`/kb?q=${encodeURIComponent(k)}`}
              className={`${chipClass("neutral")} hover:border-(--line-strong)`}
              title={`Find documents with "${k}"`}
            >
              {k}
            </Link>
          ))}
        </div>
      )}

      {/* dcl-09: extractor provenance — NEVER a silent baseline. */}
      <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs">
        <span className={LABEL}>Extractor</span>
        <span className="font-mono text-[11px]">{doc.extractor || "baseline"}{doc.extractorVersion ? ` · ${doc.extractorVersion}` : ""}</span>
        {doc.extractorFallback ? (
          <>
            <Chip tone="warn" caps>fallback</Chip>
            <span className="text-muted-foreground">
              Baseline extraction — the high-fidelity extractor was unavailable ({doc.extractorFallback}).
            </span>
          </>
        ) : null}
        {(can(user, "kb.manage") || doc.ownerId === user.id) && doc.textStatus !== "EXTRACTING" && (
          <KbReextractButton documentId={doc.id} />
        )}
      </div>
      {canFile && enrich && (
        <KbDocumentFiling
          documentId={doc.id}
          collectionId={doc.collectionId}
          visibility={doc.visibility}
          collections={collections}
          enrichment={{ enabled: enrich.enabled, enrichedAt: doc.enrichedAt?.toISOString() ?? null, model: doc.enrichModel }}
        />
      )}
      {can(user, "kb.share") && <KbSharePanel documentId={doc.id} />}

      {agentReaders === 0 && (
        <p className={`${NOTE_WARN} mt-4`}>
          No agent can read this yet — agents search only what a grant gives
          them. This is deliberate: share the document to make it searchable.
        </p>
      )}

      {/* ext-08: the typed values this document's text carried, as chips that
          link to the chunk and offset they were read from. A document with no
          facts renders NOTHING here — absence is the ordinary case on prose. */}
      <KbFactChips documentId={doc.id} />

      <div className="mt-6 grid gap-6 md:grid-cols-[minmax(0,1fr)_260px]">
        <KbChunkList
          chunks={chunks.map((chunk) => ({ id: chunk.id, index: chunk.index, text: chunk.text, locator: describeLocator(chunk.locator) }))}
        />

        {/* Related files stay in view while the chunks scroll past. */}
        <aside className="flex flex-col gap-2 md:sticky md:top-20 md:self-start">
          <h2 className={LABEL}>Related files · {related.length}</h2>
          {related.map((r) => (
            <Link
              key={r.id}
              href={`/kb/${r.id}`}
              className="rounded-lg border border-border bg-card px-3 py-2 transition-colors hover:border-(--line-strong)"
            >
              <p className="truncate font-heading text-[13px] font-medium">{r.name}</p>
              <p className="mt-1 flex items-center gap-1.5">
                <Chip tone={RELATED_TONE[r.kind] ?? "neutral"} caps>{r.kind.replaceAll("_", " ").toLowerCase()}</Chip>
                <span className="font-mono text-[10.5px] text-muted-foreground">{r.weight.toFixed(2)}</span>
              </p>
            </Link>
          ))}
          {related.length === 0 && (
            <p className="text-xs text-muted-foreground">
              No related files you can read.
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}

function describeLocator(locator: unknown): string {
  if (typeof locator !== "object" || locator === null) return "chunk";
  const l = locator as Record<string, unknown>;
  if (typeof l.sheet === "string") return `sheet ${l.sheet}${l.range ? ` · ${l.range}` : ""}`;
  if (typeof l.page === "number") return `page ${l.page}`;
  if (typeof l.lines === "string") return `lines ${l.lines}`;
  return "chunk";
}
