import { chunkText, readUpload } from "../src/lib/import/files";

function assert(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) process.exitCode = 1;
}

// --- chunking -------------------------------------------------------------
const paragraphs = Array.from({ length: 60 }, (_, i) => `Paragraph ${i}. ` + "x".repeat(400));
const long = paragraphs.join("\n\n");
const chunks = chunkText(long, 2000);
assert("splits long text", chunks.length > 5, `${chunks.length} chunks`);
assert("every chunk under budget-ish", chunks.every((c) => c.length <= 2600), `max ${Math.max(...chunks.map((c) => c.length))}`);
assert("chunks overlap by a paragraph", chunks[1].startsWith(chunks[0].split("\n\n").pop()!.slice(0, 30)));
assert("short text is one chunk", chunkText("just a line").length === 1);
assert("empty text yields nothing", chunkText("   ").length === 0);

const monster = "y".repeat(9000);
assert("giant single paragraph still splits", chunkText(monster, 2000).length === 5);

// --- file reading ---------------------------------------------------------
const md = new File([new TextEncoder().encode("# Notes\n\nCPL fell 30%.")], "notes.md", { type: "text/markdown" });
const txtDoc = await readUpload(md);
assert("reads markdown", txtDoc.kind === "text" && txtDoc.text.includes("CPL fell 30%"));

const fakePdf = new File([new Uint8Array([37, 80, 68, 70])], "deck.pdf", { type: "application/pdf" });
const pdfDoc = await readUpload(fakePdf);
assert("passes pdf through as base64", pdfDoc.kind === "pdf" && pdfDoc.base64.length > 0, pdfDoc.kind === "pdf" ? pdfDoc.base64 : "");

try {
  await readUpload(new File([new Uint8Array([1, 2])], "slides.pptx", { type: "application/vnd.ms-powerpoint" }));
  assert("rejects unsupported types", false);
} catch (error) {
  assert("rejects unsupported types with a useful message", String(error).includes("export it to PDF"));
}

// A real .docx, built as a minimal OOXML zip so mammoth is genuinely exercised.
import { execSync } from "node:child_process";
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "docx-"));
mkdirSync(join(dir, "_rels"));
mkdirSync(join(dir, "word"));
writeFileSync(join(dir, "[Content_Types].xml"), `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
writeFileSync(join(dir, "_rels/.rels"), `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
writeFileSync(join(dir, "word/document.xml"), `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Retargeting under 14 days converts twice as well.</w:t></w:r></w:p></w:body></w:document>`);
execSync(`cd ${dir} && zip -q -r out.docx '[Content_Types].xml' _rels word`);

const docxFile = new File([readFileSync(join(dir, "out.docx"))], "client-notes.docx");
const docxDoc = await readUpload(docxFile);
assert("reads a real .docx", docxDoc.kind === "text" && docxDoc.text.includes("Retargeting under 14 days"), docxDoc.kind === "text" ? JSON.stringify(docxDoc.text.trim()) : "");
