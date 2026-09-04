// kb-lib-1: the library view — Spanish-aware deterministic keywords, the
// document-level profile ingest stores, and the pure filter the list
// component renders with. Like kb-facts-ui, the markup criteria are asserted
// against the component source (no DOM harness in this repo).

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { documentProfile, keywordPass } from "@/lib/kb/keywords";
import { filterDocuments, type KbDocumentRow } from "@/lib/kb/library";

describe("keywordPass — Spanish text (kb-lib-1)", () => {
  const es =
    "Este documento planea la Fase 0 del frente de datos de SkanControl: la " +
    "planeación del frente de datos con los riesgos, las historias y las tareas " +
    "de la infraestructura de datos. Los datos y la planeación son el foco.";

  it("drops Spanish function words instead of ranking them", () => {
    const { keywords } = keywordPass(es);
    for (const furniture of ["del", "que", "con", "las", "los", "de", "la"]) {
      expect(keywords).not.toContain(furniture);
    }
    expect(keywords).toContain("datos");
  });

  it("keeps accented words whole", () => {
    const { keywords } = keywordPass(es);
    expect(keywords).toContain("planeación");
    expect(keywords).not.toContain("planeaci");
  });

  it("still drops the English list", () => {
    const { keywords } = keywordPass("the renewal of the contract and the renewal date");
    expect(keywords).toContain("renewal");
    expect(keywords).not.toContain("the");
    expect(keywords).not.toContain("and");
  });

  it("is deterministic", () => {
    expect(keywordPass(es)).toEqual(keywordPass(es));
  });
});

describe("documentProfile (kb-lib-1)", () => {
  it("ranks a term by the number of chunks it tops, not raw frequency", () => {
    const chunks = [
      "backup backup backup backup backup backup backup backup nightly",
      "restore procedure for the nightly job",
      "nightly job window and the restore runbook",
    ];
    const { keywords } = documentProfile(chunks);
    // "nightly" appears in three chunks; "backup" in one (however loudly).
    expect(keywords[0]).toBe("nightly");
    expect(keywords.indexOf("nightly")).toBeLessThan(keywords.indexOf("backup"));
  });

  it("caps and is deterministic", () => {
    const chunks = Array.from({ length: 30 }, (_, i) => `chunk ${i} alpha beta gamma delta term${i} term${i + 1}`);
    const a = documentProfile(chunks);
    const b = documentProfile(chunks);
    expect(a).toEqual(b);
    expect(a.keywords.length).toBeLessThanOrEqual(12);
    expect(a.entities.length).toBeLessThanOrEqual(10);
  });

  it("is empty for no chunks", () => {
    expect(documentProfile([])).toEqual({ keywords: [], entities: [] });
  });
});

describe("filterDocuments (kb-lib-1)", () => {
  const row = (over: Partial<KbDocumentRow>): KbDocumentRow => ({
    id: "d",
    name: "doc.pdf",
    contentType: "application/pdf",
    byteSize: 1,
    textStatus: "EXTRACTED",
    textError: null,
    summary: "",
    visibility: "PRIVATE",
    updatedAt: new Date(0),
    keywords: [],
    topics: [],
    aiSummary: "",
    collectionId: null,
    collectionName: null,
    ...over,
  });
  const docs = [
    row({ id: "a", name: "Manual VPN.pdf", visibility: "STAFF", keywords: ["vpn", "acceso"], collectionId: "c1", collectionName: "IT" }),
    row({ id: "b", name: "Backlog.pdf", visibility: "PRIVATE", keywords: ["datos", "planeación"] }),
    row({ id: "c", name: "Public FAQ.md", visibility: "PUBLIC", keywords: ["faq"], collectionId: "c2", collectionName: "HR" }),
  ];
  const all = { text: "", visibility: "ALL" as const, collection: "ALL" };

  it("returns everything unfiltered", () => {
    expect(filterDocuments(docs, all).map((d) => d.id)).toEqual(["a", "b", "c"]);
  });

  it("filters by visibility exactly", () => {
    expect(filterDocuments(docs, { ...all, visibility: "PUBLIC" }).map((d) => d.id)).toEqual(["c"]);
    expect(filterDocuments(docs, { ...all, visibility: "PRIVATE" }).map((d) => d.id)).toEqual(["b"]);
  });

  it("filters by collection, with the uncategorized shelf", () => {
    expect(filterDocuments(docs, { ...all, collection: "c1" }).map((d) => d.id)).toEqual(["a"]);
    expect(filterDocuments(docs, { ...all, collection: "NONE" }).map((d) => d.id)).toEqual(["b"]);
  });

  it("matches text against the name, any keyword or any topic, case-insensitively", () => {
    expect(filterDocuments(docs, { ...all, text: "PLANEACIÓN" }).map((d) => d.id)).toEqual(["b"]);
    const withTopic = [row({ id: "t", topics: ["Data Contracts"] })];
    expect(filterDocuments(withTopic, { ...all, text: "contracts" }).map((d) => d.id)).toEqual(["t"]);
    expect(filterDocuments(docs, { ...all, text: "vpn" }).map((d) => d.id)).toEqual(["a"]);
    expect(filterDocuments(docs, { ...all, text: "faq" }).map((d) => d.id)).toEqual(["c"]);
    expect(filterDocuments(docs, { ...all, text: "nothing" })).toEqual([]);
  });

  it("combines the three filters with AND", () => {
    expect(filterDocuments(docs, { text: "vpn", visibility: "STAFF", collection: "c1" }).map((d) => d.id)).toEqual(["a"]);
    expect(filterDocuments(docs, { text: "vpn", visibility: "PUBLIC", collection: "c1" })).toEqual([]);
  });
});

describe("library markup (kb-lib-1)", () => {
  const list = readFileSync("src/components/kb/KbDocumentList.tsx", "utf8");
  const library = readFileSync("src/lib/kb/library.ts", "utf8");
  const page = readFileSync("src/app/kb/page.tsx", "utf8");
  const detail = readFileSync("src/app/kb/[id]/page.tsx", "utf8");

  it("renders the visibility filter with every state and the collection filter", () => {
    expect(library).toMatch(/VISIBILITY_FILTERS = \["ALL", "PRIVATE", "STAFF", "PUBLIC"\]/);
    expect(list).toMatch(/VISIBILITY_FILTERS\.map/);
    expect(list).toMatch(/aria-label="Visibility"/);
    expect(list).toMatch(/aria-label="Collection"/);
    expect(list).toMatch(/Uncategorized/);
  });

  it("renders keyword chips that set the text filter", () => {
    expect(list).toMatch(/aria-label="Keywords"/);
    expect(list).toMatch(/onClick=\{\(\) => setText\(k\)\}/);
  });

  it("the page selects keywords and the collection name, and the detail page links chips back", () => {
    expect(page).toMatch(/keywords: true/);
    expect(page).toMatch(/collection: \{ select: \{ name: true \} \}/);
    expect(detail).toMatch(/href=\{`\/kb\?q=\$\{encodeURIComponent\(k\)\}`\}/);
  });
});

describe("ingest stores the profile (kb-lib-1)", () => {
  it("both write paths set Document.keywords from documentProfile", () => {
    const ingest = readFileSync("src/lib/kb/ingest.ts", "utf8");
    const reingest = readFileSync("src/lib/kb/reingest.ts", "utf8");
    expect(ingest).toMatch(/keywords: documentProfile\(chunks\.map\(\(c\) => c\.text\)\)\.keywords/);
    expect(reingest).toMatch(/keywords: documentProfile\(chunked\.map\(\(c\) => c\.text\)\)\.keywords/);
  });
});
