// kb-11: the knowledge-base tools — the mock-provider resolver run calling
// search_knowledge with citations, cursor pagination, the no-existence-oracle
// rule, MCP denial by name, and ensureToolPolicies backfilling the rows.

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { tmpDb, type TmpDb } from "./helpers/tmp-db";

type ServoDb = { [key: string]: unknown };
const holder = vi.hoisted(() => ({ db: null as unknown as ServoDb }));
vi.mock("@/lib/db", () => ({ get db() { return holder.db; } }));

import {
  kbTools,
  compileStatedFilter,
  statedFromFilter,
  queryRuleset,
  interpretation,
} from "@/lib/ai/tools/kb";
import { getMcpTools, mcpToolWithholdReason } from "@/lib/mcp";
import { ensureToolPolicies } from "@/lib/ai/custom-tools";
import { ingestDocument } from "@/lib/kb/ingest";
import { parseQueryFilters } from "@/lib/kb/query-filters";
import { filterExistsSql } from "@/lib/kb/search";
import { KB_EXTRACT_BUDGET_ENV } from "@/lib/kb/settings";

// The same tightening ext-04's and ext-06's own files make: fixtures must not
// wait out the shipped extraction budget.
process.env[KB_EXTRACT_BUDGET_ENV] = "20000";

const handles: TmpDb[] = [];
afterAll(async () => {
  for (const h of handles) await h.dispose();
});

let db: PrismaClient;
let admin: { id: string; role: string };
let requester: { id: string; role: string };

beforeEach(async () => {
  if (handles.length > 2) await handles.shift()?.dispose();
  const a = await tmpDb();
  handles.push(a);
  db = a.client;
  holder.db = db as unknown as ServoDb;
  admin = await db.user.create({ data: { name: "A", email: "a@x.com", role: "ADMIN" } });
  requester = await db.user.create({ data: { name: "R", email: "r@x.com", role: "REQUESTER" } });
});

const ctx = (agentId = "builtin:resolver", humanId: string | null) => ({
  ticketId: "t",
  runId: "r",
  agentUser: { id: "ai" } as never,
  principals: { agentId, humanId },
});

describe("search_knowledge", () => {
  it("returns passage + document name + locator for an entitled document", async () => {
    const doc = await ingestDocument({
      name: "pricing.md", contentType: "text/markdown", ownerId: admin.id, visibility: "PUBLIC",
      bytes: Buffer.from("# Pricing\n\nThe renewal window for pricing is March."),
    });
    await db.kbGrant.create({
      data: { documentId: doc.documentId, subjectType: "AGENT", subjectId: "builtin:resolver", grantedById: admin.id },
    });
    const out = await kbTools.search_knowledge.execute(
      { query: "renewal pricing" },
      ctx("builtin:resolver", requester.id),
    );
    expect(out).toContain("pricing.md");
    expect(out).toContain("lines 1");
    expect(out).toContain("renewal window");
    expect(out.startsWith("[1]")).toBe(true);
  });

  it("denies without a human principal — and MCP contexts carry none", async () => {
    const out = await kbTools.search_knowledge.execute(
      { query: "x" },
      { ticketId: "mcp-external", runId: "mcp-external", agentUser: { id: "ai" } as never },
    );
    expect(out).toMatch(/per-user token/);
  });

  it("No accessible sources. on an empty intersection — never a degraded answer", async () => {
    await ingestDocument({
      name: "locked.md", contentType: "text/markdown", ownerId: admin.id,
      bytes: Buffer.from("# Locked\n\nsecret renewal terms"),
    });
    const out = await kbTools.search_knowledge.execute(
      { query: "renewal terms" },
      ctx("builtin:resolver", requester.id),
    );
    expect(out).toBe("No accessible sources.");
  });
});

// ---------------------------------------------------------------------------
// ext-07: filters on search_knowledge.

/** The frozen "today" the readback assertions resolve against. Only Date is
 *  faked — timers stay real, so the Postgres client is untouched. */
const FROZEN = new Date("2026-04-15T09:00:00Z");
const REF_DATE = "2026-04-15";

