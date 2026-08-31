// Chunking for text/markdown and text/plain documents (spec kb-04). Pure:
// text in, chunks with exact {lines} locators out — a locator must round-trip
// to the precise source lines it came from, which is the property the test
// asserts and the property citations depend on later ("per the manual,
// lines 120-180").
//
// Splitting: headings start a new chunk; runs of blank lines separate
// paragraphs into chunks under a size budget so one giant paragraph does not
// become one giant chunk. xlsx and PDF locators ({sheet, range}, {page})
// arrive with kb-06 and kb-07.

/** Rough target for a text chunk. Headings and blank runs split first. */
const TARGET_CHUNK_CHARS = 1200;
/** Never emit a chunk smaller than this unless the document ended. */
const MIN_CHUNK_CHARS = 80;

export interface Chunked {
  index: number;
  text: string;
  locator: { lines: string };
}

/** Split markdown/plain text into line-accurate chunks. */
export function chunkMarkdown(text: string): Chunked[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const chunks: Chunked[] = [];
  let buffer: string[] = [];
  let startLine = 1; // 1-based, inclusive
  let inFence = false;

  const flush = (endLine: number) => {
    const body = buffer.join("\n").trim();
    if (body) {
      chunks.push({
        index: chunks.length,
        text: body,
        locator: { lines: startLine === endLine ? `${startLine}` : `${startLine}-${endLine}` },
      });
    }
    buffer = [];
  };

  lines.forEach((line, i) => {
    const lineNo = i + 1;
    if (/^\s*```/.test(line)) inFence = !inFence;

    if (!inFence && /^#{1,6}\s/.test(line)) {
      // A heading starts a new chunk; the heading belongs to what follows.
      flush(lineNo - 1);
      startLine = lineNo;
      buffer.push(line);
      return;
    }
    if (buffer.length === 0) startLine = lineNo;
    buffer.push(line);

    const joined = buffer.join("\n");
    if (!inFence && line.trim() === "" && joined.trim().length >= MIN_CHUNK_CHARS && joined.length >= TARGET_CHUNK_CHARS) {
      flush(lineNo);
      return;
    }
    if (joined.length >= TARGET_CHUNK_CHARS * 2 && !inFence && line.trim() === "") {
      flush(lineNo);
    }
  });
  flush(lines.length);
  return chunks;
}
