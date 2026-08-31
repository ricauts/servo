// The knowledge-base tools (spec kb-11). Reads are LOW risk, no approval —
// scoping lives INSIDE execute(), exactly as history.ts withholds other
// requesters' identities: policy gates whether a call RUNS; ENTITLEMENT
// gates what it can see, and no policy edit can widen it.
//
// KB tools are NOT exposed over MCP in v1: src/lib/mcp.ts authenticates one
// shared bearer token with no user identity, so an MCP session has no human
// principal — deny or invent a fallback are the only alternatives, and
// inventing one is the exact leak this area exists to prevent.

import { formatLocator } from "@/lib/kb/locator";
import { db } from "@/lib/db";
import { kbSearch } from "@/lib/kb/search";
import { getEmbedSettings, embedWithEndpoint } from "@/lib/kb/embed";
import { mockEmbed, MOCK_EMBEDDER_MODEL } from "@/lib/kb/mock-embedder";
import { DEFAULT_RULESET, exponentFor, extractFacts, type Fact, type FactRuleset } from "@/lib/kb/facts";
import type { FactConfidence, FactKind } from "@/lib/kb/facts/types";
import { parseQueryFilters, QUERY_INPUT_CAP, type Comparator, type QueryFilter } from "@/lib/kb/query-filters";
import type { ToolDef } from "@/lib/ai/tools/types";

const NOT_AUTHENTICATED =
  "Error: knowledge tools require a per-user token; the MCP session has no human principal.";

/** Resolve the chain, or the reason it cannot be resolved. */
function chainFor(ctx: { principals?: { agentId: string; humanId: string | null } }) {
  const principals = ctx.principals;
  if (!principals || principals.humanId === null) return null;
  return { humanId: principals.humanId, agentId: principals.agentId };
}

// ---------------------------------------------------------------------------
// ext-07 — structured filters on search_knowledge
//
// TWO WAYS IN, ONE WAY THROUGH. A model may STATE a filter in the tool input,
// or leave it in the query text for ext-06's phrase table to INFER. Both end
// as `QueryFilter[]` handed to `kbSearch`, which compiles them to the same
// EXISTS clauses inside kb-10's single statement. There is no second search
// path, no post-filter pass and no second query — a filter can only remove
// rows from an already-entitled candidate set.
//
// A STATED VALUE IS NOT A PARSED VALUE UNTIL THE EXTRACTOR SAYS SO. Only
// `kind` and `comparator` reach the query from the model as themselves, and
// both are checked against closed sets below. Every value — the amount, the
// currency, the date, the identifier — is rendered back to a surface form and
// re-read by `extractFacts`, the SAME pass that produced the stored
// `DocumentFact` rows. So `num`, `unit` and `norm` in the SQL are always
// something the extractor produced. That is what makes "USD 2000" from a model
// and "$2,000" from a document the same number, and it is why no model string
// reaches a NUMERIC position at all (`numLit` refuses a non-finite anyway).
//
// It is NOT, however, an escaping story, and must not be mistaken for one.
// A `norm` is extractor OUTPUT but its characters can still be chosen by the
// caller: `new URL()` percent-decodes a host, so the URL matcher's own
// apostrophe exclusion does not stop `https://ex%27ample.com/a` from
// normalising to a string with a quote in it. What keeps that safe is
// `lit()` in search.ts doubling the quote, exactly as it does for every other
// literal in that statement. A test below pins it.
// ---------------------------------------------------------------------------

/** The seven kinds a filter may name. CLOSED. */
const FILTER_KINDS = ["DATE", "MONEY", "DURATION", "IDENTIFIER", "QUANTITY", "EMAIL", "URL"] as const;
/** The four comparators ext-06 defined. CLOSED — no strict variants. */
const COMPARATORS = [">=", "<=", "between", "="] as const;

/**
 * The finite bounds an open-ended DATE filter uses. `>= 2026-01-01` is the
 * interval [2026-01-01, TS_MAX); ±8.64e15 ms is the widest instant a JS Date
 * can name, and `DocumentFact.ts` is a BIGINT with room to spare. Finite
 * matters: `numLit` in search.ts refuses a non-finite bound rather than
 * rendering `Infinity` into SQL.
 */
