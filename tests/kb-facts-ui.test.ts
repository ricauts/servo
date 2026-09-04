// ext-08: facts in the Knowledge UI — the fact chips on a document, the
// parsed-filter chips beside the search box, and the two route-level gates
// that keep both honest.
//
// The rendering itself has no DOM harness in this repo (there is no jsdom and
// no testing-library), so this file tests what the UI is a view OF: the two
// endpoints it reads, the pure helpers it renders with, and — for the two
// criteria that are statements about markup — the component source, the same
// convention kb-17's KbAdminPanel assertions use.

import { readFileSync } from "node:fs";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { tmpDb, type TmpDb } from "./helpers/tmp-db";

type ServoDb = { [key: string]: unknown };
const holder = vi.hoisted(() => ({
  db: null as unknown as ServoDb,
  user: null as unknown as { id: string; role: string },
}));
vi.mock("@/lib/db", () => ({ get db() { return holder.db; } }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: async () => holder.user }));

import { GET as getFacts, type FactsResponse } from "@/app/api/kb/documents/[id]/facts/route";
import { GET as search } from "@/app/api/kb/search/route";
import { describeFilter, operandText, parseDropped, type KbSearchResponse } from "@/lib/kb/filter-view";
import { assumptionNote, factValue } from "@/components/kb/fact-assumptions";
import { parseQueryFilters } from "@/lib/kb/query-filters";
import { ingestDocument } from "@/lib/kb/ingest";

const handles: TmpDb[] = [];
afterAll(async () => {
  for (const h of handles) await h.dispose();
});

let db: PrismaClient;
let admin: { id: string; role: string };
let agent: { id: string; role: string };
let requester: { id: string; role: string };

beforeEach(async () => {
  if (handles.length > 1) await handles.shift()?.dispose();
  const a = await tmpDb();
  handles.push(a);
  db = a.client;
  holder.db = db as unknown as ServoDb;
  admin = { ...(await db.user.create({ data: { name: "A", email: "a@x.com", role: "ADMIN" } })), role: "ADMIN" };
  agent = { ...(await db.user.create({ data: { name: "G", email: "g@x.com", role: "AGENT" } })), role: "AGENT" };
  requester = { ...(await db.user.create({ data: { name: "R", email: "r@x.com", role: "REQUESTER" } })), role: "REQUESTER" };
});

const req = (url: string) => new Request(url) as never;
const P = (id: string) => ({ params: Promise.resolve({ id }) });

const FACTFUL = "Invoice INV-2024-113 total $2,400.00 issued 2025-11-04, due in 30 days. Contact ap@example.com.";
const PROSE = "A short note about how the team prefers to write handover summaries for each other.";

async function ingest(name: string, body: string, visibility?: "PRIVATE" | "STAFF" | "PUBLIC") {
  const { documentId } = await ingestDocument({
    name,
    contentType: "text/markdown",
    ownerId: admin.id,
    ...(visibility ? { visibility } : {}),
    bytes: Buffer.from(body),
  });
  return { id: documentId };
}

// ---------------------------------------------------------------------------
// The gate. "Route-level permission tests — a REQUESTER gets 403 on every
// fact-bearing endpoint."
// ---------------------------------------------------------------------------

