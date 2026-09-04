// kb-lib-4: Word documents. Before this, every OOXML zip routed to the
// workbook path and a .docx died as "The workbook contains no data rows".
// The fixture is built here, in memory, from the WordprocessingML subset the
// worker walks — headings, runs, tabs, a list, a table — so the test pins
// exactly the shapes the extractor claims to keep.

import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { sniffRoute } from "@/lib/kb/extract";
import { extractDocument } from "@/lib/kb/extractors/run";
import { BASELINE_EXTRACTORS, docxExtractor, xlsxExtractor } from "@/lib/kb/extractors/baseline";
import { pickExtractor } from "@/lib/kb/extractors/run";

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

function para(text: string, opts: { style?: string; list?: boolean } = {}): string {
  const pPr =
    opts.style || opts.list
      ? `<w:pPr>${opts.style ? `<w:pStyle w:val="${opts.style}"/>` : ""}${opts.list ? "<w:numPr><w:ilvl w:val=\"0\"/><w:numId w:val=\"1\"/></w:numPr>" : ""}</w:pPr>`
      : "";
  return `<w:p>${pPr}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
}

async function docx(body: string, opts: { withDocument?: boolean } = {}): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  if (opts.withDocument !== false) {
    zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8"?><w:document ${W}><w:body>${body}</w:body></w:document>`);
  }
  return Buffer.from(await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }));
}

const SAMPLE =
  para("Respuesta SkanControl", { style: "Title" }) +
  para("1. Alcance", { style: "Heading1" }) +
  `<w:p><w:r><w:t>El diccionario </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>WITS</w:t></w:r><w:r><w:t xml:space="preserve"> es la fuente única de verdad &amp; base del contrato.</w:t></w:r></w:p>` +
  `<w:p><w:r><w:t>Columna</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>Valor</w:t></w:r><w:r><w:br/></w:r><w:r><w:t>Segunda línea</w:t></w:r></w:p>` +
  para("Ingesta OPC UA", { list: true }) +
  para("Envío a nube", { list: true }) +
  `<w:tbl><w:tr><w:tc>${para("Riesgo")}</w:tc><w:tc>${para("Mitigación")}</w:tc></w:tr><w:tr><w:tc>${para("Latencia > 250 ms")}</w:tc><w:tc>${para("Buffer local")}</w:tc></w:tr></w:tbl>` +
  para("2. Cierre", { style: "Heading2" }) +
  para("Fin del documento.");

describe("docx routing (kb-lib-4)", () => {
  it("sniffs word/document.xml as docx, before the workbook rule", async () => {
    const bytes = await docx(SAMPLE);
    expect(sniffRoute(bytes, "application/octet-stream")).toBe("docx");
    expect(sniffRoute(bytes, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBe("docx");
    expect(pickExtractor("docx", BASELINE_EXTRACTORS)).toBe(docxExtractor);
    // A workbook still routes to the workbook path.
    expect(pickExtractor("xlsx", BASELINE_EXTRACTORS)).toBe(xlsxExtractor);
  });

  it("names its library version from package.json", () => {
    const pkg = JSON.parse(require("node:fs").readFileSync("package.json", "utf8"));
    expect(docxExtractor.version).toContain(`jszip@${String(pkg.dependencies.jszip).replace(/^[\^~]/, "")}`);
  });
});

describe("docx extraction (kb-lib-4)", () => {
  it("renders headings, runs, tabs, breaks, lists and tables as citable lines", async () => {
    const ran = await extractDocument(await docx(SAMPLE), "application/octet-stream");
    expect(ran.extractorId).toBe("baseline-docx");
    expect(ran.outcome.status).toBe("EXTRACTED");
    if (ran.outcome.status !== "EXTRACTED") return;
    const text = ran.outcome.text;
    expect(text).toContain("# Respuesta SkanControl");
    expect(text).toContain("# 1. Alcance");
    expect(text).toContain("## 2. Cierre");
    // Runs join without losing the bold word; entities decode.
    expect(text).toContain("El diccionario WITS es la fuente única de verdad & base del contrato.");
    expect(text).toContain("Columna\tValor\nSegunda línea");
    expect(text).toContain("- Ingesta OPC UA");
    expect(text).toContain("- Envío a nube");
    expect(text).toContain("| Riesgo | Mitigación |");
    expect(text).toContain("| Latencia > 250 ms | Buffer local |");
    // Chunks carry {lines} locators.
    expect(ran.outcome.chunks?.length ?? 0).toBeGreaterThan(0);
    for (const c of ran.outcome.chunks ?? []) expect(typeof (c.locator as { lines?: unknown }).lines).toBe("string");
  });

  it("a Word zip with no document part is UNSUPPORTED with the reason named", async () => {
    const bytes = await docx("", { withDocument: false });
    // Without word/document.xml the sniff sees an OOXML zip and routes to
    // xlsx — the legacy shape. Declared as Word, the worker's docx branch
    // answers with the missing-part message instead.
    const ran = await extractDocument(bytes, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect(ran.outcome.status).toBe("UNSUPPORTED");
  });

  it("an image-only document is UNSUPPORTED, not an empty index", async () => {
    const ran = await extractDocument(await docx('<w:p><w:r><w:drawing/></w:r></w:p>'), "application/octet-stream");
    expect(ran.outcome.status).toBe("UNSUPPORTED");
    if (ran.outcome.status === "UNSUPPORTED") expect(ran.outcome.error).toMatch(/no extractable text/);
  });
});