const TS_MIN = -8.64e15;
const TS_MAX = 8.64e15;

/**
 * How many filters one search may carry, stated or inferred.
 *
 * EACH FILTER IS ANOTHER CORRELATED SUBQUERY in kb-10's single statement, and
 * the planner's cost is superlinear in them: measured against a real server,
 * 50 filters take ~150 ms, 100 take ~2.1 s and 200 take ~44 s — on an EMPTY
 * database. `filters` arrives from a model whose input is steered by ticket
 * text nobody trusts, and the tool is LOW risk with no approval, so an
 * uncapped array is a planner denial-of-service one tool call wide. The cap is
 * REFUSED rather than silently trimmed on the stated path, and NAMED in the
 * readback on the inferred one; ext-06's own extractor already stops at
 * MAX_FACTS_PER_CALL = 64, so this only ever binds a deliberate caller.
 */
export const MAX_FILTERS = 16;

/** The character budget of one search_knowledge result, readback included. */
const RESULT_CAP = 4000;

/** One filter as a model states it — the shape of the `filters` input items. */
export interface StatedFilter {
  kind: string;
  comparator?: string;
  /** A single value, or `"low..high"` when the comparator is `between`. */
  value: string;
  /** ISO currency code for MONEY, the unit symbol for QUANTITY. */
  unit?: string;
}

/**
 * The query-side ruleset. `refDate` is resolved BY THE CALLER, exactly as
 * ingestion resolves it from a document's `createdAt` — the parser itself
 * reads no clock, and the readback below names the date it resolved against
 * so an operator can see which "today" a relative phrase was read against.
 */
export function queryRuleset(refDate: string): FactRuleset {
  return { ...DEFAULT_RULESET, refDate };
}

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** MONEY/DURATION/QUANTITY carry `num` and `unit`; the rest do not. */
function numericFact(f: Fact): f is Extract<Fact, { num: number }> {
  return f.kind === "MONEY" || f.kind === "DURATION" || f.kind === "QUANTITY";
}

/** QUANTITY, EMAIL and URL facts carry no confidence — they are never assumed. */
function confidenceOf(f: Fact): FactConfidence {
  return (f as { confidence?: FactConfidence }).confidence ?? "EXACT";
}

/**
 * A stated value, rendered back to a surface form the shared extractor already
 * reads. MONEY with no unit is rendered with a bare `$` on purpose: that is
 * the extractor's own ambiguous-symbol path, so the ruleset default resolves
 * it and the fact comes back ASSUMED — the same way a document's bare `$` does.
 */
function probeText(kind: FactKind, value: string, unit: string | undefined): string {
  const u = (unit ?? "").trim();
  if (kind === "MONEY") return u === "" ? `$${value}` : `${u.toUpperCase()} ${value}`;
  // The space matters: ext-03's precedence reads "3.5gb" as an IDENTIFIER
  // (digits and letters joined by an internal "."), while "3.5 gb" is
  // unambiguously a quantity — space is not an identifier separator.
  if (kind === "QUANTITY") return `${value} ${u.toLowerCase()}`;
  if (kind === "DURATION") return durationProbe(value);
  return value;
}

/**
 * DURATION is stated in seconds, but the extractor's number is bounded at six
 * digits — "2592000 seconds" is not a duration it reads. The probe therefore
 * uses the LARGEST unit word that divides the value exactly, which is the form
 * a document would have carried anyway ("30 days"); the extractor multiplies
 * it back to the same second count. A value no unit word can express inside
 * the bound produces a probe the extractor reads only partially, and the
 * whole-span rule below then refuses it rather than filtering on a number
 * nobody stated.
 */
function durationProbe(value: string): string {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) return `${value} seconds`;
  const WORDS = [[604_800, "weeks"], [86_400, "days"], [3_600, "hours"], [60, "minutes"], [1, "seconds"]] as const;
  for (const [seconds, word] of WORDS) {
    if (n % seconds === 0) return `${n / seconds} ${word}`;
  }
  return `${value} seconds`;
}

