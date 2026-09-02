/* eslint-disable no-console */
// One-time migration: encrypt secrets that predate SERVO_ENCRYPTION_KEY.
//
//   node scripts/ops/encrypt-secrets.cjs
//
// Reads SERVO_ENCRYPTION_KEY from the environment (or .env), then seals every
// sensitive value that is still plaintext: Setting rows for secret keys,
// AiCredential.apiKey, CustomTool.secret, Webhook.secret and
// McpServer.secret. Idempotent —
// already-encrypted values are left alone. New writes are encrypted
// automatically by the app; this exists only for rows written before the key.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { PrismaClient } = require("@prisma/client");

const PREFIX = "enc:v1:";
const SENSITIVE_SETTING_KEYS = [
  "ai.apiKey",
  "integration.smtp.url",
  "integration.github.token",
  "integration.azure.clientSecret",
  "integration.inbound.secret",
  "auth.oidc.clientSecret",
  "integration.mcp.token",
];

function loadDotEnv() {
  const file = path.join(process.cwd(), ".env");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (match && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  }
}

function keyBytes() {
  const raw = (process.env.SERVO_ENCRYPTION_KEY || "").trim();
  if (!raw) return null;
  if (/^[A-Fa-f0-9]{64}$/.test(raw)) return Buffer.from(raw, "hex");
  const b64 = Buffer.from(raw, "base64");
  if (b64.length === 32) return b64;
  return crypto.scryptSync(raw, "servo-secret-store", 32);
}

function seal(key, plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64");
}

(async () => {
  loadDotEnv();
  const key = keyBytes();
  if (!key) {
    console.error("SERVO_ENCRYPTION_KEY is not set (env or .env) — nothing to do.");
    process.exit(1);
  }
  const db = new PrismaClient();
  let sealed = 0;

  const settings = await db.setting.findMany({
    where: { key: { in: SENSITIVE_SETTING_KEYS } },
  });
  for (const row of settings) {
    if (row.value && !row.value.startsWith(PREFIX)) {
      await db.setting.update({ where: { key: row.key }, data: { value: seal(key, row.value) } });
      console.log(`sealed setting ${row.key}`);
      sealed++;
    }
  }
  for (const cred of await db.aiCredential.findMany()) {
    if (cred.apiKey && !cred.apiKey.startsWith(PREFIX)) {
      await db.aiCredential.update({ where: { id: cred.id }, data: { apiKey: seal(key, cred.apiKey) } });
      console.log(`sealed credential ${cred.name}`);
      sealed++;
    }
  }
  for (const tool of await db.customTool.findMany()) {
    if (tool.secret && !tool.secret.startsWith(PREFIX)) {
      await db.customTool.update({ where: { id: tool.id }, data: { secret: seal(key, tool.secret) } });
      console.log(`sealed custom tool ${tool.name}`);
      sealed++;
    }
  }
  for (const hook of await db.webhook.findMany()) {
    if (hook.secret && !hook.secret.startsWith(PREFIX)) {
      await db.webhook.update({ where: { id: hook.id }, data: { secret: seal(key, hook.secret) } });
      console.log(`sealed webhook secret ${hook.id}`);
      sealed++;
    }
  }
  // cnp-02 joined McpServer.secret to the sealed-secret family in
  // src/lib/db.ts; a model the write hook seals but this backfill does not
  // know about would leave pre-key rows plaintext forever.
  for (const server of await db.mcpServer.findMany()) {
    if (server.secret && !server.secret.startsWith(PREFIX)) {
      await db.mcpServer.update({ where: { id: server.id }, data: { secret: seal(key, server.secret) } });
      console.log(`sealed MCP server secret ${server.slug}`);
      sealed++;
    }
  }

  console.log(sealed === 0 ? "Nothing to seal — all secrets already encrypted." : `Done: ${sealed} value(s) encrypted.`);
  await db.$disconnect();
})();
