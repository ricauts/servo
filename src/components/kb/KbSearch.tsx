"use client";

import { useCallback, useRef, useState } from "react";
import { QUERY_INPUT_CAP } from "@/lib/kb/query-filters";
import Link from "next/link";
import { Search, X } from "lucide-react";
import type { KbSearchResponse } from "@/lib/kb/filter-view";

/**
 * The KB search box, with the parse made visible (ext-08).
 *
 * ext-06 reads structured filters out of a typed question: "invoices over $2k
 * from last quarter" becomes a money filter, a date interval and the residue
 * "invoices". That inference is good and it is also INVISIBLE — an operator
 * who did not want the amount treated as a threshold had no way to see that
 * it was, and no way to take it back. So every filter the parser read is
 * rendered as a chip beside the residue, and every chip carries a control
 * that removes it and re-runs the search without it.
 *
 * The chip is a READBACK, not an editor: it names the surface text it was
 * read from, the comparator, the normalized value and whether a ruleset
 * default resolved anything. Nothing here re-parses; the route hands back
 * exactly what `parseQueryFilters` produced.
 */

const COMPARATOR_LABEL: Record<string, string> = { ">=": "≥", "<=": "≤", "=": "=", between: "between" };

export default function KbSearch() {
  const [query, setQuery] = useState("");
  /** The query the chips ON SCREEN were parsed from — set when a response
   *  PAINTS, never when one is sent.
   *
   *  A chip index means a position in ONE parse, so a chip must re-run the
   *  query it belongs to or it drops a different filter than the one it
   *  names. Binding this at submit time is not enough: while a second search
   *  is in flight — or after one has FAILED, which is durable rather than a
   *  race — the first query's chips are still on screen with live controls,
   *  and a click would carry the second query's indices. */
  const [ranQuery, setRanQuery] = useState("");
  const [dropped, setDropped] = useState<number[]>([]);
  const [data, setData] = useState<KbSearchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Monotonic request id: two searches must paint in the order they were
   *  ASKED FOR, not the order they return. */
  const seq = useRef(0);
  /**
   * THE OPERATOR'S INTENT, which is not the same thing as the painted state.
   *
   * `dropped` records the drops of the answer ON SCREEN, so it can only move
   * when one paints. Reading it at click time loses a click: two X buttons
   * pressed inside one round trip both see the same painted `dropped`, the
   * second request carries only the second index, and the seq guard then
   * DISCARDS the first — so the first chip comes back, un-struck, with its
   * filter still narrowing the results. A ref advances at click time, so the
   * second request carries both.
   *
   * It is keyed to the query it belongs to: intent recorded against one parse
   * must never be replayed against another.
   */
  const pending = useRef<{ query: string; drops: number[] }>({ query: "", drops: [] });

  const run = useCallback(async (q: string, drop: number[]) => {
    const text = q.trim();
    if (text === "") {
      setData(null);
      setError(null);
      return;
    }
    const ticket = ++seq.current;
    pending.current = { query: text, drops: drop };
    setBusy(true);
    setError(null);
    try {
      const params = new URLSearchParams({ q: text });
      if (drop.length > 0) params.set("drop", drop.join(","));
      const res = await fetch(`/api/kb/search?${params.toString()}`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Search failed.");
      const body = (await res.json()) as KbSearchResponse;
      if (ticket !== seq.current) return; // a newer search already answered
      // The chips, the query they belong to and the drops that produced them
      // are set TOGETHER, so no two of them can ever disagree — not while a
      // search is in flight, and not after one has failed.
      setData(body);
      setRanQuery(text);
      setDropped(drop);
    } catch (err) {
      if (ticket !== seq.current) return;
      // A REMOVAL THAT FAILED IS NOT INTENT. Nothing painted, so the chip is
      // still on screen un-struck with its filter still applied — and if the
      // ref kept those drops, the operator's NEXT click would silently carry
      // them too and remove filters that click did not name. Clearing it
      // makes dropFilter fall back to the painted `dropped`, which is exactly
      // what the screen shows. Guarded on the ticket so a stale failure
      // cannot clobber a newer request's intent.
      pending.current = { query: "", drops: [] };
      setError(err instanceof Error ? err.message : "Search failed.");
    } finally {
      if (ticket === seq.current) setBusy(false);
    }
  }, []);

  /** Removing a chip re-runs THE QUERY THE CHIP CAME FROM with that filter
   *  dropped — never the input's current text, which may since have been
   *  edited into a different parse with different indices — and it ACCUMULATES
   *  with any removal still in flight against that same query. */
  function dropFilter(index: number) {
    const inFlight = pending.current.query === ranQuery ? pending.current.drops : dropped;
    void run(ranQuery, inFlight.includes(index) ? inFlight : [...inFlight, index]);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    // A new question is a new parse: chip indices belong to one query. None
    // of the three — query, drops, chips — advances here; they move together
    // when the answer paints, so no state on screen is ever ahead of it.
    void run(query, []);
  }

  const active = data?.filters.filter((f) => !f.dropped) ?? [];

  return (
    <section className="mt-4">
      <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
        {/* The ring rides on the WRAPPER, because the wrapper is what looks
            like the field: the input's own outline is suppressed, so
            focus-within is what keeps a keyboard user visible. */}
        <div className="flex min-w-64 flex-1 items-center gap-2 rounded-md border border-input bg-background px-2.5 py-1.5 transition-[color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50">
          <Search size={14} className="shrink-0 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            // ext-06 parses the first QUERY_INPUT_CAP characters; the route
            // refuses more, so the field refuses to produce more.
            maxLength={QUERY_INPUT_CAP}
            placeholder="Search the knowledge base — e.g. invoices over $2,000 from last quarter"
            aria-label="Search the knowledge base"
            className="min-w-0 flex-1 bg-transparent font-sans text-[13px] outline-none"
          />
        </div>
        <button
          type="submit"
          disabled={busy || query.trim() === ""}
          className="rounded-md bg-primary px-3 py-1.5 font-heading text-[12.5px] font-medium text-primary-foreground disabled:opacity-50"
        >
          {busy ? "Searching…" : "Search"}
        </button>
      </form>

      {error && (
        <p className="mt-2 font-mono text-[11px]" style={{ color: "var(--critical-chip-ink)" }}>
          {error}
        </p>
      )}

      {data && (data.filters.length > 0 || data.queryUsed !== "") && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
            Read as
          </span>
          {data.filters.map((f) => (
            <span
              key={f.index}
              data-filter-index={f.index}
              data-dropped={f.dropped ? "true" : "false"}
              title={
                f.confidence === "ASSUMED"
                  ? `Read from "${f.text}". A ruleset default resolved part of this value.`
                  : `Read from "${f.text}".`
              }
              // A dropped chip is struck through and RECAST to the neutral
              // tone — never faded. Chips in this system are opaque, and an
              // opacity that halves the contrast of the text is the wrong way
              // to say "this one is no longer applied".
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-px font-mono text-[10.5px] leading-4 ${
                f.confidence === "ASSUMED" && !f.dropped ? "border-dashed" : ""
              } ${f.dropped ? "line-through" : ""}`}
              style={{
                borderColor: f.dropped
                  ? "var(--neutral-chip-line)"
                  : f.confidence === "ASSUMED"
                    ? "var(--warn-chip-line)"
                    : "var(--info-chip-line)",
                background: f.dropped
                  ? "var(--neutral-chip)"
                  : f.confidence === "ASSUMED"
                    ? "var(--warn-chip)"
                    : "var(--info-chip)",
                color: f.dropped
                  ? "var(--neutral-chip-ink)"
                  : f.confidence === "ASSUMED"
                    ? "var(--warn-chip-ink)"
                    : "var(--info-chip-ink)",
              }}
            >
              {/* The kind is a machine word and stays one: the same enum the
                  fact chips on a document show, spelled the same way. */}
              <span>{f.kind}</span>
              <span>
                {f.kind === "DATE" ? "" : `${COMPARATOR_LABEL[f.comparator] ?? f.comparator} `}
                {f.display}
              </span>
              {!f.dropped && (
                <button
                  type="button"
                  onClick={() => dropFilter(f.index)}
                  aria-label={`Remove the ${f.kind} filter read from ${f.text}`}
                  // Focus left to the design system's own :focus-visible rule
                  // (base.css, outside every cascade layer): a utility ring
                  // here would never win, and a dead class reads like one.
                  className="ml-0.5 inline-flex items-center rounded-full"
                >
                  <X size={11} />
                </button>
              )}
            </span>
          ))}
          {/* The text chip carries what the keyword pass ACTUALLY ran on,
              not the residue as such: a question made only of values leaves
              no residue, and there the search runs on the values themselves. A
              readback that named the residue would name a string the search
              never used. */}
          {data.queryUsed !== "" && (
            <span
              className="inline-flex items-center gap-1 rounded-full border px-2 py-px font-mono text-[10.5px] leading-4"
              style={{
                borderColor: "var(--neutral-chip-line)",
                background: "var(--neutral-chip)",
                color: "var(--neutral-chip-ink)",
              }}
            >
              <span>text</span>
              {data.queryUsed}
            </span>
          )}
        </div>
      )}

      {data && (
        <p className="mt-1.5 text-xs text-muted-foreground">
          {active.length > 0
            ? "A rule-based parser matched these values in your question and filtered on them. Remove a chip to search without that filter."
            : data.filters.length > 0
              ? "Every value the parser matched has been removed — this searched the text alone."
              : "No values were matched in your question; this searched the text alone."}
          {data.overflow > 0 &&
            ` ${data.overflow} further value${data.overflow === 1 ? "" : "s"} the parser matched ${data.overflow === 1 ? "was" : "were"} not applied — a search filters on at most ${data.maxFilters}.`}
        </p>
      )}

      {data && data.hits.length > 0 && (
        <ul className="mt-3 flex flex-col gap-2">
          {data.hits.map((h) => (
            <li key={h.chunkId} className="rounded-md border border-border bg-card p-3">
              <Link
                href={`/kb/${h.documentId}#chunk-${h.chunkId}`}
                className="font-heading text-[13px] font-medium underline-offset-2 hover:underline"
              >
                {h.docName}
              </Link>
              <p className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
                {h.locator}
              </p>
              <p className="mt-1 line-clamp-3 text-[13px] leading-relaxed text-muted-foreground">
                {h.text}
              </p>
            </li>
          ))}
        </ul>
      )}

      {data && data.hits.length === 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          No passages you can read match this search.
        </p>
      )}
    </section>
  );
}
