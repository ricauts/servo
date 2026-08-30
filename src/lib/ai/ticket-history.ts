// Desk memory: the pure half of the ticket-history tools (no database, no
// Prisma) so ranking, resolution extraction and requester redaction are unit
// testable. The tools in src/lib/ai/tools/history.ts fetch candidate rows and
// hand them to these functions.
//
// Why ranking lives here and not in SQL: the score blends lexical overlap
// with recency and kind weights over a bounded candidate window, and keeping
// it in TypeScript keeps the query a plain portable SELECT and the behaviour
// unit-testable without a database.

/** The shape the tools select out of Prisma — kept structural on purpose. */
export interface HistoryComment {
  body: string;
  kind: string;
}

export interface HistoryTicket {
  number: number;
  title: string;
  description: string;
  status: string;
  priority: string;
  category: string;
  createdAt: Date;
  resolvedAt: Date | null;
  requesterId: string;
  requester?: { name: string; email: string } | null;
  /** Oldest first. */
  comments: HistoryComment[];
}

/**
 * Words that carry no signal in a service-desk query. Deliberately short: an
 * over-eager stoplist silently drops the one term that mattered.
 */
const STOPWORDS = new Set([
  "the", "and", "for", "with", "from", "this", "that", "have", "has", "had",
  "was", "were", "are", "not", "but", "you", "your", "our", "can", "cant",
  "please", "help", "issue", "issues", "problem", "problems", "ticket",
  "request", "need", "needs", "when", "what", "why", "how", "who", "any",
  "all", "get", "got", "does", "did", "will", "would", "could", "should",
  "about", "into", "than", "then", "there", "their", "they", "them",
]);

const MIN_TERM_LENGTH = 3;
const MAX_TERMS = 8;

/**
 * Reduce a word to a crude stem so "connecting" also finds "connection" and
 * "passwords" finds "password". Substring matching does the rest — this is a
 * suffix trim, not a linguistic stemmer, and it never shortens below four
 * characters so "sso" or "vpns" stay intact enough to match.
 *
 * -ing/-ed leave behind the doubled consonant English adds before them
 * ("resetting" → "resett"), which then matches neither "reset" nor anything
 * else useful, so that doubling is undone. Over-collapsing is harmless here —
 * a shorter stem is still a substring of the words it should find.
 */
export function stem(word: string): string {
  for (const suffix of ["ing", "ed", "es", "s"]) {
    if (word.length - suffix.length >= 4 && word.endsWith(suffix)) {
      const trimmed = word.slice(0, -suffix.length);
      const doubled =
        (suffix === "ing" || suffix === "ed") &&
        trimmed.length > MIN_TERM_LENGTH &&
        trimmed.at(-1) === trimmed.at(-2);
      return doubled ? trimmed.slice(0, -1) : trimmed;
    }
  }
  return word;
}

/** Split a natural-language query into the terms worth matching on. */
export function searchTerms(query: string): string[] {
  const seen = new Set<string>();
  for (const raw of query.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < MIN_TERM_LENGTH || STOPWORDS.has(raw)) continue;
    const term = stem(raw);
    if (term.length < MIN_TERM_LENGTH) continue;
    seen.add(term);
    if (seen.size >= MAX_TERMS) break;
  }
  return [...seen];
}

const RESOLUTION_NOTE = /^Resolved by [^:]+:\s*([\s\S]+)$/;

/**
 * The resolution note an agent wrote when it closed the ticket. resolve_ticket
 * records it as a SYSTEM comment ("Resolved by <agent>: <note>"); tickets a
 * human closed from the UI have no such line, so callers fall back to
 * `lastPublicReply`.
 */
export function resolutionNote(comments: HistoryComment[]): string | null {
  for (let i = comments.length - 1; i >= 0; i--) {
    const comment = comments[i];
    if (comment.kind !== "SYSTEM") continue;
    const match = RESOLUTION_NOTE.exec(comment.body.trim());
    if (match) return match[1].trim();
  }
  return null;
}

/** The last thing actually said to the requester — the human-closed fallback. */
export function lastPublicReply(comments: HistoryComment[]): string | null {
  for (let i = comments.length - 1; i >= 0; i--) {
    if (comments[i].kind === "COMMENT") return comments[i].body.trim() || null;
  }
  return null;
}

/** What a past ticket teaches, if anything: its note, else its last reply. */
export function outcomeOf(ticket: HistoryTicket): string | null {
  return resolutionNote(ticket.comments) ?? lastPublicReply(ticket.comments);
}

const TITLE_WEIGHT = 3;
const OUTCOME_WEIGHT = 2;
const DESCRIPTION_WEIGHT = 1;
const SETTLED_BONUS = 2;

const SETTLED = new Set(["RESOLVED", "CLOSED"]);

