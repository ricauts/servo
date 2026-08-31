// Card rendering (cat-06): CatalogEntry profile → the card's chunk text.
// DETERMINISTIC: the same profile produces byte-identical text and therefore
// identical chunks — no clock, no locale, no provider. Exactly FOUR section
// kinds, each a chunk with the {entry, section, from?} locator:
//
//   overview   — <=1500 chars, exactly ONE per entry
//   columns    — <=1200 chars per chunk, 12 columns per chunk, every column
//                exactly once, split by window with an ordinal when wide
//   values     — <=800 chars, one per low-cardinality INTERNAL column
//   freshness  — <=600 chars, exactly one
//
// The fqn and display name ride EVERY chunk, and each chunk's first line
// carries derivation provenance (the profile date and exact-vs-sampled).
// There is NO sample section and NO row card at any altitude — the only
// values that can appear are the ones cat-02's gate already passed, and the
// renderer re-applies the gate rather than trusting the caller.

import { gateExemplars } from "./exemplars";
import type { Classification } from "./classify";

/** The renderer's entire world: the tier-1/tier-2 facts for ONE entry. */
export interface RenderInput {
  fqn: string;
  displayName: string;
  dataSourceId: string;
  profiledAt: string; // ISO date — provenance, not a clock read
  exact: boolean; // whether counts are exact or sampled
  description: string | null; // the source's own COMMENT
  rows: number | null;
  bytes?: number | null;
  objectCount?: number | null;
  extensions?: Record<string, number>;
  oldest?: string | null;
  newest?: string | null;
  columns: RenderColumn[];
  /** The k-floored top-K per column, as tier 2 recorded it. */
  topKByColumn?: Record<string, { value: string; count: number }[]>;
  kFloor?: number;
  topKCap?: number;
}

export interface RenderColumn {
  name: string;
  declaredType: string;
  nullable: boolean;
  isPrimaryKey: boolean;
  /** The FK target, split, with whether both endpoints share the entry's
   *  dataSourceId — cross-source FKs render as NOTHING (no foreign FQN and
   *  no foreign column name may appear in any card). */
  references: { table: string; column: string; sameSource: boolean } | null;
  isUnique: boolean;
  comment: string | null;
  classification: Pick<Classification, "semanticType" | "sensitivity">;
  distinct?: number | null;
  nullFraction?: number | null;
}

export interface RenderedChunk {
  text: string;
  locator: { entry: string; section: "overview" | "columns" | "values" | "freshness"; from?: string };
}

const COLUMNS_PER_CHUNK = 12;
const KFLOOR = 5;
const TOPK_CAP = 3;

