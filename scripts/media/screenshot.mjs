// Screenshot helper for docs/assets — drives the system Chrome via puppeteer-core.
// Usage: node scripts/screenshot.mjs <url> <outfile> [--dark] [--width=1440]
//        [--height=900] [--click="Tab label"]
// --click clicks the first element whose trimmed text matches, before shooting
// (used to capture a specific tab).
import puppeteer from "puppeteer-core";

const CHROME_PATHS = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "/usr/bin/google-chrome",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

const [url, outfile, ...flags] = process.argv.slice(2);
if (!url || !outfile) {
  console.error("Usage: node scripts/screenshot.mjs <url> <outfile> [--dark] [--width=N] [--height=N]");
  process.exit(1);
}
const dark = flags.includes("--dark");
const width = Number(flags.find((f) => f.startsWith("--width="))?.split("=")[1] ?? 1440);
const height = Number(flags.find((f) => f.startsWith("--height="))?.split("=")[1] ?? 900);

const { existsSync } = await import("node:fs");
const executablePath = CHROME_PATHS.find((p) => existsSync(p));
if (!executablePath) {
  console.error("Chrome not found in known locations.");
  process.exit(1);
}

const browser = await puppeteer.launch({ executablePath, headless: "shell" });
try {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 2 });
  if (dark) {
    // next-themes reads this key before first paint, so the page renders dark from the start
    await page.evaluateOnNewDocument(() => localStorage.setItem("theme", "dark"));
  }
  await page.goto(url, { waitUntil: "networkidle0", timeout: 30000 });
  const clickText = flags.find((f) => f.startsWith("--click="))?.slice(8);
  if (clickText) {
    // Wait for hydration before clicking, then dispatch a real mouse event so
    // Radix/React handlers fire.
    await new Promise((r) => setTimeout(r, 1200));
    const handle = await page.evaluateHandle((text) => {
      return [...document.querySelectorAll("button, [role='tab'], a")].find(
        (candidate) => candidate.textContent.trim() === text,
      );
    }, clickText);
    const element = handle.asElement();
    if (!element) throw new Error(`--click target not found: ${clickText}`);
    await element.click();
  }
  await new Promise((r) => setTimeout(r, 900));
  await page.screenshot({ path: outfile });
  console.log(`saved ${outfile} (${width}x${height}${dark ? ", dark" : ""})`);
} finally {
  await browser.close();
}
