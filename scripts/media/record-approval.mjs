// Records APPROVAL-MOMENT for the landing page: 1280x960, framed on one pending
// approval card so the loop closes on a single state change — the exact tool
// input on screen, a human presses Approve, the paused run resumes.
//
//   node scripts/record-approval.mjs [out.webm] [baseUrl]
//
// Record against the demo seed (prisma/demo.db): its pending queue is #1004
// `DROP TABLE employees_backup;` and #1005, both HIGH risk, both English. The
// working database has pending approvals too, but they are not presentable.
// HIGH-risk approvals are admin-only, so the session must be Ana Rodríguez.
//
// Never type in the "Why are you approving or rejecting this action?" field.
// A reason in the film is a reason someone will quote back.
import { existsSync } from "node:fs";
import puppeteer from "puppeteer-core";
import { CURSOR } from "./record-cursor.mjs";

const OUT = process.argv[2] ?? "approval-moment.webm";
const BASE = process.argv[3] ?? "http://localhost:3000";

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
  await page.setViewport({ width: 1280, height: 960, deviceScaleFactor: 1 });
  await page.evaluateOnNewDocument(CURSOR);
  await page.goto(`${BASE}/approvals`, { waitUntil: "networkidle0" });
  await wait(2200);

  // Frame the shot on the DROP TABLE card specifically. It is second in the
  // queue (#1005 was requested more recently), and "Approve" alone would hit
  // the wrong button — everything below is scoped to this card.
  // Frame the shot on the DROP TABLE card specifically. It is second in the
  // queue (#1005 was requested more recently), and "Approve" alone would hit
  // the wrong button — everything below is scoped to this card.
  //
  // Found by walking up from its <pre> to the first ancestor holding exactly
  // one Approve button, rather than by class name: the markup is generated
  // Tailwind and its classes are not a stable contract.
  await page.evaluate(() => {
    const pre = [...document.querySelectorAll("pre")].find((e) =>
      e.textContent.includes("employees_backup"),
    );
    if (!pre) throw new Error("no tool input mentioning employees_backup");
    let card = pre.parentElement;
    while (card) {
      const approves = [...card.querySelectorAll("button")].filter(
        (b) => b.textContent.trim() === "Approve",
      );
      if (approves.length === 1) break;
      if (approves.length > 1) throw new Error("walked past the card boundary");
      card = card.parentElement;
    }
    if (!card) throw new Error("no card wrapping that tool input");
    card.setAttribute("data-shot", "1");
    window.scrollTo(0, Math.max(0, card.getBoundingClientRect().top + scrollY - 24));
  });
  await wait(700);

  const rec = await page.screencast({ path: OUT, speed: 1 });

  await wait(2200); // 0 — header, tool name, pause note and the full JSON input, static. Poster.

  // 1 — the pointer rests on the input. Nothing is clicked; the point is that
  //     the exact argument a human is agreeing to is on screen.
  await page.evaluate(() => {
    const pre = document.querySelector('[data-shot="1"] pre');
    if (!pre) return;
    const r = pre.getBoundingClientRect();
    return window.__moveTo(r.left + r.width / 2, r.top + r.height / 2, 900);
  });
  await wait(1400);

  // 2 — the decision, on this card's own Approve button.
  await page.evaluate(async () => {
    const btn = [...document.querySelectorAll('[data-shot="1"] button')].find(
      (b) => b.textContent.trim() === "Approve",
    );
    if (!btn) throw new Error("no Approve button inside the framed card");
    const r = btn.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    await window.__moveTo(x, y);
    await new Promise((res) => setTimeout(res, 600));
    window.__pulse(x, y);
    btn.click();
  });
  await wait(2600);

  await wait(2800); // 3 — the card resolves and the run resumes.

  await page.evaluate(() => window.__smoothScroll(-40, 700));
  await wait(2300); // 4 — settle back to the beat-0 framing.

  await rec.stop();
  console.log("recorded", OUT);
} finally {
  await browser.close();
}
