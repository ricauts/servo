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
    [path.join(process.cwd(), "scripts", "imap-relay.mjs")],
    {
      stdio: "inherit",
      env: { ...process.env, INBOUND_EMAIL_SECRET: row.value },
    },
  );
  child.on("exit", (code) => process.exit(code ?? 0));
}

main();
