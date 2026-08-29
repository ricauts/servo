// Builds tests/fixtures/kb/pricing.xlsx — the kb-06 acceptance workbook:
// two sheets, headers on row 1, a merged cell inside the data region, and a
// row count that forces the Hardware sheet to window into TWO chunks (40
// data rows at 4 columns → windows of 30). Run from the repo root:
//
//   node tests/fixtures/kb/generate-pricing-xlsx.mjs
import { writeFileSync } from "node:fs";
import ExcelJS from "exceljs";

const wb = new ExcelJS.Workbook();

const hw = wb.addWorksheet("Hardware");
hw.addRow(["SKU", "Item", "Unit price", "Stock"]);
for (let i = 1; i <= 40; i++) {
  hw.addRow([
    `HW-${String(i).padStart(3, "0")}`,
    `Spindle motor ${i}`,
    i % 3 === 0 ? 41.5 : 12.99,
    i * 2,
  ]);
}
// The merged cell (acceptance): D2:D3 reports as one — value read at the
// anchor D2, D3 itself empty to the range math.
hw.getCell("D2").value = "bulk pack";
hw.mergeCells("D2:D3");

const sv = wb.addWorksheet("Services");
sv.addRow(["Code", "Service", "Rate", "Unit"]);
for (let i = 1; i <= 8; i++) {
  sv.addRow([`SV-${String(i).padStart(3, "0")}`, `On-site calibration ${i}`, 90 + i, "hour"]);
}

const bytes = await wb.xlsx.writeBuffer();
writeFileSync(new URL("./pricing.xlsx", import.meta.url), Buffer.from(bytes));
console.log("wrote tests/fixtures/kb/pricing.xlsx");
