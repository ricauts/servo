// The deterministic keyword/entity pass (spec kb-08). No provider call, no
// randomness, no clock: the same input produces the same keywords — which
// the test asserts by running it twice, and which graph-edge stability
// depends on. Entities are the citable anchors (emails, invoice-style codes,
// capitalized multi-word names, column headers); keywords are the top-N
// frequent non-stopword terms.

/** Small English + Spanish stopword list — enough to keep furniture out of
 *  the top-N in either language. Both lists ride in one set: the pass never
 *  detects a language, so a bilingual manual is handled the same as either
 *  monolingual one. */
const STOPWORDS = new Set([
  // English
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with", "at",
  "by", "from", "is", "are", "was", "were", "be", "been", "it", "its", "this",
  "that", "these", "those", "as", "if", "then", "than", "so", "we", "you",
  "they", "he", "she", "our", "their", "your", "not", "no", "yes", "all",
  "any", "can", "will", "may", "must", "should", "would", "could", "into",
  "per", "via", "due", "up", "down", "out", "over", "under", "new", "each",
  // Spanish (kb-lib-1)
  "de", "del", "la", "las", "el", "los", "un", "una", "unos", "unas", "y", "o",
  "u", "e", "que", "qué", "con", "sin", "por", "para", "como", "cómo", "más",
  "mas", "pero", "sino", "también", "muy", "ya", "aún", "aun", "ser", "es",
  "son", "era", "eran", "fue", "fueron", "está", "están", "estar", "hay",
  "ha", "han", "he", "has", "hemos", "se", "su", "sus", "lo", "le", "les",
  "al", "ante", "bajo", "cada", "desde", "donde", "dónde", "entre", "hacia",
  "hasta", "mediante", "según", "sobre", "tras", "este", "esta", "estos",
  "estas", "ese", "esa", "esos", "esas", "esto", "eso", "aquel", "aquella",
  "aquellos", "aquellas", "mi", "mis", "tu", "tus", "nos", "nosotros", "ellos",
  "vosotros", "ella", "él",
  "ellas", "usted", "ustedes", "todo", "toda", "todos", "todas", "otro", "otra",
  "otros", "otras", "mismo", "misma", "mismos", "mismas", "puede", "pueden",
  "debe", "deben", "debería", "deberían", "cuando", "cuándo", "porque", "así",
  "solo", "sólo", "si", "sí", "no", "ni", "cual", "cuál", "cuales", "cuáles",
  "cualquier", "cualquiera", "sea", "sean", "tiene", "tienen", "tener",
  "hacer", "hace", "hacen", "ver", "dos", "tres", "primer", "primera",
  "segundo", "segunda", "durante", "además", "luego", "entonces",
]);

/** The keyword tokenizer: a letter followed by at least two letters, digits
 *  or hyphens, in any script. Unicode-aware on purpose — the pre-kb-lib-1
 *  `[a-z]` class split "planeación" at the accent and kept "planeaci". */
const TOKEN = /\p{L}[\p{L}\p{N}-]{2,}/gu;

export interface KeywordPass {
  keywords: string[];
  entities: string[];
}

/**
 * Extract the deterministic keyword/entity set from one chunk of text.
 *
 * opts.prefixEnd (dcl-04): the first N characters are a HEADING PREFIX the
 * chunker prepended for context, not the chunk's own body. Keyword
 * FREQUENCY is counted only past the boundary, so a term appearing only in
 * a heading that dominates every chunk beneath it cannot enter that
 * chunk's keywords; entities still scan the whole text (a citable anchor
 * is citable wherever it appears). Baseline callers pass no opts and get
 * exactly the pre-dcl-04 behaviour — there is no structure-aware branch
 * in this function, only a boundary the caller names.
 */
export function keywordPass(text: string, topN = 8, opts: { prefixEnd?: number } = {}): KeywordPass {
  const normalized = text.replace(/\r\n/g, "\n");

  // Entities — order of appearance, deduped, capped.
  const entities: string[] = [];
  const pushEntity = (value: string) => {
    const v = value.trim();
    if (v && !entities.includes(v) && entities.length < 16) entities.push(v);
  };
  for (const m of normalized.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)) {
    pushEntity(m[0]); // emails
  }
  for (const m of normalized.matchAll(/\b[A-Z]{2,6}-\d{2,4}-\d{2,8}\b/g)) {
    pushEntity(m[0]); // codes like INV-2024-113, VPN-26-0091
  }
  for (const m of normalized.matchAll(/\b([A-Z][a-z]{2,})\s+([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})?)\b/g)) {
    // Capitalized multi-word names — cheap heuristic, deterministic.
    if (!STOPWORDS.has(m[1].toLowerCase())) pushEntity(m[0]);
  }
  for (const m of normalized.matchAll(/^\s*\|?\s*([A-Z][A-Za-z0-9 ]{1,24})\s*\|/gm)) {
    pushEntity(m[1].trim()); // markdown table column headers
  }

  // Keywords — frequency over non-stopword tokens, ties broken by term so
  // the result is fully deterministic. The heading-prefix region (dcl-04)
  // is excluded from the count when the caller names its boundary.
  const counts = new Map<string, number>();
  const keywordRegion =
    typeof opts.prefixEnd === "number" && opts.prefixEnd > 0 && opts.prefixEnd < normalized.length
      ? normalized.slice(opts.prefixEnd)
      : normalized;
  for (const token of keywordRegion.toLowerCase().match(TOKEN) ?? []) {
    if (STOPWORDS.has(token)) continue;
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  const keywords = rankTerms(counts, topN);

  return { keywords, entities };
}

/** Top-N terms by count, ties broken by term — fully deterministic. */
function rankTerms(counts: Map<string, number>, topN: number): string[] {
  return [...counts.entries()]
    .sort((a, b) => (b[1] - a[1] !== 0 ? b[1] - a[1] : a[0].localeCompare(b[0])))
    .slice(0, topN)
    .map(([term]) => term);
}

/**
 * The document-level profile (kb-lib-1): the keywords and entities that
 * describe a WHOLE document, derived from its chunks. A term is scored by
 * how many chunks it appears in, not how often it appears overall — a word
 * repeated fifty times on one page is a local matter; a word present on
 * most pages is what the document is about. Repeated boilerplate (a header
 * on every page) still wins by this rule; the deterministic pass has no
 * way to tell a running header from a theme, and the graph has the same
 * blind spot. Same determinism contract as keywordPass: no clock, no model.
 */
export function documentProfile(
  chunkTexts: readonly string[],
  opts: { topKeywords?: number; topEntities?: number } = {},
): KeywordPass {
  const topKeywords = opts.topKeywords ?? 12;
  const topEntities = opts.topEntities ?? 10;
  const keywordDocFreq = new Map<string, number>();
  const entityDocFreq = new Map<string, number>();
  for (const text of chunkTexts) {
    // Per-chunk keywords are the top-8 already ranked by keywordPass; the
    // profile counts chunks in which a term reached that top-8, so a term
    // must matter locally before it can matter globally.
    const pass = keywordPass(text);
    for (const k of new Set(pass.keywords)) keywordDocFreq.set(k, (keywordDocFreq.get(k) ?? 0) + 1);
    for (const e of new Set(pass.entities)) entityDocFreq.set(e, (entityDocFreq.get(e) ?? 0) + 1);
  }
  return {
    keywords: rankTerms(keywordDocFreq, topKeywords),
    entities: rankTerms(entityDocFreq, topEntities),
  };
}