/**
 * The one fact the shared extractor reads out of a stated value, or null.
 *
 * THE WHOLE STATEMENT OR NOTHING. The fact must span the entire probe. The
 * money grammar takes at most two decimals, the duration number at most six
 * digits, the quantity table only the units it knows — so a statement just
 * outside one of those bounds ("USD 2000.123") would otherwise come back as
 * the prefix the extractor could read (USD 2000) and silently filter on a
 * value the caller never asked for. A partial read is a refusal instead.
 */
function factFromStated(
  kind: FactKind,
  value: string,
  unit: string | undefined,
  ruleset: FactRuleset,
): Fact | null {
  const probe = probeText(kind, value.trim(), unit);
  const fact = extractFacts(probe, ruleset).facts.find((f) => f.kind === kind);
  if (!fact) return null;
  return fact.offset === 0 && fact.length === probe.length ? fact : null;
}

const worse = (a: Fact, b: Fact): FactConfidence =>
  confidenceOf(a) === "ASSUMED" || confidenceOf(b) === "ASSUMED" ? "ASSUMED" : "EXACT";

/**
 * Compile one stated filter, or name why it cannot be read. The failure is
 * always about the STATEMENT — never about the corpus — so it discloses
 * nothing: an unreadable value fails identically whether or not any document
 * would have matched it.
 */
export function compileStatedFilter(
  raw: unknown,
  ruleset: FactRuleset,
): { filter: QueryFilter } | { error: string } {
  const stated = (raw ?? {}) as StatedFilter;
  const kind = String(stated.kind ?? "").trim().toUpperCase();
  if (!(FILTER_KINDS as readonly string[]).includes(kind)) {
    return { error: `names an unknown kind — use one of ${FILTER_KINDS.join(", ")}.` };
  }
  const comparator = String(stated.comparator ?? "=").trim() as Comparator;
  if (!(COMPARATORS as readonly string[]).includes(comparator)) {
    return { error: "names an unknown comparator — use >=, <=, between or =." };
  }
  const factKind = kind as FactKind;
  const value = String(stated.value ?? "").trim();
  if (value === "") return { error: "carries no value." };
  // ext-06 caps QUERY input at 512 characters because extraction runs bounded
  // regexes over caller-supplied text (query-filters.ts). A stated value is
  // the same caller-supplied text arriving through a different door, so it
  // gets the same cap — without it a megabyte-long value burns seconds of CPU
  // inside extractFacts before the whole-span rule below rejects it, and a
  // long one that IS readable renders a megabyte of SQL.
  if (value.length > QUERY_INPUT_CAP || String(stated.unit ?? "").length > QUERY_INPUT_CAP) {
    return { error: `is longer than the ${QUERY_INPUT_CAP}-character limit on a stated value.` };
  }

  if (comparator === "between") {
    const parts = value.split("..");
    if (parts.length !== 2 || parts[0].trim() === "" || parts[1].trim() === "") {
      return { error: 'uses "between", whose value must be written "low..high".' };
    }
    const a = factFromStated(factKind, parts[0], stated.unit, ruleset);
    const b = factFromStated(factKind, parts[1], stated.unit, ruleset);
    if (!a || !b) return { error: `has a value the extractor cannot read as ${kind}.` };
    if (a.kind === "DATE" && b.kind === "DATE") {
      return {
        filter: {
          kind: "DATE", comparator: "=",
          ts: Math.min(a.ts, b.ts), tsEnd: Math.max(a.tsEnd, b.tsEnd),
          confidence: worse(a, b), text: value,
        },
      };
    }
    if (!numericFact(a) || !numericFact(b)) {
      return { error: `is a ${kind} filter, and "between" only applies to dates and numbers.` };
    }
    if (a.unit !== b.unit) {
      return { error: `mixes units (${a.unit} and ${b.unit}); units are compared, never converted.` };
    }
    return {
      filter: {
        kind: factKind, comparator: "between",
        num: Math.min(a.num, b.num), num2: Math.max(a.num, b.num), unit: a.unit,
        confidence: worse(a, b), text: value,
      },
    };
  }

  const fact = factFromStated(factKind, value, stated.unit, ruleset);
  if (!fact) return { error: `has a value the extractor cannot read as ${kind}.` };

  if (fact.kind === "DATE") {
    // Every date is an interval, so an open-ended comparator is an open-ended
    // interval — there is one date predicate (overlap) and this keeps it.
    return {
      filter: {
        kind: "DATE", comparator: "=",
        ts: comparator === "<=" ? TS_MIN : fact.ts,
        tsEnd: comparator === ">=" ? TS_MAX : fact.tsEnd,
        confidence: fact.confidence, text: value,
      },
    };
  }
  if (numericFact(fact)) {
    return {
      filter: {
        kind: factKind, comparator, num: fact.num, unit: fact.unit,
        confidence: confidenceOf(fact), text: value,
      },
    };
  }
  // IDENTIFIER | EMAIL | URL join on `norm`; ordering them has no meaning, so
  // any comparator collapses to equality rather than being silently dropped.
  // The fact's OWN confidence is carried, not a hardcoded "EXACT": the phrase
  // table does the same (query-filters.ts filterFromFact), and two copies that
  // disagree are the drift this file exists to avoid.
  return { filter: { kind: factKind, comparator: "=", norm: fact.norm, confidence: confidenceOf(fact), text: value } };
}

