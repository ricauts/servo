import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { forbid } from "@/lib/permissions";
import { kbSearch } from "@/lib/kb/search";
import { getEmbedSettings, embedWithEndpoint } from "@/lib/kb/embed";
import { mockEmbed, MOCK_EMBEDDER_MODEL } from "@/lib/kb/mock-embedder";
import { exponentFor } from "@/lib/kb/facts";
import { queryRuleset } from "@/lib/ai/tools/kb";
import { parseQueryFilters, QUERY_INPUT_CAP, type QueryFilter } from "@/lib/kb/query-filters";
import { formatLocator } from "@/lib/kb/locator";

export const dynamic = "force-dynamic";

/**
 * The operator's own filtered search (ext-08) — the readback made visible.
 *
 * `search_knowledge` already tells a MODEL what ext-06's phrase table read
 * out of its question. An operator got nothing: the same inference ran, and
 * the only evidence was a result set that looked mysteriously narrow. This
 * route returns EVERY parsed filter, dropped ones included, so the UI can
 * render what was inferred and hand back a control to remove it.
 *
 * NOTHING NEW IS INFERRED HERE. The parse is `parseQueryFilters` — ext-06's
 * one entry point, the same call the tool and the drafter make — and the
 * search is `kbSearch`, kb-10's single statement with the entitlement CTE in
 * its FROM clause. Filters NARROW an already-entitled candidate set; `drop`
 * only ever removes a filter, so it can only widen the CANDIDATE set back
 * towards what the unfiltered query would have returned, never past it. (The
 * rows returned are that set's top SEARCH_LIMIT by rank, so a widened search
 * can admit a candidate that outranks one previously shown — the guarantee is
 * about what may be considered, not about what fits in eight rows.)
 */

/** The most filters one search applies. Its own cap, not the tool's — the
 *  tool answers a model with a result budget, this answers an operator with a
 *  row of chips, and a readback nobody can read is not a readback. */
export const MAX_UI_FILTERS = 8;

/** Result rows one search returns. */
const SEARCH_LIMIT = 8;

export interface SearchFilterView {
  /** Index into the FULL parse — the id `drop` names. Stable for one query. */
  index: number;
  kind: string;
  comparator: string;
  /** The surface text the filter was read from, as the operator typed it. */
  text: string;
  confidence: string;
  /** The normalized value, rendered for a human: "≥ USD 2,000.00". */
  display: string;
  /** True when this filter was dropped by `drop` and did NOT narrow. */
  dropped: boolean;
}

export interface SearchHitView {
  documentId: string;
  docName: string;
  chunkId: string;
  locator: string;
  text: string;
}

export interface KbSearchResponse {
  /** The free text that reached the keyword pass. */
  residue: string;
  /** What the search actually ran on — residue, or the query verbatim. */
  queryUsed: string;
  filters: SearchFilterView[];
  /** Filters beyond MAX_UI_FILTERS that were parsed but not applied. */
  overflow: number;
  /** The cap `overflow` was measured against — sent so the readback can name
   *  it without the client importing this server module. */
  maxFilters: number;
  hits: SearchHitView[];
}

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

const COMPARATOR_GLYPH: Record<string, string> = {
  ">=": "≥",
  "<=": "≤",
  "=": "=",
  between: "between",
};

/**
 * The normalized value in words. MONEY is stored in MINOR UNITS, so it is
 * rendered through the currency's own exponent rather than divided by a
 * hardcoded 100 — JPY has no minor unit and would otherwise read 100× high.
 */
export function describeFilter(f: QueryFilter): string {
  if (f.kind === "DATE") {
    const start = isoDay(f.ts ?? 0);
    // tsEnd is EXCLUSIVE; a single day renders as the day, not as a range
    // whose second half nobody asked about.
    const end = isoDay((f.tsEnd ?? 0) - 1);
    return start === end ? start : `${start} → ${end}`;
  }
  if (f.num !== undefined) {
    const one = (n: number) => renderAmount(f.kind, n, f.unit ?? "");
    if (f.comparator === "between") return `between ${one(f.num)} and ${one(f.num2 ?? f.num)}`;
    return `${COMPARATOR_GLYPH[f.comparator] ?? f.comparator} ${one(f.num)}`;
  }
  return f.norm ?? "";
}

