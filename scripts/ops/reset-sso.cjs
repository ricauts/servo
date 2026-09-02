// Break-glass SSO recovery: clears the OIDC tenant so Servo falls back to
// demo mode (cookie user switcher) on the next request. Use it when a
// misconfigured issuer/client locks every admin out of the UI.
//
//   node scripts/reset-sso.cjs
//
// Provider name, admin emails and allowed domains are kept so re-enabling
// SSO from Integrations only needs the issuer + client credentials again.
const { PrismaClient } = require("@prisma/client");
const db = new PrismaClient();

const CLEARED = ["auth.oidc.issuer", "auth.oidc.clientId", "auth.oidc.clientSecret"];

(async () => {
  for (const key of CLEARED) {
    await db.setting.upsert({ where: { key }, create: { key, value: "" }, update: { value: "" } });
  }
  console.log("SSO cleared — Servo is back in demo mode. Reconfigure it from /integrations.");
  await db.$disconnect();
})();