describe("a REQUESTER on every fact-bearing endpoint", () => {
  it("gets 403 from the document-facts route and the search route", async () => {
    holder.user = requester;
    const facts = await getFacts(req("http://x/api/kb/documents/any/facts"), P("any"));
    expect(facts.status).toBe(403);
    const found = await search(req("http://x/api/kb/search?q=invoice%20over%20$2,000") as never);
    expect(found.status).toBe(403);
    // The gate answers BEFORE the id is consulted: a real id gets the same 403.
    const doc = await ingest("invoice.md", FACTFUL);
    expect((await getFacts(req(`http://x/api/kb/documents/${doc.id}/facts`), P(doc.id))).status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// "The chips render for an entitled document and are absent for a
// non-entitled one, with no count and no placeholder disclosing that anything
// was withheld."
// ---------------------------------------------------------------------------

describe("the document-facts route", () => {
  it("returns chips for an entitled document", async () => {
    const doc = await ingest("invoice.md", FACTFUL);
    holder.user = admin;
    const res = await getFacts(req(`http://x/api/kb/documents/${doc.id}/facts`), P(doc.id));
    expect(res.status).toBe(200);
    const body = (await res.json()) as FactsResponse;
    expect(body.facts.length).toBeGreaterThan(0);

    // Every chip names its surface form and the chunk + offset it came from,
    // and the span round-trips against the chunk's own text.
    const chunks = new Map(
      (await db.documentChunk.findMany({ where: { documentId: doc.id }, select: { id: true, text: true } })).map(
        (c) => [c.id, c.text],
      ),
    );
    for (const fact of body.facts) {
      expect(fact.text).not.toBe("");
      expect(chunks.has(fact.chunkId)).toBe(true);
      expect(fact.chunkIndex).toBeGreaterThanOrEqual(0);
      const text = chunks.get(fact.chunkId) as string;
      expect(text.slice(fact.offset, fact.offset + fact.length)).toBe(fact.text);
    }

    // Grouped by kind: this text carries more than one kind, so the chip
    // panel has more than one group to draw.
    expect(new Set(body.facts.map((f) => f.kind)).size).toBeGreaterThan(1);
    expect(body.documentDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("is absent for a non-entitled document — the same answer an unknown id gets, with no count", async () => {
    const doc = await ingest("invoice.md", FACTFUL);
    holder.user = agent; // kb.view yes, no grant on the admin's private document

    const denied = await getFacts(req(`http://x/api/kb/documents/${doc.id}/facts`), P(doc.id));
    const unknown = await getFacts(req("http://x/api/kb/documents/nope/facts"), P("nope"));
    expect(denied.status).toBe(404);
    expect(unknown.status).toBe(404);
    // Character-identical: no count, no name, no "withheld" placeholder, and
    // nothing that distinguishes "exists but not yours" from "does not exist".
    const deniedBody = await denied.text();
    expect(deniedBody).toBe(await unknown.text());
    expect(deniedBody).not.toMatch(/\d/);
    expect(JSON.parse(deniedBody)).toEqual({ error: "Unknown document." });
  });

  it("a document with no facts answers an empty list — the panel then renders nothing", async () => {
    const doc = await ingest("note.md", PROSE);
    holder.user = admin;
    const res = await getFacts(req(`http://x/api/kb/documents/${doc.id}/facts`), P(doc.id));
    expect(res.status).toBe(200);
    expect(((await res.json()) as FactsResponse).facts).toEqual([]);

    // Absence of facts is normal on prose and must not read as a failure: the
    // component returns null rather than an empty section, and carries no
    // empty-state copy at all.
    const source = readFileSync("src/components/kb/KbFactChips.tsx", "utf8");
    expect(source).toContain("if (data === null || data.facts.length === 0) return null;");
    // Nothing means nothing: no empty-state element, and no markup at all on
    // the empty branch. Comments are stripped first so the prose that
    // EXPLAINS the rule cannot satisfy or break the assertion.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toContain("EmptyState");
    // The empty branch returns null — never markup, and never a count.
    expect(code).toMatch(/data\.facts\.length === 0\) return null;/);
    expect(code).not.toMatch(/facts\.length === 0[\s\S]{0,80}return\s*\(/);
  });
});

// ---------------------------------------------------------------------------
// "An ASSUMED chip is visually distinct and its tooltip names the setting
// that resolved it."
// ---------------------------------------------------------------------------

describe("the ASSUMED chip", () => {
  it("names the ruleset field that resolved it — defaultCurrency, dateOrder or refDate", () => {
    expect(assumptionNote({ kind: "MONEY", text: "$2,400.00" }, "2026-01-15")).toContain("defaultCurrency");
    expect(assumptionNote({ kind: "MONEY", text: "$2,400.00" }, "2026-01-15")).toContain("USD");
    // The one date shape whose reading dateOrder decides.
    expect(assumptionNote({ kind: "DATE", text: "04/11/2025" }, "2026-01-15")).toContain("dateOrder");
    expect(assumptionNote({ kind: "DATE", text: "04/11/2025" }, "2026-01-15")).toContain("DMY");
    // Every other assumed date came from a relative phrase, resolved against
    // the document's own date — which the tooltip states.
    const relative = assumptionNote({ kind: "DATE", text: "next month" }, "2026-01-15");
    expect(relative).toContain("refDate");
    expect(relative).toContain("2026-01-15");
    expect(relative).not.toContain("dateOrder");
  });

  it("is distinct in two channels, not colour alone, and both resolve to design-system tokens", async () => {
    const doc = await ingest("invoice.md", FACTFUL);
    holder.user = admin;
    const body = (await (await getFacts(req(`http://x/api/kb/documents/${doc.id}/facts`), P(doc.id))).json()) as FactsResponse;
    // "$2,400.00" carries an ambiguous symbol, so the ruleset default
    // resolved its currency and the stored fact is ASSUMED. Without one, the
    // chip has nothing to be distinct about and this test proves nothing.
    expect(body.facts.some((f) => f.confidence === "ASSUMED")).toBe(true);

    const source = readFileSync("src/components/kb/KbFactChips.tsx", "utf8");
    expect(source).toContain("border-dashed"); // shape
    expect(source).toContain("var(--warn-chip)"); // tone
    expect(source).toContain("var(--neutral-chip)"); // the EXACT tone it differs from
    expect(source).toContain('<span className="sr-only">assumed</span>'); // and for a screen reader
    expect(source).toContain("title={tooltip}");
    // Design system: no raw colour anywhere in either component.
    for (const file of ["src/components/kb/KbFactChips.tsx", "src/components/kb/KbSearch.tsx"]) {
      expect(readFileSync(file, "utf8")).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|oklch\(/);
    }
  });
});

// ---------------------------------------------------------------------------
// "The KB search box shows the parsed filters as removable chips beside the
// residue text ... Removing a chip re-runs the search without that filter."
// ---------------------------------------------------------------------------

describe("the search route", () => {
  it("shows the parse back as chips beside the residue, and dropping one widens the result set", async () => {
    const big = await ingest("big.md", "Invoice INV-2024-113 total $2,400.00 for the renewal.", "PUBLIC");
    const small = await ingest("small.md", "Invoice INV-2024-114 total $180.00 for the renewal.", "PUBLIC");
    holder.user = admin;

    const withFilter = (await (await search(
      req(`http://x/api/kb/search?q=${encodeURIComponent("invoice over $2,000")}`) as never,
    )).json()) as KbSearchResponse;

    // The residue is what reached the keyword pass — the free text, with the
    // comparator and its operand taken out and shown as a chip instead.
    expect(withFilter.residue).toBe("invoice");
    expect(withFilter.queryUsed).toBe("invoice");
    const money = withFilter.filters.find((f) => f.kind === "MONEY");
    expect(money).toBeDefined();
    expect(money?.comparator).toBe(">=");
    expect(money?.text).toBe("$2,000"); // the surface form, as typed
    expect(money?.display).toBe("≥ USD 2000.00"); // the normalized value
    expect(money?.dropped).toBe(false);

    const ids = new Set(withFilter.hits.map((h) => h.documentId));
    expect(ids.has(big.id)).toBe(true);
    expect(ids.has(small.id)).toBe(false);

    // Removing the chip re-runs the SAME query without that filter.
    const dropped = (await (await search(
      req(`http://x/api/kb/search?q=${encodeURIComponent("invoice over $2,000")}&drop=${money?.index}`) as never,
    )).json()) as KbSearchResponse;
    expect(dropped.filters.find((f) => f.kind === "MONEY")?.dropped).toBe(true);
    expect(dropped.residue).toBe("invoice");

    const widened = new Set(dropped.hits.map((h) => h.documentId));
    expect(widened.has(big.id)).toBe(true);
    expect(widened.has(small.id)).toBe(true);
    // Strictly more: removing a constraint can only widen, never narrow.
    expect(widened.size).toBeGreaterThan(ids.size);
    for (const id of ids) expect(widened.has(id)).toBe(true);
  });

  it("filters can only narrow an entitled set — a dropped chip never reveals a document the searcher may not read", async () => {
    const mine = await ingest("mine.md", "Invoice INV-2024-113 total $2,400.00 for the renewal.", "PUBLIC");
    const theirs = await ingest("theirs.md", "Invoice INV-2024-999 total $9,900.00 for the renewal.");
    holder.user = agent; // no grant on `theirs`, PUBLIC covers `mine`

    for (const url of [
      `http://x/api/kb/search?q=${encodeURIComponent("invoice over $2,000")}`,
      `http://x/api/kb/search?q=${encodeURIComponent("invoice over $2,000")}&drop=0,1,2`,
    ]) {
      const body = (await (await search(req(url) as never)).json()) as KbSearchResponse;
      const seen = body.hits.map((h) => h.documentId);
      expect(seen).not.toContain(theirs.id);
      expect(JSON.stringify(body)).not.toContain("9,900");
    }
    // The searcher's own document is still reachable, so the assertion above
    // is about entitlement rather than about an empty result set.
    const own = (await (await search(
      req(`http://x/api/kb/search?q=${encodeURIComponent("renewal")}`) as never,
    )).json()) as KbSearchResponse;
    expect(own.hits.map((h) => h.documentId)).toContain(mine.id);
  });

  it("an empty query searches nothing rather than everything", async () => {
    await ingest("big.md", "Invoice INV-2024-113 total $2,400.00.", "PUBLIC");
    holder.user = admin;
    const body = (await (await search(req("http://x/api/kb/search?q=%20") as never)).json()) as KbSearchResponse;
    expect(body).toEqual({ residue: "", queryUsed: "", filters: [], overflow: 0, maxFilters: 8, hits: [] });
  });

  it("a query that is ONLY a value still finds the document — a wordless residue searches the values", async () => {
    const doc = await ingest("big.md", "Invoice INV-2024-113 total $2,400.00 for the renewal.", "PUBLIC");
    holder.user = admin;
    // The whole query parses to one IDENTIFIER filter, so the residue is
    // empty. websearch_to_tsquery('simple', '') matches no row, so falling
    // back to the residue here would return nothing on a keyword-only
    // install with the document sitting right there.
    const body = (await (await search(req("http://x/api/kb/search?q=INV-2024-113") as never)).json()) as KbSearchResponse;
    expect(body.residue).toBe("");
    expect(body.queryUsed).toBe("INV-2024-113"); // the readback names what actually ran
    expect(body.filters.map((f) => f.kind)).toContain("IDENTIFIER");
    expect(body.hits.map((h) => h.documentId)).toContain(doc.id);
  });

  it("a residue of punctuation alone is treated as no residue — the same bug wearing quotes", async () => {
    const doc = await ingest("big.md", "Invoice INV-2024-113 total $2,400.00 for the renewal.", "PUBLIC");
    holder.user = admin;
    // `"INV-2024-113"` leaves the two quote characters behind. That residue
    // is non-empty as a string and just as empty to websearch_to_tsquery.
    const body = (await (await search(
      req(`http://x/api/kb/search?q=${encodeURIComponent('"INV-2024-113"')}`) as never,
    )).json()) as KbSearchResponse;
    expect(body.residue).not.toBe(""); // non-empty as a string…
    expect(body.residue).not.toMatch(/[\p{L}\p{N}]/u); // …and empty to the text search
    expect(body.queryUsed).toBe("INV-2024-113");
    expect(body.hits.map((h) => h.documentId)).toContain(doc.id);
  });

  it("the fallback searches the values, not the words the parser stripped", async () => {
    const doc = await ingest("big.md", "Invoice INV-2024-113 issued 2025-11-04 for the renewal.", "PUBLIC");
    holder.user = admin;
    // "on 2025-11-04" leaves no residue. Falling back to the raw string
    // would AND the connective "on", which the document does not contain —
    // so "2025-11-04" would find it and "on 2025-11-04" would not.
    for (const q of ["2025-11-04", "on 2025-11-04", "from 2025-11-04"]) {
      const body = (await (await search(req(`http://x/api/kb/search?q=${encodeURIComponent(q)}`) as never)).json()) as KbSearchResponse;
      expect(body.queryUsed, q).toBe("2025-11-04");
      expect(body.hits.map((h) => h.documentId), q).toContain(doc.id);
    }
  });

  it("a between range does not demand the join word — 'entre $1,000 y $2,000' is not a search for 'y'", async () => {
    const es = await ingest("banda.md", "Rango de precios: $1,000 hasta $2,000 por asiento. Factura INV-2024-779 total $1,700.00.", "PUBLIC");
    const en = await ingest("band.md", "Seat price band: $1,000 to $2,000 per seat. Invoice INV-2024-777 total $1,500.00.", "PUBLIC");
    holder.user = admin;
    // The two-sided form's `text` is the whole span — "$1,000 y $2,000" —
    // so a naive fallback ANDs the literal lexeme "y" and finds only
    // documents that happen to phrase the range the same way the question
    // did. Both of these documents carry both operands and satisfy the
    // filter; neither contains "y" or "and" as a word.
    for (const q of ["entre $1,000 y $2,000", "between $1,000 and $2,000"]) {
      const body = (await (await search(req(`http://x/api/kb/search?q=${encodeURIComponent(q)}`) as never)).json()) as KbSearchResponse;
      expect(body.filters.map((f) => f.comparator), q).toContain("between");
      expect(body.queryUsed, q).toBe("$1,000 $2,000");
      const ids = body.hits.map((h) => h.documentId);
      expect(ids, q).toContain(es.id);
      expect(ids, q).toContain(en.id);
    }
  });

  it("a DATE range is two-sided too, though its comparator is '='", async () => {
    const doc = await ingest(
      "cover.md",
      "Coverage period: 2025-01-05 through 2025-03-01. Policy POL-77 covers the whole term.",
      "PUBLIC",
    );
    holder.user = admin;
    // Every date is an interval, so a DATE range carries comparator "=" like
    // any other date. A fallback keyed on the comparator would fix the money
    // range above and leave this one searching for the literal word "and".
    // The document contains both dates verbatim and neither join word.
    for (const q of ["between 2025-01-05 and 2025-03-01", "entre 2025-01-05 y 2025-03-01"]) {
      const body = (await (await search(req(`http://x/api/kb/search?q=${encodeURIComponent(q)}`) as never)).json()) as KbSearchResponse;
      expect(body.filters.map((f) => f.kind), q).toContain("DATE");
      expect(body.queryUsed, q).toBe("2025-01-05 2025-03-01");
      expect(body.hits.map((h) => h.documentId), q).toContain(doc.id);
    }
  });

  it("the keyword text is a function of the query alone — dropping chips never changes it", async () => {
    await ingest("big.md", "Invoice INV-2024-113 total $2,400.00 issued 2025-11-04.", "PUBLIC");
    holder.user = admin;
    const q = encodeURIComponent("invoice INV-2024-113 over $2,000");
    const base = (await (await search(req(`http://x/api/kb/search?q=${q}`) as never)).json()) as KbSearchResponse;
    // Every subset of dropped chips: the text searched must not move, or
    // removal stops being monotone.
    for (let mask = 0; mask < 1 << base.filters.length; mask++) {
      const drop = base.filters.filter((_f, i) => mask & (1 << i)).map((f) => f.index);
      const res = (await (await search(
        req(`http://x/api/kb/search?q=${q}${drop.length ? `&drop=${drop.join(",")}` : ""}`) as never,
      )).json()) as KbSearchResponse;
      expect(res.queryUsed, `drop=${drop}`).toBe(base.queryUsed);
      const widened = new Set(res.hits.map((h) => h.documentId));
      for (const h of base.hits) expect(widened.has(h.documentId), `drop=${drop}`).toBe(true);
    }
  });

  it("refuses a query longer than the parse cap rather than filtering a prefix of it", async () => {
    holder.user = admin;
    const res = await search(req(`http://x/api/kb/search?q=${"a".repeat(600)}`) as never);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("512");
    // Exactly at the cap is accepted: the field's maxLength is the same
    // number, so a full box must never be refused.
    expect((await search(req(`http://x/api/kb/search?q=${"a".repeat(512)}`) as never)).status).toBe(200);
  });

  it("refuses a NUL character with a stated answer rather than throwing out of the handler", async () => {
    holder.user = admin;
    const res = await search(req("http://x/api/kb/search?q=%00invoice") as never);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("NUL");
  });
});

// ---------------------------------------------------------------------------
// The pure helpers the chips render with.
// ---------------------------------------------------------------------------

describe("the chip helpers", () => {
  it("renders MONEY through its own currency exponent, not a hardcoded 100", () => {
    expect(describeFilter({ kind: "MONEY", comparator: ">=", num: 200000, unit: "USD", confidence: "EXACT", text: "$2k" }))
      .toBe("≥ USD 2000.00");
    // JPY has no minor unit: dividing by 100 here would read 100x low.
    expect(describeFilter({ kind: "MONEY", comparator: "<=", num: 5000, unit: "JPY", confidence: "EXACT", text: "¥5000" }))
      .toBe("≤ JPY 5000");
    expect(describeFilter({ kind: "DURATION", comparator: ">=", num: 2592000, unit: "s", confidence: "EXACT", text: "30 days" }))
      .toBe("≥ 2592000 s");
    expect(describeFilter({ kind: "IDENTIFIER", comparator: "=", norm: "inv2024113", confidence: "EXACT", text: "INV-2024-113" }))
      .toBe("inv2024113");
  });

  it("takes the operands out of a two-sided span and leaves a one-sided one alone", () => {
    const between = { kind: "MONEY", comparator: "between", num: 100000, num2: 200000, unit: "USD", confidence: "EXACT" } as const;
    expect(operandText({ ...between, text: "$1,000 and $2,000", operands: ["$1,000", "$2,000"] })).toBe("$1,000 $2,000");
    expect(operandText({ ...between, text: "$1,000 y $2,000", operands: ["$1,000", "$2,000"] })).toBe("$1,000 $2,000");
    // A DATE range carries comparator "=", not "between" — every date is an
    // interval, so a range is only a wider one. Keying on the comparator
    // would leave exactly this shape broken.
    expect(
      operandText({
        kind: "DATE", comparator: "=", ts: 0, tsEnd: 1, confidence: "EXACT",
        text: "January 5, 2025 and March 1, 2025", operands: ["January 5, 2025", "March 1, 2025"],
      }),
    ).toBe("January 5, 2025 March 1, 2025");
    // A one-sided filter's text IS its operand — nothing to take out.
    expect(operandText({ kind: "MONEY", comparator: ">=", num: 200000, unit: "USD", confidence: "EXACT", text: "$2,000" })).toBe("$2,000");
    expect(operandText({ kind: "IDENTIFIER", comparator: "=", norm: "inv2024113", confidence: "EXACT", text: "INV-2024-113" })).toBe("INV-2024-113");
  });

  it("the parser records both operand surfaces on every two-sided filter, and on no other", () => {
    const ruleset = { refDate: "2026-01-15", dateOrder: "DMY" as const, defaultCurrency: "USD", stepBudget: 250_000 };
    const money = parseQueryFilters("entre $1,000 y $2,000", ruleset).filters;
    expect(money[0].operands).toEqual(["$1,000", "$2,000"]);
    const dates = parseQueryFilters("between 2025-01-05 and 2025-03-01", ruleset).filters;
    expect(dates[0].kind).toBe("DATE");
    expect(dates[0].comparator).toBe("="); // the reason operandText cannot key on it
    expect(dates[0].operands).toEqual(["2025-01-05", "2025-03-01"]);
    // One-sided and bare filters carry none.
    for (const q of ["invoice over $2,000", "INV-2024-113", "issued 2025-11-04"]) {
      for (const f of parseQueryFilters(q, ruleset).filters) expect(f.operands, q).toBeUndefined();
    }
  });

  it("renders a MONEY fact chip through its currency exponent, like the filter chips do", () => {
    // MONEY is stored in MINOR UNITS. "240000 USD" beside the text
    // "$2,400.00" tells an operator the parser read the amount 100x high —
    // the opposite of what a provenance tooltip is for. The bug is
    // currency-dependent, so JPY alone would not catch it.
    const money = (num: string, unit: string) => ({
      kind: "MONEY", norm: `${unit}:${num}`, unit, num, ts: null, tsEnd: null,
    });
    expect(factValue(money("240000", "USD"))).toBe("USD 2400.00");
    expect(factValue(money("5000", "JPY"))).toBe("JPY 5000"); // exponent 0
    expect(factValue(money("240000", "USD"))).not.toContain("240000");
    // The other kinds are unchanged: DURATION and QUANTITY carry no exponent.
    expect(factValue({ kind: "DURATION", norm: "P30D", unit: "s", num: "2592000", ts: null, tsEnd: null })).toBe("2592000 s");
    expect(factValue({ kind: "QUANTITY", norm: "3.5:gb", unit: "gb", num: "3.5", ts: null, tsEnd: null })).toBe("3.5 gb");
    expect(factValue({ kind: "EMAIL", norm: "a@b.com", unit: "", num: null, ts: null, tsEnd: null })).toBe("a@b.com");
  });

  it("renders a one-day DATE as the day, and a wider interval as a closed range", () => {
    const DAY = 86_400_000;
    const start = Date.UTC(2025, 10, 4);
    expect(describeFilter({ kind: "DATE", comparator: "=", ts: start, tsEnd: start + DAY, confidence: "EXACT", text: "2025-11-04" }))
      .toBe("2025-11-04");
    expect(describeFilter({ kind: "DATE", comparator: "=", ts: Date.UTC(2025, 9, 1), tsEnd: Date.UTC(2026, 0, 1), confidence: "EXACT", text: "Q4 2025" }))
      .toBe("2025-10-01 → 2025-12-31");
  });

  it("ignores a drop index that is not a run of digits rather than refusing the search", () => {
    expect([...parseDropped("0,2")]).toEqual([0, 2]);
    expect([...parseDropped("-1,x,1.5,3")]).toEqual([3]);
    expect([...parseDropped(null)]).toEqual([]);
    // Number("") and Number(" ") are both 0, so a shape test rather than a
    // coercion is what stops a trailing comma dropping filter 0 — a chip
    // nobody clicked.
    expect([...parseDropped(",")]).toEqual([]);
    expect([...parseDropped("1,")]).toEqual([1]);
    expect([...parseDropped(" ")]).toEqual([]);
    expect([...parseDropped("0x2")]).toEqual([]);
    // Bounded on the way in: the value is only read as has(i) for i < 8, so
    // a million-part `drop` must not build a million-entry Set.
    expect(parseDropped(Array.from({ length: 10_000 }, (_v, i) => i).join(",")).size).toBeLessThanOrEqual(32);
    expect([...parseDropped("9".repeat(400))]).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The two client components hold state across a client navigation, so the
// tests that matter about them are about what they do when their input
// CHANGES. There is no DOM harness here; these assert the guards exist.
// ---------------------------------------------------------------------------

describe("the client components' state discipline", () => {
  it("the fact panel clears its data when the document id changes", () => {
    const source = readFileSync("src/components/kb/KbFactChips.tsx", "utf8");
    // Without this, a client navigation from a fact-bearing document to a
    // factless one leaves the previous document's chips on screen, linking
    // to chunk anchors that are not on the page — and leaves them forever
    // if the new fetch fails.
    expect(source).toMatch(/useEffect\(\(\) => \{[\s\S]{0,400}setData\(null\);[\s\S]{0,200}void \(async/);
  });

  it("removing a chip re-runs the query the chip came from, not the box's current text", () => {
    const source = readFileSync("src/components/kb/KbSearch.tsx", "utf8");
    // A chip index is a position in ONE parse. Editing the box without
    // pressing Search changes the parse; re-running with the live value
    // would drop a different filter than the chip names.
    expect(source).toMatch(/function dropFilter[\s\S]{0,200}run\(ranQuery,/);
    expect(source).not.toMatch(/function dropFilter[\s\S]{0,300}run\(query,/);
    // ranQuery and dropped move WITH the painted chips, never ahead of them:
    // set only in run()'s success branch, never in submit(). Otherwise a
    // failed second search leaves the first query's chips on screen carrying
    // the second query's indices — durable, not a race.
    expect(source).toMatch(/setData\(body\);\s*\n\s*setRanQuery\(text\);\s*\n\s*setDropped\(drop\);/);
    expect(source).not.toMatch(/function submit[\s\S]{0,300}set(RanQuery|Dropped)\(/);
    // Drops must ACCUMULATE across a round trip. Two X buttons pressed inside
    // one request both read the painted `dropped`, so the second request
    // would carry only the second index and the seq guard would discard the
    // first — the first chip comes back with its filter still applied. The
    // intent therefore advances in a ref at click time, keyed to its query.
    expect(source).toMatch(/pending\.current\.query === ranQuery \? pending\.current\.drops : dropped/);
    expect(source).toMatch(/pending\.current = \{ query: text, drops: drop \};/);
    // And a removal that FAILED is not intent: the ref is rolled back in the
    // catch branch, or the next click silently carries drops that never
    // applied and removes filters it does not name.
    expect(source).toMatch(/catch \(err\) \{[\s\S]{0,700}pending\.current = \{ query: "", drops: \[\] \};/);
    // And two fast removals must paint in the order they were asked for.
    expect(source).toContain("if (ticket !== seq.current) return;");
  });

  it("neither component ships a focus utility the design system's own rule would override", () => {
    // servo_design_system/tokens/base.css paints the 3px --focus-ring on every
    // :focus-visible element. It is imported into Tailwind's `base` layer
    // (spec question 135), so a utility CAN override it now — which is the
    // point: a per-component ring utility on a focusable element there is a
    // second focus recipe competing with the design system's own, and the
    // one it would replace is the one the whole app shares.
    for (const file of ["src/components/kb/KbFactChips.tsx", "src/components/kb/KbSearch.tsx"]) {
      expect(readFileSync(file, "utf8"), file).not.toContain("focus-visible:ring-[var(--focus-ring)]");
    }
    // The search field's ring is focus-WITHIN on a wrapper, which base.css
    // does not style, so that one is live — and it is the repo's own recipe.
    expect(readFileSync("src/components/kb/KbSearch.tsx", "utf8")).toContain(
      "focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50",
    );
  });

  it("chips stay opaque — a dropped filter is recast, never faded", () => {
    // "Status and brand chips are opaque" (servo_design_system/readme.md):
    // halving the contrast of a chip's text is the wrong way to say it is no
    // longer applied, so a dropped chip takes the neutral tone instead.
    const source = readFileSync("src/components/kb/KbSearch.tsx", "utf8");
    // `disabled:opacity-50` on the submit button is the repo's own button
    // recipe and is not a chip; every OTHER opacity is the thing banned here.
    expect(source.replaceAll("disabled:opacity-50", "")).not.toMatch(/opacity-\d/);
    expect(source).toMatch(/f\.dropped\s*\?\s*"var\(--neutral-chip\)"/);
    expect(readFileSync("src/components/kb/KbFactChips.tsx", "utf8")).not.toMatch(/hover:opacity|opacity-\d/);
  });
});
