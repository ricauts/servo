// Builds the kb-07 PDF fixtures from scratch — no PDF library, just valid
// object/xref structure Mozilla's pdf.js (under unpdf) accepts. Run from
// the repo root:
//
//   node tests/fixtures/kb/generate-pdf-fixtures.mjs
//
//   manual.pdf  — 3 pages, each carrying a real text layer (the acceptance
//                  fixture: >= 3 chunks with correct page numbers).
//   scanned.pdf — 3 pages, valid structure, NO text operators (a drawing
//                  only): text-layer-free, must land UNSUPPORTED.
//   corrupt.pdf — a header followed by binary garbage: no objects, no xref;
//                  must land FAILED, never a silent empty extraction.
import { writeFileSync } from "node:fs";

/** Assemble a PDF from per-page content streams with a correct object
 *  table, xref and trailer — the parser's happy path, not its recovery
 *  mode. Object numbering: 1 catalog, 2 pages tree, then contents/page
 *  pairs per page, then one shared font. */
function buildPdf(pageContents) {
  const total = 2 + pageContents.length * 2 + 1; // + shared font
  const fontNum = total;

  const bodies = new Map(); // object number → body (before "N 0 obj")
  bodies.set(1, `<< /Type /Catalog /Pages 2 0 R >>`);
  const pageNums = pageContents.map((_, i) => 3 + i * 2 + 1);
  bodies.set(
    2,
    `<< /Type /Pages /Kids [${pageNums.map((n) => `${n} 0 R`).join(" ")}] /Count ${pageContents.length} >>`,
  );
  pageContents.forEach((stream, i) => {
    const contentsNum = 3 + i * 2;
    const pageNum = contentsNum + 1;
    bodies.set(contentsNum, `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    bodies.set(
      pageNum,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentsNum} 0 R ` +
        `/Resources << /Font << /F1 ${fontNum} 0 R >> >> >>`,
    );
  });
  bodies.set(fontNum, `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`);

  let out = "%PDF-1.4\n";
  const offsets = new Map();
  for (let n = 1; n <= total; n++) {
    offsets.set(n, out.length);
    out += `${n} 0 obj\n${bodies.get(n)}\nendobj\n`;
  }
  const xrefAt = out.length;
  out += `xref\n0 ${total + 1}\n0000000000 65535 f \n`;
  for (let n = 1; n <= total; n++) {
    out += `${String(offsets.get(n)).padStart(10, "0")} 00000 n \n`;
  }
  out += `trailer\n<< /Size ${total + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

const textPage = (lines) =>
  "BT\n/F1 12 Tf\n72 720 Td\n14 TL\n" +
  lines.map((l) => `(${l}) Tj T*`).join("\n") +
  "\nET";

const manual = buildPdf([
  textPage([
    "Servo field manual - page one.",
    "The spindle inventory baseline is reconciled weekly.",
    "Reference code INV-2024-113 denotes the Q3 stock take.",
  ]),
  textPage([
    "Servo field manual - page two.",
    "Calibration intervals: motors every 90 days, encoders every 30.",
    "Escalate any drift beyond 0.02 mm to the desk.",
  ]),
  textPage([
    "Servo field manual - page three.",
    "Warranty claims must cite the serial number and the fault code.",
    "Codes F-01 through F-09 are covered; F-10 and above are not.",
  ]),
]);
writeFileSync(new URL("./manual.pdf", import.meta.url), manual);

// A drawing only — valid content, zero text operators.
const drawingPage = "1 0 0 rg\n100 600 300 100 re\nf\n0.5 w\n72 72 m\n540 72 l\nS\n";
const scanned = buildPdf([drawingPage, drawingPage, drawingPage]);
writeFileSync(new URL("./scanned.pdf", import.meta.url), scanned);

// Header + garbage: no recoverable structure at all.
const garbage = Buffer.concat([
  Buffer.from("%PDF-1.4\n", "latin1"),
  Buffer.alloc(4096, 0xde),
  Buffer.from("\ntrailer junk no xref no objects %%EOF", "latin1"),
]);
writeFileSync(new URL("./corrupt.pdf", import.meta.url), garbage);

console.log("wrote manual.pdf, scanned.pdf, corrupt.pdf");
