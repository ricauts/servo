// Builds servo_capture — a throwaway copy of the working Postgres database,
// safe to screenshot, film and mutate. The real database is only read
// (pg_dump); `npm run demo` is deliberately NOT used because it wipes in
// place.
//
//   node scripts/make-capture-db.mjs
//
// (The old invocation note said `node --experimental-sqlite` — that flag has
// not been needed since Node shipped node:sqlite stable, and the script left
// SQLite behind with the Postgres cutover; db-07 repointed it here.)
//
// Run it before every take: a recording clicks Approve & send and starts runs,
// so the second take of a scene would otherwise start from a used-up fixture.
//
// What it guarantees, per MEDIA-GUIDE.md §B.9 — the statements below are the
// SQLite-era ones, transplanted verbatim in substance:
//   - no real person, address or domain anywhere on screen
//   - no real credential, and no path to a paid model call
//   - English only (the working database has Spanish ticket titles)
//   - ticket #1061 staged mid-flight: workable, with its reply draft pending
import { spawnSync } from "node:child_process";

const COMPOSE_DB = ["compose", "exec", "-T", "db"];

function psql(sql, database = "servo_capture") {
  const args =
    process.env.PGHOST || process.env.PGPORT
      ? ["psql", `-h ${process.env.PGHOST ?? "localhost"}`, `-p ${process.env.PGPORT ?? "5432"}`, "-U", process.env.PGUSER ?? "servo", "-d", database, "-v", "ON_ERROR_STOP=1", "-c", sql]
      : ["psql", "-U", "servo", "-d", database, "-v", "ON_ERROR_STOP=1", "-c", sql];
  const viaCompose = spawnSync("docker", [...COMPOSE_DB, ...args], { encoding: "utf8", env: { ...process.env, PGPASSWORD: process.env.PGPASSWORD ?? "servo" } });
  if (viaCompose.status === 0) return;
  // No compose? Fall back to a direct psql on PATH.
  const direct = spawnSync("psql", args.slice(1), { encoding: "utf8", env: { ...process.env, PGPASSWORD: process.env.PGPASSWORD ?? "servo" } });
  if (direct.status !== 0) {
    console.error(`make-capture-db: psql failed\n${String(viaCompose.stderr)}\n${String(direct.stderr)}`);
    process.exit(1);
  }
}

function run(sql) {
  return psql(sql);
}

// Fresh capture database: dump the working one, restore into servo_capture —
// the same procedure SECURITY.md teaches for backups, exercised here on every
// capture (and proven by tests/backup-restore.test.ts).
run("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'servo_capture'");
spawnSync("docker", [...COMPOSE_DB, "dropdb", "--if-exists", "-U", "servo", "servo_capture"], { encoding: "utf8" });
spawnSync("docker", [...COMPOSE_DB, "createdb", "-U", "servo", "servo_capture"], { encoding: "utf8" });
const dump = spawnSync("docker", [...COMPOSE_DB, "pg_dump", "-U", "servo", "servo"], { encoding: "utf8", maxBuffer: 1 << 28 });
if (dump.status !== 0) {
  console.error(`make-capture-db: pg_dump failed\n${String(dump.stderr)}`);
  process.exit(1);
}
const restore = spawnSync("docker", [...COMPOSE_DB, "psql", "-U", "servo", "-d", "servo_capture", "-v", "ON_ERROR_STOP=1"], { encoding: "utf8", input: dump.stdout, maxBuffer: 1 << 28 });
if (restore.status !== 0) {
  console.error(`make-capture-db: restore failed\n${String(restore.stderr)}`);
  process.exit(1);
}

// 1. demo auth — the OIDC tenant would bounce a headless browser to the IdP
for (const key of ["auth.oidc.issuer", "auth.oidc.clientId", "auth.oidc.clientSecret"]) {
  run(`UPDATE "Setting" SET value='' WHERE key='${key}'`);
}

// 2. real accounts -> invented ones on acme.dev. Dana Whitfield and Tomas Berg
//    are already fictional (@northwind.example) and stay: #1061 is the page's
//    proof story and its screenshots already ship in the README.
const people = [
  ["sricaurte@servoai.org", "Marta Oliveira", "marta@acme.dev"],
  ["pancakesiscool@gmail.com", "Nils Ericsson", "nils@acme.dev"],
  ["support@servoai.org", "Acme Support", "support@acme.dev"],
  ["mail-noreply@google.com", "Mail Team", "mail@acme.dev"],
  ["no-reply@accounts.google.com", "Accounts", "accounts@acme.dev"],
  ["workspace-noreply@google.com", "Workspace Team", "workspace@acme.dev"],
];
for (const [email, name, next] of people) {
  run(`UPDATE "User" SET name='${name.replace(/'/g, "''")}', email='${next}' WHERE email='${email}'`);
}

// 3. settings that render as text on /integrations
run(`UPDATE "Setting" SET value='Acme Support <support@acme.dev>' WHERE key='integration.smtp.from'`);
run(`UPDATE "Setting" SET value='admin@acme.dev' WHERE key='auth.adminEmails'`);
run(`UPDATE "Setting" SET value='acme.dev' WHERE key='auth.allowedDomains'`);

// 4. English only — three of these were legible in the phone frame
const titles = [
  [1051, "Start the dark mode feature: branch in the Servo repo"],
  [1050, "Repo for the public marketing site"],
  [1049, "New table to track software licences"],
  [1048, "Feature request: dark mode toggle in the portal"],
  [1047, "Account locked - I cannot sign in"],
  [1045, "MCP e2e: test guest VPN access"],
  [1042, "Duplicate rows in the licences table"],
  [1039, "The weekly sales report did not arrive"],
  [1038, "Onboarding: new starter needs workspace access"],
  [1037, "The printer on floor 4 will not power on"],
];
for (const [number, title] of titles) {
  run(`UPDATE "Ticket" SET title='${title.replace(/'/g, "''")}' WHERE number=${number}`);
}

// 5. no paid calls. The global provider is already `mock`, but a per-agent
//    credential overrides it, so both have to go.
run(`UPDATE "AgentProfile" SET "credentialId"=null`);
run(`DELETE FROM "AiCredential"`);
run(`UPDATE "Setting" SET value='mock' WHERE key='ai.provider'`);

// 6. stage #1061 mid-flight. RESOLVED refuses new runs ("Cannot start an agent
//    run on a resolved or closed ticket"), which put a red error in take one.
run(`UPDATE "Ticket" SET status='IN_PROGRESS' WHERE number=1061`);
run(`
  UPDATE "ReplyDraft" SET status='PENDING', "decidedAt"=null, "deciderId"=null,
    emailed=false, edited=false
  WHERE "ticketId"=(SELECT id FROM "Ticket" WHERE number=1061)
`);

console.log("servo_capture ready — #1061 staged IN_PROGRESS with a PENDING draft");
