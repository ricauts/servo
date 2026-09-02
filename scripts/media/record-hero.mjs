// Records HERO-FILM for the landing page: 1600x900, no browser chrome, synthetic
// cursor, one full loop of the desk — request filed, agent works it, human
// approves, answer sent — ending pixel-identical to where it started.
//
//   node scripts/media/record-hero.mjs <ticketId> [out.webm] [baseUrl]
//
// Needs ffmpeg on PATH (puppeteer's screencast spawns it). The repo carries one
// at node_modules/ffmpeg-static; prepend that directory if the system has none.
// Record against a throwaway database with the mock provider and no per-agent
// credentials, or the run will call a real model and cost money.
import { existsSync, realpathSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import puppeteer from "puppeteer-core";
import { loadOptional } from "./_deps.mjs";

// ffmpeg comes from ffmpeg-static when present (guarded: NOT a declared
// dependency), else from the system PATH; only NEITHER is fatal.
const ffmpegStatic = await loadOptional("ffmpeg-static", () => {
  const which = spawnSync("ffmpeg", ["-version"], { encoding: "utf8" });
  return which.status === 0; // system ffmpeg suffices — handled
});
if (ffmpegStatic?.path) {
  process.env.PATH = `${dirname(realpathSync(ffmpegStatic.path))}:${process.env.PATH}`;
}
import { CURSOR } from "./record-cursor.mjs";

const TICKET = process.argv[2];
const OUT = process.argv[3] ?? "hero-film.webm";
const BASE = process.argv[4] ?? "http://localhost:3000";
if (!TICKET) {
  console.error("usage: node scripts/media/record-hero.mjs <ticketId> [out.webm] [baseUrl]");
  process.exit(1);
}

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "/usr/bin/google-chrome",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].find(existsSync);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: "shell" });

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 900, deviceScaleFactor: 1 });
  await page.evaluateOnNewDocument(CURSOR);
  await page.goto(`${BASE}/tickets/${TICKET}`, { waitUntil: "networkidle0" });
  await wait(2500); // hydration, fonts, charts

  const rec = await page.screencast({ path: OUT, speed: 1 });

  await wait(1200);  // 0 — settled. This frame is the poster and the loop point.
  await wait(3300);  // 1 — hold on the header: a request arrived and was filed.

  await page.evaluate(() => window.__smoothScroll(320, 900));
  await wait(1600);  // 2 — the conversation.

  await page.evaluate(() => window.__clickText("Run AI resolver"));
  await wait(2500);  // 3 — the human hands it to the agent.

  await wait(4500);  // 4 — the run streams. Mock finishes fast; hold, never speed up.

  await page.evaluate(() => window.__smoothScroll(-260, 900));
  await wait(1600);  // 5 — the drafted reply.

  await page.evaluate(() => window.__clickText("Approve & send"));
  await wait(3000);  // 6 — the human decision.

  await wait(2500);  // 7 — the draft becomes a sent public comment.

  await page.evaluate(() => window.__scrollTop(0, 1400));
  await wait(2000);  // 8 — back to the start so the loop is invisible.

  await rec.stop();
  console.log("recorded", OUT);
} finally {
  await browser.close();
}
