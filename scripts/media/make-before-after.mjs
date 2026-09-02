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
const BG = { r: 4, g: 23, b: 15, alpha: 1 };

const { ticket } = await (await fetch(`${origin}/api/tickets/${ticketId}`)).json();
const attachments = ticket?.attachments ?? [];
const before = attachments.find((a) => /before/i.test(a.caption));
const after = attachments.find((a) => /after/i.test(a.caption));
if (!before || !after) throw new Error("ticket has no before/after attachments");

async function panel(id, label, colour) {
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
    `<svg width="${WIDTH}" height="${BAR}">
       <rect width="100%" height="100%" fill="#072318"/>
       <text x="24" y="38" font-family="Helvetica,Arial,sans-serif" font-size="26" font-weight="bold" fill="${colour}">${label}</text>
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

const top = await panel(before.id, "BEFORE  ·  label unreadable — 2.4:1 contrast", "#f3a4a4");
const bottom = await panel(after.id, "AFTER  ·  fixed by the agent — 9.4:1, WCAG AA", "#25d97f");

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
