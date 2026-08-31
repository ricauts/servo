// Spreadsheet chunking (spec kb-06). Pure: a normalized sheet matrix in,
// chunks with A1-notation {sheet, range} locators out — no exceljs here, no
// database, no provider. The forked worker (kb-05) parses the workbook and
// normalizes it to these shapes; THIS module owns the math citations depend
// on, so it is the part unit tests pin cell-for-cell.
//
// Chunk shape: each sheet's contiguous used region is cut into row windows.
// The header row (the region's first row) is repeated into EVERY chunk of its
// region, so a mid-sheet chunk still says what its columns mean — a property
// kb-08's rarity weighting relies on (it counts DISTINCT DOCUMENTS, never
// occurrences, precisely because the header repeats). The locator's range
// covers the chunk's DATA rows only: the header line inside the text is
// context repeated from row `firstRow`, not part of the window the locator
// addresses.

/** Resource caps for the chunker. The workbook-level caps live in the worker,
 * where the parse happens; these bound what one chunk may carry. */
export const SPREADSHEET_LIMITS = {
  /** Max cells (header + data rows) in one chunk's rendered text. */
  chunkCellCap: 200,
  /** Max data rows per window, even on narrow sheets. */
  maxRowsPerChunk: 30,
  /** Max cells across ALL sheets — the worker refuses beyond this, the
   * chunker double-checks so the cap holds even if only the pure path runs. */
  maxTotalCells: 250_000,
} as const;

/** A sheet normalized by the worker: used region, the header row's rendered
 * cells, and the data rows inside it. `r` is the 1-based worksheet row. */
export interface SheetRows {
  name: string;
  firstRow: number;
  firstCol: number;
  lastCol: number;
  headerRow: string[];
  rows: { r: number; values: string[] }[];
}

export interface SheetChunk {
  text: string;
  locator: { sheet: string; range: string };
}

/** 1-based column index → A1 letters (1 → "A", 27 → "AA"). */
export function colToA1(col: number): string {
  let n = col;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out || "A";
}

/** A1 range over the region's full column span for rows r1..r2 (inclusive). */
export function a1Range(sheet: SheetRows, r1: number, r2: number): string {
  const c1 = colToA1(sheet.firstCol);
  const c2 = colToA1(Math.max(sheet.firstCol, sheet.lastCol));
  return r1 === r2 ? `${c1}${r1}` : `${c1}${r1}:${c2}${r2}`;
}

function renderRow(cells: string[]): string {
  return `| ${cells.map((c) => (c === "" ? " " : c)).join(" | ")} |`;
}

/**
 * Cut sheets into row-window chunks. Sheets with no data rows are skipped
 * (their header alone carries nothing retrievable); a workbook where every
 * sheet is empty lands UNSUPPORTED rather than EXTRACTED-with-nothing, so an
 * empty file can never look like an indexed one.
 */
export function chunkSpreadsheetSheets(
  sheets: SheetRows[],
): { status: "EXTRACTED"; chunks: SheetChunk[] } | { status: "UNSUPPORTED"; error: string } {
  let totalCells = 0;
  for (const s of sheets) {
    totalCells += s.headerRow.length + s.rows.length * Math.max(1, s.lastCol - s.firstCol + 1);
    if (totalCells > SPREADSHEET_LIMITS.maxTotalCells) {
      return {
        status: "UNSUPPORTED",
        error: `Workbook exceeds ${SPREADSHEET_LIMITS.maxTotalCells} cells; extraction refused.`,
      };
    }
  }

  const chunks: SheetChunk[] = [];
  for (const sheet of sheets) {
    if (sheet.rows.length === 0) continue;
    const cols = Math.max(1, sheet.lastCol - sheet.firstCol + 1);
    const rowsPerWindow = Math.max(
      1,
      Math.min(
        SPREADSHEET_LIMITS.maxRowsPerChunk,
        Math.floor(SPREADSHEET_LIMITS.chunkCellCap / (cols + 1)), // +1: header rides every chunk
      ),
    );
    for (let start = 0; start < sheet.rows.length; start += rowsPerWindow) {
      const window = sheet.rows.slice(start, start + rowsPerWindow);
      const first = window[0].r;
      const last = window[window.length - 1].r;
      const lines = [
        `### Sheet: ${sheet.name}`,
        renderRow(sheet.headerRow),
        "|".concat(" --- |".repeat(sheet.headerRow.length)),
        ...window.map((row) => renderRow(row.values)),
      ];
      chunks.push({ text: lines.join("\n"), locator: { sheet: sheet.name, range: a1Range(sheet, first, last) } });
    }
  }
  if (chunks.length === 0) {
    return { status: "UNSUPPORTED", error: "The workbook contains no data rows." };
  }
  return { status: "EXTRACTED", chunks };
}