async function ledger(name: string, text: string, visibility: "PUBLIC" | "PRIVATE", grant: boolean) {
  const doc = await ingestDocument({
    name, contentType: "text/markdown", ownerId: admin.id, visibility,
    bytes: Buffer.from(text, "utf8"),
  });
  if (grant) {
    await db.kbGrant.create({
      data: { documentId: doc.documentId, subjectType: "AGENT", subjectId: "builtin:resolver", grantedById: admin.id },
    });
  }
  return doc.documentId;
}

describe("search_knowledge filters — one compiler, two ways in (ext-07)", () => {
  it("a STATED filter and the SAME filter INFERRED compile to identical SQL", () => {
    const ruleset = queryRuleset(REF_DATE);
    const inferred = parseQueryFilters("invoices over $2,000", ruleset).filters;
    expect(inferred).toHaveLength(1);

    const compiled = compileStatedFilter(
      { kind: "MONEY", comparator: ">=", value: "2000", unit: "USD" },
      ruleset,
    );
    expect("filter" in compiled).toBe(true);
    const stated = (compiled as { filter: (typeof inferred)[number] }).filter;

    // The proof is the SQL itself, not the object: both paths reach kbSearch
    // through the one EXISTS compiler, so there is no second implementation.
    expect(filterExistsSql(stated, "0", 'c."documentId"')).toBe(
      filterExistsSql(inferred[0], "0", 'c."documentId"'),
    );
    // ...and the amount agrees, minor units and all.
    expect(stated).toMatchObject({ kind: "MONEY", comparator: ">=", num: 200_000, unit: "USD" });
  });

  it("compiles every kind, and round-trips a parsed filter back through the stated shape", () => {
    const ruleset = queryRuleset(REF_DATE);
    const cases = [
      "invoices over $2k from last quarter",
      "write to billing@acme.com",
      "under 30 days",
      "files over 3.5 gb",
      "between $1,000 and $2,000",
      "see https://acme.example/handbook",
      // A DOZEN IDENTIFIER SHAPES, not the one that happens to survive. The
      // normalized form strips separators, so "SKU-9A" becomes "sku9a" —
      // which is no longer readable AS an identifier. A round-trip that
      // states the norm rather than the surface refuses nine of these.
      "ticket INV-2024-113", "ref ABC.123.def", "part SKU-9A", "code AB-12-CD",
      "unit X1-Y2", "case REF-2026-ALPHA", "ticket TICKET-42A", "part P/N-889-B",
      "version V2.3.1", "case CASE-2026-ZZ", "order ORD_2024_77", "spec ISO-8601-2019",
    ];
    for (const query of cases) {
      for (const filter of parseQueryFilters(query, ruleset).filters) {
        const stated = statedFromFilter(filter);
        expect(stated, `${query} -> ${filter.kind}`).not.toBeNull();
        const back = compileStatedFilter(stated, ruleset);
        expect(back, `${query} -> ${filter.kind}`).toHaveProperty("filter");
        // Same SQL is the contract; `text` and `confidence` are readback
        // material and play no part in it.
        expect(
          filterExistsSql((back as { filter: typeof filter }).filter, "0", "d.id"),
          `${query} -> ${filter.kind}`,
        ).toBe(filterExistsSql(filter, "0", "d.id"));
      }
    }
  });

  it("an open-ended stated DATE stays one interval, and a bare amount assumes the ruleset currency", () => {
    const ruleset = queryRuleset(REF_DATE);
    const from = compileStatedFilter({ kind: "DATE", comparator: ">=", value: "2026-01-01" }, ruleset);
    expect(from).toMatchObject({
      filter: { kind: "DATE", ts: Date.parse("2026-01-01T00:00:00Z"), tsEnd: 8.64e15 },
    });
    const to = compileStatedFilter({ kind: "DATE", comparator: "<=", value: "2026-01-31" }, ruleset);
    expect(to).toMatchObject({
      filter: { kind: "DATE", ts: -8.64e15, tsEnd: Date.parse("2026-02-01T00:00:00Z") },
    });
    const bare = compileStatedFilter({ kind: "MONEY", comparator: ">=", value: "2000" }, ruleset);
    expect(bare).toMatchObject({
      filter: { kind: "MONEY", num: 200_000, unit: "USD", confidence: "ASSUMED" },
    });
  });

  it("refuses a statement it cannot read, by position, without touching the corpus", async () => {
    const out = await kbTools.search_knowledge.execute(
      { query: "invoices", filters: [{ kind: "MONEY", value: "2000", unit: "USD" }, { kind: "MONEY", value: "not-a-number" }] },
      ctx("builtin:resolver", requester.id),
    );
    expect(out).toMatch(/^Error: filter 2 /);
    for (const bad of [
      { kind: "PERSON", value: "x" },
      { kind: "MONEY", comparator: "~", value: "1" },
      { kind: "MONEY", comparator: "between", value: "1000" },
      { kind: "EMAIL", value: "" },
      // Read only in PART by the extractor: the money grammar takes two
      // decimals, so "USD 2000.123" would have filtered on 2000 flat.
      { kind: "MONEY", value: "2000.123", unit: "USD" },
      // Beyond the duration number's six-digit bound in every unit word.
      { kind: "DURATION", value: "999999999999937" },
      { kind: "QUANTITY", value: "3", unit: "parsecs" },
    ]) {
      expect(compileStatedFilter(bad, queryRuleset(REF_DATE)), JSON.stringify(bad)).toHaveProperty("error");
    }
    // ...and the whole-span rule does not cost the ordinary values.
    for (const good of [
      { kind: "MONEY", value: "2000.12", unit: "USD" },
      { kind: "DURATION", value: "2592000" },
      { kind: "QUANTITY", value: "3.5", unit: "gb" },
      { kind: "URL", value: "https://acme.example/handbook" },
    ]) {
      expect(compileStatedFilter(good, queryRuleset(REF_DATE)), JSON.stringify(good)).toHaveProperty("filter");
    }
  });
});