function renderAmount(kind: string, num: number, unit: string): string {
  if (kind === "MONEY") {
    const exponent = exponentFor(unit);
    if (exponent === null) return `${num} ${unit}`.trim();
    const major = num / 10 ** exponent;
    return `${unit} ${major.toFixed(exponent)}`;
  }
  if (kind === "DURATION") return `${num} s`;
  return unit === "" ? String(num) : `${num} ${unit}`;
}

/**
 * The OPERAND text of one filter, for the value fallback below.
 *
 * A one-sided filter's `text` IS its operand. A two-sided one's is the whole
 * span from the first operand to the second — "$1,000 and $2,000", "2025-01-05
 * y 2025-03-01" — so it carries the join word the parser consumed and the
 * readback has already told the operator was consumed. Feeding that to the
 * keyword pass demands the literal lexeme "and" or "y", which turns a range
 * question into a search for documents that happen to phrase the range the
 * same way the question did.
 *
 * TWO-SIDEDNESS IS READ FROM `operands`, NOT FROM THE COMPARATOR. A numeric
 * range carries comparator "between", but a DATE range carries "=" like every
 * other date — every date is an interval, so a range is just a wider one.
 * Keying on the comparator would fix "entre $1,000 y $2,000" and leave "entre
 * 2025-01-05 y 2025-03-01" broken, which is the same bug with a different
 * operand type.
 */
export function operandText(f: QueryFilter): string {
  return f.operands ? f.operands.join(" ") : f.text;
}

/**
 * `drop=0,2` -> {0, 2}. Anything that is not a run of digits is ignored
 * rather than refused: a stale chip index is a no-op, not a 400.
 *
 * The shape test is `/^\d+$/` on the raw part, NOT `Number(part)`, because
 * `Number("")` and `Number(" ")` are both 0 — a trailing comma or a stray
 * space would otherwise drop filter index 0, a chip nobody clicked.
 */