/**
 * The inverse: one compiled filter, back in the shape a model would state.
 * Round-trips through `compileStatedFilter` to the same SQL, which is what
 * lets `MockProvider` script a STATED filtered search without owning a second
 * set of rules (ext-07). Returns null for a filter with nothing to state.
 */
export function statedFromFilter(f: QueryFilter): StatedFilter | null {
  if (f.kind === "DATE") {
    if (f.ts === undefined || f.tsEnd === undefined) return null;
    // An OPEN END has no day to name, so it round-trips as the comparator that
    // produced it rather than as a bound. `isoDay(TS_MAX)` is "+275760-09",
    // which nothing can read back — a documented inverse that returns a value
    // its own compiler refuses is worse than one that returns null.
    const open = { start: f.ts <= TS_MIN, end: f.tsEnd >= TS_MAX };
    if (open.start && open.end) return null; // unbounded both ways: nothing to state
    if (open.start) return { kind: "DATE", comparator: "<=", value: isoDay(f.tsEnd - 1) };
    if (open.end) return { kind: "DATE", comparator: ">=", value: isoDay(f.ts) };
    // tsEnd is EXCLUSIVE and always a UTC midnight, so the last day inside
    // the interval is tsEnd - 1 ms: stating it round-trips the same interval.
    return { kind: "DATE", comparator: "between", value: `${isoDay(f.ts)}..${isoDay(f.tsEnd - 1)}` };
  }
  if (f.num !== undefined) {
    const value = f.comparator === "between"
      ? `${majorUnits(f, f.num)}..${majorUnits(f, f.num2 ?? f.num)}`
      : majorUnits(f, f.num);
    return { kind: f.kind, comparator: f.comparator, value, unit: f.unit };
  }
  // THE SURFACE, NOT THE NORM. `norm` is the joinable form — separators
  // collapsed away, host percent-decoded — and most normalized identifiers are
  // no longer readable AS identifiers: "SKU-9A" normalises to "sku9a", which
  // has neither an internal separator nor a letters-then-digits shape, so
  // compileStatedFilter would refuse the very value this function produced.
  // The SURFACE is what the extractor read the fact out of, so re-reading it
  // yields the same norm by construction. The round-trip test walks a dozen
  // identifier shapes rather than the one that happened to survive.
  if (f.norm !== undefined) return { kind: f.kind, comparator: "=", value: f.text };
  return null;
}

/** MONEY stores minor units; a model states major ones ("USD 2000"). */
function majorUnits(f: QueryFilter, num: number): string {
  if (f.kind !== "MONEY") return String(num);
  const exponent = exponentFor(f.unit ?? "") ?? 0;
  return String(Number((num / 10 ** exponent).toFixed(exponent)));
}

