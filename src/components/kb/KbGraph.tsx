"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Database, FileText, FolderOpen, Maximize2, Search, X, ZoomIn, ZoomOut } from "lucide-react";
import {
  curvedEdgeMidpoint,
  curvedEdgePath,
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
import { Chip, chipClass, sourceStatusTone, textStatusTone, visibilityTone, type ChipTone } from "@/components/kb/KbChip";
import { BTN_ICON, BTN_OUTLINE_SM, INPUT, LABEL, SEGMENT_GROUP, SELECT, segmentClass } from "@/components/kb/kb-controls";

const CANVAS = { width: 1200, height: 800 };
const IDENTITY = { x: 0, y: 0, k: 1 };
const ZOOM = { min: 0.3, max: 4, step: 1.2 };

const DATA_TYPE_LABEL: Record<DataTypeFilter, string> = {
  ALL: "All types",
  FILE: "Files",
  CATALOG: "Catalog cards",
  S3: "S3",
  POSTGRES: "PostgreSQL",
};

/**
 * Edge kinds: the stroke that tells them apart on the canvas, the chip tone
 * the panel and legend use for the same kind, and the label. Membership is
 * a hairline; the two "came from / names the same thing" links take the
 * brand series (--chart-2, the dataviz blue); shared facts take the warn
 * gold; shared keywords are a muted dash. Strokes follow the chart rule:
 * 1.75px for a typed link, a hairline for structure.
 */
const EDGE_STYLE: Record<string, { stroke: string; width: number; dash?: string; tone: ChipTone; label: string }> = {
  MEMBER: { stroke: "var(--line-strong)", width: 1, tone: "neutral", label: "on shelf" },
  FROM_SOURCE: { stroke: "var(--chart-2)", width: 1.25, dash: "5 4", tone: "info", label: "from source" },
  SHARED_ENTITY: { stroke: "var(--chart-2)", width: 1.75, tone: "brand", label: "shared names" },
  SHARED_KEYWORD: { stroke: "var(--text-faint)", width: 1.25, dash: "3 3", tone: "neutral", label: "shared keywords" },
  SHARED_FACT: { stroke: "var(--warn)", width: 1.75, tone: "warn", label: "shared facts" },
  SAME_COLLECTION: { stroke: "var(--line)", width: 1, dash: "2 3", tone: "neutral", label: "same shelf" },
};

function edgeStyle(kind: string) {
  return EDGE_STYLE[kind] ?? EDGE_STYLE.SHARED_KEYWORD;
}

/** Shelves and sources grow with what hangs off them; documents stay small. */
function nodeRadius(n: LaidOutNode): number {
  if (n.kind === "document") return n.docKind === "CATALOG" ? 8 : 9;
  return 14 + Math.min(10, (n.size ?? 1) * 2);
}

/** A label's backplate width, from the glyph count — SVG has no measure
 *  here, and a plate a few pixels generous reads better than one that clips. */
function labelWidth(text: string, fontSize: number, em = 0.58): number {
  return Math.round(text.length * fontSize * em) + 14;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function sourceKindLabel(kind: string | undefined): string {
  return kind === "POSTGRES" ? "PostgreSQL" : (kind ?? "source");
}

/** A client point in canvas (viewBox) units, through the SVG's own screen
 *  matrix — exact even when the viewBox is letterboxed inside the element. */
function toCanvas(svg: SVGSVGElement, clientX: number, clientY: number): { x: number; y: number } {
  const ctm = svg.getScreenCTM();
  if (!ctm) return { x: CANVAS.width / 2, y: CANVAS.height / 2 };
  const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
  return { x: p.x, y: p.y };
}

/**
 * The interactive knowledge graph (kb-lib-3). Pure layout from graph-view.ts
 * (seeded, so the same corpus draws the same picture every time), SVG with
 * wheel zoom, drag-to-pan and a Fit reset, three filters that DIM rather
 * than remove (a node that disappears takes its context with it), and a
 * side panel for the selected node with links into the library.
 */
export default function KbGraph() {
  const [view, setView] = useState<GraphView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [visibility, setVisibility] = useState<VisibilityFilter>("ALL");
  const [collection, setCollection] = useState<string>("ALL");
  const [dataType, setDataType] = useState<DataTypeFilter>("ALL");
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [hoveredEdge, setHoveredEdge] = useState<number | null>(null);
  const [transform, setTransform] = useState(IDENTITY);
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

  /** Zoom by a factor around a canvas point (the cursor, or the centre). */
  const zoomBy = useCallback((factor: number, cx = CANVAS.width / 2, cy = CANVAS.height / 2) => {
    setTransform((t) => {
      const k = Math.min(ZOOM.max, Math.max(ZOOM.min, t.k * factor));
      return { k, x: cx - ((cx - t.x) * k) / t.k, y: cy - ((cy - t.y) * k) / t.k };
    });
  }, []);

  // Wheel zoom must cancel the page scroll, and React registers `wheel` on
  // the root as a PASSIVE listener, where preventDefault is a no-op — so the
  // listener is attached natively, non-passive, once the canvas exists.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const { x, y } = toCanvas(svg!, e.clientX, e.clientY);
      zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1, x, y);
    }
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [view, zoomBy]);

  function onPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    if ((e.target as Element).closest("[data-node]")) return;
    drag.current = { x: e.clientX, y: e.clientY, tx: transform.x, ty: transform.y };
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (!drag.current) return;
    // Screen pixels → canvas units: the CTM's scale, not the element's width
    // (which over-counts when the viewBox is letterboxed).
    const ctm = svgRef.current?.getScreenCTM();
    const scale = ctm ? 1 / ctm.a : 1;
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
    return <p className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">{error}</p>;
  }
  if (!view) {
    return <p className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">Laying out the graph…</p>;
  }
  if (view.nodes.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        Nothing to draw yet — upload a document, or ask for access to one.
      </p>
    );
  }

  const docCount = laidOut.filter((n) => n.kind === "document").length;
  const kindsPresent = new Set(view.edges.map((e) => e.kind));
  const hoveredEdgeView = hoveredEdge !== null ? view.edges[hoveredEdge] : null;

  return (
    <div className="flex h-full min-h-[560px] flex-col gap-3">
      {/* Toolbar: one 32px row — search, visibility, shelf, data type, counts. */}
      <div className="flex flex-wrap items-center gap-2" data-testid="kb-graph-filters">
        <div className="relative min-w-[220px] flex-1">
          <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Highlight by name, topic or keyword"
            aria-label="Highlight nodes"
            className={`${INPUT} pl-7 pr-7`}
          />
          {query && (
            <button type="button" aria-label="Clear" onClick={() => setQuery("")} className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground">
              <X size={12} />
            </button>
          )}
        </div>
        <div role="group" aria-label="Visibility" className={SEGMENT_GROUP}>
          {VISIBILITY_FILTERS.map((v) => (
            <button key={v} type="button" aria-pressed={visibility === v} onClick={() => setVisibility(v)} className={segmentClass(visibility === v)}>
              {v === "ALL" ? "All" : v.toLowerCase()}
            </button>
          ))}
        </div>
        <select value={collection} onChange={(e) => setCollection(e.target.value)} aria-label="Collection" className={SELECT}>
          <option value="ALL">All shelves</option>
          <option value="NONE">Uncategorized</option>
          {shelves.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        <select value={dataType} onChange={(e) => setDataType(e.target.value as DataTypeFilter)} aria-label="Data type" className={SELECT}>
          {DATA_TYPES.map((t) => (
            <option key={t} value={t}>{DATA_TYPE_LABEL[t]}</option>
          ))}
        </select>
        <span className="font-mono text-[10.5px] text-muted-foreground">
          {docCount} document{docCount === 1 ? "" : "s"} · {shelves.length} shel{shelves.length === 1 ? "f" : "ves"} · {sourceCount} source{sourceCount === 1 ? "" : "s"} · {view.edges.length} link{view.edges.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="grid min-h-0 flex-1 gap-3 md:grid-cols-[minmax(0,1fr)_300px]">
        {/* The canvas: SVG on top, the legend as a chip strip beneath it. */}
        <div className="flex min-h-[520px] flex-col overflow-hidden rounded-lg border border-border bg-card">
          <div className="relative min-h-0 flex-1">
            <svg
              ref={svgRef}
              viewBox={`0 0 ${CANVAS.width} ${CANVAS.height}`}
              className="h-full w-full touch-none select-none"
              role="img"
              aria-label="Knowledge graph"
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
                  const style = edgeStyle(e.kind);
                  const on = lit.has(a.id) && lit.has(b.id);
                  const touching = selected !== null && (e.from === selected || e.to === selected);
                  const emphasised = touching || hoveredEdge === i;
                  const d = curvedEdgePath(a, b);
                  return (
                    <g key={`${e.from}-${e.to}-${e.kind}-${i}`} onPointerEnter={() => setHoveredEdge(i)} onPointerLeave={() => setHoveredEdge((h) => (h === i ? null : h))}>
                      <path
                        d={d}
                        fill="none"
                        stroke={style.stroke}
                        strokeDasharray={style.dash}
                        strokeLinecap="round"
                        strokeWidth={emphasised ? 2.5 : e.kind === "MEMBER" ? style.width : style.width + Math.min(1.25, e.weight)}
                        opacity={on ? (selected && !touching ? 0.35 : 0.9) : 0.12}
                      />
                      {/* A wide invisible twin so the hover target is not a hairline. */}
                      <path d={d} fill="none" stroke="transparent" strokeWidth={14} pointerEvents="stroke" />
                    </g>
                  );
                })}
                {laidOut.map((n) => {
                  const on = lit.has(n.id);
                  const isSel = n.id === selected;
                  const isNeighbour = neighbours.has(n.id);
                  const r = nodeRadius(n);
                  // Node strokes are the tone's INK, not its hairline: a 9px
                  // disc has no text inside to carry the tone, and a chip
                  // hairline on a white canvas is invisible at that size.
                  // Selection recolours to brand; a neighbour thickens.
                  const strokeW = isSel ? 2.5 : isNeighbour ? 2.25 : 1.5;
                  const fontSize = n.kind === "collection" ? 12 : 11;
                  const text = truncate(n.name, n.kind === "collection" ? 28 : 32);
                  const plateW = labelWidth(text, fontSize);
                  const plateH = fontSize + 8;
                  const plateTop = r + (n.kind === "source" ? 10 : 6);
                  const glyph = Math.round(r * (n.kind === "source" ? 0.9 : 1.05));
                  return (
                    <g
                      key={n.id}
                      data-node={n.id}
                      transform={`translate(${n.x} ${n.y})`}
                      opacity={on ? 1 : 0.2}
                      style={{ cursor: "pointer" }}
                      onClick={() => setSelected(isSel ? null : n.id)}
                      onPointerEnter={() => setHovered(n.id)}
                      onPointerLeave={() => setHovered((h) => (h === n.id ? null : h))}
                    >
                      {/* The halo: a second disc at 12% brand ink — no filter, no glow. */}
                      {(isSel || hovered === n.id) && <circle r={r + 8} fill="var(--brand)" fillOpacity={0.12} />}
                      {n.kind === "collection" ? (
                        <>
                          <rect x={-r} y={-r} width={r * 2} height={r * 2} rx={Math.round(r * 0.35)}
                            fill="var(--brand-chip)"
                            stroke={isSel ? "var(--brand)" : "var(--brand-chip-ink)"}
                            strokeWidth={strokeW} />
                          <FolderOpen x={-glyph / 2} y={-glyph / 2} size={glyph} strokeWidth={1.75} color="var(--brand-chip-ink)" aria-hidden />
                        </>
                      ) : n.kind === "source" ? (
                        // A diamond: the external store (S3 / PostgreSQL) the
                        // documents beneath it were crawled or described from.
                        // A source that is not READY takes the warn ink.
                        <>
                          <polygon points={`0,${-r - 4} ${r + 4},0 0,${r + 4} ${-r - 4},0`}
                            fill="var(--info-chip)"
                            stroke={isSel ? "var(--brand)" : n.status === "READY" ? "var(--info-chip-ink)" : "var(--warn-chip-ink)"}
                            strokeWidth={strokeW} />
                          <Database x={-glyph / 2} y={-glyph / 2} size={glyph} strokeWidth={1.75} color="var(--info-chip-ink)" aria-hidden />
                        </>
                      ) : n.docKind === "CATALOG" ? (
                        // A catalog card: the data lives in the external store;
                        // the node is its description. The document disc,
                        // drawn hollow and dashed in the source tone.
                        <circle r={r}
                          fill="var(--surface)"
                          stroke={isSel ? "var(--brand)" : "var(--info-chip-ink)"}
                          strokeWidth={strokeW} strokeDasharray="3 2" />
                      ) : (
                        <circle r={r}
                          fill={n.visibility === "PUBLIC" ? "var(--good-chip)" : n.visibility === "STAFF" ? "var(--warn-chip)" : "var(--neutral-chip)"}
                          stroke={
                            isSel ? "var(--brand)"
                            : n.textStatus !== "EXTRACTED" ? "var(--critical-chip-ink)"
                            : n.visibility === "PUBLIC" ? "var(--good-chip-ink)"
                            : n.visibility === "STAFF" ? "var(--warn-chip-ink)"
                            : "var(--neutral-chip-ink)"
                          }
                          strokeDasharray={n.textStatus !== "EXTRACTED" ? "3 2" : undefined}
                          strokeWidth={strokeW} />
                      )}
                      {/* The label on a small opaque plate, so it stays legible over edges. */}
                      <g transform={`translate(0 ${plateTop})`}>
                        <rect x={-plateW / 2} y={0} width={plateW} height={plateH} rx={4}
                          fill="var(--surface)"
                          stroke={isSel ? "var(--brand)" : "var(--line)"}
                          strokeWidth={1} />
                        <text
                          y={plateH / 2}
                          textAnchor="middle"
                          dominantBaseline="central"
                          fontSize={fontSize}
                          fontWeight={n.kind === "collection" || isSel ? 600 : 500}
                          fill={on ? "var(--text-strong)" : "var(--text-muted)"}
                        >
                          {text}
                        </text>
                      </g>
                    </g>
                  );
                })}
                {/* The hovered edge's label, drawn last so it sits above every node. */}
                {hoveredEdgeView && (() => {
                  const a = byId.get(hoveredEdgeView.from);
                  const b = byId.get(hoveredEdgeView.to);
                  if (!a || !b) return null;
                  const style = edgeStyle(hoveredEdgeView.kind);
                  const m = curvedEdgeMidpoint(a, b);
                  const text = truncate(
                    `${style.label} · ${hoveredEdgeView.weight.toFixed(2)}${hoveredEdgeView.evidence.length > 0 ? ` · ${hoveredEdgeView.evidence.slice(0, 3).join(", ")}` : ""}`,
                    64,
                  );
                  const w = labelWidth(text, 10.5, 0.62);
                  return (
                    <g transform={`translate(${m.x} ${m.y})`} pointerEvents="none">
                      <rect x={-w / 2} y={-9} width={w} height={18} rx={4} fill="var(--surface)" stroke={style.stroke} strokeWidth={1} />
                      <text textAnchor="middle" dominantBaseline="central" fontSize={10.5} className="font-mono" fill="var(--text-body)">
                        {text}
                      </text>
                    </g>
                  );
                })()}
              </g>
            </svg>
            {/* Zoom controls: opaque, floating, one group. */}
            <div className="absolute right-2 top-2 flex overflow-hidden rounded-lg border border-border bg-card shadow-(--shadow-1)" role="group" aria-label="Zoom">
              <button type="button" aria-label="Zoom in" title="Zoom in" onClick={() => zoomBy(ZOOM.step)} className={BTN_ICON}><ZoomIn size={14} /></button>
              <button type="button" aria-label="Zoom out" title="Zoom out" onClick={() => zoomBy(1 / ZOOM.step)} className={`${BTN_ICON} border-l border-border`}><ZoomOut size={14} /></button>
              <button type="button" title="Fit the whole graph" onClick={() => setTransform(IDENTITY)} className={`${BTN_ICON} w-auto gap-1.5 border-l border-border px-2.5 font-heading text-[11.5px] font-medium`}>
                <Maximize2 size={13} /> Fit
              </button>
            </div>
          </div>
          {/* Legend: the node and link vocabulary, as chips. */}
          <div className="flex flex-wrap items-center gap-1.5 border-t border-border bg-(--surface-2) px-3 py-2" aria-label="Legend">
            <span className={`${LABEL} mr-1`}>Legend</span>
            <Chip tone="neutral" caps icon={<i className="inline-block size-2 rounded-full bg-current" />}>private</Chip>
            <Chip tone="warn" caps icon={<i className="inline-block size-2 rounded-full bg-current" />}>staff</Chip>
            <Chip tone="good" caps icon={<i className="inline-block size-2 rounded-full bg-current" />}>public</Chip>
            <Chip tone="critical" caps icon={<i className="inline-block size-2 rounded-full border border-dashed border-current" />}>not indexed</Chip>
            <Chip tone="brand" caps icon={<FolderOpen size={11} />}>shelf</Chip>
            {sourceCount > 0 && (
              <>
                <Chip tone="info" caps icon={<Database size={11} />}>source</Chip>
                <Chip tone="info" caps className="border-dashed" icon={<i className="inline-block size-2 rounded-full border border-dashed border-current" />}>catalog card</Chip>
              </>
            )}
            {[...kindsPresent].map((k) => {
              const style = edgeStyle(k);
              return (
                <Chip
                  key={k}
                  tone="neutral"
                  caps
                  icon={
                    <svg width={16} height={6} aria-hidden>
                      <line x1={0} y1={3} x2={16} y2={3} stroke={style.stroke} strokeWidth={2} strokeDasharray={style.dash} />
                    </svg>
                  }
                >
                  {style.label}
                </Chip>
              );
            })}
          </div>
        </div>

        {/* Side panel: a header strip naming the kind, then the node. */}
        <aside className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-card text-xs md:max-h-[760px]" data-testid="kb-graph-panel">
          <div className="flex items-center gap-2 border-b border-border bg-(--surface-2) px-3 py-2">
            {!selectedNode ? (
              <span className={LABEL}>Details</span>
            ) : selectedNode.kind === "collection" ? (
              <Chip tone="brand" caps icon={<FolderOpen size={11} />}>shelf</Chip>
            ) : selectedNode.kind === "source" ? (
              <Chip tone="info" caps icon={<Database size={11} />}>{sourceKindLabel(selectedNode.sourceKind)} source</Chip>
            ) : selectedNode.docKind === "CATALOG" ? (
              <Chip tone="info" caps className="border-dashed">catalog card</Chip>
            ) : (
              <Chip tone="neutral" caps icon={<FileText size={11} />}>file</Chip>
            )}
            {selectedNode && (
              <>
                <span className="ml-auto font-mono text-[10.5px] text-muted-foreground">
                  {selectedEdges.length} link{selectedEdges.length === 1 ? "" : "s"}
                </span>
                <button type="button" aria-label="Clear selection" onClick={() => setSelected(null)} className="rounded p-0.5 text-muted-foreground hover:text-foreground">
                  <X size={12} />
                </button>
              </>
            )}
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto p-3">
            {!selectedNode ? (
              <p className="text-muted-foreground">Click a node to see its shelf, topics, keywords and links. Scroll to zoom, drag the canvas to pan, hover a link for what it shares.</p>
            ) : selectedNode.kind === "collection" ? (
              <ShelfPanel node={selectedNode} members={[...neighbours].map((id) => byId.get(id)).filter((n): n is LaidOutNode => !!n)} onPick={setSelected} onFilter={() => setCollection(selectedNode.id.slice("collection:".length))} />
            ) : selectedNode.kind === "source" ? (
              <SourcePanel node={selectedNode} members={[...neighbours].map((id) => byId.get(id)).filter((n): n is LaidOutNode => !!n)} onPick={setSelected} onFilter={() => setDataType((selectedNode.sourceKind as DataTypeFilter) ?? "ALL")} />
            ) : (
              <DocumentPanel node={selectedNode} edges={selectedEdges} byId={byId} onPick={setSelected} onSearch={setQuery} />
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

function MemberList({ members, onPick }: { members: LaidOutNode[]; onPick: (id: string) => void }) {
  return (
    <ul className="flex flex-col gap-0.5">
      {members.map((m) => (
        <li key={m.id}>
          <button type="button" onClick={() => onPick(m.id)} className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left hover:bg-accent">
            <FileText size={12} className="shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">{m.name}</span>
            {m.visibility && <Chip tone={visibilityTone(m.visibility)} caps>{m.visibility}</Chip>}
          </button>
        </li>
      ))}
    </ul>
  );
}

function ShelfPanel({ node, members, onPick, onFilter }: { node: LaidOutNode; members: LaidOutNode[]; onPick: (id: string) => void; onFilter: () => void }) {
  return (
    <>
      <p className="font-heading text-[13.5px] font-semibold text-foreground">{node.name}</p>
      <p className="text-muted-foreground">{members.length} document{members.length === 1 ? "" : "s"} on this shelf.</p>
      <button type="button" onClick={onFilter} className={`${BTN_OUTLINE_SM} self-start`}>Filter to this shelf</button>
      <MemberList members={members} onPick={onPick} />
    </>
  );
}

function SourcePanel({ node, members, onPick, onFilter }: { node: LaidOutNode; members: LaidOutNode[]; onPick: (id: string) => void; onFilter: () => void }) {
  return (
    <>
      <p className="font-heading text-[13.5px] font-semibold text-foreground">{node.name}</p>
      <div className="flex flex-wrap gap-1">
        <Chip tone="neutral" caps>{sourceKindLabel(node.sourceKind)}</Chip>
        {node.status && <Chip tone={sourceStatusTone(node.status)} caps>{node.status}</Chip>}
        <Chip tone="neutral" caps>external store</Chip>
      </div>
      <p className="text-muted-foreground">
        The data stays in the source; Servo holds {members.length} indexed record{members.length === 1 ? "" : "s"} and catalog card{members.length === 1 ? "" : "s"} describing it, which is what agents search and cite.
      </p>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" onClick={onFilter} className={BTN_OUTLINE_SM}>Filter to {sourceKindLabel(node.sourceKind)}</button>
        <Link href="/kb/sources" className={BTN_OUTLINE_SM}>Manage sources</Link>
      </div>
      <MemberList members={members} onPick={onPick} />
    </>
  );
}

function DocumentPanel({ node, edges, byId, onPick, onSearch }: { node: LaidOutNode; edges: GraphEdge[]; byId: Map<string, LaidOutNode>; onPick: (id: string) => void; onSearch: (q: string) => void }) {
  const shelf = node.collectionId ? byId.get(`collection:${node.collectionId}`) : null;
  const source = node.sourceId ? byId.get(`source:${node.sourceId}`) : null;
  const links = edges.filter((e) => e.kind !== "MEMBER" && e.kind !== "FROM_SOURCE");
  return (
    <>
      <p className="break-words font-heading text-[13.5px] font-semibold text-foreground">{node.name}</p>
      <div className="flex flex-wrap gap-1">
        {node.visibility && <Chip tone={visibilityTone(node.visibility)} caps>{node.visibility}</Chip>}
        {node.textStatus && <Chip tone={textStatusTone(node.textStatus)} caps>{node.textStatus === "EXTRACTED" ? "indexed" : node.textStatus.toLowerCase()}</Chip>}
        {shelf ? (
          <button type="button" onClick={() => onPick(shelf.id)} className={chipClass("brand")} title="Open the shelf">
            <FolderOpen size={11} /> <span className="truncate">{shelf.name}</span>
          </button>
        ) : (
          <Chip tone="neutral">uncategorized</Chip>
        )}
        {source && (
          <button type="button" onClick={() => onPick(source.id)} className={chipClass("info")} title={`From the ${sourceKindLabel(source.sourceKind)} source "${source.name}"`}>
            <Database size={11} /> <span className="truncate">{source.name}</span>
          </button>
        )}
      </div>
      <Link href={`/kb/${node.id}`} className={`${BTN_OUTLINE_SM} self-start`}>Open document</Link>
      {(node.topics?.length ?? 0) > 0 && (
        <div>
          <p className={LABEL}>Topics</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {node.topics!.map((t) => (
              <button key={t} type="button" onClick={() => onSearch(t)} className={`${chipClass("brand", { face: "ui" })} hover:border-(--brand)`} title={`Highlight "${t}"`}>{t}</button>
            ))}
          </div>
        </div>
      )}
      {(node.keywords?.length ?? 0) > 0 && (
        <div>
          <p className={LABEL}>Keywords</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {node.keywords!.map((k) => (
              <button key={k} type="button" onClick={() => onSearch(k)} className={`${chipClass("neutral")} hover:border-(--line-strong)`} title={`Highlight "${k}"`}>{k}</button>
            ))}
          </div>
        </div>
      )}
      <div>
        <p className={LABEL}>Links · {links.length}</p>
        {links.length === 0 ? (
          <p className="mt-1 text-muted-foreground">No shared names, keywords or facts with another document you can read.</p>
        ) : (
          <ul className="mt-1 flex flex-col gap-2">
            {links.map((e, i) => {
              const otherId = e.from === node.id ? e.to : e.from;
              const other = byId.get(otherId);
              const style = edgeStyle(e.kind);
              const evidence = e.evidence.slice(0, 4);
              return (
                <li key={`${otherId}-${e.kind}-${i}`} className="rounded-lg border border-border bg-background px-2.5 py-2">
                  <button type="button" onClick={() => onPick(otherId)} className="block w-full truncate text-left font-heading text-[12.5px] font-medium text-foreground hover:underline underline-offset-2">{other?.name ?? otherId}</button>
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    <Chip tone={style.tone} caps>{style.label}</Chip>
                    <span className="font-mono text-[10.5px] text-muted-foreground">{e.weight.toFixed(2)}</span>
                  </div>
                  {evidence.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1" aria-label="Shared evidence">
                      {evidence.map((v) => (
                        <Chip key={v} tone="neutral" title={v}>{v}</Chip>
                      ))}
                      {e.evidence.length > evidence.length && (
                        <span className="font-mono text-[10.5px] text-muted-foreground">+{e.evidence.length - evidence.length}</span>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}
