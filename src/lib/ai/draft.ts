// AI reply drafts with human approval — the everyday support loop: a request
// arrives (usually by email), the AI writes the answer, a human reviews and
// approves it (editing if needed), and Servo posts it as a public comment and
// emails it to the requester. The subject carries the #number tag so the
// requester's answer threads back onto the same ticket.
//
// Concurrency: every status transition is an atomic claim (updateMany guarded
// by the current status) so concurrent approve/reject/regenerate calls cannot
// double-send a reply or corrupt the audit record. Draft generation itself is
// additionally serialized per ticket, mirroring the resolver-run guard.

import type { ReplyDraft, User } from "@prisma/client";
import { db } from "@/lib/db";
import { sendMail } from "@/lib/notify";
import { isEditedReply, replySubject } from "@/lib/reply-format";
import { emitEvent } from "@/lib/webhooks";
import { pickAgentProfile } from "@/lib/agent-profiles";
import { draftPrincipalId } from "@/lib/kb/principals";
import { kbSearch } from "@/lib/kb/search";
import { getEmbedSettings, embedWithEndpoint } from "@/lib/kb/embed";
import { mockEmbed, MOCK_EMBEDDER_MODEL } from "@/lib/kb/mock-embedder";
import { settingsForProfile, withUsage } from "./credentials";
import { draftSystem, draftUser } from "./prompts";
import { getProvider } from "./provider";

const CONVERSATION_LIMIT = 12; // most recent public comments fed to the model

/** Character budget for injected KB passages (kb-12). The drafter gets
 *  retrieval, not a tool loop — provenance by construction: nothing outside
 *  this budget can be quoted, because nothing outside it is in the prompt. */
/** Filler words stripped from drafter retrieval queries: the 'simple'
 *  tsquery config ANDs every term and knows no stopwords of its own. */
const DRAFT_QUERY_STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with",
  "at", "by", "from", "is", "are", "was", "were", "be", "been", "it",
  "its", "this", "that", "these", "those", "as", "if", "then", "than",
  "so", "we", "you", "they", "he", "she", "our", "their", "your",
  "not", "no", "yes", "all", "any", "can", "will", "may", "must",
  "should", "would", "could", "into", "per", "via", "due", "when",
  "what", "why", "how", "who", "does", "did", "has", "have", "had",
  "tell", "me", "about", "please", "and", "its",
]);

export const KB_CONTEXT_LIMIT = 3000;

export interface DraftSource {
  docId: string;
  docName: string;
  locator: unknown;
  chunkId: string;
}

/**
 * The deterministic pre-retrieval step: resolve the chain
 * (A = draftPrincipalId(profile), B = ticket.requesterId) and search the
 * knowledge base over title + description + recent comments. Returns the
 * passages AND nothing else — the drafter has no other way to reach KB text.
 */
async function retrieveSources(
  ticket: { title: string; description: string; requesterId: string; category: string },
  comments: { body: string }[],
  profile: { id: string } | null,
): Promise<{ passages: string[]; sources: DraftSource[] }> {
  const chain = {
    agentId: draftPrincipalId(profile),
    humanId: ticket.requesterId,
  };
  const raw = [ticket.title, ticket.description, ...comments.map((c) => c.body)]
    .join(" ")
    .slice(0, 400);
  // The 'simple' text-search config has no stopwords, so a natural-language
  // query would AND every filler word and match nothing. Drop them (the
  // same stopword list the keyword pass uses) and dedupe.
  const query = [
    ...new Set(
      (raw.toLowerCase().match(/[a-z0-9][a-z0-9-]{2,}/g) ?? []).filter(
        (t) => !DRAFT_QUERY_STOPWORDS.has(t),
      ),
    ),
  ]
    .slice(0, 12)
    .join(" ");

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
    /* keyword-only on any configuration failure — same path */
  }

  const hits = await kbSearch(db, chain, query, { limit: 6, queryVector: vector, embeddingModel: model });
  const passages: string[] = [];
  const sources: DraftSource[] = [];
  let budget = KB_CONTEXT_LIMIT;
  for (const [i, hit] of hits.entries()) {
    const marker = `[${i + 1}] ${hit.docName} · ${describeLocator(hit.locator)}`;
    if (marker.length + hit.text.length > budget) break;
    budget -= marker.length + hit.text.length;
    passages.push(`${marker}\n${hit.text}`);
    sources.push({ docId: hit.documentId, docName: hit.docName, locator: hit.locator, chunkId: hit.chunkId });
  }
  return { passages, sources };
}

function describeLocator(locator: unknown): string {
  if (typeof locator !== "object" || locator === null) return "";
  const l = locator as Record<string, unknown>;
  if (typeof l.sheet === "string") return `sheet ${l.sheet}${l.range ? ` ${l.range}` : ""}`;
  if (typeof l.page === "number") return `page ${l.page}`;
  if (typeof l.lines === "string") return `lines ${l.lines}`;
  return "";
}

// In-process guard: one draft generation per ticket at a time (same pattern
// as the resolver's activeResolverTickets set).
const activeDraftTickets = new Set<string>();

/**
 * Generate (or regenerate) the pending reply draft for a ticket. One pending
 * draft per ticket: regenerating replaces its body instead of stacking a
 * queue nobody asked for.
 */
export async function draftReply(ticketId: string): Promise<ReplyDraft> {
  if (activeDraftTickets.has(ticketId)) {
    throw new Error("A draft is already being generated for this ticket.");
  }
  activeDraftTickets.add(ticketId);
  try {
    return await draftReplyInner(ticketId);
  } finally {
    activeDraftTickets.delete(ticketId);
  }
}

