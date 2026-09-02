// IMAP → Servo inbound relay: turns any IMAP mailbox (Gmail / Google
// Workspace, Outlook, Fastmail…) into tickets by forwarding unseen messages
// to POST /api/inbound/email. Run it next to Servo (or as a container):
//
//   IMAP_HOST=imap.gmail.com IMAP_USER=tickets@company.com \
//   IMAP_PASSWORD=<app-password> SERVO_URL=http://localhost:3000 \
//   INBOUND_EMAIL_SECRET=<shared secret> node scripts/ops/imap-relay.mjs
//
// Gmail/Workspace notes: enable IMAP for the mailbox and use an app password
// (requires 2-Step Verification). Messages are marked \Seen only after Servo
// accepts them, so a crash never loses mail.

import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";

const config = {
  host: process.env.IMAP_HOST ?? "imap.gmail.com",
  port: Number(process.env.IMAP_PORT ?? 993),
  user: process.env.IMAP_USER ?? "",
  password: process.env.IMAP_PASSWORD ?? "",
  servoUrl: (process.env.SERVO_URL ?? "http://localhost:3000").replace(/\/+$/, ""),
  secret: process.env.INBOUND_EMAIL_SECRET ?? "",
  pollSeconds: Number(process.env.IMAP_POLL_SECONDS ?? 30),
};

if (!config.user || !config.password || !config.secret) {
  console.error(
    "Missing config: IMAP_USER, IMAP_PASSWORD and INBOUND_EMAIL_SECRET are required.",
  );
  process.exit(1);
}

async function forward(parsed) {
  const res = await fetch(`${config.servoUrl}/api/inbound/email`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-servo-token": config.secret,
    },
    body: JSON.stringify({
      from: parsed.from?.text ?? "",
      subject: parsed.subject ?? "",
      text: parsed.text ?? "",
      // Servo uses these to recognise bounces and auto-replies, which must
      // never become tickets (RFC 3834 and the de-facto headers).
      headers: {
        "auto-submitted": parsed.headers?.get("auto-submitted") ?? "",
        precedence: parsed.headers?.get("precedence") ?? "",
        "return-path": parsed.headers?.get("return-path") ?? "",
        "content-type": String(parsed.headers?.get("content-type")?.value ?? ""),
        "x-autoreply": parsed.headers?.get("x-autoreply") ?? "",
        "x-auto-response-suppress": parsed.headers?.get("x-auto-response-suppress") ?? "",
      },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Servo rejected the message (${res.status}): ${body.error ?? ""}`);
  return body;
}

async function processUnseen(client) {
  const uids = await client.search({ seen: false });
  for (const uid of uids ?? []) {
    const { content } = await client.download(uid);
    const chunks = [];
    for await (const chunk of content) chunks.push(chunk);
    const parsed = await simpleParser(Buffer.concat(chunks));
    try {
      const result = await forward(parsed);
      await client.messageFlagsAdd(uid, ["\\Seen"]);
      console.log(
        `[relay] ${parsed.from?.text ?? "?"} :: "${parsed.subject ?? ""}" -> ${result.action ?? "?"}${result.ticketNumber ? ` #${result.ticketNumber}` : ""}`,
      );
    } catch (err) {
      // Leave unseen so the next pass retries.
      console.error(`[relay] delivery failed, will retry: ${err.message}`);
    }
  }
}

async function run() {
  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: true,
    auth: { user: config.user, pass: config.password },
    logger: false,
  });
  // Socket drops (Gmail resets idle connections) surface as async 'error'
  // events; without a listener they become fatal unhandled rejections.
  // With one, the next command throws normally and the outer loop reconnects.
  client.on("error", (err) => {
    console.error(`[relay] socket error: ${err.message}`);
  });
  await client.connect();
  console.log(`[relay] connected to ${config.host} as ${config.user}; polling every ${config.pollSeconds}s`);
  const lock = await client.getMailboxLock("INBOX");
  try {
    for (;;) {
      // A long-lived session goes stale without traffic: Gmail (and most
      // servers) only reveal new messages/flag changes after a NOOP.
      await client.noop();
      await processUnseen(client);
      await new Promise((r) => setTimeout(r, config.pollSeconds * 1000));
    }
  } finally {
    try {
      lock.release();
    } catch {
      /* connection already gone */
    }
  }
}

for (;;) {
  try {
    await run();
  } catch (err) {
    console.error(`[relay] connection error: ${err.message} — reconnecting in 30s`);
    await new Promise((r) => setTimeout(r, 30_000));
  }
}
