// Builds a legacy (pre-Postgres) Servo SQLite database for the db-07
// migration tests — every table the importer knows, with the column names
// Prisma's SQLite connector used, a few rows each, an Attachment carrying
// real binary bytes, and sealed `enc:v1:` values that must survive verbatim.
// The spec's original wording ("built by prisma db push") predates db-01's
// provider switch: db push can no longer target SQLite, so the fixture is
// created with node:sqlite directly — same shape, and the importer reads it
// the same way it reads a real legacy file.

import { DatabaseSync } from "node:sqlite";

const DDL = [
  `CREATE TABLE "Setting" ("key" TEXT PRIMARY KEY, "value" TEXT NOT NULL)`,
  `CREATE TABLE "SlaPolicy" ("priority" TEXT NOT NULL, "responseMinutes" INTEGER NOT NULL, "resolutionMinutes" INTEGER NOT NULL, "escalateOnBreach" BOOLEAN NOT NULL)`,
  `CREATE TABLE "ToolPolicy" ("toolName" TEXT PRIMARY KEY, "description" TEXT NOT NULL, "riskLevel" TEXT NOT NULL, "enabled" BOOLEAN NOT NULL, "requiresApproval" BOOLEAN NOT NULL)`,
  `CREATE TABLE "User" ("id" TEXT PRIMARY KEY, "name" TEXT NOT NULL, "email" TEXT NOT NULL, "role" TEXT NOT NULL, "aiKind" TEXT, "color" TEXT, "createdAt" DATETIME NOT NULL)`,
  `CREATE TABLE "AiCredential" ("id" TEXT PRIMARY KEY, "name" TEXT NOT NULL, "provider" TEXT NOT NULL, "apiKey" TEXT NOT NULL, "baseUrl" TEXT, "model" TEXT, "createdAt" DATETIME NOT NULL)`,
  `CREATE TABLE "Group" ("id" TEXT PRIMARY KEY, "name" TEXT NOT NULL, "description" TEXT, "categories" TEXT NOT NULL, "createdAt" DATETIME NOT NULL)`,
  `CREATE TABLE "GroupMember" ("id" TEXT PRIMARY KEY, "groupId" TEXT NOT NULL, "userId" TEXT NOT NULL, "seniority" TEXT NOT NULL)`,
  `CREATE TABLE "AgentProfile" ("id" TEXT PRIMARY KEY, "slug" TEXT NOT NULL, "name" TEXT NOT NULL, "description" TEXT, "categories" TEXT, "tools" TEXT, "systemPrompt" TEXT, "markdown" TEXT, "enabled" BOOLEAN NOT NULL, "credentialId" TEXT, "createdAt" DATETIME NOT NULL, "updatedAt" DATETIME NOT NULL)`,
  `CREATE TABLE "Ticket" ("id" TEXT PRIMARY KEY, "number" INTEGER NOT NULL, "title" TEXT NOT NULL, "description" TEXT NOT NULL, "status" TEXT NOT NULL, "priority" TEXT NOT NULL, "category" TEXT NOT NULL, "requesterId" TEXT NOT NULL, "assigneeId" TEXT, "groupId" TEXT, "escalationLevel" INTEGER NOT NULL, "createdAt" DATETIME NOT NULL, "updatedAt" DATETIME NOT NULL, "firstResponseAt" DATETIME, "resolvedAt" DATETIME, "responseDueAt" DATETIME, "resolutionDueAt" DATETIME, "slaEscalatedAt" DATETIME)`,
  `CREATE TABLE "Skill" ("id" TEXT PRIMARY KEY, "slug" TEXT NOT NULL, "name" TEXT NOT NULL, "description" TEXT, "categories" TEXT, "body" TEXT, "markdown" TEXT, "enabled" BOOLEAN NOT NULL, "createdAt" DATETIME NOT NULL, "updatedAt" DATETIME NOT NULL)`,
  `CREATE TABLE "Comment" ("id" TEXT PRIMARY KEY, "ticketId" TEXT NOT NULL, "authorId" TEXT NOT NULL, "body" TEXT NOT NULL, "kind" TEXT NOT NULL, "createdAt" DATETIME NOT NULL)`,
  `CREATE TABLE "AgentRun" ("id" TEXT PRIMARY KEY, "ticketId" TEXT NOT NULL, "agentUserId" TEXT NOT NULL, "profileId" TEXT, "kind" TEXT NOT NULL, "status" TEXT NOT NULL, "conversation" TEXT NOT NULL, "summary" TEXT, "error" TEXT, "qaVerdict" TEXT, "qaNotes" TEXT, "createdAt" DATETIME NOT NULL, "completedAt" DATETIME)`,
  `CREATE TABLE "AgentStep" ("id" TEXT PRIMARY KEY, "runId" TEXT NOT NULL, "index" INTEGER NOT NULL, "type" TEXT NOT NULL, "toolName" TEXT, "content" TEXT NOT NULL, "riskLevel" TEXT, "createdAt" DATETIME NOT NULL)`,
  `CREATE TABLE "Approval" ("id" TEXT PRIMARY KEY, "runId" TEXT NOT NULL, "ticketId" TEXT NOT NULL, "toolName" TEXT NOT NULL, "toolInput" TEXT NOT NULL, "toolUseId" TEXT NOT NULL, "riskLevel" TEXT NOT NULL, "status" TEXT NOT NULL, "reason" TEXT, "requestedAt" DATETIME NOT NULL, "decidedAt" DATETIME, "deciderId" TEXT)`,
  `CREATE TABLE "ReplyDraft" ("id" TEXT PRIMARY KEY, "ticketId" TEXT NOT NULL, "body" TEXT NOT NULL, "status" TEXT NOT NULL, "agentName" TEXT NOT NULL, "emailed" BOOLEAN NOT NULL, "edited" BOOLEAN NOT NULL, "createdAt" DATETIME NOT NULL, "decidedAt" DATETIME, "deciderId" TEXT, "sources" TEXT, "autoDelivered" BOOLEAN NOT NULL)`,
  `CREATE TABLE "Attachment" ("id" TEXT PRIMARY KEY, "ticketId" TEXT NOT NULL, "name" TEXT NOT NULL, "contentType" TEXT NOT NULL, "data" BLOB NOT NULL, "caption" TEXT, "createdAt" DATETIME NOT NULL)`,
  `CREATE TABLE "AiUsage" ("id" TEXT PRIMARY KEY, "createdAt" DATETIME NOT NULL, "credentialName" TEXT, "provider" TEXT NOT NULL, "model" TEXT, "kind" TEXT, "agentName" TEXT, "inputTokens" INTEGER, "outputTokens" INTEGER, "latencyMs" INTEGER, "ok" BOOLEAN, "error" TEXT)`,
  `CREATE TABLE "Webhook" ("id" TEXT PRIMARY KEY, "url" TEXT NOT NULL, "secret" TEXT, "events" TEXT NOT NULL, "enabled" BOOLEAN NOT NULL, "createdAt" DATETIME NOT NULL)`,
  `CREATE TABLE "WebhookDelivery" ("id" TEXT PRIMARY KEY, "webhookId" TEXT NOT NULL, "event" TEXT NOT NULL, "ok" BOOLEAN NOT NULL, "statusCode" INTEGER, "error" TEXT, "durationMs" INTEGER, "createdAt" DATETIME NOT NULL)`,
  `CREATE TABLE "CustomTool" ("id" TEXT PRIMARY KEY, "name" TEXT NOT NULL, "description" TEXT, "inputSchema" TEXT NOT NULL, "method" TEXT NOT NULL, "url" TEXT NOT NULL, "headers" TEXT, "bodyTemplate" TEXT, "secret" TEXT, "createdAt" DATETIME NOT NULL, "updatedAt" DATETIME NOT NULL)`,
  `CREATE TABLE "McpCall" ("id" TEXT PRIMARY KEY, "toolName" TEXT NOT NULL, "inputJson" TEXT, "resultPreview" TEXT, "decision" TEXT NOT NULL, "callerLabel" TEXT, "createdAt" DATETIME NOT NULL)`,
];

