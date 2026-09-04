// The library view's pure half (kb-lib-1): the row shape the Knowledge list
// renders and the filter it renders through. Kept out of the component so
// the test can assert the filter semantics without a DOM (this repo has no
// jsdom), and so the same rules can back a server-side filter later.

export interface KbDocumentRow {
  id: string;
  name: string;
  contentType: string;
  byteSize: number;
  textStatus: string;
  textError: string | null;
  summary: string;
  visibility: string;
  updatedAt: Date;
  /** The document-level keyword profile (Document.keywords). */
  keywords: string[];
  /** kb-lib-2: model-written topics and summary; empty until enriched. */
  topics: string[];
  aiSummary: string;
  collectionId: string | null;
  collectionName: string | null;
}

export interface KbCollectionOption {
  id: string;
  name: string;
}

/** The three ingest states, distinguishable and actionable (kb-16). Lives
 *  here rather than in the list component because the list is a client
 *  component since kb-lib-1 and the document page (a server component)
 *  renders the same copy. */
export function statusCopy(doc: Pick<KbDocumentRow, "textStatus" | "textError">): { label: string; tone: string; hint?: string } {
  switch (doc.textStatus) {
    case "EXTRACTED":
      return { label: "Indexed", tone: "var(--good-chip-ink)" };
    case "EXTRACTING":
    case "PENDING":
      return { label: "Processing…", tone: "var(--text-muted)" };
    case "FAILED":
      return {
        label: "Failed",
        tone: "var(--critical-chip-ink)",
        hint: doc.textError ?? "Extraction failed — re-upload the file to retry.",
      };
    case "UNSUPPORTED":
      return {
        label: "Stored, not searchable",
        tone: "var(--warn-chip-ink)",
        hint: doc.textError ?? "No extractor for this format yet — the file is stored and shareable.",
      };
    default:
      return { label: doc.textStatus, tone: "var(--text-muted)" };
  }
}

/** "ALL" is the unfiltered view; the other three are Document.visibility. */
export const VISIBILITY_FILTERS = ["ALL", "PRIVATE", "STAFF", "PUBLIC"] as const;
export type VisibilityFilter = (typeof VISIBILITY_FILTERS)[number];

/** The collection filter's "uncategorized" shelf — a document no one has
 *  filed yet, which is exactly the one an operator wants to find. */
export const UNCATEGORIZED = "NONE";

export interface LibraryFilters {
  /** Matches the name OR any keyword, case-insensitively; blank = no filter. */
  text: string;
  visibility: VisibilityFilter;
  /** "ALL", UNCATEGORIZED, or a collection id. */
  collection: string;
}

/** Document.keywords / Document.topics are Json columns: read them as the
 *  string[] they are documented to be, dropping anything else. */
export function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((k): k is string => typeof k === "string") : [];
}

/** Pure: the rows that survive the three filters, in the given order. */
export function filterDocuments(
  documents: readonly KbDocumentRow[],
  filters: LibraryFilters,
): KbDocumentRow[] {
  const needle = filters.text.trim().toLowerCase();
  return documents.filter((doc) => {
    if (filters.visibility !== "ALL" && doc.visibility !== filters.visibility) return false;
    if (filters.collection !== "ALL") {
      const bucket = doc.collectionId ?? UNCATEGORIZED;
      if (bucket !== filters.collection) return false;
    }
    if (needle) {
      const inName = doc.name.toLowerCase().includes(needle);
      const inKeywords = doc.keywords.some((k) => k.toLowerCase().includes(needle));
      const inTopics = doc.topics.some((t) => t.toLowerCase().includes(needle));
      if (!inName && !inKeywords && !inTopics) return false;
    }
    return true;
  });
}
