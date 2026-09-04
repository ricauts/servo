"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Database, FileText, FolderOpen, Search, X } from "lucide-react";
import {
  DATA_TYPES,
  layoutGraph,
  matchesDataType,
  nodeMatches,
  type DataTypeFilter,
  type GraphEdge,
  type GraphView,
  type LaidOutNode,
} from "@/lib/kb/graph-view";
import { VISIBILITY_FILTERS, type VisibilityFilter } from "@/lib/kb/library";

const CANVAS = { width: 1200, height: 800 };

const DATA_TYPE_LABEL: Record<DataTypeFilter, string> = {
  ALL: "All types",
  FILE: "Files",
  CATALOG: "Catalog cards",
  S3: "S3",
  POSTGRES: "PostgreSQL",
};

/** Edge kinds and the stroke tokens that tell them apart. */
const EDGE_STYLE: Record<string, { stroke: string; dash?: string; label: string }> = {
  MEMBER: { stroke: "var(--line)", label: "on shelf" },
  FROM_SOURCE: { stroke: "var(--line-brand)", dash: "6 3", label: "from source" },
  SHARED_ENTITY: { stroke: "var(--brand-chip-line)", label: "shared names" },
  SHARED_KEYWORD: { stroke: "var(--text-muted)", dash: "4 3", label: "shared keywords" },
  SHARED_FACT: { stroke: "var(--warn-chip-line)", label: "shared facts" },
  SAME_COLLECTION: { stroke: "var(--line)", dash: "2 3", label: "same shelf" },
};

/**
 * The interactive knowledge graph (kb-lib-3). Pure layout from graph-view.ts
 * (seeded, so the same corpus draws the same picture every time), SVG with
 * wheel zoom and drag-to-pan, three filters that DIM rather than remove (a
 * node that disappears takes its context with it), and a side panel for the
 * selected node with links into the library.
 */