/** One filter in words, for the readback. Never mentions any document. */
export function describeFilter(f: QueryFilter, refDate: string): string {
  if (f.kind === "DATE") {
    const from = f.ts !== undefined && f.ts > TS_MIN ? isoDay(f.ts) : "any";
    const to = f.tsEnd !== undefined && f.tsEnd < TS_MAX ? isoDay(f.tsEnd) : "any";
    return `${from}..${to} against ${refDate}${f.confidence === "ASSUMED" ? " (assumed day/month order)" : ""}`;
  }
  const cmp = f.comparator === "=" ? "" : f.comparator === "between" ? "between " : `${f.comparator} `;
  if (f.num !== undefined) {
    const amount = f.comparator === "between"
      ? `${majorUnits(f, f.num)} and ${majorUnits(f, f.num2 ?? f.num)}`
      : majorUnits(f, f.num);
    const assumed = f.confidence === "ASSUMED" ? " (assumed currency)" : "";
    if (f.kind === "MONEY") return `${cmp}${f.unit} ${amount}${assumed}`;
    if (f.kind === "DURATION") return `${cmp}${amount} seconds`;
    return `${cmp}${amount} ${f.unit}`;
  }
  return `${f.kind.toLowerCase()} ${f.norm}`;
}

/**
 * The readback. A SILENTLY NARROWED SEARCH THAT RETURNS NOTHING IS
 * INDISTINGUISHABLE FROM AN EMPTY KNOWLEDGE BASE, so whenever a filter was
 * INFERRED from the query text the result says what was read and what it was
 * read as. Stated filters get no readback: the caller already knows.
 *
 * It is a pure function of the query and the ruleset — no count, no name, no
 * hint of what exists — which is why prefixing it to "No accessible sources."
 * leaves that response byte-identical between a filter matching only
 * non-entitled documents and a filter matching nothing at all.
 */
export function interpretation(filters: QueryFilter[], refDate: string, parsedTotal = filters.length): string {
  if (filters.length === 0) return "";
  const parts = filters.map((f) => `read "${f.text}" as ${describeFilter(f, refDate)}`);
  const dropped = parsedTotal - filters.length;
  const tail = dropped > 0
    ? `; ${dropped} further reading${dropped === 1 ? "" : "s"} dropped — at most ${MAX_FILTERS} filters apply to one search`
    : "";
  return `Interpreted: ${parts.join("; ")}${tail}.\n\n`;
}

/**
 * The STATED path's readback, and it exists for the same reason: when a caller
 * states its filters, the query text is still reduced to ext-06's residue, so
 * filter-shaped words left in the query are neither searched as text NOR
 * applied as filters. That is a silent drop unless it is said out loud.
 * Nothing here reads the corpus either.
 */
function unappliedNotice(carried: QueryFilter[]): string {
  if (carried.length === 0) return "";
  const quoted = carried.map((f) => `"${f.text}"`).join(", ");
  return (
    `Interpreted: your stated filters were applied as given. ${quoted} in the query text ` +
    `was read as a value, so it was neither applied as a filter nor matched as text — ` +
    `state it in filters if you meant to filter on it.\n\n`
  );
}

