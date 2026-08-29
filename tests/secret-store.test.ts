import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { encryptionEnabled, isSealed, open, seal } from "@/lib/secret-store";

const KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"; // 64 hex

// "Without a key" must mean without a key — not "without whatever the
// developer's .env happens to carry" (vitest loads .env into workers).
beforeEach(() => {
  delete process.env.SERVO_ENCRYPTION_KEY;
});

afterEach(() => {
  delete process.env.SERVO_ENCRYPTION_KEY;
});

describe("secret-store", () => {
  it("is a no-op without a key (POC mode)", () => {
    expect(encryptionEnabled()).toBe(false);
    expect(seal("sk-ant-123")).toBe("sk-ant-123");
    expect(open("sk-ant-123")).toBe("sk-ant-123");
  });

  it("round-trips a secret with a hex key", () => {
    process.env.SERVO_ENCRYPTION_KEY = KEY;
    const stored = seal("sk-ant-123");
    expect(isSealed(stored)).toBe(true);
    expect(stored).not.toContain("sk-ant-123");
    expect(open(stored)).toBe("sk-ant-123");
  });

  it("round-trips with a passphrase key and is seal-idempotent", () => {
    process.env.SERVO_ENCRYPTION_KEY = "correct horse battery staple";
    const once = seal("token-xyz");
    expect(seal(once)).toBe(once); // sealing a sealed value never double-wraps
    expect(open(once)).toBe("token-xyz");
  });

  it("leaves empty values alone so 'clear the secret' still works", () => {
    process.env.SERVO_ENCRYPTION_KEY = KEY;
    expect(seal("")).toBe("");
  });

  it("fails loudly on a sealed value when the key is missing", () => {
    process.env.SERVO_ENCRYPTION_KEY = KEY;
    const stored = seal("secret");
    delete process.env.SERVO_ENCRYPTION_KEY;
    expect(() => open(stored)).toThrow(/SERVO_ENCRYPTION_KEY is not set/);
  });

  it("fails loudly on tampering or a wrong key", () => {
    process.env.SERVO_ENCRYPTION_KEY = KEY;
    const stored = seal("secret");
    process.env.SERVO_ENCRYPTION_KEY = "another key entirely";
    expect(() => open(stored)).toThrow(/wrong SERVO_ENCRYPTION_KEY|tampered/);
  });

  it("legacy plaintext passes through even with a key set", () => {
    process.env.SERVO_ENCRYPTION_KEY = KEY;
    expect(open("plain-old-value")).toBe("plain-old-value");
  });
});
