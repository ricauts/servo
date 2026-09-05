"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { FileText, FolderOpen, Search, X } from "lucide-react";
import {
  filterDocuments,
  statusCopy,
  UNCATEGORIZED,
  VISIBILITY_FILTERS,
  type KbCollectionOption,
  type KbDocumentRow,
  type VisibilityFilter,
} from "@/lib/kb/library";
import { Chip, chipClass, textStatusTone, visibilityTone } from "@/components/kb/KbChip";
import { BTN_OUTLINE, BTN_OUTLINE_SM, INPUT, NOTE_WARN, SEGMENT_GROUP, SELECT, segmentClass } from "@/components/kb/kb-controls";

export type { KbCollectionOption, KbDocumentRow } from "@/lib/kb/library";

function kb(size: number): string {
  return size > 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(size / 1024))} KB`;
}

/** How many chips one card row carries before "+N" — topics first, then
 *  keywords, one row and no more. */
const ROW_CHIPS = 6;

/** Cards per page before "Show more": a library of hundreds stays a page
 *  of thirty, and the filters above narrow it before anyone scrolls. */
const PAGE = 30;

export default function KbDocumentList({
  documents,
  collections,
  anyAgentGrant,
  initialText = "",
}: {
  documents: KbDocumentRow[];
  collections: KbCollectionOption[];
  /** Drives the deliberate "dark to automation" empty state (spec kb-16). */
  anyAgentGrant: boolean;
  /** The `?q=` a keyword chip on a document page arrives with. */
  initialText?: string;
}) {
  const [text, setText] = useState(initialText);
  const [visibility, setVisibility] = useState<VisibilityFilter>("ALL");
  const [collection, setCollection] = useState<string>("ALL");
  const [limit, setLimit] = useState(PAGE);

  const visible = useMemo(
    () => filterDocuments(documents, { text, visibility, collection }),
    [documents, text, visibility, collection],
  );
  const counts = useMemo(() => {
    const byVisibility = new Map<string, number>();
    for (const d of documents) byVisibility.set(d.visibility, (byVisibility.get(d.visibility) ?? 0) + 1);
    return byVisibility;
  }, [documents]);
  const filtering = text.trim() !== "" || visibility !== "ALL" || collection !== "ALL";
  const needle = text.trim().toLowerCase();
  const shownRows = visible.slice(0, limit);

  function clearFilters() {
    setText("");
    setVisibility("ALL");
    setCollection("ALL");
  }

  return (
    <div className="mt-6 flex flex-col gap-2" id="kb-library">
      {!anyAgentGrant && documents.length > 0 && (
        <p className={NOTE_WARN}>
          No agent can read anything here yet — a fresh knowledge base is dark
          to automation by design. Share a document with an agent to light it up.
        </p>
      )}

      {/* kb-lib-1: the library toolbar — one 32px row: text, visibility, collection, count. */}
      {documents.length > 0 && (
        <div className="flex flex-wrap items-center gap-2" data-testid="kb-library-filters">
          <div className="relative min-w-[220px] flex-1">
            <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Filter by name, topic or keyword"
              aria-label="Filter documents by name or keyword"
              className={`${INPUT} pl-7 pr-7`}
            />
            {text && (
              <button
                type="button"
                aria-label="Clear text filter"
                onClick={() => setText("")}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
              >
                <X size={12} />
              </button>
            )}
          </div>
          <div role="group" aria-label="Visibility" className={SEGMENT_GROUP}>
            {VISIBILITY_FILTERS.map((v) => {
              const active = visibility === v;
              const n = v === "ALL" ? documents.length : (counts.get(v) ?? 0);
              return (
                <button key={v} type="button" aria-pressed={active} onClick={() => setVisibility(v)} className={segmentClass(active)}>
                  {v === "ALL" ? "All" : v.toLowerCase()} <span className={active ? "text-muted-foreground" : "text-(--text-faint)"}>{n}</span>
                </button>
              );
            })}
          </div>
          <select value={collection} onChange={(e) => setCollection(e.target.value)} aria-label="Collection" className={SELECT}>
            <option value="ALL">All collections</option>
            <option value={UNCATEGORIZED}>Uncategorized</option>
            {collections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <span className="font-mono text-[10.5px] text-muted-foreground">
            {filtering ? `${visible.length} of ${documents.length}` : `${documents.length} document${documents.length === 1 ? "" : "s"}`}
          </span>
          {filtering && (
            <button type="button" onClick={clearFilters} className={BTN_OUTLINE}>
              Clear
            </button>
          )}
        </div>
      )}

      {shownRows.map((doc) => {
        const status = statusCopy(doc);
        // kb-lib-2: topics first (model-written, Title Case), then the
        // deterministic keywords — one row of ROW_CHIPS, the rest as a count.
        const chips = [
          ...doc.topics.map((value) => ({ kind: "topic" as const, value })),
          ...doc.keywords.map((value) => ({ kind: "keyword" as const, value })),
        ];
        const shown = chips.slice(0, ROW_CHIPS);
        const more = chips.length - shown.length;
        const summary = status.hint ?? (doc.aiSummary || doc.summary);
        return (
          <article
            key={doc.id}
            className="rounded-lg border border-border bg-card px-4 py-3 transition-colors hover:border-(--line-strong)"
          >
            <div className="flex items-start gap-3">
              <FileText size={15} className="mt-0.5 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <Link
                    href={`/kb/${doc.id}`}
                    className="min-w-0 max-w-full truncate font-heading text-[14px] font-semibold text-foreground underline-offset-2 hover:underline"
                  >
                    {doc.name}
                  </Link>
                  {doc.collectionName && (
                    <Chip tone="neutral" icon={<FolderOpen size={11} />} title="Shelf">
                      {doc.collectionName}
                    </Chip>
                  )}
                  <Chip tone={visibilityTone(doc.visibility)} caps>{doc.visibility}</Chip>
                  {/* Indexed is the ordinary state; only the other three earn a chip. */}
                  {doc.textStatus !== "EXTRACTED" && (
                    <Chip tone={textStatusTone(doc.textStatus)} caps>{status.label}</Chip>
                  )}
                  <span className="ml-auto font-mono text-[10.5px] text-muted-foreground">{kb(doc.byteSize)}</span>
                </div>
                {summary && <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{summary}</p>}
                {shown.length > 0 && (
                  <div className="mt-2 flex flex-wrap items-center gap-1" aria-label="Keywords">
                    {shown.map((chip) => {
                      if (chip.kind === "topic") {
                        const t = chip.value;
                        const active = needle === t.toLowerCase();
                        return (
                          <button
                            key={`t:${t}`}
                            type="button"
                            title={`Filter by "${t}"`}
                            onClick={() => setText(t)}
                            className={`${chipClass("brand", { face: "ui" })} transition-shadow ${active ? "ring-2 ring-(--brand)" : "hover:border-(--brand)"}`}
                          >
                            {t}
                          </button>
                        );
                      }
                      const k = chip.value;
                      const active = needle === k.toLowerCase();
                      return (
                        <button
                          key={`k:${k}`}
                          type="button"
                          title={`Filter by "${k}"`}
                          onClick={() => setText(k)}
                          className={`${chipClass("neutral")} transition-shadow ${active ? "ring-2 ring-(--brand)" : "hover:border-(--line-strong)"}`}
                        >
                          {k}
                        </button>
                      );
                    })}
                    {more > 0 && <span className="font-mono text-[10.5px] text-muted-foreground">+{more}</span>}
                  </div>
                )}
              </div>
            </div>
          </article>
        );
      })}

      {visible.length > limit && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed border-border px-3 py-2">
          <span className="font-mono text-[10.5px] text-muted-foreground">
            Showing {limit} of {visible.length}
          </span>
          <span className="flex gap-1.5">
            <button type="button" onClick={() => setLimit((l) => l + PAGE)} className={BTN_OUTLINE_SM}>
              Show {Math.min(PAGE, visible.length - limit)} more
            </button>
            <button type="button" onClick={() => setLimit(visible.length)} className={BTN_OUTLINE_SM}>
              Show all
            </button>
          </span>
        </div>
      )}

      {documents.length > 0 && visible.length === 0 && (
        <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
          No documents match these filters.{" "}
          <button type="button" className="underline underline-offset-2 hover:text-foreground" onClick={clearFilters}>
            Clear filters
          </button>
        </p>
      )}
    </div>
  );
}
