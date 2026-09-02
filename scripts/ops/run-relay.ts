// Launch the IMAP relay with the decrypted inbound secret from Settings.
// Keeps the plaintext out of shell history/args — it travels via child env.
// Usage: npx tsx scripts/ops/run-relay.ts  (IMAP_* vars still come from env)
import { spawn } from "child_process";
import path from "path";
import { db } from "../../src/lib/db";

async function main() {
  const row = await db.setting.findUnique({ where: { key: "integration.inbound.secret" } });
  if (!row?.value) {
    console.error("No inbound secret configured (Integrations → Inbound email).");
    process.exit(1);
  }
  await db.$disconnect();
  const child = spawn(
    process.execPath,
    // hyg-09 moved the relay to scripts/ops/. This spawn target was the one
    // reference the move missed, and it is the only one that breaks at RUNTIME
    // rather than misleading a reader: `npm run relay` reached a path that no
    // longer exists.
    [path.join(process.cwd(), "scripts", "ops", "imap-relay.mjs")],
    {
      stdio: "inherit",
      env: { ...process.env, INBOUND_EMAIL_SECRET: row.value },
    },
  );
  child.on("exit", (code) => process.exit(code ?? 0));
}

main();
