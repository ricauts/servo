// dcl-04: the structure-aware chunker over DoclingDocument. Everything
// runs in node over typed documents (also pushed through the schema parser
// to prove shape compatibility) — no endpoint is called, no socket opens.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { parseCappedDocument, type DoclingDocumentT } from "@/lib/kb/extractors/docling-schema";
import {
  chunkDoclingDocument,
  DOC_TABLE_CELL_CAP,
  HEADING_PREFIX_END_KEY,
} from "@/lib/kb/extractors/docling-chunker";
import { keywordPass } from "@/lib/kb/keywords";
import { mockEmbed, MOCK_EMBEDDER_MODEL } from "@/lib/kb/mock-embedder";
import { chunkMarkdown } from "@/lib/kb/chunk";
import { PageLocator, SheetLocator } from "@/lib/kb/locator";

const FIXDIR = "tests/fixtures/kb/docling";

/** Parse a typed doc through the schema too — the chunker's input is
 *  exactly what the capped client produces. */
function docFromJson(name: string): DoclingDocumentT {
  return parseCappedDocument(readFileSync(`${FIXDIR}/${name}`));
}

/** An inline document builder for the structural cases. */
function doc(items: unknown[], pages = [{ page_no: 1, size: { width: 612, height: 792 } }]): DoclingDocumentT {
  return parseCappedDocument(
    Buffer.from(JSON.stringify({ pages, items })),
  );
}

describe("heading paths", () => {
  it("a section's heading path prefixes every chunk beneath it, nesting consecutive headings", () => {
    const d = doc([
      { item_type: "section-header", text: "Chapter 2", prov: [{ page_no: 1 }] },
      { item_type: "section-header", text: "Maintenance", prov: [{ page_no: 1 }] },
      { item_type: "text", text: "Replace the filter every 90 days.", prov: [{ page_no: 1 }] },
    ]);
    const chunks = chunkDoclingDocument(d);
    const body = chunks.find((c) => c.text.includes("filter"))!;
    expect(body.text).toBe("Chapter 2 › Maintenance › Replace the filter every 90 days.");
    const maintenance = chunks.find((c) => c.text === "Chapter 2 › Maintenance")!;
    expect(maintenance.locator[HEADING_PREFIX_END_KEY]).toBe("Chapter 2 › ".length);
    expect(chunks.find((c) => c.text === "Chapter 2")).toBeDefined();
  });

  it("a heading after body content restarts the path at depth 1", () => {
    const d = doc([
      { item_type: "section-header", text: "One", prov: [{ page_no: 1 }] },
      { item_type: "section-header", text: "Two", prov: [{ page_no: 1 }] },
      { item_type: "text", text: "body under two", prov: [{ page_no: 1 }] },
      { item_type: "section-header", text: "Three", prov: [{ page_no: 1 }] },
      { item_type: "text", text: "body under three", prov: [{ page_no: 1 }] },
    ]);
    const chunks = chunkDoclingDocument(d);
    expect(chunks.find((c) => c.text.includes("three"))!.text).toBe("Three › body under three");
  });
});

describe("tables", () => {
  it("a table under the cap stays whole", () => {
    const chunks = chunkDoclingDocument(docFromJson("manual.doclingdocument.json"));
    const table = chunks.find((c) => "sheet" in (c.locator as object) || (c.locator as { label?: string }).label === "table");
    expect(table).toBeDefined();
    expect(table!.text).toMatch(/^\| Part \| Interval \| Torque \|/);
  });

  it("over the cap it splits by row groups WITH THE HEADER ROW REPEATED, each piece carrying {page, bbox, label:table}", () => {
    // cols=4, cap 600 → 149 body rows per piece; build 300 body rows.
    const cells: Array<{ row: number; col: number; text: string }> = [];
    for (let c = 0; c < 4; c++) cells.push({ row: 0, col: c, text: `H${c}` });
    for (let r = 1; r <= 300; r++) for (let c = 0; c < 4; c++) cells.push({ row: r, col: c, text: `r${r}c${c}` });
    const d = doc([
      {
        item_type: "table",
        prov: [{ page_no: 1, bbox: { l: 10, t: 10, r: 600, b: 700 } }],
        data: { num_rows: 301, num_cols: 4, table_cells: cells },
      },
    ]);
    const chunks = chunkDoclingDocument(d);
    expect(chunks.length).toBeGreaterThan(1);
    expect(301 * 4).toBeGreaterThan(DOC_TABLE_CELL_CAP);
    for (const piece of chunks) {
      // The header repeats in EVERY piece.
      expect(piece.text.startsWith("| H0 | H1 | H2 | H3 |")).toBe(true);
      expect((piece.locator as Record<string, unknown>).label).toBe("table");
      expect((piece.locator as Record<string, unknown>).page).toBe(1);
      expect(piece.locator).toHaveProperty("bbox");
      expect(PageLocator.safeParse(piece.locator).success || SheetLocator.safeParse(piece.locator).success).toBe(true);
    }
    // Row groups partition the body without overlap: 300 body rows total.
    const dataRows = chunks.reduce((n, p) => n + (p.text.split("\n").length - 1), 0);
    expect(dataRows).toBe(300);
  });
});

