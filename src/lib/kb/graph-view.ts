// The graph VIEW (kb-lib-3): the shape /api/kb/graph returns and the pure
// force layout the page draws it with. Nothing here touches the database —
// the route assembles the entitled nodes and edges, this file lays them
// out. Pure and seeded so the test can assert the layout twice and so the
// same corpus draws the same picture on every load (a graph that shuffles
// itself on refresh cannot be learned).

export interface GraphNode {
  id: string;
  /** document = a Document row (an upload, a crawled record or a catalog
   *  card); collection = a shelf; source = an external DataSource (S3,
   *  PostgreSQL…) at least one entitled document came from. */
  kind: "document" | "collection" | "source";
  name: string;
  /** Documents only. */
  visibility?: string;
  textStatus?: string;
  collectionId?: string | null;
  topics?: string[];
  keywords?: string[];
  /** Documents only: FILE (uploaded/crawled bytes) or CATALOG (a rendered
   *  description of a dataset that lives in the external store). */
  docKind?: "FILE" | "CATALOG";
  /** Documents only: the DataSource the record came from, when any. */
  sourceId?: string | null;
  /** Collections and sources: how many entitled documents hang off it. */
  size?: number;
  /** Sources only: S3 | POSTGRES, and the sync status. */
  sourceKind?: string;
  status?: string;
}

export interface GraphEdge {
  from: string;
  to: string;
  /** SHARED_ENTITY | SHARED_KEYWORD | SHARED_FACT | SAME_COLLECTION from the
   *  knowledge graph, MEMBER for document → collection membership, or
   *  FROM_SOURCE for document → the external DataSource it came from. */
  kind: string;
  weight: number;
  evidence: string[];
}

/** The data-type facets the graph page filters on. */
export const DATA_TYPES = ["ALL", "FILE", "CATALOG", "S3", "POSTGRES"] as const;
export type DataTypeFilter = (typeof DATA_TYPES)[number];

/** Whether a node passes the data-type facet. Collections always pass (they
 *  are structure, not data); a source passes on its own kind; a document
 *  passes on its docKind, or on its source's kind when the facet names one. */
export function matchesDataType(node: GraphNode, filter: DataTypeFilter, sourceKindOf: (id: string) => string | undefined): boolean {
  if (filter === "ALL" || node.kind === "collection") return true;
  if (node.kind === "source") return node.sourceKind === filter;
  if (filter === "FILE" || filter === "CATALOG") return node.docKind === filter;
  return !!node.sourceId && sourceKindOf(node.sourceId) === filter;
}

export interface GraphView {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface LaidOutNode extends GraphNode {
  x: number;
  y: number;
}

export interface LayoutOptions {
  width: number;
  height: number;
  iterations?: number;
  seed?: number;
}

/** Deterministic PRNG (mulberry32) — the layout must not depend on Math.random. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A small Fruchterman–Reingold-style force layout: every node repels every
 * other, every edge pulls its ends together (stronger for heavier edges),
 * a weak gravity keeps disconnected pieces on screen, and the step size
 * cools linearly. O(n²) per iteration — fine for the hundreds of documents
 * a desk's knowledge base holds; not meant for tens of thousands.
 */
export function layoutGraph(view: GraphView, opts: LayoutOptions): LaidOutNode[] {
  const { width, height } = opts;
  const iterations = opts.iterations ?? 300;
  const random = rng(opts.seed ?? 7);
  const n = view.nodes.length;
  if (n === 0) return [];

  const index = new Map(view.nodes.map((node, i) => [node.id, i]));
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  // Seed positions on a jittered circle so the first frame is already legible.
  for (let i = 0; i < n; i++) {
    const angle = (i / n) * Math.PI * 2;
    const r = Math.min(width, height) * 0.35 * (0.7 + 0.3 * random());
    xs[i] = width / 2 + Math.cos(angle) * r;
    ys[i] = height / 2 + Math.sin(angle) * r;
  }
  if (n === 1) return [{ ...view.nodes[0], x: xs[0], y: ys[0] }];

  const area = width * height;
  const k = Math.sqrt(area / n) * 0.6; // ideal edge length
  const edges = view.edges
    .map((e) => ({
      a: index.get(e.from),
      b: index.get(e.to),
      w: e.kind === "MEMBER" || e.kind === "FROM_SOURCE" ? 1.2 : 0.4 + Math.min(1, e.weight),
    }))
    .filter((e): e is { a: number; b: number; w: number } => e.a !== undefined && e.b !== undefined && e.a !== e.b);

  const dx = new Float64Array(n);
  const dy = new Float64Array(n);
  let temperature = Math.max(width, height) / 8;
  const cooling = temperature / iterations;

  for (let iter = 0; iter < iterations; iter++) {
    dx.fill(0);
    dy.fill(0);
    // Repulsion.
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let ddx = xs[i] - xs[j];
        let ddy = ys[i] - ys[j];
        let dist = Math.hypot(ddx, ddy);
        if (dist < 0.01) {
          // Coincident nodes: nudge deterministically.
          ddx = (random() - 0.5) * 0.1;
          ddy = (random() - 0.5) * 0.1;
          dist = Math.hypot(ddx, ddy) || 0.01;
        }
        const force = (k * k) / dist;
        const fx = (ddx / dist) * force;
        const fy = (ddy / dist) * force;
        dx[i] += fx;
        dy[i] += fy;
        dx[j] -= fx;
        dy[j] -= fy;
      }
    }
    // Attraction along edges.
    for (const e of edges) {
      const ddx = xs[e.a] - xs[e.b];
      const ddy = ys[e.a] - ys[e.b];
      const dist = Math.hypot(ddx, ddy) || 0.01;
      const force = ((dist * dist) / k) * e.w;
      const fx = (ddx / dist) * force;
      const fy = (ddy / dist) * force;
      dx[e.a] -= fx;
      dy[e.a] -= fy;
      dx[e.b] += fx;
      dy[e.b] += fy;
    }
    // Gravity toward the centre, so islands stay on screen.
    for (let i = 0; i < n; i++) {
      dx[i] += (width / 2 - xs[i]) * 0.02;
      dy[i] += (height / 2 - ys[i]) * 0.02;
    }
    // Move, capped by the temperature, clamped to the canvas.
    for (let i = 0; i < n; i++) {
      const len = Math.hypot(dx[i], dy[i]) || 0.01;
      const step = Math.min(len, temperature);
      xs[i] = clamp(xs[i] + (dx[i] / len) * step, 24, width - 24);
      ys[i] = clamp(ys[i] + (dy[i] / len) * step, 24, height - 24);
    }
    temperature = Math.max(0.5, temperature - cooling);
  }

  return view.nodes.map((node, i) => ({ ...node, x: round(xs[i]), y: round(ys[i]) }));
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
function round(v: number): number {
  return Math.round(v * 100) / 100;
}

/** The text a search box matches a node on: name, topics, keywords. */
export function nodeMatches(node: GraphNode, needle: string): boolean {
  const q = needle.trim().toLowerCase();
  if (!q) return true;
  if (node.name.toLowerCase().includes(q)) return true;
  if (node.topics?.some((t) => t.toLowerCase().includes(q))) return true;
  if (node.keywords?.some((k) => k.toLowerCase().includes(q))) return true;
  return false;
}
