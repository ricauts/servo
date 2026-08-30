// The Docling response contract (dcl-03): caps BEFORE parsing, then Zod
// over the consumed subset. The DoclingDocument format is used FORMAT-ONLY
// — exactly like SKILL.md in spec §6.4 — and the client that talks to
// docling-serve is hand-written in docling-client.ts; no npm package is
// consumed for either (docling-ts self-describes as an unstable draft and
// its published package id is UNVERIFIED; we read about ten fields).
//
// THE CAP ORDER IS THE SECURITY PROPERTY: Content-Length is checked before
// a byte is read; a streaming byte counter aborts MID-BODY when a server
// lies about length or sends none; the item count is capped after parse
// and before mapping; only then does Zod run over the consumed subset. A
// cap that buffers first and counts second would OOM the worker before it
// fired.

import { z } from "zod";

/** Response size ceiling: 32 MB of DoclingDocument is already enormous. */
export const DOCLING_MAX_BYTES = 32 * 1024 * 1024;
/** Item ceiling: a real manual carries hundreds, not millions. */
export const DOCLING_MAX_ITEMS = 20_000;

/** Every failure is a typed error, never a throw that escapes. */
export class DoclingError extends Error {
  constructor(
    public readonly code:
      | "docling-oversize"
      | "docling-too-many-items"
      | "docling-bad-json"
      | "docling-bad-schema"
      | "docling-task-failed"
      | "docling-task-abandoned"
      | "docling-transport",
    message: string,
  ) {
    super(message);
    this.name = "DoclingError";
  }
}

export const DoclingOversizeError = (detail: string) =>
  new DoclingError("docling-oversize", `Docling response exceeded ${DOCLING_MAX_BYTES} bytes: ${detail}`);

/**
 * bbox in Docling is points with a top-left origin: {l, t, r, b} against
 * the page's own width/height. Normalized here to 0-1 top-left — the
 * dcl-02 contract — so it survives any render scale.
 */
const BBoxPoints = z.object({
  l: z.number(),
  t: z.number(),
  r: z.number(),
  b: z.number(),
});

const Provenance = z.object({
  page_no: z.number().int().min(1),
  bbox: BBoxPoints.optional(),
});

/** The ~ten fields we consume. Unknown fields are ignored, never banned. */
const PictureItem = z.object({
  self_ref: z.string().optional(),
});

export const TextItem = z.object({
  item_type: z.literal("text"),
  self_ref: z.string().optional(),
  text: z.string(),
  prov: z.array(Provenance).min(1),
  label: z.string().optional(),
});
export type TextItemT = z.infer<typeof TextItem>;
export const TableItem = z.object({
  item_type: z.literal("table"),
  self_ref: z.string().optional(),
  prov: z.array(Provenance).min(1),
  label: z.string().optional(),
  data: z.object({
    num_rows: z.number().int().min(1),
    num_cols: z.number().int().min(1),
    table_cells: z
      .array(
        z.object({
          row: z.number().int().min(0),
          col: z.number().int().min(0),
          text: z.string(),
        }),
      )
      .default([]),
  }),
});
export type TableItemT = z.infer<typeof TableItem>;

export const DoclingItem = z.union([
  TextItem,
  z.object({
    item_type: z.literal("document-title"),
    self_ref: z.string().optional(),
    text: z.string(),
    prov: z.array(Provenance).min(1),
  }),
  z.object({
    item_type: z.literal("section-header"),
    self_ref: z.string().optional(),
    text: z.string(),
    prov: z.array(Provenance).min(1),
  }),
  TableItem,
  z.object({
    item_type: z.literal("picture"),
    self_ref: z.string().optional(),
    prov: z.array(Provenance).min(1),
    captions: z.array(z.string()).default([]),
  }),
  // Anything else is carried through as ignored structure — the format is
  // consumed additively and unknown item types must not fail extraction.
  z.object({
    item_type: z.string(),
    self_ref: z.string().optional(),
    prov: z.array(Provenance).default([]),
  }).passthrough(),
]);

export const DoclingDocument = z.object({
  schema_name: z.string().optional(),
  version: z.string().optional(),
  name: z.string().optional(),
  pages: z
    .object({
      page_no: z.number().int().min(1),
      size: z.object({ width: z.number(), height: z.number() }).optional(),
    })
    .array()
    .default([]),
  body: z.object({ children: z.array(z.string()).default([]) }).optional(),
  // The flattened item list the mapper walks. Item typing is additive:
  // known item_types carry their fields; every other type passes through
  // as ignored structure.
  items: z.array(DoclingItem).default([]),
  pictures: z.array(PictureItem).optional(),
});

/** The poll status payload. */
export const DoclingTaskStatus = z.object({
  task_status: z.enum(["pending", "started", "success", "failure"]),
  message: z.string().optional(),
});

export type DoclingItemT = z.infer<typeof DoclingItem>;
export type DoclingDocumentT = z.infer<typeof DoclingDocument>;
export type DoclingTaskStatusT = z.infer<typeof DoclingTaskStatus>;

/**
 * Consume a response body under the byte cap: Content-Length first, then a
 * streaming counter that aborts MID-BODY. `fetchBody` is injected so tests
 * drive it with stubs — no socket is ever opened in this suite.
 */
export async function readCappedBody(
  response: { headers: { get(name: string): string | null }; body: ReadableStream<Uint8Array> | null },
  opts: { abort: AbortSignal; maxBytes?: number; readChunk?: (reader: ReadableStreamDefaultReader<Uint8Array>, signal: AbortSignal) => Promise<Uint8Array | null> },
): Promise<Buffer> {
  const maxBytes = opts.maxBytes ?? DOCLING_MAX_BYTES;
  const readChunk = opts.readChunk ?? defaultReadChunk;
  const declared = response.headers.get("content-length");
  if (declared !== null && Number(declared) > maxBytes) {
    throw DoclingOversizeError(`Content-Length says ${declared}`);
  }
  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const parts: Buffer[] = [];
  let total = 0;
  for (;;) {
    const chunk = await readChunk(reader, opts.abort);
    if (chunk === null) break;
    total += chunk.byteLength;
    if (total > maxBytes) {
      // Abort MID-BODY: the reader is cancelled so the transport stops
      // delivering — this is the cap a post-buffer check would miss.
      await reader.cancel().catch(() => undefined);
      throw DoclingOversizeError(`streamed ${total} bytes and counting`);
    }
    parts.push(Buffer.from(chunk));
  }
  return Buffer.concat(parts);
}

async function defaultReadChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal,
): Promise<Uint8Array | null> {
  if (signal.aborted) throw new DoclingError("docling-transport", "aborted");
  return reader.read().then((r) => (r.done ? null : r.value));
}

/** Parse + item-count cap + Zod. Every failure is typed. */
export function parseCappedDocument(raw: Buffer, maxItems: number = DOCLING_MAX_ITEMS): DoclingDocumentT {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString("utf8"));
  } catch (err) {
    throw new DoclingError("docling-bad-json", err instanceof Error ? err.message : String(err));
  }
  const items = (parsed as { items?: unknown[] })?.items;
  if (Array.isArray(items) && items.length > maxItems) {
    throw new DoclingError("docling-too-many-items", `${items.length} items exceeds ${maxItems}`);
  }
  const verdict = DoclingDocument.safeParse(parsed);
  if (!verdict.success) {
    throw new DoclingError("docling-bad-schema", verdict.error.issues[0]?.message ?? "schema mismatch");
  }
  return verdict.data;
}