export default function KbGraph() {
  const [view, setView] = useState<GraphView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [visibility, setVisibility] = useState<VisibilityFilter>("ALL");
  const [collection, setCollection] = useState<string>("ALL");
  const [dataType, setDataType] = useState<DataTypeFilter>("ALL");
  const [selected, setSelected] = useState<string | null>(null);
  const [transform, setTransform] = useState({ x: 0, y: 0, k: 1 });
  const drag = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/kb/graph")
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Could not load the graph.");
        return (await res.json()) as GraphView;
      })
      .then((data) => {
        if (!cancelled) setView(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load the graph.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const laidOut = useMemo(() => (view ? layoutGraph(view, { ...CANVAS, iterations: 250 }) : []), [view]);
  const byId = useMemo(() => new Map(laidOut.map((n) => [n.id, n])), [laidOut]);
  const shelves = useMemo(
    () => laidOut.filter((n) => n.kind === "collection").map((n) => ({ id: n.id.slice("collection:".length), name: n.name })),
    [laidOut],
  );

  const sourceKindOf = useMemo(() => {
    const map = new Map(laidOut.filter((n) => n.kind === "source").map((n) => [n.id.slice("source:".length), n.sourceKind]));
    return (id: string) => map.get(id);
  }, [laidOut]);
  const sourceCount = laidOut.filter((n) => n.kind === "source").length;

  // Which nodes the filters keep LIT; everything else dims.
  const lit = useMemo(() => {
    const set = new Set<string>();
    for (const n of laidOut) {
      if (!matchesDataType(n, dataType, sourceKindOf)) continue;
      if (n.kind === "collection") {
        if (collection === "ALL" || n.id === `collection:${collection}`) set.add(n.id);
        continue;
      }
      if (n.kind === "source") {
        if (nodeMatches(n, query)) set.add(n.id);
        continue;
      }
      if (visibility !== "ALL" && n.visibility !== visibility) continue;
      if (collection !== "ALL" && (n.collectionId ?? "NONE") !== collection) continue;
      if (!nodeMatches(n, query)) continue;
      set.add(n.id);
    }
    return set;
  }, [laidOut, visibility, collection, dataType, query, sourceKindOf]);

  const selectedNode = selected ? byId.get(selected) ?? null : null;
  const selectedEdges = useMemo(
    () => (view && selected ? view.edges.filter((e) => e.from === selected || e.to === selected) : []),
    [view, selected],
  );
  const neighbours = useMemo(() => {
    const set = new Set<string>();
    for (const e of selectedEdges) set.add(e.from === selected ? e.to : e.from);
    return set;
  }, [selectedEdges, selected]);

  function onWheel(e: React.WheelEvent<SVGSVGElement>) {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    setTransform((t) => {
      const k = Math.min(4, Math.max(0.3, t.k * factor));
      // Zoom around the cursor.
      const rect = svgRef.current?.getBoundingClientRect();
      const cx = rect ? ((e.clientX - rect.left) / rect.width) * CANVAS.width : CANVAS.width / 2;
      const cy = rect ? ((e.clientY - rect.top) / rect.height) * CANVAS.height : CANVAS.height / 2;
      return { k, x: cx - ((cx - t.x) * k) / t.k, y: cy - ((cy - t.y) * k) / t.k };
    });
  }
  function onPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    if ((e.target as Element).closest("[data-node]")) return;
    drag.current = { x: e.clientX, y: e.clientY, tx: transform.x, ty: transform.y };
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (!drag.current) return;
    const rect = svgRef.current?.getBoundingClientRect();
    const scale = rect ? CANVAS.width / rect.width : 1;
    setTransform((t) => ({
      ...t,
      x: drag.current!.tx + (e.clientX - drag.current!.x) * scale,
      y: drag.current!.ty + (e.clientY - drag.current!.y) * scale,
    }));
  }
  function onPointerUp() {
    drag.current = null;
  }

  if (error) {
    return <p className="rounded-md border border-border bg-card p-4 text-sm text-muted-foreground">{error}</p>;
  }
  if (!view) {
    return <p className="rounded-md border border-border bg-card p-4 text-sm text-muted-foreground">Laying out the graph…</p>;
  }
  if (view.nodes.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        Nothing to draw yet — upload a document, or ask for access to one.
      </p>
    );
  }

  const docCount = laidOut.filter((n) => n.kind === "document").length;
  const kindsPresent = new Set(view.edges.map((e) => e.kind));

  return (
    <div className="flex h-full min-h-[560px] flex-col gap-3">
      {/* Toolbar: search, visibility, shelf, legend. */}
      <div className="flex flex-wrap items-center gap-2" data-testid="kb-graph-filters">
        <div className="relative min-w-[220px] flex-1">
          <Search size={13} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Highlight by name, topic or keyword"
            aria-label="Highlight nodes"
            className="h-8 w-full rounded-md border border-border bg-background pl-7 pr-7 text-[12.5px] outline-none focus:ring-2 focus:ring-ring"
          />
          {query && (
            <button type="button" aria-label="Clear" onClick={() => setQuery("")} className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground">
              <X size={12} />
            </button>
          )}
        </div>
        <div role="group" aria-label="Visibility" className="flex overflow-hidden rounded-md border border-border">
          {VISIBILITY_FILTERS.map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={visibility === v}
              onClick={() => setVisibility(v)}
              className={`h-8 px-2.5 font-mono text-[10.5px] uppercase tracking-wider transition-colors ${visibility === v ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/40"}`}
            >
              {v === "ALL" ? "All" : v.toLowerCase()}
            </button>
          ))}
        </div>
        <select
          value={collection}
          onChange={(e) => setCollection(e.target.value)}
          aria-label="Collection"
          className="h-8 rounded-md border border-border bg-background px-2 font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground"
        >
          <option value="ALL">All shelves</option>
          <option value="NONE">Uncategorized</option>
          {shelves.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        <select
          value={dataType}
          onChange={(e) => setDataType(e.target.value as DataTypeFilter)}
          aria-label="Data type"
          className="h-8 rounded-md border border-border bg-background px-2 font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground"
        >
          {DATA_TYPES.map((t) => (
            <option key={t} value={t}>{DATA_TYPE_LABEL[t]}</option>
          ))}
        </select>
        <span className="font-mono text-[10.5px] text-muted-foreground">
          {docCount} document{docCount === 1 ? "" : "s"} · {shelves.length} shel{shelves.length === 1 ? "f" : "ves"} · {sourceCount} source{sourceCount === 1 ? "" : "s"} · {view.edges.length} link{view.edges.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="grid min-h-0 flex-1 gap-3 md:grid-cols-[1fr_280px]">
        <div className="relative min-h-[480px] overflow-hidden rounded-md border border-border bg-card">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${CANVAS.width} ${CANVAS.height}`}
            className="h-full w-full touch-none select-none"
            role="img"
            aria-label="Knowledge graph"
            onWheel={onWheel}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerUp}
            style={{ cursor: drag.current ? "grabbing" : "grab" }}
          >
            <g transform={`translate(${transform.x} ${transform.y}) scale(${transform.k})`}>
              {view.edges.map((e, i) => {
                const a = byId.get(e.from);
                const b = byId.get(e.to);
                if (!a || !b) return null;
                const style = EDGE_STYLE[e.kind] ?? EDGE_STYLE.SHARED_KEYWORD;
                const on = lit.has(a.id) && lit.has(b.id);
                const touching = selected !== null && (e.from === selected || e.to === selected);
                return (
                  <line
                    key={`${e.from}-${e.to}-${e.kind}-${i}`}
                    x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                    stroke={style.stroke}
                    strokeDasharray={style.dash}
                    strokeWidth={touching ? 2.5 : e.kind === "MEMBER" ? 1 : 1 + Math.min(2, e.weight * 2)}
                    opacity={on ? (selected && !touching ? 0.35 : 0.9) : 0.12}
                  />
                );
              })}
              {laidOut.map((n) => {
                const on = lit.has(n.id);
                const isSel = n.id === selected;
                const isNeighbour = neighbours.has(n.id);
                const r = n.kind === "document" ? (n.docKind === "CATALOG" ? 8 : 9) : 14 + Math.min(10, (n.size ?? 1) * 2);
                return (
                  <g
                    key={n.id}
                    data-node={n.id}
                    transform={`translate(${n.x} ${n.y})`}
                    opacity={on ? 1 : 0.2}
                    style={{ cursor: "pointer" }}
                    onClick={() => setSelected(isSel ? null : n.id)}
                  >
                    {n.kind === "collection" ? (
                      <rect x={-r} y={-r} width={r * 2} height={r * 2} rx={5}
                        fill="var(--brand-chip)"
                        stroke={isSel ? "var(--brand)" : "var(--brand-chip-line)"}
                        strokeWidth={isSel ? 3 : 1.5} />
                    ) : n.kind === "source" ? (
                      // A diamond: the external store (S3 / PostgreSQL) the
                      // documents beneath it were crawled or described from.
                      <polygon points={`0,${-r - 4} ${r + 4},0 0,${r + 4} ${-r - 4},0`}
                        fill="var(--brand-soft)"
                        stroke={isSel ? "var(--brand)" : n.status === "READY" ? "var(--line-brand)" : "var(--warn-chip-line)"}
                        strokeWidth={isSel ? 3 : 1.5} />
                    ) : n.docKind === "CATALOG" ? (
                      // A catalog card: the data lives in the external store;
                      // the node is its description. Drawn hollow.
                      <rect x={-r} y={-r} width={r * 2} height={r * 2} rx={2} transform="rotate(45)"
                        fill="var(--surface)"
                        stroke={isSel ? "var(--brand)" : isNeighbour ? "var(--text-body)" : "var(--line-brand)"}
                        strokeWidth={isSel ? 3 : 1.5} strokeDasharray="3 2" />
                    ) : (
                      <circle r={isSel || isNeighbour ? r + 2 : r}
                        fill={n.visibility === "PUBLIC" ? "var(--good-chip)" : n.visibility === "STAFF" ? "var(--warn-chip)" : "var(--surface)"}
                        stroke={isSel ? "var(--brand)" : isNeighbour ? "var(--text-body)" : n.textStatus === "EXTRACTED" ? "var(--text-muted)" : "var(--critical-chip-line)"}
                        strokeWidth={isSel ? 3 : 1.5} />
                    )}
                    <text
                      y={r + 12}
                      textAnchor="middle"
                      fontSize={n.kind === "collection" ? 12 : 11}
                      fontWeight={n.kind === "collection" || isSel ? 600 : 400}
                      fill="var(--text-body)"
                      style={{ paintOrder: "stroke", stroke: "var(--surface)", strokeWidth: 3 }}
                    >
                      {truncate(n.name, n.kind === "collection" ? 28 : 34)}
                    </text>
                  </g>
                );
              })}
            </g>
          </svg>
          {/* Legend. */}
          <div className="pointer-events-none absolute bottom-2 left-2 flex flex-wrap gap-x-3 gap-y-1 rounded-md border border-border bg-card/90 px-2 py-1 font-mono text-[10px] text-muted-foreground">
            <span><i className="mr-1 inline-block h-2 w-2 rounded-full border align-middle" style={{ background: "var(--surface)", borderColor: "var(--text-muted)" }} /> private</span>
            <span><i className="mr-1 inline-block h-2 w-2 rounded-full border align-middle" style={{ background: "var(--warn-chip)", borderColor: "var(--text-muted)" }} /> staff</span>
            <span><i className="mr-1 inline-block h-2 w-2 rounded-full border align-middle" style={{ background: "var(--good-chip)", borderColor: "var(--text-muted)" }} /> public</span>
            <span><i className="mr-1 inline-block h-2 w-2 rounded-sm border align-middle" style={{ background: "var(--brand-chip)", borderColor: "var(--brand-chip-line)" }} /> shelf</span>
            {sourceCount > 0 && (
              <>
                <span><i className="mr-1 inline-block h-2 w-2 rotate-45 border align-middle" style={{ background: "var(--brand-soft)", borderColor: "var(--line-brand)" }} /> source (S3 / SQL)</span>
                <span><i className="mr-1 inline-block h-2 w-2 rotate-45 border border-dashed align-middle" style={{ background: "var(--surface)", borderColor: "var(--line-brand)" }} /> catalog card</span>
              </>
            )}
            {[...kindsPresent].filter((k) => k !== "MEMBER").map((k) => (
              <span key={k}>
                <i className="mr-1 inline-block h-0 w-4 border-t-2 align-middle" style={{ borderColor: EDGE_STYLE[k]?.stroke ?? "var(--line)", borderStyle: EDGE_STYLE[k]?.dash ? "dashed" : "solid" }} />
                {EDGE_STYLE[k]?.label ?? k.toLowerCase()}
              </span>
            ))}
          </div>
        </div>

        {/* Side panel. */}
        <aside className="flex flex-col gap-2 rounded-md border border-border bg-card p-3 text-xs" data-testid="kb-graph-panel">
          {!selectedNode ? (
            <p className="text-muted-foreground">Click a node to see its shelf, topics, keywords and links. Scroll to zoom, drag the canvas to pan.</p>
          ) : selectedNode.kind === "collection" ? (
            <ShelfPanel node={selectedNode} members={[...neighbours].map((id) => byId.get(id)).filter((n): n is LaidOutNode => !!n)} onPick={setSelected} onFilter={() => setCollection(selectedNode.id.slice("collection:".length))} />
          ) : selectedNode.kind === "source" ? (
            <SourcePanel node={selectedNode} members={[...neighbours].map((id) => byId.get(id)).filter((n): n is LaidOutNode => !!n)} onPick={setSelected} onFilter={() => setDataType((selectedNode.sourceKind as DataTypeFilter) ?? "ALL")} />
          ) : (
            <DocumentPanel node={selectedNode} edges={selectedEdges} byId={byId} onPick={setSelected} onSearch={setQuery} />
          )}
        </aside>
      </div>
    </div>
  );
}

function ShelfPanel({ node, members, onPick, onFilter }: { node: LaidOutNode; members: LaidOutNode[]; onPick: (id: string) => void; onFilter: () => void }) {
  return (
    <>
      <p className="inline-flex items-center gap-1.5 font-heading text-[13px] font-semibold"><FolderOpen size={13} /> {node.name}</p>
      <p className="text-muted-foreground">{members.length} document{members.length === 1 ? "" : "s"} on this shelf.</p>
      <button type="button" onClick={onFilter} className="self-start rounded-md border border-border px-2 py-1 font-heading text-[11.5px] font-medium hover:bg-accent/40">Filter to this shelf</button>
      <ul className="mt-1 flex flex-col gap-1">
        {members.map((m) => (
          <li key={m.id}>
            <button type="button" onClick={() => onPick(m.id)} className="truncate text-left hover:underline">{m.name}</button>
          </li>
        ))}
      </ul>
    </>
  );
}

function SourcePanel({ node, members, onPick, onFilter }: { node: LaidOutNode; members: LaidOutNode[]; onPick: (id: string) => void; onFilter: () => void }) {
  return (
    <>
      <p className="inline-flex items-center gap-1.5 font-heading text-[13px] font-semibold"><Database size={13} /> {node.name}</p>
      <p className="font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground">
        {node.sourceKind === "POSTGRES" ? "PostgreSQL" : node.sourceKind} · {node.status?.toLowerCase()} · external store
      </p>
      <p className="text-muted-foreground">
        The data stays in the source; Servo holds {members.length} indexed record{members.length === 1 ? "" : "s"} and catalog card{members.length === 1 ? "" : "s"} describing it, which is what agents search and cite.
      </p>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" onClick={onFilter} className="rounded-md border border-border px-2 py-1 font-heading text-[11.5px] font-medium hover:bg-accent/40">Filter to {node.sourceKind === "POSTGRES" ? "PostgreSQL" : node.sourceKind}</button>
        <Link href="/kb/sources" className="rounded-md border border-border px-2 py-1 font-heading text-[11.5px] font-medium hover:bg-accent/40">Manage sources</Link>
      </div>
      <ul className="mt-1 flex flex-col gap-1">
        {members.map((m) => (
          <li key={m.id}>
            <button type="button" onClick={() => onPick(m.id)} className="truncate text-left hover:underline">{m.name}</button>
          </li>
        ))}
      </ul>
    </>
  );
}

function DocumentPanel({ node, edges, byId, onPick, onSearch }: { node: LaidOutNode; edges: GraphEdge[]; byId: Map<string, LaidOutNode>; onPick: (id: string) => void; onSearch: (q: string) => void }) {
  const shelf = node.collectionId ? byId.get(`collection:${node.collectionId}`) : null;
  const source = node.sourceId ? byId.get(`source:${node.sourceId}`) : null;
  const links = edges.filter((e) => e.kind !== "MEMBER" && e.kind !== "FROM_SOURCE");
  return (
    <>
      <p className="inline-flex items-start gap-1.5 font-heading text-[13px] font-semibold"><FileText size={13} className="mt-0.5 shrink-0" /> <span className="break-words">{node.name}</span></p>
      <p className="font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground">
        {node.docKind === "CATALOG" ? "catalog card" : "file"} · {node.visibility} · {node.textStatus === "EXTRACTED" ? "indexed" : node.textStatus?.toLowerCase()}
        {shelf ? ` · ${shelf.name}` : " · uncategorized"}
      </p>
      {source && (
        <button type="button" onClick={() => onPick(source.id)} className="self-start font-mono text-[10.5px] text-muted-foreground hover:underline">
          from {source.sourceKind === "POSTGRES" ? "PostgreSQL" : source.sourceKind} source “{source.name}”
        </button>
      )}
      <Link href={`/kb/${node.id}`} className="self-start rounded-md border border-border px-2 py-1 font-heading text-[11.5px] font-medium hover:bg-accent/40">Open document</Link>
      {(node.topics?.length ?? 0) > 0 && (
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Topics</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {node.topics!.map((t) => (
              <button key={t} type="button" onClick={() => onSearch(t)} className="rounded-full border border-primary/40 px-1.5 py-px font-heading text-[10.5px] leading-4 hover:bg-accent">{t}</button>
            ))}
          </div>
        </div>
      )}
      {(node.keywords?.length ?? 0) > 0 && (
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Keywords</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {node.keywords!.map((k) => (
              <button key={k} type="button" onClick={() => onSearch(k)} className="rounded-full border border-border px-1.5 py-px font-mono text-[10.5px] leading-4 text-muted-foreground hover:bg-accent">{k}</button>
            ))}
          </div>
        </div>
      )}
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Links · {links.length}</p>
        {links.length === 0 ? (
          <p className="mt-1 text-muted-foreground">No shared names, keywords or facts with another document you can read.</p>
        ) : (
          <ul className="mt-1 flex flex-col gap-1.5">
            {links.map((e, i) => {
              const otherId = e.from === node.id ? e.to : e.from;
              const other = byId.get(otherId);
              return (
                <li key={`${otherId}-${e.kind}-${i}`}>
                  <button type="button" onClick={() => onPick(otherId)} className="truncate text-left font-medium hover:underline">{other?.name ?? otherId}</button>
                  <p className="font-mono text-[10px] text-muted-foreground">
                    {EDGE_STYLE[e.kind]?.label ?? e.kind.toLowerCase()} · {e.weight.toFixed(2)}
                    {e.evidence.length > 0 ? ` · ${e.evidence.slice(0, 4).join(", ")}` : ""}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
