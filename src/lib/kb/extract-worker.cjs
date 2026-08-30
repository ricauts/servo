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
  // ext-04: the facts route carries CHUNKS and a ruleset instead of bytes —
  // the typed-fact pass runs here, in the same forked worker under the same
  // caps, rather than on the request path. It is dispatched before the byte
  // routes because its message has no `bytes` to buffer.
  const job =
    msg && msg.route === "facts"
      ? extractChunkFacts(msg.chunks || [], msg.ruleset)
      : // dcl-01: the parent sends the SNIFFED route (xlsx|pdf|text) or the
        // declared type when the sniff had nothing to say — routing on BYTES,
        // never on the client-declared multipart Content-Type.
        extract(Buffer.from(msg.bytes), msg.route || msg.contentType);
  job
    .then((result) => reply({ ok: true, ...result }))
    .catch((err) => reply({ ok: false, error: err && err.message ? err.message : String(err) }));
});

/**
 * Send one reply, then close the channel — IN THAT ORDER, and not before.
 *
 * process.send() is ASYNCHRONOUS: it hands the payload to the IPC channel
 * and returns. Disconnecting in a .finally() beside it therefore tears the
 * channel down while a large payload is still draining, and the parent
 * sees a clean `exit 0` with no message — a silent, size-dependent loss.
 * The byte routes only ever hit that at megabyte replies; ext-04's facts
 * route reaches it at an ordinary multi-hundred-chunk document, which is
 * how it was found. The disconnect therefore waits for send's completion
 * callback, and falls back to a timer if the callback never fires so a
 * wedged channel still ends the process rather than hanging it.
 */
function reply(payload) {
  if (!process.send) return;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    // One job per process: the parent forks fresh for each document.
    try {
      process.disconnect();
    } catch {
      /* the parent may already have killed the channel */
    }
  };
  const guard = setTimeout(close, 30_000);
  guard.unref?.();
  process.send(payload, () => {
    clearTimeout(guard);
    close();
  });
}

/**
 * The typed-fact pass (spec ext-04), run in this process rather than the
 * parent's. One job carries every chunk of one document, so a document
 * costs one fork — the same "one job per process" rule the byte routes
 * follow.
 *
 * The extractor itself is the TYPED module ext-02/ext-03 shipped
 * (src/lib/kb/facts/), imported here rather than reimplemented: two copies
 * of a parser drift, and the golden fixtures only pin one of them. That is
 * why the parent launches THIS route with the tsx loader in execArgv
 * (src/lib/kb/extract.ts) — the byte routes are launched exactly as before
 * and never pay for it. A worker started without the loader cannot serve
 * this route, which is why the parent owns the flag.
 */
async function extractChunkFacts(chunks, ruleset) {
  const { extractFacts } = await import("./facts/index.ts");
  const results = chunks.map((chunk) => ({
    chunkId: chunk.id,
    // The pass is PURE and bounded by the ruleset's own step budget
    // (ext-02); the fork's heap and wall-clock caps bound the rest.
    facts: extractFacts(String(chunk.text || ""), ruleset).facts,
  }));
  return { kind: "facts", results, status: "EXTRACTED" };
}

/** Dispatch on the route. Unknown types land UNSUPPORTED with the type
 *  named — never a silent empty extraction. The sniffed routes ("xlsx",
 *  "pdf", "text") sit beside the legacy declared types so both callers
 *  dispatch identically. */
async function extract(bytes, contentType) {
  const ct = contentType || "";
  if (ct === "text" || ct === "text/markdown" || ct === "text/plain" || ct === "application/markdown") {
    return { kind: "text", text: bytes.toString("utf8"), status: "EXTRACTED" };
  }
  if (ct === "pdf" || ct === "application/pdf") {
    return extractPdf(bytes);
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
 *  .xlsm), however the uploader's form labels them, plus the sniffed
 *  route the parent derived from the bytes themselves. */
function isXlsxFamily(ct) {
  return ct === "xlsx" || ct.indexOf("spreadsheetml") !== -1 || ct.indexOf("xlsx") !== -1;
}

/** Extract the text layer of a PDF, page by page. unpdf wraps Mozilla's
 *  pdf.js as pure ESM with zero runtime dependencies — hence the dynamic
 *  import from this CommonJS worker (Node 22 runs it natively, no bundler).
 *  The empty/absent text layer verdict is NOT decided here: the typed
 *  chunker (extract-pdf.ts) owns it, so the scanned-document message lives
 *  in exactly one place. */
async function extractPdf(bytes) {
  const { extractText, getDocumentProxy } = await import("unpdf");
  try {
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { text } = await extractText(pdf, { mergePages: false });
    return { kind: "pages", pages: text };
  } catch (err) {
    throw new Error("PDF could not be parsed: " + (err && err.message ? err.message : String(err)));
  }
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