describe("search_knowledge filters — the readback and the red team (ext-07)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(FROZEN);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("names its interpretation when a filter was INFERRED, and stays silent when it was STATED", async () => {
    await ledger("ledger.md", "# Ledger\n\nConsulting invoices. Total $3,000.00 dated 2026-02-14.", "PUBLIC", true);

    const inferred = await kbTools.search_knowledge.execute(
      { query: "invoices over $2k from last quarter" },
      ctx("builtin:resolver", requester.id),
    );
    // Every reading is named: the surface text, what it became, and the
    // "today" a relative phrase was resolved against.
    expect(inferred).toContain('read "$2k" as >= USD 2000 (assumed currency)');
    expect(inferred).toContain(`read "last quarter" as 2026-01-01..2026-04-01 against ${REF_DATE}`);
    expect(inferred.startsWith("Interpreted: ")).toBe(true);
    expect(inferred).toContain("ledger.md");

    const stated = await kbTools.search_knowledge.execute(
      {
        query: "invoices",
        filters: [{ kind: "MONEY", comparator: ">=", value: "2000", unit: "USD" }],
      },
      ctx("builtin:resolver", requester.id),
    );
    expect(stated).not.toContain("Interpreted:");
    expect(stated.startsWith("[1] ledger.md")).toBe(true);
  });

  it("the readback is a pure function of the query — same query, same prefix, whatever the data", async () => {
    const ruleset = queryRuleset(REF_DATE);
    const { filters } = parseQueryFilters("invoices over $2k from last quarter", ruleset);
    const prefix = interpretation(filters, REF_DATE);
    expect(prefix.endsWith("\n\n")).toBe(true);
    expect(interpretation(filters, REF_DATE)).toBe(prefix); // no clock, no state
    expect(interpretation([], REF_DATE)).toBe("");
  });

  it("NO EXISTENCE ORACLE: a filter matching only a non-entitled document is byte-identical to one matching nothing", async () => {
    // Three ledgers, and the shape matters. small is entitled and does NOT
    // satisfy the money filter; big is entitled and DOES, so the requester has
    // a real hit and the EMPTY and NON-EMPTY returns are both exercised;
    // secret satisfies it too and is not readable by the resolver.
    await ledger("small-ledger.md", "# Ledger\n\nConsulting invoices. Total $10.00 dated 2026-02-02.", "PUBLIC", true);
    await ledger("big-ledger.md", "# Ledger\n\nConsulting invoices. Total $3,000.00 dated 2026-02-14.", "PUBLIC", true);
    const secret = await ledger(
      "secret-ledger.md",
      "# Ledger\n\nConsulting invoices, CONFIDENTIAL-ZEBRA. Total $9,000.00 dated 2026-02-03.",
      "PRIVATE",
      false,
    );

    // $2k: big and secret match. $5k: ONLY secret matches, so the requester's
    // result is empty. The same pair of runs is compared on both branches,
    // because a leak appended to a list of hits is as much an oracle as one
    // appended to "No accessible sources."
    const withHit = { query: "invoices over $2k from last quarter" };
    const withoutHit = { query: "invoices over $5k from last quarter" };

    // THE CONTROL THAT MAKES THE COMPARISONS BELOW ABLE TO FAIL. Without it, a
    // fixture whose dates drifted outside the filter's window would turn the
    // byte-identity assertions into pairs of "nothing matched anywhere" runs
    // that are trivially equal. This runs the SAME query at the SAME frozen
    // refDate under a chain that CAN read the document, and the name comes
    // back — so it really is a filter match. (The chain differs in both its
    // halves; the control's only job is to prove the match, not to say which
    // half hides it.)
    await db.kbGrant.create({
      data: { documentId: secret, subjectType: "AGENT", subjectId: "builtin:auditor", grantedById: admin.id },
    });
    for (const q of [withHit, withoutHit]) {
      expect(await kbTools.search_knowledge.execute(q, ctx("builtin:auditor", admin.id))).toContain("secret-ledger.md");
    }

    // The other control, taken BEFORE the deletion below so it can still fail:
    // unfiltered, the requester sees the two ledgers it may read and never the
    // third — so the emptiness below is the filter narrowing, not an empty
    // knowledge base, and the hidden document was in keyword range all along.
    const unfiltered = await kbTools.search_knowledge.execute(
      { query: "invoices" },
      ctx("builtin:resolver", requester.id),
    );
    expect(unfiltered).toContain("small-ledger.md");
    expect(unfiltered).toContain("big-ledger.md");
    expect(unfiltered).not.toContain("secret-ledger.md");

    const hitWithHiddenMatch = await kbTools.search_knowledge.execute(withHit, ctx("builtin:resolver", requester.id));
    const emptyWithHiddenMatch = await kbTools.search_knowledge.execute(withoutHit, ctx("builtin:resolver", requester.id));

    // Same queries, same everything — except that now NOTHING matches the
    // filter anywhere in the database.
    await db.document.delete({ where: { id: secret } });
    const hitWithNoMatchAtAll = await kbTools.search_knowledge.execute(withHit, ctx("builtin:resolver", requester.id));
    const emptyWithNoMatchAtAll = await kbTools.search_knowledge.execute(withoutHit, ctx("builtin:resolver", requester.id));

    expect(hitWithHiddenMatch).toBe(hitWithNoMatchAtAll);
    expect(emptyWithHiddenMatch).toBe(emptyWithNoMatchAtAll);
    expect(hitWithHiddenMatch).toContain("big-ledger.md");
    expect(emptyWithHiddenMatch).toContain("No accessible sources.");
    for (const out of [hitWithHiddenMatch, emptyWithHiddenMatch]) {
      expect(out).not.toContain("secret-ledger");
      expect(out).not.toContain("ZEBRA");
      expect(out).not.toMatch(/more matching|not accessible|withheld|hidden/i);
    }
  }, 60_000);

  it("FILTERS NARROW: dropping the filter returns strictly more, adding it never adds a document", async () => {
    await ledger("big.md", "# Ledger\n\nConsulting invoices. Total $3,000.00 dated 2026-02-14.", "PUBLIC", true);
    await ledger("small.md", "# Ledger\n\nConsulting invoices. Total $500.00 dated 2026-02-15.", "PUBLIC", true);

    const filtered = await kbTools.search_knowledge.execute(
      { query: "invoices", filters: [{ kind: "MONEY", comparator: ">=", value: "2000", unit: "USD" }] },
      ctx("builtin:resolver", requester.id),
    );
    const unfiltered = await kbTools.search_knowledge.execute(
      { query: "invoices" },
      ctx("builtin:resolver", requester.id),
    );
    expect(filtered).toContain("big.md");
    expect(filtered).not.toContain("small.md");
    expect(unfiltered).toContain("big.md");
    expect(unfiltered).toContain("small.md");
  });

  it("a MOCK-PROVIDER RESOLVER RUN really issues a filtered search, and gets the filtered answer", async () => {
    await ledger("manual-big.md", "# Manual\n\nConsulting invoices in the manual. Total $3,000.00 due.", "PUBLIC", true);
    await ledger("manual-small.md", "# Manual\n\nConsulting invoices in the manual. Total $500.00 due.", "PUBLIC", true);

    const t = await db.ticket.create({
      data: {
        number: 47_101,
        title: "Invoices over $2,000 in the manual",
        description: "Which invoices does the manual cover?",
        requesterId: requester.id,
        category: "OTHER",
        status: "TRIAGED",
      },
    });
    const { ensureAiAgents } = await import("@/lib/bootstrap");
    await ensureAiAgents();
    const { runResolver } = await import("@/lib/ai/engine");
    const run = await runResolver(t.id);

    const call = await db.agentStep.findFirstOrThrow({
      where: { runId: run.id, type: "TOOL_CALL", toolName: "search_knowledge" },
      orderBy: { index: "asc" },
    });
    // The script STATED the filter rather than leaving it to be inferred...
    const input = JSON.parse(call.content) as { query: string; filters?: unknown[] };
    expect(input.filters).toEqual([
      { kind: "MONEY", comparator: ">=", value: "2000", unit: "USD" },
    ]);
    expect(input.query).not.toContain("$2,000"); // the residue, not the phrase

    // ...and the tool honoured it: the run saw the big ledger and not the small.
    const result = await db.agentStep.findFirstOrThrow({
      where: { runId: run.id, type: "TOOL_RESULT", toolName: "search_knowledge" },
      orderBy: { index: "asc" },
    });
    expect(result.content).toContain("manual-big.md");
    expect(result.content).not.toContain("manual-small.md");
    expect(result.content).not.toContain("Interpreted:"); // stated, not inferred
  }, 60_000);

  it("the STATED path reduces the query to the residue too, and says what it did not apply", async () => {
    await ledger("big.md", "# Ledger\n\nConsulting invoices. Total $3,000.00 dated 2026-02-14.", "PUBLIC", true);

    // The natural usage: a model states the filter AND leaves the phrase in
    // the query. websearch_to_tsquery ANDs "over" and "2 <-> 000", so without
    // the residue reduction this returns nothing — the stated field would be
    // strictly worse than the phrase table it exists to improve on.
    const natural = await kbTools.search_knowledge.execute(
      { query: "invoices over $2,000", filters: [{ kind: "MONEY", comparator: ">=", value: "2000", unit: "USD" }] },
      ctx("builtin:resolver", requester.id),
    );
    expect(natural).toContain("big.md");
    // ...and the phrase it swallowed is NAMED, because it was neither applied
    // as a filter nor matched as text.
    expect(natural).toContain('"$2,000" in the query text');
    expect(natural).toContain("state it in filters if you meant to filter on it");

    // A stated filter with plain prose says nothing extra.
    const clean = await kbTools.search_knowledge.execute(
      { query: "invoices", filters: [{ kind: "MONEY", comparator: ">=", value: "2000", unit: "USD" }] },
      ctx("builtin:resolver", requester.id),
    );
    expect(clean).not.toContain("Interpreted:");
    expect(clean).toContain("big.md");
  });

  it("filters PRESENT means stated — an empty array is the pre-ext-07 search, a non-array is refused", async () => {
    await ledger("tagged.md", "# Escalation\n\nEscalation policy INV-2024-113 applies here.", "PUBLIC", true);
    await ledger("untagged.md", "# Escalation\n\nEscalation policy for everything else.", "PUBLIC", true);

    // `filters: []` means "no filters" — so nothing is taken out of the
    // keyword text either. The identifier stays a search term, exactly as it
    // did before this item; the regression this pins is the opposite rule,
    // under which the identifier would be stripped in exchange for no filter
    // and untagged.md would come back too.
    const suppressed = await kbTools.search_knowledge.execute(
      { query: "escalation INV-2024-113", filters: [] },
      ctx("builtin:resolver", requester.id),
    );
    expect(suppressed).toContain("tagged.md");
    expect(suppressed).not.toContain("untagged.md");
    expect(suppressed).not.toContain("Interpreted:"); // nothing was inferred

    // The same text with no `filters` key at all: the identifier becomes a
    // structured filter instead, and the result says so.
    const inferred = await kbTools.search_knowledge.execute(
      { query: "escalation INV-2024-113" },
      ctx("builtin:resolver", requester.id),
    );
    expect(inferred).toContain("tagged.md");
    expect(inferred).not.toContain("untagged.md");
    expect(inferred).toContain('read "INV-2024-113" as identifier inv2024113');

    const malformed = await kbTools.search_knowledge.execute(
      { query: "invoices", filters: "MONEY>=2000" },
      ctx("builtin:resolver", requester.id),
    );
    expect(malformed).toBe("Error: filters must be an array of {kind, comparator, value, unit}.");
  });

  it("caps the filter count — one tool call may not hand the planner an unbounded conjunction", async () => {
    const one = { kind: "MONEY", comparator: ">=", value: "1", unit: "USD" };
    const refused = await kbTools.search_knowledge.execute(
      { query: "invoices", filters: Array.from({ length: 17 }, () => one) },
      ctx("builtin:resolver", requester.id),
    );
    expect(refused).toBe("Error: at most 16 filters may be stated in one search.");

    // The inferred path cannot refuse — a query is not a statement — so it
    // trims and SAYS it trimmed.
    const many = Array.from({ length: 20 }, (_, i) => `INV-2024-${100 + i}`).join(" ");
    const trimmed = await kbTools.search_knowledge.execute(
      { query: many },
      ctx("builtin:resolver", requester.id),
    );
    expect(trimmed).toMatch(/further readings dropped — at most 16 filters apply to one search/);

    // And a stated value cannot smuggle the cap back in by being enormous.
    const huge = await kbTools.search_knowledge.execute(
      { query: "invoices", filters: [{ kind: "URL", value: `https://x.example/${"a".repeat(600)}` }] },
      ctx("builtin:resolver", requester.id),
    );
    expect(huge).toMatch(/^Error: filter 1 is longer than the 512-character limit/);
  });

  it("a norm carrying a quote is escaped, not refused — lit() is what holds this line", async () => {
    // The URL matcher excludes "'" from what it matches, but new URL()
    // percent-decodes the host, so the NORMALIZED form can carry one. The
    // header of src/lib/ai/tools/kb.ts says lit() is the defence; this pins it.
    const compiled = compileStatedFilter(
      { kind: "URL", value: "https://ex%27ample.com/a" },
      queryRuleset(REF_DATE),
    );
    expect(compiled).toHaveProperty("filter");
    const filter = (compiled as { filter: Parameters<typeof filterExistsSql>[0] }).filter;
    expect(filter.norm).toContain("'");
    expect(filterExistsSql(filter, "0", "d.id")).toContain("''");

    // It reaches the database as a value, not as syntax.
    const out = await kbTools.search_knowledge.execute(
      { query: "invoices", filters: [{ kind: "URL", value: "https://ex%27ample.com/a" }] },
      ctx("builtin:resolver", requester.id),
    );
    expect(out).toBe("No accessible sources.");
  });

  it("the open-ended DATE filters compileStatedFilter emits round-trip through statedFromFilter", () => {
    const ruleset = queryRuleset(REF_DATE);
    for (const comparator of [">=", "<="]) {
      const first = compileStatedFilter({ kind: "DATE", comparator, value: "2026-01-01" }, ruleset);
      const filter = (first as { filter: Parameters<typeof filterExistsSql>[0] }).filter;
      const restated = statedFromFilter(filter);
      expect(restated, comparator).not.toBeNull();
      const back = compileStatedFilter(restated, ruleset);
      expect(back, comparator).toHaveProperty("filter");
      expect(filterExistsSql((back as { filter: typeof filter }).filter, "0", "d.id"), comparator).toBe(
        filterExistsSql(filter, "0", "d.id"),
      );
    }
  });

  it("the whole result, readback included, stays inside the 4000-character budget", async () => {
    await ledger(
      "long.md",
      `# Ledger\n\n${"Consulting invoices for the period. ".repeat(400)}Total $3,000.00 dated 2026-02-14.`,
      "PUBLIC",
      true,
    );
    // A dense query: many inferred filters, so a long "Interpreted:" prefix.
    const dense = `invoices ${Array.from({ length: 20 }, (_, i) => `INV-2024-${100 + i}`).join(" ")}`;
    const out = await kbTools.search_knowledge.execute({ query: dense }, ctx("builtin:resolver", requester.id));
    expect(out.length).toBeLessThanOrEqual(4000);
  });

  it("a mock-scripted IDENTIFIER filter is one the tool ACCEPTS — the inverse states the surface, not the norm", async () => {
    await ledger("manual.md", "# Manual\n\nThis knowledge base article covers part SKU-9A and its replacement.", "PUBLIC", true);
    const t = await db.ticket.create({
      data: {
        number: 47_102,
        title: "knowledge base SKU-9A",
        description: "Which article covers it?",
        requesterId: requester.id,
        category: "OTHER",
        status: "TRIAGED",
      },
    });
    const { ensureAiAgents } = await import("@/lib/bootstrap");
    await ensureAiAgents();
    const { runResolver } = await import("@/lib/ai/engine");
    const run = await runResolver(t.id);

    const result = await db.agentStep.findFirstOrThrow({
      where: { runId: run.id, type: "TOOL_RESULT", toolName: "search_knowledge" },
      orderBy: { index: "asc" },
    });
    // The regression this pins: statedFromFilter used to emit the NORMALIZED
    // identifier ("sku9a"), which compileStatedFilter cannot read back, so the
    // scripted call came home as "Error: filter 1 has a value the extractor
    // cannot read as IDENTIFIER" and the run lost a citation it used to get.
    expect(result.content).not.toMatch(/^Error:/);
    expect(result.content).toContain("manual.md");
  }, 60_000);

  it("a query longer than ext-06's parse cap is searched verbatim, never spliced", async () => {
    const filler = "Consulting ledgers cover the quarterly period. ".repeat(14);
    await ledger("long.md", `# Ledger\n\nInvoices over $2,000 due. ${filler}`, "PUBLIC", true);

    // The filter phrase sits INSIDE the 512-character parse window, so a
    // filter really is applied; the query then runs past the cap. The residue
    // covers only the first 512 characters, so splicing it onto the untouched
    // tail would either glue two words together or bisect the one the cap cut
    // in half — and websearch_to_tsquery ANDs the fragment, which no chunk
    // contains. Verbatim is what this tool did before ext-07, so a long query
    // can never come back with less than it used to.
    const long = `invoices over $2,000 ${filler}`;
    expect(long.length).toBeGreaterThan(512);
    const out = await kbTools.search_knowledge.execute(
      { query: long },
      ctx("builtin:resolver", requester.id),
    );
    expect(out).toContain("long.md");
    // The filter still applied, and is still named.
    expect(out).toContain('read "$2,000" as >= USD 2000');
  }, 60_000);

  it("the tool's risk row is untouched by this item: LOW, no approval, and no new policy row", async () => {
    await ensureToolPolicies();
    const row = await db.toolPolicy.findUniqueOrThrow({ where: { toolName: "search_knowledge" } });
    expect(row.riskLevel).toBe("LOW");
    expect(row.requiresApproval).toBe(false);
    expect(row.enabled).toBe(true);
    // Filters are scoping INSIDE execute(), so this item adds no tool.
    const kbRows = await db.toolPolicy.findMany({ where: { toolName: { startsWith: "search_" } } });
    expect(kbRows.map((r) => r.toolName).sort()).toEqual(["search_knowledge", "search_tickets"]);
  });
});