export function renderCard(input: RenderInput): RenderedChunk[] {
  const chunks: RenderedChunk[] = [];
  const provenance = `derived from the ${input.exact ? "exact" : "sampled"} profile of ${input.profiledAt}`;
  // The name's PARTS ride the head as bare words: full-text tokenizers
  // merge "public.payroll" into ONE lexeme, so without the spaced form a
  // plain "payroll" query could never find the card.
  const parts = [...new Set(input.displayName.split(/[^A-Za-z0-9]+/).filter((w) => w.length > 1))];
  const head = `${input.displayName} (${input.fqn}) · ${parts.join(" ")} — ${provenance}`;

  // --- overview: exactly one, <=1500 -------------------------------------
  const overviewParts: string[] = [];
  if (input.description) overviewParts.push(`Description: ${input.description}`);
  const scale: string[] = [];
  if (input.rows !== null && input.rows !== undefined) scale.push(`${input.rows.toLocaleString("en-US")} rows`);
  if (input.objectCount !== undefined && input.objectCount !== null) {
    scale.push(`${input.objectCount.toLocaleString("en-US")} objects`);
  }
  if (input.bytes !== undefined && input.bytes !== null) scale.push(`${Math.round(input.bytes / 1024)} KiB`);
  if (input.extensions && Object.keys(input.extensions).length > 0) {
    scale.push(
      `extensions: ${Object.entries(input.extensions)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([e, n]) => `${e}×${n}`)
        .join(", ")}`,
    );
  }
  if (scale.length > 0) overviewParts.push(`Scale: ${scale.join(", ")}`);
  overviewParts.push(`Columns: ${input.columns.length} (${summariseColumns(input.columns)})`);
  const overview = clamp(`${head}\n${overviewParts.join("\n")}`, 1500);
  chunks.push({ text: overview, locator: { entry: entryId(input), section: "overview" } });

  // --- columns: every column exactly once, 12 per chunk, <=1200 ----------
  const columnLines = input.columns.map((c) => renderColumnLine(input, c));
  for (let start = 0; start < columnLines.length; start += COLUMNS_PER_CHUNK) {
    const window = columnLines.slice(start, start + COLUMNS_PER_CHUNK);
    const ordinal = columnLines.length > COLUMNS_PER_CHUNK ? ` (part ${Math.floor(start / COLUMNS_PER_CHUNK) + 1}/${Math.ceil(columnLines.length / COLUMNS_PER_CHUNK)})` : "";
    const text = clamp(`${head}\ncolumns${ordinal}\n${window.join("\n")}`, 1200);
    const first = input.columns[start]?.name;
    chunks.push({
      text,
      locator: { entry: entryId(input), section: "columns", ...(first ? { from: first } : {}) },
    });
  }

  // --- values: one per low-cardinality INTERNAL column, <=800 ------------
  for (const col of input.columns) {
    if (col.classification.sensitivity !== "INTERNAL") continue;
    if (!isLowCardinality(col)) continue;
    const gated = gateExemplars({
      classification: col.classification,
      topK: (input.topKByColumn?.[col.name] ?? []).map((v) => ({ value: String(v.value), count: Number(v.count) })),
      kFloor: input.kFloor ?? KFLOOR,
      topKCap: input.topKCap ?? TOPK_CAP,
    });
    if (gated.length === 0) continue;
    const members = gated.map((g) => `${g.value} (×${g.count})`).join(", ");
    const text = clamp(`${head}\nvalues of ${col.name}: ${members}`, 800);
    chunks.push({ text, locator: { entry: entryId(input), section: "values", from: col.name } });
  }

  // --- freshness: exactly one, <=600 --------------------------------------
  const freshParts: string[] = [];
  if (input.newest) freshParts.push(`newest object ${input.newest}`);
  if (input.oldest) freshParts.push(`oldest object ${input.oldest}`);
  if (input.profiledAt) freshParts.push(`profiled ${input.profiledAt}`);
  const fresh = clamp(`${head}\nfreshness: ${freshParts.join("; ") || "no dates recorded"}`, 600);
  chunks.push({ text: fresh, locator: { entry: entryId(input), section: "freshness" } });

  return chunks;
}

function entryId(input: RenderInput): string {
  // The entry id the persist step assigns; deterministic from the source.
  return `${input.dataSourceId}:${input.fqn}`;
}

function renderColumnLine(input: RenderInput, c: RenderColumn): string {
  const bits: string[] = [`- ${c.name} ${c.declaredType}`];
  if (c.nullable) bits.push("nullable");
  if (c.isPrimaryKey) bits.push("primary key");
  // Declared FKs render ONLY when both endpoints share the source — a
  // cross-source reference would leak a foreign FQN into the card.
  if (c.references?.sameSource) {
    bits.push(`references ${c.references.table}.${c.references.column} of this source`);
  }
  if (c.distinct !== undefined && c.distinct !== null) bits.push(`${c.distinct} distinct`);
  if (c.nullFraction !== undefined && c.nullFraction !== null && c.nullFraction > 0) {
    bits.push(`${Math.round(c.nullFraction * 100)}% null`);
  }
  if (c.comment) bits.push(`source note: ${c.comment}`);
  bits.push(c.classification.semanticType.toLowerCase());
  return bits.join(", ");
}

function isLowCardinality(c: RenderColumn): boolean {
  return (c.distinct ?? Infinity) <= 25;
}

function summariseColumns(columns: RenderColumn[]): string {
  const byType = new Map<string, number>();
  for (const c of columns) {
    const key = c.classification.semanticType;
    byType.set(key, (byType.get(key) ?? 0) + 1);
  }
  return [...byType.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([t, n]) => `${n} ${t.toLowerCase()}`)
    .join(", ");
}

function clamp(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

/** The document summary: <=220 chars, deterministic. */
export function cardSummary(input: RenderInput): string {
  const scale =
    input.rows !== null && input.rows !== undefined
      ? `${input.rows.toLocaleString("en-US")} rows`
      : input.objectCount !== undefined && input.objectCount !== null
        ? `${input.objectCount.toLocaleString("en-US")} objects`
        : "unknown scale";
  const base = `${input.displayName}: ${scale}, ${input.columns.length} columns.`;
  return base.length <= 220 ? base : `${base.slice(0, 219)}…`;
}