/**
 * Relevance of one past ticket to the query terms. A term counts once per
 * field, so a word repeated in a long description cannot outrank a title hit,
 * and tickets that actually reached an outcome are worth more as precedent
 * than open ones.
 */
export function scoreTicket(ticket: HistoryTicket, terms: string[]): number {
  if (terms.length === 0) return 0;
  const title = ticket.title.toLowerCase();
  const description = ticket.description.toLowerCase();
  const outcome = (outcomeOf(ticket) ?? "").toLowerCase();

  let score = 0;
  for (const term of terms) {
    if (title.includes(term)) score += TITLE_WEIGHT;
    if (outcome.includes(term)) score += OUTCOME_WEIGHT;
    if (description.includes(term)) score += DESCRIPTION_WEIGHT;
  }
  if (score > 0 && SETTLED.has(ticket.status)) score += SETTLED_BONUS;
  return score;
}

function recencyOf(ticket: HistoryTicket): number {
  return (ticket.resolvedAt ?? ticket.createdAt).getTime();
}

/** Score, drop the misses, and order by relevance then recency. */
export function rankTickets(
  tickets: HistoryTicket[],
  terms: string[],
  limit: number,
): { ticket: HistoryTicket; score: number }[] {
  return tickets
    .map((ticket) => ({ ticket, score: scoreTicket(ticket, terms) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || recencyOf(b.ticket) - recencyOf(a.ticket))
    .slice(0, limit);
}

/**
 * Whether the agent may see who filed a past ticket. Servo isolates requester
 * data, and an agent reading precedent for Dana has no business learning that
 * Ravi filed the original — worse, it could quote the name back into a public
 * comment. Identity is revealed only when it is the same person.
 */
export function mayRevealRequester(
  ticket: { requesterId: string },
  currentRequesterId: string | null,
): boolean {
  return currentRequesterId !== null && ticket.requesterId === currentRequesterId;
}

export function requesterLabel(
  ticket: HistoryTicket,
  currentRequesterId: string | null,
): string {
  if (!mayRevealRequester(ticket, currentRequesterId)) return "another requester (withheld)";
  const requester = ticket.requester;
  return requester ? `${requester.name} <${requester.email}>` : "this requester";
}

export function truncate(text: string, limit: number): string {
  const clean = text.trim().replace(/\s+/g, " ");
  return clean.length > limit ? `${clean.slice(0, limit)}…` : clean;
}

function day(date: Date | null): string {
  return date ? date.toISOString().slice(0, 10) : "—";
}

const SNIPPET_CHARS = 260;

/** One search hit, as the model reads it. */
export function formatSearchHit(
  ticket: HistoryTicket,
  currentRequesterId: string | null,
): string {
  const outcome = outcomeOf(ticket);
  const lines = [
    `#${ticket.number} [${ticket.status}/${ticket.priority}/${ticket.category}] ${ticket.title}`,
    `  opened ${day(ticket.createdAt)}${ticket.resolvedAt ? `, resolved ${day(ticket.resolvedAt)}` : ""} · ${requesterLabel(ticket, currentRequesterId)}`,
  ];
  lines.push(
    outcome
      ? `  outcome: ${truncate(outcome, SNIPPET_CHARS)}`
      : "  outcome: none recorded yet",
  );
  return lines.join("\n");
}

const DESCRIPTION_CHARS = 800;
const COMMENT_CHARS = 400;

/** The full read of one past ticket, including how it was worked. */
export function formatTicketDetail(
  ticket: HistoryTicket,
  currentRequesterId: string | null,
  toolsUsed: string[],
): string {
  const parts = [
    `#${ticket.number}: ${ticket.title}`,
    `Status ${ticket.status} · Priority ${ticket.priority} · Category ${ticket.category}`,
    `Opened ${day(ticket.createdAt)}${ticket.resolvedAt ? ` · resolved ${day(ticket.resolvedAt)}` : ""}`,
    `Requester: ${requesterLabel(ticket, currentRequesterId)}`,
    "",
    "## Request",
    truncate(ticket.description, DESCRIPTION_CHARS),
  ];

  const replies = ticket.comments.filter((c) => c.kind === "COMMENT");
  if (replies.length > 0) {
    parts.push(
      "",
      "## Replies sent to the requester (oldest first)",
      ...replies.map((c) => `- ${truncate(c.body, COMMENT_CHARS)}`),
    );
  }

  if (toolsUsed.length > 0) {
    parts.push("", `## Tools the agent used\n${toolsUsed.join(", ")}`);
  }

  const note = resolutionNote(ticket.comments);
  parts.push("", `## Resolution\n${note ? truncate(note, COMMENT_CHARS) : "Not resolved yet."}`);
  return parts.join("\n");
}
