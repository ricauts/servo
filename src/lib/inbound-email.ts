// Inbound email → tickets. A mail provider (SendGrid Inbound Parse, Mailgun
// Routes, Postmark, or a small IMAP-to-webhook relay) POSTs incoming messages
// to /api/inbound/email; a new sender becomes a REQUESTER, a subject carrying
// a ticket number becomes a comment on that ticket, anything else opens a new
// ticket and goes through triage.
//
// Config follows the integration pattern used everywhere else: the env var
// wins over the Settings copy and the secret is never returned by any API.

import { db } from "@/lib/db";
import { nextTicketNumber } from "@/lib/tickets";
import { getSmtpConfig } from "@/lib/notify";

export const INBOUND_SETTING_KEYS = {
  enabled: "integration.inbound.enabled",
  secret: "integration.inbound.secret", // never returned by the API
} as const;

export interface InboundConfig {
  enabled: boolean;
  secret: string;
  secretSource: "env" | "db" | "none";
}

export async function getInboundConfig(): Promise<InboundConfig> {
  const rows = await db.setting.findMany({
    where: { key: { in: Object.values(INBOUND_SETTING_KEYS) } },
  });
  const map = new Map(rows.map((row) => [row.key, row.value]));
  const envSecret = process.env.INBOUND_EMAIL_SECRET ?? "";
  const dbSecret = map.get(INBOUND_SETTING_KEYS.secret) ?? "";
  return {
    enabled: (map.get(INBOUND_SETTING_KEYS.enabled) ?? "false") === "true",
    secret: envSecret || dbSecret,
    secretSource: envSecret ? "env" : dbSecret ? "db" : "none",
  };
}

/** Pull the bare address out of `Name <user@host>` (or a plain address). */
export function parseSenderEmail(from: string): string {
  const angled = from.match(/<([^>]+)>/);
  const raw = (angled ? angled[1] : from).trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw) ? raw : "";
}