export function parseDropped(raw: string | null): Set<number> {
  const out = new Set<number>();
  if (!raw) return out;
  // Bounded on the way in. The value is only ever read as `has(i)` for
  // i < MAX_UI_FILTERS, so nothing beyond that many distinct indices can
  // change an answer — and a `drop` of a million parts would otherwise
  // build a million-entry Set on an endpoint whose other inputs are capped.
  for (const part of raw.split(",", MAX_UI_FILTERS * 4)) {
    const trimmed = part.trim();
    if (/^\d{1,6}$/.test(trimmed)) out.add(Number(trimmed));
  }
  return out;
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  const denied = forbid(user, "kb.view");
  if (denied) return denied;

  const url = new URL(req.url);
  const rawQuery = (url.searchParams.get("q") ?? "").trim();
  const dropped = parseDropped(url.searchParams.get("drop"));

  const empty: KbSearchResponse = {
    residue: "", queryUsed: "", filters: [], overflow: 0, maxFilters: MAX_UI_FILTERS, hits: [],
  };
  if (rawQuery === "") return Response.json(empty);

  // The cap is REFUSED, not silently worked around. ext-06 parses only the
  // first QUERY_INPUT_CAP characters, so a longer query would be filtered on
  // its prefix and keyword-searched on its whole — two different questions
  // under one readback. The stated-filter door on `search_knowledge` refuses
  // over-cap input for the same reason, and refusing here also keeps an
  // unbounded string out of the raw SQL literal and out of the embeddings
  // request body. The input carries the same maxLength, so the UI cannot
  // produce this.
  if (rawQuery.length > QUERY_INPUT_CAP) {
    return Response.json(
      { error: `A search is at most ${QUERY_INPUT_CAP} characters; this one is ${rawQuery.length}.` },
      { status: 400 },
    );
  }
  // A NUL byte cannot survive the trip to Postgres — the connector rejects
  // the parameter and the handler would throw rather than answer. Refusing
  // it here is a stated answer instead of a 500.
  if (rawQuery.includes("\u0000")) {
    return Response.json({ error: "A search may not contain a NUL character." }, { status: 400 });
  }

  // refDate is resolved HERE, exactly as the tool resolves it: a relative
  // phrase in a live question means "relative to today", and the chip names
  // the interval it resolved to, so the resolution is never silent.
  const ruleset = queryRuleset(new Date().toISOString().slice(0, 10));
  const parsed = parseQueryFilters(rawQuery, ruleset);

  const capped = parsed.filters.slice(0, MAX_UI_FILTERS);
  const applied = capped.filter((_f, i) => !dropped.has(i));

  // THE KEYWORD TEXT IS THE RESIDUE, WHETHER OR NOT A CHIP WAS DROPPED — and
  // that is a deliberate difference from `search_knowledge`, which searches
  // the query verbatim when no filter applies.
  //
  // The tool's rule exists for a caller that STATES its filters and repeats
  // the phrase in the query text; holding the text back until a filter is
  // applied is what stops it searching for the literal tokens "over" and
  // "2 <-> 000". Here the operator typed ONE string, the text actually
  // searched is shown back beside the chips, and removing a chip means "same
  // words, one fewer constraint". Swapping the text under them at the moment
  // the last chip goes would make removal non-monotone: dropping a filter
  // would return FEWER results than keeping it, which is the opposite of
  // what the control says it does.
  //
  // UNLESS THE RESIDUE CARRIES NO WORD AT ALL, and that exception is the
  // difference between this route working and not. A query that is ONLY a
  // value — "INV-2024-113", an email address, a bare date — leaves nothing
  // behind, and `websearch_to_tsquery('simple', '')` matches no row. On a
  // keyword-only install (the private default: no embeddings, so nothing
  // else can put a candidate in the set) the search would then return zero
  // hits for the query an operator is MOST likely to paste in, while the
  // document sits right there.
  //
  // THE TEST IS FOR A LEXEME, NOT FOR THE EMPTY STRING. `"INV-2024-113"`
  // typed with its quotes leaves a residue of `" "` — non-empty, and just
  // as empty to the text search, which is the same bug wearing punctuation.
  //
  // AND THE FALLBACK IS THE OPERANDS, NOT THE WHOLE QUERY. Falling back to
  // the raw string re-injects as mandatory ANDed terms exactly the words the
  // parser consumed, so "2025-11-04" would find the document and "on
  // 2025-11-04" would not — an outcome that turns on a filler word the
  // readback has already said was consumed. `operandText` above is why this
  // says OPERANDS rather than "the filters' text": a between filter's text is
  // the whole span, join word included, and "entre $1,000 y $2,000" must not
  // come to mean "documents that also contain the word y".
  //
  // Drop-independent by construction: it reads EVERY parsed filter, not the
  // applied ones, so removing a chip can never change the text searched.
  //
  // The limit that remains, stated rather than hidden: a value only matches
  // when its surface form is also a keyword in the document, because
  // candidate selection is kb-10's keyword/vector pass and a fact filter can
  // only narrow it. "$2,400" finds a document that spells it that way and
  // not one that spells it "2400.00". Changing that is a change to retrieval,
  // not to this readback.
  const HAS_LEXEME = /[\p{L}\p{N}]/u;
  const values = parsed.filters.map(operandText).join(" ").replace(/\s+/g, " ").trim();
  const query = HAS_LEXEME.test(parsed.residue)
    ? parsed.residue
    : HAS_LEXEME.test(values)
      ? values
      : rawQuery;

  let vector: number[] | undefined;
  let model: string | undefined;
  try {
    const settings = await getEmbedSettings();
    if (settings.kind === "mock") {
      vector = mockEmbed(query);
      model = MOCK_EMBEDDER_MODEL;
    } else if (settings.kind === "openai-compatible") {
      const [embedded] = await embedWithEndpoint(settings, [query]);
      vector = embedded.vector;
      model = embedded.model;
    }
  } catch {
    /* embeddings failing degrades to keyword-only — same code path */
  }

  const hits = await kbSearch(db, { humanId: user.id, agentId: null }, query, {
    limit: SEARCH_LIMIT,
    queryVector: vector,
    embeddingModel: model,
    filters: applied,
  });

  const body: KbSearchResponse = {
    residue: parsed.residue,
    queryUsed: query,
    filters: capped.map((f, index) => ({
      index,
      kind: f.kind,
      comparator: f.comparator,
      text: f.text,
      confidence: f.confidence,
      display: describeFilter(f),
      dropped: dropped.has(index),
    })),
    overflow: Math.max(0, parsed.filters.length - capped.length),
    maxFilters: MAX_UI_FILTERS,
    hits: hits.map((h) => ({
      documentId: h.documentId,
      docName: h.docName,
      chunkId: h.chunkId,
      locator: formatLocator(h.locator),
      text: h.text,
    })),
  };
  return Response.json(body);
}
