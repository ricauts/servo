// Regenerates the README screenshots — the desk in its LIGHT theme by default
// (owner ask, 2026-09-04; spec §0.5), --theme=dark for the dark variants. Shoots
// the running app (docker compose, demo dataset) with the system Chrome via
// puppeteer-core, authenticating as a demo user through the same
// /api/auth/switch the user switcher uses.
//   node scripts/media/readme-screenshots.mjs [baseUrl] [--theme=light|dark] [--out=<dir>]
import puppeteer from "puppeteer-core";
import { existsSync } from "node:fs";

// Arguments: [baseUrl] [--theme=light|dark] [--out=<dir>]. The README ships
// the LIGHT theme (owner ask, 2026-09-04); --theme=dark is kept for the
// dark variants and for reviewing both.
const positional = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const flag = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const base = positional[0] ?? "http://localhost:3000";
const OUT = flag("out", "docs/assets");
const THEME = flag("theme", "light") === "dark" ? "dark" : "light";

const CHROME_PATHS = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "/usr/bin/google-chrome",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

async function cookieFor(userName) {
  const res = await fetch(`${base}/api/users`);
  const { users } = await res.json();
  const user = users.find((u) => u.name.startsWith(userName));
  if (!user) throw new Error(`demo user ${userName} not found`);
  const sw = await fetch(`${base}/api/auth/switch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId: user.id }),
  });
  return sw.headers.get("set-cookie")?.split(";")[0] ?? "";
}

async function ticketId(cookie, q) {
  const res = await fetch(`${base}/api/tickets?q=${encodeURIComponent(q)}`, { headers: { cookie } });
  const { tickets } = await res.json();
  return tickets?.[0]?.id;
}

const executablePath = CHROME_PATHS.find((p) => existsSync(p));
if (!executablePath) {
  console.error("Chrome not found in known locations.");
  process.exit(1);
}

const adminCookie = await cookieFor("Ana");
const agentCookie = await cookieFor("Bruno");
// The detail shot wants a ticket with a run paused for approval — the demo's
// status-page hotfix (#1005) — so the folded run and the gate are visible.
const detailId = await ticketId(agentCookie, "status-page hotfix") ?? await ticketId(agentCookie, "VPN") ?? (await (await fetch(base + "/api/tickets", { headers: { cookie: agentCookie } })).json()).tickets?.[0]?.id;
if (!detailId) throw new Error("no demo ticket found for the detail shot");

const jobs = [
  { url: "/dashboard", out: `${OUT}/screenshot-dashboard.png`, cookie: adminCookie },
  { url: "/tickets", out: `${OUT}/screenshot-tickets.png`, cookie: agentCookie },
  { url: `/tickets/${detailId}`, out: `${OUT}/screenshot-ticket-detail.png`, cookie: agentCookie, wait: 2200 },
  { url: "/approvals", out: `${OUT}/screenshot-approvals.png`, cookie: agentCookie },
  { url: "/agents", out: `${OUT}/screenshot-agents.png`, cookie: adminCookie },
  { url: "/integrations", out: `${OUT}/screenshot-integrations.png`, cookie: adminCookie },
  { url: "/settings", out: `${OUT}/screenshot-settings.png`, cookie: adminCookie, click: "Tool permissions" },
  // The library (kb-lib-*): the list with its filters and chips, the graph
  // with a node selected, Packs, and the fleet pages the README names.
  { url: "/kb", out: `${OUT}/screenshot-knowledge.png`, cookie: adminCookie, wait: 1800 },
  { url: "/kb/graph", out: `${OUT}/screenshot-graph.png`, cookie: adminCookie, wait: 2500, clickSelector: "[data-node]" },
  { url: "/packs", out: `${OUT}/screenshot-packs.png`, cookie: adminCookie },
  { url: "/skills", out: `${OUT}/screenshot-skills.png`, cookie: adminCookie },
  { url: "/runs", out: `${OUT}/screenshot-runs.png`, cookie: adminCookie },
  { url: "/tickets", out: `${OUT}/screenshot-mobile.png`, cookie: agentCookie, width: 390, height: 844 },
];

const browser = await puppeteer.launch({ executablePath, headless: "shell" });
try {
  for (const job of jobs) {
    const page = await browser.newPage();
    // Pin next-themes' persisted choice before any app script runs so no
    // theme flash reaches the shot (the stored value is the theme NAME —
    // ThemeProvider maps "light" to the .servo-light class).
    await page.evaluateOnNewDocument((theme) => {
      try {
        localStorage.setItem("theme", theme);
      } catch {
        /* storage unavailable — the app default (light) applies */
      }
    }, THEME);
    await page.setViewport({
      width: job.width ?? 1440,
      height: job.height ?? 900,
      deviceScaleFactor: 2,
    });
    await page.setCookie(
      ...job.cookie.split(";").map((pair) => {
        const [name, ...rest] = pair.split("=");
        return { name: name.trim(), value: rest.join("="), url: base };
      }),
    );
    await page.goto(`${base}${job.url}`, { waitUntil: "networkidle0", timeout: 45000 });
    if (job.click) {
      await new Promise((r) => setTimeout(r, 1500));
      const handle = await page.evaluateHandle((text) => {
        return [...document.querySelectorAll("button, [role='tab'], a")].find(
          (candidate) => candidate.textContent.trim() === text,
        );
      }, job.click);
      const element = handle.asElement();
      if (element) await element.click();
    }
    if (job.clickSelector) {
      await new Promise((r) => setTimeout(r, 1200));
      const nodes = await page.$$(job.clickSelector);
      // The first document node: a selected node opens the side panel, which
      // is the point of the graph shot.
      if (nodes[0]) await nodes[0].click();
    }
    await new Promise((r) => setTimeout(r, job.wait ?? 1200));
    await page.screenshot({ path: job.out });
    console.log(`saved ${job.out}`);
    await page.close();
  }
} finally {
  await browser.close();
}