describe("read_document — cursor pagination and the no-existence-oracle", () => {
  it("pages by chunk cursor and names the next cursor", async () => {
    const doc = await ingestDocument({
      name: "big.md", contentType: "text/markdown", ownerId: admin.id, visibility: "PUBLIC",
      bytes: Buffer.from(
        ["# One", "", "first section body", "", "# Two", "", "second section body", "", "# Three", "", "third section body", "", "# Four", "", "fourth section body", "", "# Five", "", "fifth section body"].join("\n"),
      ),
    });
    // The resolver reads only what an AGENT grant gives it — even PUBLIC.
    await db.kbGrant.create({
      data: { documentId: doc.documentId, subjectType: "AGENT", subjectId: "builtin:resolver", grantedById: admin.id },
    });
    const first = await kbTools.read_document.execute(
      { documentId: doc.documentId },
      ctx("builtin:resolver", requester.id),
    );
    expect(first).toContain("big.md");
    expect(first).toContain("next cursor");
    const m = first.match(/"fromChunk": (\d+)/);
    expect(m).toBeTruthy();
    const second = await kbTools.read_document.execute(
      { documentId: doc.documentId, fromChunk: Number(m![1]) },
      ctx("builtin:resolver", requester.id),
    );
    expect(second).not.toContain("first section body");
  });

  it("returns the IDENTICAL string for non-entitled and non-existent ids", async () => {
    const doc = await ingestDocument({
      name: "hidden.md", contentType: "text/markdown", ownerId: admin.id,
      bytes: Buffer.from("# Hidden\n\nbody"),
    });
    const denied = await kbTools.read_document.execute(
      { documentId: doc.documentId },
      ctx("builtin:resolver", requester.id),
    );
    const missing = await kbTools.read_document.execute(
      { documentId: "does-not-exist" },
      ctx("builtin:resolver", requester.id),
    );
    expect(denied).toBe(missing);
    expect(denied).toMatch(/no accessible document/i);
  });
});

