// Responsive audit: renders every desk route at standard viewport widths and
// flags horizontal overflow (document wider than the viewport — the classic
// broken-layout symptom). Optionally saves screenshots of failures.
// Usage: node scripts/dev/responsive-audit.mjs [baseUrl] [shotDir]
//
// Chrome: puppeteer-core spawns a binary verbatim and downloads nothing, so the
// path is taken from SERVO_CHROME or PUPPETEER_EXECUTABLE_PATH when set, else
// from the cross-platform candidate list below; none found is a clear refusal,
// not a `spawn ENOENT` (spec question 136).
import fs from "node:fs";
import puppeteer from "puppeteer-core";

const CHROME_CANDIDATES = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

function resolveChrome() {
  for (const name of ["SERVO_CHROME", "PUPPETEER_EXECUTABLE_PATH"]) {
    const candidate = process.env[name];
    if (!candidate) continue;
    if (fs.existsSync(candidate)) return candidate;
    // An explicit path that does not exist is a mistake to report, not to paper over.
    console.error(`${name} is set to "${candidate}", but nothing exists at that path.`);
    process.exit(1);
  }
  const found = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
  if (found) return found;
  console.error(
    [
      "Chrome not found. Set SERVO_CHROME (or PUPPETEER_EXECUTABLE_PATH) to a Chrome or Chromium binary.",
      "Locations checked:",
      ...CHROME_CANDIDATES.map((p) => `  ${p}`),
    ].join("\n"),
  );
  process.exit(1);
}

const CHROME = resolveChrome();
const base = process.argv[2] ?? "http://localhost:3000";
const shotDir = process.argv[3] ?? "";

const VIEWPORTS = [
  { name: "android", width: 360, height: 800 },
  { name: "iphone", width: 375, height: 812 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "laptop", width: 1280, height: 800 },
  { name: "desktop", width: 1440, height: 900 },
];
// Every desk route. Sections within a page are ?section= params, not routes,
// so this list is the whole navigable surface.
const PAGES = [
  "/dashboard",
  "/tickets",
  "/tickets/new",
  "/approvals",
  "/groups",
  "/agents",
  "/runs",
  "/skills",
  "/kb",
  "/kb/graph",
  "/kb/sources",
  "/packs",
  "/integrations",
  "/settings",
];

const browser = await puppeteer.launch({ executablePath: CHROME, headless: "shell" });
let failures = 0;
try {
  const page = await browser.newPage();
  for (const path of PAGES) {
    for (const vp of VIEWPORTS) {
      await page.setViewport({ width: vp.width, height: vp.height, deviceScaleFactor: 1 });
      await page.goto(`${base}${path}`, { waitUntil: "networkidle0", timeout: 30000 });
      await new Promise((r) => setTimeout(r, 400));
      const overflow = await page.evaluate(() => {
        const doc = document.documentElement;
        return Math.max(doc.scrollWidth - doc.clientWidth, document.body.scrollWidth - doc.clientWidth);
      });
      const ok = overflow <= 1; // sub-pixel rounding tolerance
      if (!ok) {
        failures++;
        if (shotDir) {
          fs.mkdirSync(shotDir, { recursive: true });
          const file = `${shotDir}/overflow${path.replace(/\//g, "-")}-${vp.name}.png`;
          await page.screenshot({ path: file });
        }
      }
      console.log(
        `${ok ? "OK  " : "FAIL"} ${vp.name.padEnd(8)} ${String(vp.width).padStart(4)}px  ${path}${ok ? "" : `  (+${overflow}px overflow)`}`,
      );
    }
  }
} finally {
  await browser.close();
}

console.log(failures === 0 ? "\nAll pages fit at every width." : `\n${failures} page/viewport combinations overflow.`);
process.exit(failures === 0 ? 0 : 1);
