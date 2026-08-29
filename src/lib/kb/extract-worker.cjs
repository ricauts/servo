// The forked extraction worker (spec kb-05). Plain CommonJS on purpose: the
// parent forks it directly — no build step, no bundler, identical in dev,
// CI, tests and the container. The worker only ever sees the file's BYTES
// and its content type — never a database handle.
//
// Division of labour with the typed side: this process owns PARSING (the
// part that must stay off the request path, under the fork's caps) and
// sends normalized shapes over IPC; the locator math and chunk windowing
// live in src/lib/kb/extract-xlsx.ts and extract-pdf.ts (kb-06/kb-07),
// imported by the parent.
//
// XML external entities are disabled: xlsx is a zip full of XML, and a
// workbook carrying a DOCTYPE/external-entity declaration is refused by the
// parent BEFORE this process is even forked (defense in depth — the parser
// below must also be kept entity-free; exceljs uses sax with no external
// entity resolution).

process.on("message", (msg) => {
  extract(Buffer.from(msg.bytes), msg.contentType)
    .then((result) => {
      if (process.send) process.send({ ok: true, ...result });
    })
    .catch((err) => {
      if (process.send) {
        process.send({ ok: false, error: err && err.message ? err.message : String(err) });
      }
    })
    .finally(() => {
      // One job per process: the parent forks fresh for each document.
      process.disconnect();
    });
});

/** Dispatch on content type. Unknown types land UNSUPPORTED with the type
 *  named — never a silent empty extraction. */
async function extract(bytes, contentType) {
  const ct = contentType || "";
  if (ct === "text/markdown" || ct === "text/plain" || ct === "application/markdown") {
    return { kind: "text", text: bytes.toString("utf8"), status: "EXTRACTED" };
  }
  if (ct === "application/pdf") {
    return { text: "", status: "UNSUPPORTED", error: "PDF extraction arrives with kb-07." };
  }
  if (isXlsxFamily(ct)) return extractSpreadsheet(bytes);
  if (ct.indexOf("ms-excel") !== -1 || ct.indexOf("excel") !== -1 || ct.indexOf("sheet") !== -1) {
    // exceljs reads the Office Open XML format only: the legacy binary BIFF
    // .xls cannot be parsed here, and pretending otherwise would index a
    // file the desk can actually read.
    return {
      text: "",
      status: "UNSUPPORTED",
      error: "Legacy .xls is not supported — save the workbook as .xlsx and re-upload.",
    };
  }
  return { text: "", status: "UNSUPPORTED", error: "No extractor for " + contentType + " yet." };
}

/** The xlsx family: the Office Open XML workbook types (extension .xlsx /
 *  .xlsm), however the uploader's form labels them. */
function isXlsxFamily(ct) {
  return ct.indexOf("spreadsheetml") !== -1 || ct.indexOf("xlsx") !== -1;
}

/** Parse a workbook and normalize each sheet to the shape
 *  extract-xlsx.ts windows: used region, header row, data rows as text. */
async function extractSpreadsheet(bytes) {
  const ExcelJS = require("exceljs");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes);

  const MAX_TOTAL_CELLS = 250000;
  const sheets = [];
  let totalCells = 0;

  workbook.eachSheet((ws) => {
    // A merge's value lives at its anchor; exceljs resolves a covered cell
    // to the anchor's value, which would repeat a banner once per covered
    // cell. Blank the covered coordinates so each merge reports exactly
    // once and the A1 ranges map to what the cells THEMSELVES hold.
    const covered = new Set();
    for (const merge of ws.model.merges || []) {
      const [from, to] = String(merge).split(":");
      const a = parseA1(from);
      const b = parseA1(to || from);
      for (let r = a.row; r <= b.row; r++) {
        for (let c = a.col; c <= b.col; c++) {
          if (r !== a.row || c !== a.col) covered.add(r + ":" + c);
        }
      }
    }
    const raw = [];
    for (let r = 1; r <= ws.rowCount; r++) {
      // row.values is 1-indexed (index 0 is always empty); cells the row
      // does not reach are simply absent — shorter arrays, padded never.
      const values = (ws.getRow(r).values || []).slice(1).map((v, i) =>
        covered.has(r + ":" + (i + 1)) ? "" : cellText(v),
      );
      raw.push({ r, values });
    }
    const used = raw.filter((row) => row.values.some((v) => v !== ""));
    if (used.length === 0) return; // styled-but-empty sheets are skipped

    const firstRow = used[0].r;
    const lastRow = used[used.length - 1].r;
    let firstCol = Infinity;
    let lastCol = 1;
    for (const row of used) {
      row.values.forEach((v, i) => {
        if (v !== "") {
          firstCol = Math.min(firstCol, i + 1);
          lastCol = Math.max(lastCol, i + 1);
        }
      });
    }
    // Contiguous used region: header is its first row; inner empty rows stay
    // (their absence would falsify the A1 ranges) but never lead or trail.
    const region = raw.filter((row) => row.r >= firstRow && row.r <= lastRow);
    const headerRow = region[0].values;
    const dataRows = region.slice(1).map((row) => ({ r: row.r, values: row.values }));
    totalCells += region.length * (lastCol - firstCol + 1);
    if (totalCells > MAX_TOTAL_CELLS) {
      throw new Error("Workbook exceeds " + MAX_TOTAL_CELLS + " cells; extraction refused.");
    }
    sheets.push({ name: ws.name, firstRow, firstCol, lastCol, headerRow, rows: dataRows });
  });

  return { kind: "sheets", sheets };
}

/** "B4" → { row: 4, col: 2 } — the inverse of the A1 math in
 *  extract-xlsx.ts, duplicated here because the forked worker cannot import
 *  the typed module. */
function parseA1(ref) {
  const m = /^([A-Z]+)([0-9]+)$/.exec(String(ref).toUpperCase());
  if (!m) return { row: 0, col: 0 };
  let col = 0;
  for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { row: Number(m[2]), col };
}

/** exceljs value shapes → display text: rich text runs join, formulas report
 *  their cached result, a hyperlink reports its label, a Date its ISO day.
 *  Merged cells hold their value at the anchor only — the covered cells read
 *  empty, which is exactly how the range math sees them. */
function cellText(value) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    if (Array.isArray(value.richText)) return value.richText.map((t) => t.text).join("");
    if (value.formula !== undefined || value.sharedFormula !== undefined) {
      return cellText(value.result);
    }
    if (value.text !== undefined) return String(value.text);
    if (value.error !== undefined) return String(value.error);
    if (value.hyperlink !== undefined) return String(value.text ?? value.hyperlink);
    return "";
  }
  return String(value);
}