describe("page furniture", () => {
  it("a running footer on every page yields ZERO chunks containing it", () => {
    const d = doc(
      [
        { item_type: "text", text: "ACME Field Manual — Rev C", prov: [{ page_no: 1 }] },
        { item_type: "text", text: "ACME Field Manual — Rev C", prov: [{ page_no: 2 }] },
        { item_type: "text", text: "Real content on page one.", prov: [{ page_no: 1 }] },
        { item_type: "text", text: "Real content on page two.", prov: [{ page_no: 2 }] },
      ],
      [
        { page_no: 1, size: { width: 612, height: 792 } },
        { page_no: 2, size: { width: 612, height: 792 } },
      ],
    );
    const chunks = chunkDoclingDocument(d);
    expect(chunks.filter((c) => c.text.includes("ACME Field Manual"))).toHaveLength(0);
    expect(chunks).toHaveLength(2);
  });

  it("a LONG repeated text is content, not furniture", () => {
    const long = "Disclaimer repeated verbatim. ".repeat(10).trim();
    const d = doc(
      [
        { item_type: "text", text: long, prov: [{ page_no: 1 }] },
        { item_type: "text", text: long, prov: [{ page_no: 2 }] },
      ],
      [
        { page_no: 1, size: { width: 612, height: 792 } },
        { page_no: 2, size: { width: 612, height: 792 } },
      ],
    );
    expect(chunkDoclingDocument(d)).toHaveLength(2);
  });
});

describe("keyword de-weighting", () => {
  const prefixed = "Installation › Wiring › Connect the harness before the battery.";

  it("a term ONLY in the heading prefix is dropped from keywords; a body term is kept", () => {
    const prefixEnd = "Installation › Wiring › ".length;
    const weighted = keywordPass(prefixed, 8, { prefixEnd });
    // Both directions, asserted.
    expect(weighted.keywords).not.toContain("installation");
    expect(weighted.keywords).not.toContain("wiring");
    expect(weighted.keywords).toContain("harness");
    expect(weighted.keywords).toContain("battery");
    // Without the boundary the heading terms WOULD appear — the de-weight
    // is the opts, not a change in the pass itself.
    const plain = keywordPass(prefixed, 8);
    expect(plain.keywords).toContain("installation");
  });

  it("deterministic: same input, same keywords — the kb-08 property holds with the boundary", () => {
    const a = keywordPass(prefixed, 8, { prefixEnd: "Installation › Wiring › ".length });
    const b = keywordPass(prefixed, 8, { prefixEnd: "Installation › Wiring › ".length });
    expect(a).toEqual(b);
  });

  it("baseline callers are unchanged: one-arg calls produce the pre-dcl-04 output", () => {
    // A heading-free text: the boundary is a no-op wherever it is absent.
    const text = "hydraulic hydraulic hydraulic pressure valve";
    expect(keywordPass(text)).toEqual(keywordPass(text, 8));
    expect(keywordPass(text, 8, { prefixEnd: 0 })).toEqual(keywordPass(text));
  });
});

describe("the same unchanged code paths as baseline", () => {
  it("the kb-08 pass and the kb-09 mock embedder run over Docling chunks and baseline chunks identically", () => {
    const doclingChunks = chunkDoclingDocument(docFromJson("manual.doclingdocument.json"));
    const baselineChunks = chunkMarkdown("# Title\n\nbody text about filters");
    expect(doclingChunks.length).toBeGreaterThan(0);
    expect(baselineChunks.length).toBeGreaterThan(0);

    for (const set of [doclingChunks, baselineChunks]) {
      for (const c of set) {
        // Same keyword pass, same embedder — no structure-aware branch:
        // the only difference between the two sets is the input text.
        expect(keywordPass(c.text).keywords).toBeDefined();
        expect(keywordPass(c.text).entities).toBeDefined();
        const vec = mockEmbed(c.text);
        expect(Array.isArray(vec)).toBe(true);
        expect(mockEmbed(c.text)).toEqual(vec); // deterministic
      }
    }
    expect(MOCK_EMBEDDER_MODEL).toBe("mock");
  });
});

describe("reading order and index monotonicity", () => {
  it("chunks follow item order; pages never go backwards for a forward-ordered document", () => {
    const chunks = chunkDoclingDocument(docFromJson("manual.doclingdocument.json"));
    const pages = chunks.map((c) => (c.locator as { page: number }).page).filter((p) => typeof p === "number");
    expect(pages).toEqual([...pages].sort((a, b) => a - b));
    // Monotonic by construction: the chunker never reorders.
    expect(chunks.length).toBeGreaterThan(3);
  });
});