export const kbTools: Record<string, ToolDef> = {
  search_knowledge: {
    name: "search_knowledge",
    description:
      "Search the company knowledge base for manuals, spreadsheets and procedures. Returns ranked passages with citations (document name + locator). Only sources the requester may read are searched. Dates, amounts, durations and identifiers in the query are read as filters by a rule-based parser; state them in `filters` instead to say exactly what you mean.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Natural-language search text." },
        filters: {
          type: "array",
          description:
            `Optional structured filters over values extracted from the documents. When present (an empty array included) no filter is inferred from the query text. Put only the free-text part in \`query\`: a date or amount left there is read as a value, not matched as text. At most ${MAX_FILTERS} filters. A filter can only remove results the same query would otherwise have returned.`,
          items: {
            type: "object",
            properties: {
              kind: { type: "string", enum: [...FILTER_KINDS], description: "Which extracted value to filter on." },
              comparator: { type: "string", enum: [...COMPARATORS], description: "Defaults to = ." },
              value: {
                type: "string",
                description:
                  'The value: an amount in major units ("2000"), a whole number of seconds for DURATION, an ISO date ("2026-01-31"), or the identifier/email/URL itself. For comparator "between", write it "low..high".',
              },
              unit: {
                type: "string",
                description: 'ISO currency code for MONEY ("USD"), the unit symbol for QUANTITY ("gb"). Units are compared, never converted.',
              },
            },
            required: ["kind", "value"],
          },
        },
      },
      required: ["query"],
    },
    async execute(input, ctx) {
      const chain = chainFor(ctx);
      if (!chain) return NOT_AUTHENTICATED;
      const rawQuery = String(input.query ?? "").trim();
      if (!rawQuery) return "Error: query is required.";

      // refDate is resolved HERE — the tool is the caller, and a relative
      // phrase in a live question means "relative to today". The readback
      // names it, so the resolution is never silent.
      const ruleset = queryRuleset(new Date().toISOString().slice(0, 10));

      const parsed = parseQueryFilters(rawQuery, ruleset);

      let filters: QueryFilter[];
      let readback: string;
      if (input.filters === undefined) {
        filters = parsed.filters.slice(0, MAX_FILTERS);
        readback = interpretation(filters, ruleset.refDate, parsed.filters.length);
      } else {
        // PRESENT MEANS STATED, empty array included: a caller that sends
        // `filters: []` is saying "no filters", and quietly inferring some
        // anyway would be the opposite of what the schema promises.
        if (!Array.isArray(input.filters)) {
          return "Error: filters must be an array of {kind, comparator, value, unit}.";
        }
        const stated = input.filters as unknown[];
        if (stated.length > MAX_FILTERS) {
          return `Error: at most ${MAX_FILTERS} filters may be stated in one search.`;
        }
        filters = [];
        for (const [i, one] of stated.entries()) {
          const compiled = compileStatedFilter(one, ruleset);
          if ("error" in compiled) return `Error: filter ${i + 1} ${compiled.error}`;
          filters.push(compiled.filter);
        }
        // Only when a filter actually applied: with `filters: []` nothing is
        // taken out of the query below, so there is nothing to report.
        readback = filters.length > 0 ? unappliedNotice(parsed.filters) : "";
      }

      // ONE RULE FOR THE QUERY TEXT, WHICHEVER DOOR THE FILTERS CAME THROUGH:
      // text is removed from the keyword pass ONLY in exchange for a filter
      // being applied. `websearch_to_tsquery` ANDs every term, so leaving
      // "over $2,000" in the query text makes the search require the literal
      // tokens "over" and "2 <-> 000" in a chunk — which is why a caller that
      // STATED its filter and repeated the phrase would otherwise get strictly
      // worse results than one that stated nothing.
      //
      // TWO CASES USE THE QUERY VERBATIM, and both are the same principle read
      // backwards. When NO filter applies (`filters: []`, or a query nothing
      // parsed out of), taking a word out of the search in exchange for
      // nothing is the mirror of that bug. And when the query is LONGER than
      // ext-06's 512-character parse cap, the residue only covers the first
      // 512 characters: splicing it back onto the untouched tail either glues
      // two words together or bisects the one the cap cut in half, and
      // `websearch_to_tsquery` then ANDs a fragment no chunk contains.
      // Verbatim is exactly what this tool did before this item, so a long
      // query is never worse than it was; its filters still apply, and the
      // readback still names them.
      const query =
        filters.length === 0 || rawQuery.length > QUERY_INPUT_CAP ? rawQuery : parsed.residue;

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

      const hits = await kbSearch(db, chain, query, {
        limit: 8,
        queryVector: vector,
        embeddingModel: model,
        filters,
      });
      // The readback rides on BOTH branches, and is a function of the query
      // alone: a filter that matched only documents this chain may not read
      // returns this exact string, character for character, and so does a
      // filter that matched nothing anywhere.
      if (hits.length === 0) return `${readback}No accessible sources.`;
      // The 4000-character budget is the WHOLE result's, readback included —
      // computing it inside the passage expression would have let a dense
      // query's prefix push the tool past the cap it declares.
      const body = hits
        .map((h, i) => `[${i + 1}] ${h.docName} · ${formatLocator(h.locator)}\n${h.text}`)
        .join("\n\n");
      return readback + body.slice(0, Math.max(0, RESULT_CAP - readback.length));
    },
  },

  read_document: {
    name: "read_document",
    description:
      "Read one knowledge-base document by id, paginated by sheet/page/chunk cursor. The result names the next cursor.",
    inputSchema: {
      type: "object",
      properties: {
        documentId: { type: "string" },
        fromChunk: { type: "integer", description: "Cursor: index of the first chunk to return." },
      },
      required: ["documentId"],
    },
    async execute(input, ctx) {
      const chain = chainFor(ctx);
      if (!chain) return NOT_AUTHENTICATED;
      const documentId = String(input.documentId ?? "");
      const fromChunk = Number(input.fromChunk ?? 0) || 0;

      // The entitlement oracle, not an existence check: non-entitled and
      // non-existent return the IDENTICAL string.
      const { entitledDocumentIds } = await import("@/lib/kb/entitlement");
      const ids = await entitledDocumentIds(db, chain);
      if (!ids.includes(documentId)) {
        return "Error: no accessible document with that id.";
      }

      const PAGE = 3; // chunks per page — a locator-accurate excerpt each
      const rows = await db.$queryRawUnsafe<{ id: string; index: number; text: string; locator: string }[]>(
        `SELECT id, index, text, locator::text AS locator FROM "DocumentChunk"
          WHERE "documentId" = '${documentId.replace(/'/g, "''")}' AND index >= ${fromChunk}
          ORDER BY index LIMIT ${PAGE + 1}`,
      );
      if (rows.length === 0) {
        return fromChunk === 0
          ? "Error: no accessible document with that id."
          : "End of document.";
      }
      const page = rows.slice(0, PAGE);
      const next = rows.length > PAGE ? rows[PAGE].index : null;
      const doc = await db.document.findUnique({
        where: { id: documentId },
        select: { name: true },
      });
      const body = page
        .map((r) => `[chunk ${r.index} · ${formatLocator(safeJson(r.locator))}]\n${r.text}`)
        .join("\n\n");
      return `${doc?.name ?? "Document"}${next !== null ? `\n\nnext cursor: {"fromChunk": ${next}}` : "\n\n(end of document)"}\n\n${body}`.slice(0, 4000);
    },
  },

  list_collections: {
    name: "list_collections",
    description:
      "List knowledge-base collections with counts of documents the requester may read. Collections with zero readable documents are omitted.",
    inputSchema: { type: "object", properties: {} },
    async execute(_input, ctx) {
      const chain = chainFor(ctx);
      if (!chain) return NOT_AUTHENTICATED;
      const { humanChainCte } = await import("@/lib/kb/entitlement");
      const cte = humanChainCte(chain.humanId);
      const agentCte = chain.agentId
        ? (await import("@/lib/kb/entitlement")).agentChainCte(chain.humanId, chain.agentId)
        : cte;
      const rows = await db.$queryRawUnsafe<{ id: string; name: string; n: bigint }[]>(
        `${chain.agentId ? agentCte : cte}
         SELECT c.id, c.name, count(e.id) AS n
           FROM "Collection" c
           JOIN "Document" d ON d."collectionId" = c.id
           JOIN readable e ON e.id = d.id
          GROUP BY c.id, c.name
          HAVING count(e.id) > 0
          ORDER BY c.name`,
      );
      if (rows.length === 0) return "No accessible collections.";
      return rows.map((r) => `${r.name} (${Number(r.n)} readable document${Number(r.n) === 1 ? "" : "s"})`).join("\n");
    },
  },
};

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

