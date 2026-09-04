// Builds the README's before/after figure from the screenshots an agent
// attached to a ticket: crops both to the region that changed, labels them,
// and stacks them into one crisp PNG.
//
// Usage: node scripts/media/make-before-after.mjs <ticketUrl> <outfile
import { writeFileSync } from "node:fs";
import { loadOptional } from "./_deps.mjs";

const sharp = await loadOptional("sharp");

const [ticketUrl, outfile] = process.argv.slice(2);
if (!ticketUrl || !outfile) {
  console.error("Usage: node scripts/media/make-before-after.mjs <ticketUrl> <outfile>");
  process.exit(1);
}
const origin = new URL(ticketUrl).origin;
const ticketId = ticketUrl.split("/tickets/")[1];

const WIDTH = 1200;
const BAR = 58;
const GAP = 20;
// The light frame the README uses (servo_design_system light tokens):
// page surface, white label bars, graphite ink, servo-blue for the fix.
const BG = { r: 245, g: 247, b: 251, alpha: 1 };
const BAR_BG = "#FFFFFF";
const LINE = "#DDE1EA";
const INK = "#0D0F14";
const MUTED = "#5B6577";

const { ticket } = await (await fetch(`${origin}/api/tickets/${ticketId}`)).json();
const attachments = ticket?.attachments ?? [];
const before = attachments.find((a) => /before/i.test(a.caption));
const after = attachments.find((a) => /after/i.test(a.caption));
if (!before || !after) throw new Error("ticket has no before/after attachments");

async function panel(id, kind, label, colour) {
  const buf = Buffer.from(await (await fetch(`${origin}/api/attachments/${id}`)).arrayBuffer());
  const meta = await sharp(buf).metadata();
  const crop = await sharp(buf)
    .extract({
      left: Math.round(meta.width * 0.55),
      top: 0,
      width: Math.round(meta.width * 0.43),
      height: Math.round(meta.height * 0.3),
    })
    .resize({ width: WIDTH })
    .toBuffer();
  const { height } = await sharp(crop).metadata();
  const bar = Buffer.from(
    `<svg width="${WIDTH}" height="${BAR}" xmlns="http://www.w3.org/2000/svg">
       <rect width="100%" height="100%" fill="${BAR_BG}"/>
       <rect y="${BAR - 1}" width="100%" height="1" fill="${LINE}"/>
       <circle cx="30" cy="29" r="6" fill="${colour}"/>
       <text x="48" y="36" font-family="Chivo,Helvetica,Arial,sans-serif" font-size="22" font-weight="700" fill="${INK}">${kind}</text>
       <text x="${kind === "BEFORE" ? 148 : 128}" y="36" font-family="Chivo,Helvetica,Arial,sans-serif" font-size="20" fill="${MUTED}">${label}</text>
     </svg>`,
  );
  return {
    image: await sharp({
      create: { width: WIDTH, height: height + BAR, channels: 4, background: BG },
    })
      .composite([
        { input: bar, top: 0, left: 0 },
        { input: crop, top: BAR, left: 0 },
      ])
      .png()
      .toBuffer(),
    height: height + BAR,
  };
}

const top = await panel(before.id, "BEFORE", "label unreadable — 2.4:1 contrast", "#9E332A");
const bottom = await panel(after.id, "AFTER", "fixed by the agent — 9.4:1, WCAG AA", "#2F44C9");

const out = await sharp({
  create: {
    width: WIDTH,
    height: top.height + GAP + bottom.height,
    channels: 4,
    background: BG,
  },
})
  .composite([
    { input: top.image, top: 0, left: 0 },
    { input: bottom.image, top: top.height + GAP, left: 0 },
  ])
  .png({ compressionLevel: 9 })
  .toBuffer();

writeFileSync(outfile, out);
console.log(`saved ${outfile} (${Math.round(out.length / 1024)} KB)`);
