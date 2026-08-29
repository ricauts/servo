// The forked extraction worker (spec kb-05). Plain CommonJS on purpose: the
// parent forks it directly — no build step, no bundler, identical in dev,
// CI, tests and the container. The worker only ever sees the file's BYTES
// and its content type — never a database handle.
//
// XML external entities are disabled: xlsx is a zip full of XML, and a
// workbook carrying a DOCTYPE/external-entity declaration is refused by the
// parent BEFORE this process is even forked (defense in depth — the
// extractors configured in kb-06/kb-07 must also set their parsers to
// no-entity mode).

process.on("message", (msg) => {
  try {
    const buffer = Buffer.from(msg.bytes);
    const result = extractText(buffer, msg.contentType);
    if (process.send) process.send({ ok: true, ...result });
  } catch (err) {
    if (process.send) process.send({ ok: false, error: err && err.message ? err.message : String(err) });
  }
  // One job per process: the parent forks fresh for each document.
  process.disconnect();
});

/** Pure text extraction for the formats kb-04 covers. xlsx/PDF parsers
 *  arrive with kb-06/kb-07 — the worker's hardening already applies. */
function extractText(bytes, contentType) {
  if (contentType === "text/markdown" || contentType === "text/plain" || contentType === "application/markdown") {
    return { text: bytes.toString("utf8"), status: "EXTRACTED" };
  }
  if (contentType === "application/pdf") {
    return { text: "", status: "UNSUPPORTED", error: "PDF extraction arrives with kb-07." };
  }
  if (contentType.indexOf("sheet") !== -1 || contentType.indexOf("excel") !== -1) {
    return { text: "", status: "UNSUPPORTED", error: "Spreadsheet extraction arrives with kb-06." };
  }
  return { text: "", status: "UNSUPPORTED", error: "No extractor for " + contentType + " yet." };
}
