// The deterministic keyword/entity pass (spec kb-08). No provider call, no
// randomness, no clock: the same input produces the same keywords — which
// the test asserts by running it twice, and which graph-edge stability
// depends on. Entities are the citable anchors (emails, invoice-style codes,
// capitalized multi-word names, column headers); keywords are the top-N
// frequent non-stopword terms.

/** Small English stopword list — enough to keep furniture out of the top-N. */
const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with", "at",
  "by", "from", "is", "are", "was", "were", "be", "been", "it", "its", "this",
  "that", "these", "those", "as", "if", "then", "than", "so", "we", "you",
  "they", "he", "she", "our", "their", "your", "not", "no", "yes", "all",
  "any", "can", "will", "may", "must", "should", "would", "could", "into",
  "per", "via", "due", "up", "down", "out", "over", "under", "new", "each",
]);

export interface KeywordPass {
  keywords: string[];
  entities: string[];
}

/** Extract the deterministic keyword/entity set from one chunk of text. */
export function keywordPass(text: string, topN = 8): KeywordPass {
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
  // the result is fully deterministic.
  const counts = new Map<string, number>();
  for (const token of normalized.toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) ?? []) {
    if (STOPWORDS.has(token)) continue;
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  const keywords = [...counts.entries()]
    .sort((a, b) => (b[1] - a[1] !== 0 ? b[1] - a[1] : a[0].localeCompare(b[0])))
    .slice(0, topN)
    .map(([term]) => term);

  return { keywords, entities };
}
