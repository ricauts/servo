"use client";

import { useEffect, useState } from "react";
import { BTN_OUTLINE_SM, LABEL } from "@/components/kb/kb-controls";

/** One indexed chunk, with its locator already described by the server. */
export interface ChunkView {
  id: string;
  index: number;
  text: string;
  locator: string;
}

/** Chunks shown before "Show more": a 60-page manual is a page of twenty,
 *  not a scroll of hundreds. */
const PAGE = 20;

/**
 * The document's chunks (kb-16), paged on the client. Purely presentational:
 * the server page passes the rows; nothing here fetches.
 *
 * A deep link (#chunk-<id>, from a fact chip or a search hit) must still land
 * on its chunk when that chunk sits past the fold — the browser gives up
 * when the anchor is not in the DOM, so the list reveals up to it first and
 * scrolls once it is rendered.
 */
export default function KbChunkList({ chunks }: { chunks: ChunkView[] }) {
  const [limit, setLimit] = useState(PAGE);
  const [pendingAnchor, setPendingAnchor] = useState<string | null>(null);

  useEffect(() => {
    function reveal() {
      const hash = window.location.hash;
      if (!hash.startsWith("#chunk-")) return;
      const id = decodeURIComponent(hash.slice("#chunk-".length));
      const at = chunks.findIndex((c) => c.id === id);
      if (at < 0) return;
      setLimit((l) => (at < l ? l : Math.ceil((at + 1) / PAGE) * PAGE));
      setPendingAnchor(id);
    }
    reveal();
    window.addEventListener("hashchange", reveal);
    return () => window.removeEventListener("hashchange", reveal);
  }, [chunks]);

  // Scroll once the revealed chunk exists in the DOM.
  useEffect(() => {
    if (!pendingAnchor) return;
    const el = document.getElementById(`chunk-${pendingAnchor}`);
    if (!el) return;
    el.scrollIntoView({ block: "start" });
    setPendingAnchor(null);
  }, [pendingAnchor, limit]);

  const shown = chunks.slice(0, limit);

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <h2 className={LABEL}>Chunks · {chunks.length}</h2>
      {shown.map((chunk) => (
        <article
          key={chunk.id}
          // The anchor a fact chip links to (ext-08). scroll-mt clears the
          // sticky header so the chunk a chip names is actually visible.
          id={`chunk-${chunk.id}`}
          className="scroll-mt-20 rounded-lg border border-border bg-card p-3 target:border-(--brand)"
        >
          <p className="flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground">
            <span className="text-(--text-faint)">{String(chunk.index + 1).padStart(2, "0")}</span>
            {chunk.locator}
          </p>
          <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed">{chunk.text}</p>
        </article>
      ))}
      {chunks.length === 0 && <p className="text-xs text-muted-foreground">No indexed text — see the status above.</p>}
      {chunks.length > limit && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed border-border px-3 py-2">
          <span className="font-mono text-[10.5px] text-muted-foreground">
            Showing {limit} of {chunks.length}
          </span>
          <span className="flex gap-1.5">
            <button type="button" onClick={() => setLimit((l) => l + PAGE)} className={BTN_OUTLINE_SM}>
              Show {Math.min(PAGE, chunks.length - limit)} more
            </button>
            <button type="button" onClick={() => setLimit(chunks.length)} className={BTN_OUTLINE_SM}>
              Show all
            </button>
          </span>
        </div>
      )}
    </div>
  );
}