export interface LegacyFixture {
  path: string;
  counts: Record<string, number>;
  /** The exact bytes stored in Attachment.data — byte-identity is asserted
   *  on the Postgres side after the import. */
  attachmentBytes: Buffer;
  /** A sealed value (enc:v1:…) that must arrive VERBATIM, never decrypted. */
  sealedSetting: string;
  maxTicketNumber: number;
}

export function buildLegacySqlite(path: string): LegacyFixture {
  const db = new DatabaseSync(path);
  for (const ddl of DDL) db.exec(ddl);

  const iso = (d: string) => d;
  const counts: Record<string, number> = {};

  const run = (table: string, sql: string, ...args: (string | number | Buffer | null)[]) => {
    db.prepare(sql).run(...args);
    counts[table] = (counts[table] ?? 0) + 1;
  };

  run("Setting", `INSERT INTO "Setting" VALUES ('ai.provider', 'mock')`);
  const sealed = "enc:v1:9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c-not-a-real-key";
  run("Setting", `INSERT INTO "Setting" VALUES ('ai.apiKey', ?)`, sealed);
  run("Setting", `INSERT INTO "Setting" VALUES ('smtp.from', 'desk@acme.dev')`);

  run("SlaPolicy", `INSERT INTO "SlaPolicy" VALUES ('HIGH', 30, 240, 1)`);
  run("SlaPolicy", `INSERT INTO "SlaPolicy" VALUES ('LOW', 480, 2880, 0)`);

  run("ToolPolicy", `INSERT INTO "ToolPolicy" VALUES ('device_inventory_lookup', 'Read-only device inventory', 'LOW', 1, 0)`);

  run("User", `INSERT INTO "User" VALUES ('u_admin', 'Ada Admin', 'ada@acme.dev', 'ADMIN', NULL, '#1a2b3c', ?)`, iso("2025-11-02 09:00:00.000Z"));
  run("User", `INSERT INTO "User" VALUES ('u_req', 'Rui Requester', 'rui@acme.dev', 'REQUESTER', NULL, NULL, ?)`, iso("2025-11-03 10:30:00.000Z"));
  run("User", `INSERT INTO "User" VALUES ('u_resolver', 'Servo Resolver', 'resolver@servo.ai', 'AI_AGENT', 'RESOLVER', NULL, ?)`, iso("2025-11-02 09:00:00.000Z"));

  run("AiCredential", `INSERT INTO "AiCredential" VALUES ('cred_1', 'desk key', 'anthropic', 'enc:v1:deadbeefcafebabe', NULL, 'claude-3', ?)`, iso("2025-12-01 08:00:00.000Z"));

  run("Group", `INSERT INTO "Group" VALUES ('g_1', 'Network folks', 'Network team', '["NETWORK"]', ?)`, iso("2025-11-05 14:00:00.000Z"));
  run("GroupMember", `INSERT INTO "GroupMember" VALUES ('gm_1', 'g_1', 'u_admin', 'SENIOR')`);

  run("AgentProfile", `INSERT INTO "AgentProfile" VALUES ('p_1', 'network-specialist', 'Network specialist', 'Network fixes', '["NETWORK"]', '[]', 'You fix networks.', '# Network specialist\nYou fix networks.', 1, 'cred_1', ?, ?)`, iso("2025-11-10 09:00:00.000Z"), iso("2025-11-10 09:00:00.000Z"));

  const tickets: Array<[string, number, string]> = [
    ["t_1001", 1001, "VPN drops every morning"],
    ["t_1002", 1002, "Printer on floor 4 is dead"],
    ["t_1003", 1003, "Licence report missing rows"],
  ];
  for (const [id, number, title] of tickets) {
    run(
      "Ticket",
      `INSERT INTO "Ticket" VALUES (?, ?, ?, 'It broke yesterday.', 'RESOLVED', 'MEDIUM', 'NETWORK', 'u_req', 'u_resolver', 'g_1', 0, ?, ?, ?, ?, NULL, NULL, NULL)`,
      id, number, title,
      iso("2026-01-05 08:00:00.000Z"), iso("2026-01-05 09:00:00.000Z"),
      iso("2026-01-05 08:20:00.000Z"), iso("2026-01-05 08:55:00.000Z"),
    );
  }

  run("Skill", `INSERT INTO "Skill" VALUES ('s_1', 'vpn-runbook', 'VPN runbook', 'How we fix VPN drops', '["NETWORK"]', 'Steps…', '# VPN runbook\nSteps…', 1, ?, ?)`, iso("2025-12-20 11:00:00.000Z"), iso("2025-12-20 11:00:00.000Z"));
  run("Comment", `INSERT INTO "Comment" VALUES ('c_1', 't_1001', 'u_admin', 'Rebooted the gateway; watching it.', 'HUMAN', ?)`, iso("2026-01-05 08:30:00.000Z"));
  run("AgentRun", `INSERT INTO "AgentRun" VALUES ('r_1', 't_1001', 'u_resolver', 'p_1', 'RESOLVE', 'COMPLETED', '[]', 'Checked the gateway and renewed the lease.', NULL, 'PASS', 'Matches the runbook.', ?, ?)`, iso("2026-01-05 08:05:00.000Z"), iso("2026-01-05 08:50:00.000Z"));
  run("AgentStep", `INSERT INTO "AgentStep" VALUES ('st_1', 'r_1', 0, 'TOOL_CALL', 'device_inventory_lookup', '{"sku":"GW-1"}', 'LOW', ?)`, iso("2026-01-05 08:10:00.000Z"));
  run("Approval", `INSERT INTO "Approval" VALUES ('a_1', 'r_1', 't_1001', 'password_reset', '{"user":"rui"}', 'tu_1', 'HIGH', 'APPROVED', 'asked on chat', ?, ?, 'u_admin')`, iso("2026-01-05 08:40:00.000Z"), iso("2026-01-05 08:45:00.000Z"));
  run("ReplyDraft", `INSERT INTO "ReplyDraft" VALUES ('d_1', 't_1001', 'Renewed the DHCP lease; the tunnel stayed up all morning.', 'SENT', 'Servo Resolver', 1, 0, ?, ?, 'u_admin', '[]', 0)`, iso("2026-01-05 08:55:00.000Z"), iso("2026-01-05 09:00:00.000Z"));

  const attachmentBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff, 0x00, 0x10, 0xfe, 0xf0]);
  run("Attachment", `INSERT INTO "Attachment" VALUES ('at_1', 't_1001', 'gateway-before.png', 'image/png', ?, 'before the fix', ?)`, attachmentBytes, iso("2026-01-05 08:35:00.000Z"));

  run("AiUsage", `INSERT INTO "AiUsage" VALUES ('au_1', ?, 'desk key', 'anthropic', 'claude-3', 'RESOLVE', 'Servo Resolver', 1200, 340, 890, 1, NULL)`, iso("2026-01-05 08:50:00.000Z"));
  run("Webhook", `INSERT INTO "Webhook" VALUES ('w_1', 'https://hooks.acme.dev/servo', 'enc:v1:whsec-fixture', '["ticket.resolved"]', 1, ?)`, iso("2025-11-15 16:00:00.000Z"));
  run("WebhookDelivery", `INSERT INTO "WebhookDelivery" VALUES ('wd_1', 'w_1', 'ticket.resolved', 1, 200, NULL, 120, ?)`, iso("2026-01-05 09:01:00.000Z"));
  run("CustomTool", `INSERT INTO "CustomTool" VALUES ('ct_1', 'page-screenshot', 'Screenshot a page', '{}', 'POST', 'https://shot.acme.dev/api', NULL, '{}', 'enc:v1:ct-secret-fixture', ?, ?)`, iso("2025-12-01 12:00:00.000Z"), iso("2025-12-01 12:00:00.000Z"));
  run("McpCall", `INSERT INTO "McpCall" VALUES ('m_1', 'device_inventory_lookup', '{"sku":"GW-1"}', '{"stock":3}', 'EXECUTED', 'runbook bot', ?)`, iso("2026-01-06 10:00:00.000Z"));

  db.close();
  return { path, counts, attachmentBytes, sealedSetting: sealed, maxTicketNumber: 1003 };
}
