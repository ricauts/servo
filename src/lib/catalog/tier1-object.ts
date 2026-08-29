// Tier-1 object-storage profiling (cat-05): the STRUCTURE of a bucket,
// read from LISTING responses only — tier 1 issues ZERO GETs. mapObjectListing
// is pure: a delimiter-walk listing (the shape S3 ListObjectsV2 returns)
// yields the prefix tree with per-prefix object counts, bytes, extension
// histogram, oldest/newest lastModified and depth; content type is inferred
// from the extension. Tier 2 (tier2-object.ts) is what opens objects.

export interface ListedObject {
  key: string;
  size: number;
  lastModified: string; // ISO
}

export interface PrefixNode {
  /** The prefix, with its trailing delimiter ("" at the root). */
  prefix: string;
  /** Objects stored DIRECTLY under this prefix (not in children). */
  objectCount: number;
  totalBytes: number;
  /** extension → count over the direct objects. */
  extensions: Record<string, number>;
  oldest: string | null;
  newest: string | null;
  depth: number;
  children: PrefixNode[];
}

const EXT_CONTENT_TYPES: Record<string, string> = {
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  json: "application/json",
  jsonl: "application/jsonl",
  ndjson: "application/jsonl",
  txt: "text/plain",
  md: "text/markdown",
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xlsm: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel",
  parquet: "application/vnd.apache.parquet",
  gz: "application/gzip",
  zip: "application/zip",
};

export function extensionOf(key: string): string {
  const base = key.split("/").pop() ?? key;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

export function contentTypeForExtension(ext: string): string {
  return EXT_CONTENT_TYPES[ext] ?? "application/octet-stream";
}

/**
 * Build the prefix tree from ONE flat listing (the caller may have walked
 * delimiters server-side or list everything — the tree is the same).
 * PURE: same objects (in any order) → an identical, key-sorted tree.
 */
export function mapObjectListing(objects: ListedObject[]): PrefixNode {
  const root: PrefixNode = node("", 0);
  const sorted = [...objects].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  for (const obj of sorted) {
    attach(root, obj);
  }
  sortTree(root);
  return root;
}

function node(prefix: string, depth: number): PrefixNode {
  return {
    prefix,
    objectCount: 0,
    totalBytes: 0,
    extensions: {},
    oldest: null,
    newest: null,
    depth,
    children: [],
  };
}

function attach(root: PrefixNode, obj: ListedObject): void {
  // "exports/finance/2026/q1.csv" walks exports/ → finance/ → 2026/, the
  // file itself landing as a direct object of 2026/.
  const parts = obj.key.split("/");
  let current = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const prefix = parts.slice(0, i + 1).join("/") + "/";
    let child = current.children.find((c) => c.prefix === prefix);
    if (!child) {
      child = node(prefix, i + 1);
      current.children.push(child);
    }
    current = child;
  }
  current.objectCount++;
  current.totalBytes += obj.size;
  const ext = extensionOf(obj.key);
  if (ext) current.extensions[ext] = (current.extensions[ext] ?? 0) + 1;
  if (current.oldest === null || obj.lastModified < current.oldest) current.oldest = obj.lastModified;
  if (current.newest === null || obj.lastModified > current.newest) current.newest = obj.lastModified;
}

function sortTree(n: PrefixNode): void {
  n.children.sort((a, b) => (a.prefix < b.prefix ? -1 : 1));
  for (const c of n.children) sortTree(c);
  // A prefix row carries its SUBTREE totals — the number a card shows is
  // "everything under this prefix", and oldest/newest over the subtree is
  // what a freshness view needs.
  for (const c of n.children) {
    n.objectCount += c.objectCount;
    n.totalBytes += c.totalBytes;
    for (const [ext, count] of Object.entries(c.extensions)) {
      n.extensions[ext] = (n.extensions[ext] ?? 0) + count;
    }
    if (c.oldest !== null && (n.oldest === null || c.oldest < n.oldest)) n.oldest = c.oldest;
    if (c.newest !== null && (n.newest === null || c.newest > n.newest)) n.newest = c.newest;
  }
}

/** Flatten the tree back to the prefix rows a CatalogEntry batch wants:
 *  one row per node, parent linked — fields ONLY from the tier-1 world. */
export interface PrefixRow {
  prefix: string;
  parentPrefix: string | null;
  depth: number;
  objectCount: number;
  totalBytes: number;
  extensions: Record<string, number>;
  oldest: string | null;
  newest: string | null;
  /** The power-of-two bucket the fingerprint hashes (cat-03). */
  objectCountBucket: number;
}

export function prefixRows(root: PrefixNode): PrefixRow[] {
  const rows: PrefixRow[] = [];
  const walk = (n: PrefixNode, parent: string | null) => {
    rows.push({
      prefix: n.prefix,
      parentPrefix: parent,
      depth: n.depth,
      objectCount: n.objectCount,
      totalBytes: n.totalBytes,
      extensions: Object.fromEntries(Object.entries(n.extensions).sort(([a], [b]) => a.localeCompare(b))),
      oldest: n.oldest,
      newest: n.newest,
      objectCountBucket: bucket(n.objectCount),
    });
    for (const c of n.children) walk(c, n.prefix);
  };
  walk(root, null);
  return rows;
}

function bucketPower(n: number): number {
  if (n <= 1) return 1;
  return 2 ** Math.floor(Math.log2(n));
}
function bucket(n: number): number {
  return bucketPower(n);
}
