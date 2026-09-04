"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { FileText, FolderOpen, X } from "lucide-react";
import {
  filterDocuments,
  UNCATEGORIZED,
  VISIBILITY_FILTERS,
  type KbCollectionOption,
  type KbDocumentRow,
  type VisibilityFilter,
} from "@/lib/kb/library";

import { statusCopy } from "@/lib/kb/library";

export type { KbCollectionOption, KbDocumentRow } from "@/lib/kb/library";

function kb(size: number): string {
  return size > 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(size / 1024))} KB`;
}

/** How many keyword chips a row shows before "+N". */
const ROW_KEYWORDS = 6;

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

  return (
    <div className="mt-6 flex flex-col gap-2">
      {!anyAgentGrant && documents.length > 0 && (
        <p
          className="rounded-md border px-3 py-2 font-mono text-[11.5px]"
          style={{
            borderColor: "var(--warn-chip-line)",
            background: "var(--warn-chip)",
            color: "var(--warn-chip-ink)",
          }}
        >
          No agent can read anything here yet — a fresh knowledge base is dark
          to automation by design. Share a document with an agent to light it up.
        </p>
      )}

      {/* kb-lib-1: the library toolbar — text, visibility, collection. */}
      {documents.length > 0 && (
        <div className="flex flex-wrap items-center gap-2" data-testid="kb-library-filters">
          <div className="relative min-w-[200px] flex-1">
            <input
              type="search"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Filter by name or keyword"
              aria-label="Filter documents by name or keyword"
              className="h-8 w-full rounded-md border border-border bg-background px-2.5 pr-7 text-[12.5px] outline-none focus:ring-2 focus:ring-ring"
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
          <div role="group" aria-label="Visibility" className="flex overflow-hidden rounded-md border border-border">
            {VISIBILITY_FILTERS.map((v) => {
              const active = visibility === v;
              const n = v === "ALL" ? documents.length : (counts.get(v) ?? 0);
              return (
                <button
                  key={v}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setVisibility(v)}
                  className={`h-8 px-2.5 font-mono text-[10.5px] uppercase tracking-wider transition-colors ${
                    active ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/40"
                  }`}
                >
                  {v === "ALL" ? "All" : v.toLowerCase()} <span className="opacity-70">{n}</span>
                </button>
              );
            })}
          </div>
          <select
            value={collection}
            onChange={(e) => setCollection(e.target.value)}
            aria-label="Collection"
            className="h-8 rounded-md border border-border bg-background px-2 font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground"
          >
            <option value="ALL">All collections</option>
            <option value={UNCATEGORIZED}>Uncategorized</option>
            {collections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          {filtering && (
            <span className="font-mono text-[10.5px] text-muted-foreground">
              {visible.length} of {documents.length}
            </span>
          )}
        </div>
      )}

      {visible.map((doc) => {
        const status = statusCopy(doc);
        const shown = doc.keywords.slice(0, ROW_KEYWORDS);
        const more = doc.keywords.length - shown.length;
        return (
          <div
            key={doc.id}
            className="group rounded-md border border-border bg-card p-3.5 transition-colors hover:bg-accent/40"
          >
            <Link href={`/kb/${doc.id}`} className="flex items-center gap-2.5">
              <FileText size={15} className="shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate font-heading text-[14px] font-medium">
                {doc.name}
              </span>
              {doc.collectionName && (
                <span className="inline-flex items-center gap-1 rounded-full border border-border px-1.5 py-px font-mono text-[10.5px] leading-4 text-muted-foreground">
                  <FolderOpen size={11} /> {doc.collectionName}
                </span>
              )}
              <span className="font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground">
                {doc.visibility} · {kb(doc.byteSize)}
              </span>
              <span
                className="rounded-full border px-1.5 py-px font-mono text-[10.5px] leading-4"
                style={{ color: status.tone, borderColor: "var(--line)" }}
              >
                {status.label}
              </span>
            </Link>
            {status.hint ? (
              <p className="mt-1 pl-6 text-xs text-muted-foreground">{status.hint}</p>
            ) : (
              (doc.aiSummary || doc.summary) && (
                <p className="mt-1 line-clamp-1 pl-6 text-xs text-muted-foreground">{doc.aiSummary || doc.summary}</p>
              )
            )}
            {(doc.topics.length > 0 || shown.length > 0) && (
              <div className="mt-1.5 flex flex-wrap items-center gap-1 pl-6" aria-label="Keywords">
                {/* kb-lib-2: topics first (model-written, Title Case), then the deterministic keywords. */}
                {doc.topics.map((t) => (
                  <button
                    key={`t:${t}`}
                    type="button"
                    title={`Filter by "${t}"`}
                    onClick={() => setText(t)}
                    className={`rounded-full border px-1.5 py-px font-heading text-[10.5px] leading-4 transition-colors hover:bg-accent ${
                      text.trim().toLowerCase() === t.toLowerCase() ? "border-foreground/40 bg-accent" : "border-primary/40 text-foreground"
                    }`}
                  >
                    {t}
                  </button>
                ))}
                {shown.map((k) => (
                  <button
                    key={k}
                    type="button"
                    title={`Filter by "${k}"`}
                    onClick={() => setText(k)}
                    className={`rounded-full border px-1.5 py-px font-mono text-[10.5px] leading-4 transition-colors hover:bg-accent ${
                      text.trim().toLowerCase() === k ? "border-foreground/40 bg-accent" : "border-border text-muted-foreground"
                    }`}
                  >
                    {k}
                  </button>
                ))}
                {more > 0 && (
                  <span className="font-mono text-[10.5px] text-muted-foreground">+{more}</span>
                )}
              </div>
            )}
          </div>
        );
      })}

      {documents.length > 0 && visible.length === 0 && (
        <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
          No documents match these filters.{" "}
          <button
            type="button"
            className="underline underline-offset-2 hover:text-foreground"
            onClick={() => {
              setText("");
              setVisibility("ALL");
              setCollection("ALL");
            }}
          >
            Clear filters
          </button>
        </p>
      )}
    </div>
  );
}
