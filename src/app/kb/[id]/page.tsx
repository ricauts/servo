import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Download, Lock } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { entitledDocumentIds } from "@/lib/kb/entitlement";
import { relatedDocuments } from "@/lib/kb/graph";
import { statusCopy } from "@/components/kb/KbDocumentList";
import PageHeader from "@/components/shell/PageHeader";
import EmptyState from "@/components/legacy/EmptyState";

export const dynamic = "force-dynamic";

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
    },
  });
  if (!doc) notFound();

  const [chunks, related, agentReaders] = await Promise.all([
    db.documentChunk.findMany({
      where: { documentId: id },
      select: { id: true, index: true, text: true, locator: true },
      orderBy: { index: "asc" },
    }),
    relatedDocuments(db, { humanId: user.id, agentId: null }, id),
    db.kbGrant.count({ where: { subjectType: "AGENT" } }),
  ]);
  const status = statusCopy(doc);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 md:px-6">
      <Link href="/kb" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft size={13} /> Knowledge
      </Link>

      <div className="mt-3 flex flex-wrap items-center gap-2.5">
        <h1 className="font-heading text-[20px] font-bold tracking-tight">{doc.name}</h1>
        <span
          className="rounded-full border px-1.5 py-px font-mono text-[10.5px] leading-4"
          style={{ color: status.tone, borderColor: "var(--line)" }}
        >
          {status.label}
        </span>
        <span className="font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground">
          {doc.visibility} · {(doc.byteSize / 1024).toFixed(0)} KB · {doc.contentType}
        </span>
        <a
          href={`/api/kb/documents/${doc.id}/download`}
          className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 font-heading text-[12.5px] font-medium hover:bg-accent/40"
        >
          <Download size={13} /> Download
        </a>
      </div>
      {status.hint && <p className="mt-1.5 text-xs text-muted-foreground">{status.hint}</p>}
      {doc.summary && <p className="mt-2 max-w-3xl text-[13px] leading-relaxed text-muted-foreground">{doc.summary}</p>}

      {agentReaders === 0 && (
        <p
          className="mt-4 rounded-md border px-3 py-2 font-mono text-[11.5px]"
          style={{
            borderColor: "var(--warn-chip-line)",
            background: "var(--warn-chip)",
            color: "var(--warn-chip-ink)",
          }}
        >
          No agent can read this yet — agents search only what a grant gives
          them. This is deliberate: share the document to make it searchable.
        </p>
      )}

      <div className="mt-6 grid gap-6 md:grid-cols-[1fr_240px]">
        <div className="flex flex-col gap-2">
          <h2 className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
            Chunks · {chunks.length}
          </h2>
          {chunks.map((chunk) => (
            <article key={chunk.id} className="rounded-md border border-border bg-card p-3">
              <p className="font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground">
                {describeLocator(chunk.locator)}
              </p>
              <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed">{chunk.text}</p>
            </article>
          ))}
          {chunks.length === 0 && (
            <p className="text-xs text-muted-foreground">
              No indexed text — see the status above.
            </p>
          )}
        </div>

        <aside className="flex flex-col gap-2">
          <h2 className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
            Related files
          </h2>
          {related.map((r) => (
            <Link
              key={r.id}
              href={`/kb/${r.id}`}
              className="rounded-md border border-border bg-card px-3 py-2 transition-colors hover:bg-accent/40"
            >
              <p className="truncate font-heading text-[13px] font-medium">{r.name}</p>
              <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                {r.kind.replaceAll("_", " ").toLowerCase()} · {r.weight.toFixed(2)}
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
