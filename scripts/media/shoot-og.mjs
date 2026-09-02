// Renders servoai-site/og-card.html to assets/og-card.png at exactly 1200x630.
//
//   node scripts/media/shoot-og.mjs [siteDir]
//
// Waits on document.fonts.ready: Chivo and IBM Plex Mono arrive from the Google
// CDN, and shooting before they land bakes the fallback metrics into the card.
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import puppeteer from "puppeteer-core";

const SITE = process.argv[2];
if (!SITE) {
  console.error("usage: node scripts/media/shoot-og.mjs <servoai-site-directory>");
  console.error("The site directory is REQUIRED and has no default: the loop may never");
  console.error("commit to the servoai-site repository, so it cannot hold a path into it.");
  process.exit(1);
}
const SRC = resolve(SITE, "og-card.html");
const OUT = resolve(SITE, "assets/og-card.png");

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "/usr/bin/google-chrome",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].find(existsSync);

const browser = await puppeteer.launch({ executablePath: CHROME, headless: "shell" });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(SRC).href, { waitUntil: "networkidle0" });
  await page.evaluate(() => document.fonts.ready);
  await new Promise((r) => setTimeout(r, 400));
  await page.screenshot({ path: OUT, type: "png" });
  console.log("wrote", OUT);
} finally {
  await browser.close();
}
