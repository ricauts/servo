// Responsive audit: renders every page at standard viewport widths and flags
// horizontal overflow (document wider than the viewport — the classic broken
// -layout symptom). Optionally saves screenshots of failures.
// Usage: node scripts/responsive-audit.mjs [baseUrl] [shotDir]
import fs from "fs";
import puppeteer from "puppeteer-core";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const base = process.argv[2] ?? "http://localhost:3000";
const shotDir = process.argv[3] ?? "";

const VIEWPORTS = [
  { name: "android", width: 360, height: 800 },
  { name: "iphone", width: 375, height: 812 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "laptop", width: 1280, height: 800 },
  { name: "desktop", width: 1440, height: 900 },
];
const PAGES = [
  "/dashboard",
  "/tickets",
  "/approvals",
  "/groups",
  "/agents",
  "/settings",
  "/tickets/new",
];

const browser = await puppeteer.launch({ executablePath: CHROME, headless: "shell" });
const page = await browser.newPage();
let failures = 0;

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
    console.log(`${ok ? "OK  " : "FAIL"} ${vp.name.padEnd(8)} ${String(vp.width).padStart(4)}px  ${path}${ok ? "" : `  (+${overflow}px overflow)`}`);
  }
}

await browser.close();
console.log(failures === 0 ? "\nAll pages fit at every width." : `\n${failures} page/viewport combinations overflow.`);
process.exit(failures === 0 ? 0 : 1);