async function draftReplyInner(ticketId: string): Promise<ReplyDraft> {
  const ticket = await db.ticket.findUnique({
    where: { id: ticketId },
    include: { requester: true },
  });
  if (!ticket) throw new Error("Ticket not found.");
  if (ticket.status === "CLOSED") throw new Error("The ticket is closed.");

  const comments = await db.comment.findMany({
    where: { ticketId, kind: "COMMENT" },
    include: { author: true },
    orderBy: { createdAt: "desc" },
    take: CONVERSATION_LIMIT,
  });
  const conversation = comments
    .reverse()
    .map((c) => ({ author: c.author.name, body: c.body }));

  // The specialist that owns this category drafts the reply on its own
  // credential; without one the default BYOK config (or mock) does.
  const profile = await pickAgentProfile(ticket.category);
  const { settings, credentialName } = await settingsForProfile(profile);
  const agentName = profile?.name ?? "Servo Drafter";
  const provider = withUsage(getProvider(settings, { ticket, kind: "DRAFT" }), {
    kind: "DRAFT",
    agentName,
    credentialName: settings.provider === "mock" ? "mock" : credentialName,
    provider: settings.provider,
    model: settings.model,
  });

  // Deterministic pre-retrieval (kb-12): cited passages injected with
  // numbered markers; sources IS the injected set. NO tool loop — a model
  // with tools can quote a passage it never logged, which would destroy
  // provenance. Retrieval defaults ON: it only makes drafts better and
  // changes nothing about sending.
  const { passages, sources } = await retrieveSources(ticket, conversation, profile);
  const userText = passages.length
    ? `Knowledge base sources (cite as [n]):\n\n${passages.join("\n\n")}\n\n---\n\n${draftUser(ticket, conversation)}`
    : draftUser(ticket, conversation);

  const turn = await provider.complete({
    system: draftSystem,
    messages: [{ role: "user", content: [{ type: "text", text: userText }] }],
    tools: [],
  });
  const body = turn.text.trim();
  if (!body) throw new Error("The model returned an empty draft.");

  const pending = await db.replyDraft.findFirst({
    where: { ticketId, status: "PENDING" },
  });
  if (pending) {
    // Guarded update: if the draft was approved/rejected while the model was
    // writing, leave the decided row untouched and store a fresh one instead.
    const { count } = await db.replyDraft.updateMany({
      where: { id: pending.id, status: "PENDING" },
      data: { body, agentName, sources: sources as unknown as never, createdAt: new Date() },
    });
    if (count === 1) {
      return db.replyDraft.findUniqueOrThrow({ where: { id: pending.id } });
    }
  }
  return db.replyDraft.create({
    data: { ticketId, body, agentName, sources: sources as unknown as never },
  });
}

/**
 * Approve a pending draft (optionally with an edited body): claims the draft
 * atomically, posts the reply as a public comment by the approving human,
 * emails it to the requester, and starts the first-response SLA clock. Email
 * is best-effort — a broken SMTP setup never blocks the comment. The draft
 * row keeps the exact body that was sent.
 */
export async function approveDraft(
  draftId: string,
  decider: User,
  finalBody?: string,
): Promise<ReplyDraft> {
  const draft = await db.replyDraft.findUnique({
    where: { id: draftId },
    include: { ticket: { include: { requester: true } } },
  });
  if (!draft) throw new Error("Draft not found.");
  if (draft.status !== "PENDING") throw new Error("Draft was already decided.");
  if (draft.ticket.status === "CLOSED") {
    throw new Error("The ticket is closed — replies cannot be sent on it.");
  }

  const body = (finalBody ?? "").trim() || draft.body;
  // Feeds the dashboard's AI acceptance metric: sent as-is vs edited first.
  const edited = isEditedReply(draft.body, body);

  // Atomic claim: only one concurrent decision wins; the rest see 0 rows and
  // never send anything. The row records the body that actually went out.
  const { count } = await db.replyDraft.updateMany({
    where: { id: draftId, status: "PENDING" },
    data: { status: "SENT", body, edited, decidedAt: new Date(), deciderId: decider.id },
  });
  if (count === 0) throw new Error("Draft was already decided.");

  await db.comment.create({
    data: { ticketId: draft.ticketId, authorId: decider.id, body, kind: "COMMENT" },
  });
  // Guarded so a concurrent first reply's earlier timestamp is never overwritten.
  await db.ticket.updateMany({
    where: { id: draft.ticketId, firstResponseAt: null },
    data: { firstResponseAt: new Date() },
  });

  const emailed = await sendMail(
    [draft.ticket.requester.email],
    replySubject(draft.ticket.number, draft.ticket.title),
    `${body}\n\n--\nTicket #${draft.ticket.number} · reply to this email to continue the conversation.\n`,
  );

  const updated = await db.replyDraft.update({
    where: { id: draftId },
    data: { emailed },
  });
  void emitEvent("reply.sent", {
    ticketId: draft.ticketId,
    ticketNumber: draft.ticket.number,
    draftId,
    emailed,
    decidedBy: decider.name,
  });
  return updated;
}

/** Reject a pending draft. The ticket is untouched; nothing is sent. */
export async function rejectDraft(draftId: string, decider: User): Promise<ReplyDraft> {
  const { count } = await db.replyDraft.updateMany({
    where: { id: draftId, status: "PENDING" },
    data: { status: "REJECTED", decidedAt: new Date(), deciderId: decider.id },
  });
  if (count === 0) {
    const exists = await db.replyDraft.findUnique({ where: { id: draftId } });
    throw new Error(exists ? "Draft was already decided." : "Draft not found.");
  }
  return db.replyDraft.findUniqueOrThrow({ where: { id: draftId } });
}
