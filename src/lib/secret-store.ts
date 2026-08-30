// Encryption at rest for stored secrets (API keys, tokens, SMTP URLs…).
//
// AES-256-GCM with a key from SERVO_ENCRYPTION_KEY: 64 hex chars, 32-byte
// base64, or any passphrase (stretched with scrypt). Values are stored as
// `enc:v1:<base64(iv | tag | ciphertext)>`; anything without the prefix is
// treated as legacy plaintext, so enabling encryption is non-breaking and
// existing rows can be migrated with `node scripts/encrypt-secrets.cjs`.
//
// Without a key Servo still works (POC mode) but secrets stay in plaintext
// in the database — SECURITY.md documents why you want the key in production.

import crypto from "crypto";

const PREFIX = "enc:v1:";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function keyBytes(): Buffer | null {
  const raw = process.env.SERVO_ENCRYPTION_KEY?.trim();
  if (!raw) return null;
  if (/^[A-Fa-f0-9]{64}$/.test(raw)) return Buffer.from(raw, "hex");
  try {
    const b64 = Buffer.from(raw, "base64");
    if (b64.length === 32) return b64;
  } catch {
    /* not base64 — treat as passphrase */
  }
  return crypto.scryptSync(raw, "servo-secret-store", 32);
}

export function encryptionEnabled(): boolean {
  return keyBytes() !== null;
}

export function isSealed(value: string): boolean {
  return value.startsWith(PREFIX);
}

/** Encrypt a secret for storage. No-op without a key, on empty values, and
 * on values that are already sealed (idempotent by construction). */
export function seal(plain: string): string {
  const key = keyBytes();
  if (!key || plain === "" || isSealed(plain)) return plain;
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64");
}

/** Decrypt a stored value. Legacy plaintext passes through untouched; sealed
 * values require the right key and fail loudly (never silently return
 * ciphertext to a caller that will send it to a provider). */
export function open(stored: string): string {
  if (!isSealed(stored)) return stored;
  const key = keyBytes();
  if (!key) {
    throw new Error(
      "The database holds encrypted secrets but SERVO_ENCRYPTION_KEY is not set.",
    );
  }
  const buf = Buffer.from(stored.slice(PREFIX.length), "base64");
  const iv = buf.subarray(0, IV_LENGTH);
  const tag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = buf.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    throw new Error(
      "Failed to decrypt a stored secret — wrong SERVO_ENCRYPTION_KEY, or the value was tampered with.",
    );
  }
}

/** Setting rows whose value is a secret. Kept in sync with the keys the
 * settings API refuses to return. */
export const SENSITIVE_SETTING_KEYS = new Set([
  "ai.apiKey",
  "integration.smtp.url", // may embed credentials
  "integration.github.token",
  "integration.azure.clientSecret",
  "integration.inbound.secret",
  "auth.oidc.clientSecret",
  "integration.mcp.token",
]);