/** Display name from `Name <addr>`, falling back to the address local part. */
export function parseSenderName(from: string, email: string): string {
  const named = from.match(/^\s*"?([^"<]+?)"?\s*</);
  const name = named?.[1]?.trim();
  if (name) return name;
  const local = email.split("@")[0] ?? "someone";
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/** Ticket number referenced in a reply subject, e.g. "Re: [Servo] #1029 …". */
export function extractTicketNumber(subject: string): number | null {
  const match = subject.match(/#(\d{3,})/);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Drop quoted history so a reply stores what the person actually wrote.
 * Handles the common client markers; anything exotic just stays in place.
 */
export function stripQuotedReply(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const cutPatterns = [
    /^\s*-{2,}\s*Original Message\s*-{2,}/i,
    /^\s*On .+ wrote:\s*$/i,
    /^\s*El .+ escribió:\s*$/i,
    /^\s*_{5,}\s*$/,
    /^\s*From:\s.+/i,
    /^\s*--\s*$/, // signature delimiter
  ];
  const cutIndex = lines.findIndex((line) =>
    cutPatterns.some((pattern) => pattern.test(line)),
  );
  const kept = (cutIndex === -1 ? lines : lines.slice(0, cutIndex))
    .filter((line) => !line.trimStart().startsWith(">"))
    .join("\n")
    .trim();
  // Never return empty: an all-quoted reply keeps its original text.
  return kept || text.trim();
}

/**
 * Mail that no human sent: bounces, delivery-status notifications, vacation
 * auto-replies. These must never become tickets — they are noise, they would
 * provision "Mail Delivery Subsystem" as a requester, and replying to them
 * risks a mail loop.
 *
 * Header signals (RFC 3834 and the de-facto ones) are checked when the
 * relay forwards them; the sender and subject heuristics work even for
 * providers that only post from/subject/text.
 */
export function detectAutomatedMail(message: {
  from: string;
  subject?: string;
  headers?: Record<string, string | undefined>;
}): string | null {
  const headers = message.headers ?? {};
  const header = (name: string) => (headers[name] ?? "").toLowerCase();

  const autoSubmitted = header("auto-submitted");
  if (autoSubmitted && autoSubmitted !== "no") return `Auto-Submitted: ${autoSubmitted}`;
  const precedence = header("precedence");
  if (["bulk", "auto_reply", "junk", "list"].includes(precedence)) {
    return `Precedence: ${precedence}`;
  }
  if (header("content-type").includes("report-type=delivery-status")) {
    return "Delivery status report";
  }
  // An empty envelope sender (<>) is the RFC-mandated marker of a bounce.
  const returnPath = header("return-path").replace(/\s/g, "");
  if (returnPath === "<>") return "Empty return path (bounce)";
  if (header("x-autoreply") || header("x-autorespond") || header("x-auto-response-suppress")) {
    return "Auto-responder header";
  }

  const local = (parseSenderEmail(message.from).split("@")[0] ?? "").toLowerCase();
  if (
    ["mailer-daemon", "postmaster", "no-reply", "noreply", "donotreply", "do-not-reply", "bounce", "bounces"].includes(
      local,
    )
  ) {
    return `Automated sender (${local})`;
  }

  const subject = (message.subject ?? "").toLowerCase();
  if (
    /delivery status notification|undeliverable|mail delivery (failed|subsystem)|returned mail|delivery has failed|out of office|automatic reply|auto[- ]?reply|autoresponse/.test(
      subject,
    )
  ) {
    return "Automated subject line";
  }
  return null;
}

/**
 * The address a bounce is reporting on, so the failure can be attached to the
 * conversation it belongs to instead of vanishing.
 */
export function extractFailedRecipient(body: string): string {
  const patterns = [
    /final-recipient:\s*rfc822;\s*([^\s<>]+@[^\s<>]+)/i,
    /original-recipient:\s*rfc822;\s*([^\s<>]+@[^\s<>]+)/i,
    /(?:wasn't|was not|couldn't be|could not be) delivered to\s*\**\s*([^\s<>*]+@[^\s<>*]+)/i,
    /<([^\s<>]+@[^\s<>]+)>:?\s*(?:host|recipient|address)/i,
  ];
  for (const pattern of patterns) {
    const match = body.match(pattern);
    if (match?.[1]) return match[1].replace(/[.,;]+$/, "").toLowerCase();
  }
  return "";
}

const REQUESTER_COLORS = ["#4A3AA7", "#1C5CAB", "#B4491F", "#8F6400", "#0A6E66"];

/** Existing user for this address, or a freshly created REQUESTER. */
async function resolveSender(email: string, displayName: string) {
  const existing = await db.user.findUnique({ where: { email } });
  if (existing) return existing;
  const count = await db.user.count();
  return db.user.create({
    data: {
      name: displayName,
      email,
      role: "REQUESTER",
      color: REQUESTER_COLORS[count % REQUESTER_COLORS.length],
    },
  });
}

export interface InboundMessage {
  from: string;
  subject: string;
  text: string;
  /** Raw mail headers when the relay/provider forwards them. */
  headers?: Record<string, string | undefined>;
}

export type InboundResult =
  | { action: "comment"; ticketId: string; ticketNumber: number }
  | { action: "created"; ticketId: string; ticketNumber: number }
  | { action: "bounce"; ticketId: string; ticketNumber: number; recipient: string }
  | { action: "ignored"; reason: string };

/**
 * Turn one inbound message into a comment or a new ticket. Triage is left to
 * the caller so this stays synchronous and easy to test.
 */
export async function ingestEmail(message: InboundMessage): Promise<InboundResult> {
  const email = parseSenderEmail(message.from);
  if (!email) return { action: "ignored", reason: "Unparseable sender address." };

  // Self-loop guard: when the intake mailbox is also the notification sender
  // (the common Gmail setup), Servo's own outbound mail must never bounce
  // back in as tickets/comments. Gmail rewrites the From header to the
  // authenticated account, so the SMTP URL's username counts as "own" too.
  const smtp = await getSmtpConfig();
  const own = new Set<string>();
  const fromAddress = parseSenderEmail(smtp.from);
  if (fromAddress) own.add(fromAddress);
  try {
    const url = new URL(smtp.url);
    if (url.username) own.add(decodeURIComponent(url.username).toLowerCase());
  } catch {
    /* unparseable SMTP URL — guard falls back to the From address only */
  }
  if (own.has(email)) {
    return { action: "ignored", reason: "Own notification address." };
  }

  // Bounces and auto-replies are not tickets. But a bounce carries something
  // a human needs to know — a reply never reached the requester — so it is
  // attached to that requester's ticket instead of being dropped silently.
  const automated = detectAutomatedMail(message);
  if (automated) {
    const recipient = extractFailedRecipient(message.text ?? "");
    if (recipient) {
      const ticket = await db.ticket.findFirst({
        where: { requester: { email: recipient }, status: { not: "CLOSED" } },
        orderBy: { updatedAt: "desc" },
      });
      if (ticket) {
        const reporter = await db.user.findFirst({
          where: { role: "AI_AGENT", aiKind: "TRIAGE" },
        });
        await db.comment.create({
          data: {
            ticketId: ticket.id,
            authorId: (reporter ?? (await db.user.findFirstOrThrow({ where: { role: "ADMIN" } }))).id,
            kind: "SYSTEM",
            body: `Delivery failed: mail to ${recipient} bounced (${(message.subject ?? "").trim() || automated}). The requester has not received the last reply.`,
          },
        });
        return {
          action: "bounce",
          ticketId: ticket.id,
          ticketNumber: ticket.number,
          recipient,
        };
      }
    }
    return { action: "ignored", reason: `Automated mail — ${automated}.` };
  }

  const body = stripQuotedReply(message.text ?? "");
  if (!body) return { action: "ignored", reason: "Empty message body." };

  const sender = await resolveSender(email, parseSenderName(message.from, email));
  const subject = (message.subject ?? "").trim();

  // A referenced ticket turns the message into a comment — but only while the
  // ticket is still open, so replies to closed threads open a fresh one.
  const number = extractTicketNumber(subject);
  if (number !== null) {
    const ticket = await db.ticket.findUnique({ where: { number } });
    if (ticket && ticket.status !== "CLOSED") {
      await db.comment.create({
        data: { ticketId: ticket.id, authorId: sender.id, body, kind: "COMMENT" },
      });
      if (ticket.firstResponseAt === null && sender.id !== ticket.requesterId) {
        await db.ticket.update({
          where: { id: ticket.id },
          data: { firstResponseAt: new Date() },
        });
      }
      return { action: "comment", ticketId: ticket.id, ticketNumber: ticket.number };
    }
  }

  const ticketNumber = await nextTicketNumber();
  const created = await db.ticket.create({
    data: {
      number: ticketNumber,
      title: subject.replace(/^\s*(re|fwd|rv)\s*:\s*/i, "").trim() || "(no subject)",
      description: body,
      status: "OPEN",
      channel: "EMAIL",
      priority: "MEDIUM",
      category: "OTHER",
      requesterId: sender.id,
    },
  });
  return { action: "created", ticketId: created.id, ticketNumber: created.number };
}
