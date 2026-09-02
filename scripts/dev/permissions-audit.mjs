// Role/permission audit: exercises the API as each demo role and asserts the
// expected status codes, so RBAC regressions show up as a failing script.
// Usage: node scripts/permissions-audit.mjs [baseUrl]
const base = process.argv[2] ?? "http://localhost:3000";

async function cookieFor(userName) {
  const res = await fetch(`${base}/api/users`);
  const { users } = await res.json();
  const user = users.find((u) => u.name.startsWith(userName));
  if (!user) throw new Error(`user ${userName} not found`);
  const sw = await fetch(`${base}/api/auth/switch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId: user.id }),
  });
  return sw.headers.get("set-cookie")?.split(";")[0] ?? "";
}

let failures = 0;
async function check(role, cookie, method, path, body, expected, note) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      cookie,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const ok = expected.includes(res.status);
  if (!ok) failures++;
  console.log(
    `${ok ? "OK  " : "FAIL"} ${role.padEnd(9)} ${method.padEnd(5)} ${path.padEnd(28)} -> ${res.status} (want ${expected.join("/")})  ${note}`,
  );
}

const admin = await cookieFor("Ana");
const agent = await cookieFor("Bruno");
const requester = await cookieFor("Carla");

// REQUESTER: can create tickets and comment; everything operational is walled off.
await check("REQUESTER", requester, "POST", "/api/tickets", { title: "perm audit", description: "role test" }, [201], "can open tickets");
await check("REQUESTER", requester, "GET", "/api/groups", null, [403], "groups hidden");
await check("REQUESTER", requester, "POST", "/api/groups", { name: "x" }, [403], "cannot manage groups");
await check("REQUESTER", requester, "GET", "/api/agents", null, [403], "agent profiles hidden");
await check("REQUESTER", requester, "GET", "/api/approvals", null, [403], "approvals hidden");
await check("REQUESTER", requester, "PUT", "/api/settings", { provider: "mock" }, [403], "settings walled");
await check("REQUESTER", requester, "GET", "/api/webhooks", null, [403], "webhooks walled");
await check("REQUESTER", requester, "POST", "/api/sla/scan", null, [403], "sla scan walled");
await check("REQUESTER", requester, "GET", "/api/kpis", null, [403], "kpis walled");

// AGENT: full operational access, no admin surface.
await check("AGENT", agent, "GET", "/api/groups", null, [200], "sees groups");
await check("AGENT", agent, "POST", "/api/groups", { name: "x" }, [403], "cannot create groups");
await check("AGENT", agent, "GET", "/api/agents", null, [200], "sees agent profiles");
await check("AGENT", agent, "POST", "/api/agents", { markdown: "x" }, [403], "cannot edit agents");
await check("AGENT", agent, "GET", "/api/approvals", null, [200], "sees approvals");
await check("AGENT", agent, "PUT", "/api/settings", { provider: "mock" }, [403], "settings walled");
await check("AGENT", agent, "POST", "/api/sla/scan", null, [403], "sla scan walled");
await check("AGENT", agent, "GET", "/api/kpis", null, [200], "sees kpis");

// HIGH-risk approvals stay admin-only.
const approvals = await (
  await fetch(`${base}/api/approvals`, { headers: { cookie: admin } })
).json();
const high = approvals.approvals?.find(
  (a) => a.status === "PENDING" && a.riskLevel === "HIGH",
);
if (high) {
  await check("AGENT", agent, "POST", `/api/approvals/${high.id}`, { decision: "APPROVED" }, [403], "HIGH approval admin-only");
} else {
  console.log("SKIP no pending HIGH approval to test");
}

// ADMIN: everything.
await check("ADMIN", admin, "PUT", "/api/settings", { provider: "mock" }, [200], "manages settings");
await check("ADMIN", admin, "GET", "/api/webhooks", null, [200], "manages webhooks");
await check("ADMIN", admin, "POST", "/api/sla/scan", null, [200], "runs sla scan");
await check("ADMIN", admin, "GET", "/api/tools", null, [200], "manages custom tools");

console.log(failures === 0 ? "\nAll role checks passed." : `\n${failures} role checks FAILED.`);
process.exit(failures === 0 ? 0 : 1);