describe("list_collections", () => {
  it("counts only entitled documents and omits empty collections", async () => {
    const collection = await db.collection.create({ data: { name: "Readable" } });
    const empty = await db.collection.create({ data: { name: "Empty" } });
    void empty;
    const doc = await ingestDocument({
      name: "in-collection.md", contentType: "text/markdown", ownerId: admin.id, visibility: "PUBLIC",
      bytes: Buffer.from("# C\n\ncontent"),
    });
    await db.document.update({ where: { id: doc.documentId }, data: { collectionId: collection.id } });
    await db.kbGrant.create({
      data: { collectionId: collection.id, subjectType: "AGENT", subjectId: "builtin:resolver", grantedById: admin.id },
    });
    const out = await kbTools.list_collections.execute({}, ctx("builtin:resolver", requester.id));
    expect(out).toContain("Readable (1 readable document)");
    expect(out).not.toContain("Empty");
  });
});

describe("MCP denial and policy backfill", () => {
  it("the three KB tools are absent from the MCP registry and the refusal names the reason", async () => {
    const served = await getMcpTools();
    expect(served.search_knowledge).toBeUndefined();
    expect(served.read_document).toBeUndefined();
    expect(served.list_collections).toBeUndefined();
    const reason = await mcpToolWithholdReason("search_knowledge");
    expect(reason).toMatch(/per-user token/);
  });

  it("ensureToolPolicies backfills the three rows on an existing database", async () => {
    expect(await db.toolPolicy.findUnique({ where: { toolName: "search_knowledge" } })).toBeNull();
    await ensureToolPolicies();
    for (const name of ["search_knowledge", "read_document", "list_collections"]) {
      const row = await db.toolPolicy.findUnique({ where: { toolName: name } });
      expect(row?.riskLevel).toBe("LOW");
      expect(row?.requiresApproval).toBe(false);
    }
  });
});
