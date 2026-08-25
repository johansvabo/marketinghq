import mammoth from "mammoth";

/**
 * Turns an uploaded file into something the extractor can read. Plain text and
 * Word documents become text here; PDFs are passed through untouched, because
 * Claude reads them natively and any parser we put in front would only throw
 * away the layout that tells it what is a heading and what is a caption.
 */
export type SourceDocument =
  | { kind: "text"; name: string; text: string }
  | { kind: "pdf"; name: string; base64: string };

const TEXT_EXTENSIONS = [".txt", ".md", ".markdown", ".csv", ".tsv", ".json", ".html", ".rtf"];

export const ACCEPTED_EXTENSIONS = [...TEXT_EXTENSIONS, ".docx", ".pdf"];

/** 20 MB is well inside the API's 32 MB request ceiling once base64 is applied. */
export const MAX_FILE_BYTES = 20 * 1024 * 1024;

export async function readUpload(file: File): Promise<SourceDocument> {
  const name = file.name;
  const lower = name.toLowerCase();

  if (file.size > MAX_FILE_BYTES) {
    throw new Error(`${name} is larger than 20 MB. Split it, or paste the relevant part instead.`);
  }

  if (lower.endsWith(".pdf")) {
    const buffer = Buffer.from(await file.arrayBuffer());
    return { kind: "pdf", name, base64: buffer.toString("base64") };
  }

  if (lower.endsWith(".docx")) {
    const buffer = Buffer.from(await file.arrayBuffer());
    const { value } = await mammoth.extractRawText({ buffer });
    return { kind: "text", name, text: value };
  }

  if (TEXT_EXTENSIONS.some((ext) => lower.endsWith(ext)) || file.type.startsWith("text/")) {
    return { kind: "text", name, text: await file.text() };
  }

  throw new Error(
    `${name} is a file type I can't read. Works: ${ACCEPTED_EXTENSIONS.join(", ")}. For a deck, export it to PDF first.`,
  );
}

/**
 * Splits long text on paragraph boundaries. Chunks overlap by a paragraph so a
 * finding described across a break is still visible whole to at least one pass.
 */
export function chunkText(text: string, targetChars = 9_000): string[] {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (normalized.length <= targetChars) return normalized ? [normalized] : [];

  const paragraphs = normalized.split(/\n{2,}/);
  const chunks: string[] = [];
  let current: string[] = [];
  let size = 0;

  for (const paragraph of paragraphs) {
    // A single monster paragraph still has to be broken somewhere.
    if (paragraph.length > targetChars) {
      if (current.length) {
        chunks.push(current.join("\n\n"));
        current = [];
        size = 0;
      }
      for (let i = 0; i < paragraph.length; i += targetChars) {
        chunks.push(paragraph.slice(i, i + targetChars));
      }
      continue;
    }

    if (size + paragraph.length > targetChars && current.length) {
      chunks.push(current.join("\n\n"));
      current = [current[current.length - 1]];
      size = current[0].length;
    }

    current.push(paragraph);
    size += paragraph.length + 2;
  }

  if (current.length) chunks.push(current.join("\n\n"));
  return chunks;
}
