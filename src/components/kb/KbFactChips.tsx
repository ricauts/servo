"use client";

import { useEffect, useState } from "react";
import { assumptionNote, factValue } from "@/components/kb/fact-assumptions";
import type { FactChipRow, FactsResponse } from "@/app/api/kb/documents/[id]/facts/route";

/**
 * The typed facts of one document, as chips grouped by kind (ext-08).
 *
 * WHAT A CHIP IS FOR. Every fact under it was produced by a deterministic
 * rule — a pattern matched a span of this document's own text — and the chip
 * shows that span verbatim and links to the chunk and offset it came from.
 * An operator who doubts a filter can follow one chip to the sentence that
 * produced it. Nothing here is a judgement about what the document MEANS.
 *
 * ABSENCE IS NORMAL. Prose carries no dates, no amounts and no identifiers,
 * and that is the ordinary case, not a failure: with no facts this component
 * renders NOTHING — no heading, no empty state, no "0 facts". The same holds
 * while the fetch is in flight and if the fetch fails: a panel that appears
 * and then disappears reads as a broken document, and a placeholder on a
 * document whose facts were withheld would itself be the disclosure.
 */

/** Group order — the extractor's own precedence, so the densest, most
 *  specific kinds lead and the two loosest sit at the end. */
const KIND_ORDER = ["DATE", "MONEY", "DURATION", "QUANTITY", "IDENTIFIER", "EMAIL", "URL"] as const;

export default function KbFactChips({ documentId }: { documentId: string }) {
  const [data, setData] = useState<FactsResponse | null>(null);

  useEffect(() => {
    let live = true;
    // CLEARED FIRST, on every id change. The App Router keeps this component
    // instance across a client navigation between two documents, so without
    // this the previous document's chips stay on screen until the new fetch
    // resolves — and stay forever if it fails — pointing at chunk anchors
    // that do not exist on this page.
    setData(null);
    void (async () => {
      try {
        const res = await fetch(`/api/kb/documents/${documentId}/facts`);
        if (!res.ok) return;
        const body = (await res.json()) as FactsResponse;
        if (live) setData(body);
      } catch {
        /* No facts panel rather than an error panel: see ABSENCE IS NORMAL. */
      }
    })();
    return () => {
      live = false;
    };
  }, [documentId]);

  if (data === null || data.facts.length === 0) return null;

  const groups = KIND_ORDER.map((kind) => ({
    kind,
    facts: data.facts.filter((f) => f.kind === kind),
  })).filter((g) => g.facts.length > 0);
  if (groups.length === 0) return null;

  // The count of what is DRAWN, not of what arrived: a kind outside
  // KIND_ORDER would otherwise be counted in a heading above chips that do
  // not include it.
  const shown = groups.reduce((n, g) => n + g.facts.length, 0);

  return (
    <section className="mt-6">
      <h2 className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
        Extracted values · {shown}
      </h2>
      <p className="mt-1 max-w-3xl text-xs text-muted-foreground">
        Dates, amounts, durations, quantities, identifiers, emails and URLs a
        rule-based parser matched in this document&rsquo;s own text. Each chip
        links to the chunk and offset it was read from.
      </p>
      <div className="mt-2 flex flex-col gap-2">
        {groups.map((group) => (
          <div key={group.kind} className="flex flex-wrap items-baseline gap-1.5">
            <span className="w-20 shrink-0 font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
              {group.kind}
            </span>
            {group.facts.map((fact) => {
              const assumed = fact.confidence === "ASSUMED";
              const tooltip = assumed
                ? `${factValue(fact)} — ${assumptionNote(fact, data.documentDate)}`
                : `${factValue(fact)} — read exactly as written, at offset ${fact.offset} of chunk ${fact.chunkIndex + 1}.`;
              return (
                <a
                  key={fact.id}
                  href={`#chunk-${fact.chunkId}`}
                  title={tooltip}
                  data-confidence={fact.confidence}
                  // ASSUMED is visually distinct in TWO channels, not one:
                  // the warn chip tone AND the "~" marker, so the distinction
                  // survives a colour-blind reader and a greyscale print.
                  //
                  // Hover underlines rather than fading the chip: the design
                  // system's chips are OPAQUE, and an opacity hover would
                  // wash the tint that carries the EXACT/ASSUMED distinction.
                  //
                  // Focus is deliberately NOT restyled here. The design
                  // system's own base.css styles :focus-visible outside every
                  // cascade layer, so it already wins over any utility class
                  // this component could add — a ring utility here would be a
                  // dead class that reads like an override.
                  className={`inline-flex items-center gap-1 rounded-full border px-2 py-px font-mono text-[10.5px] leading-4 underline-offset-2 hover:underline ${
                    assumed ? "border-dashed" : ""
                  }`}
                  style={{
                    borderColor: assumed ? "var(--warn-chip-line)" : "var(--neutral-chip-line)",
                    background: assumed ? "var(--warn-chip)" : "var(--neutral-chip)",
                    color: assumed ? "var(--warn-chip-ink)" : "var(--neutral-chip-ink)",
                  }}
                >
                  {assumed && <span aria-hidden="true">~</span>}
                  <span>{fact.text}</span>
                  {/* The locator stays in the chip's OWN ink. --text-faint is
                      the page's placeholder ink and lands under 3:1 on a
                      tinted chip; the chip recipe gives the tone its ink. */}
                  <span>
                    @{fact.chunkIndex + 1}:{fact.offset}
                  </span>
                  {assumed && <span className="sr-only">assumed</span>}
                </a>
              );
            })}
          </div>
        ))}
      </div>
      {data.truncated && (
        <p className="mt-2 text-xs text-muted-foreground">
          This document carries more extracted values than one page shows;
          these {shown} are the earliest in the document.
        </p>
      )}
    </section>
  );
}
