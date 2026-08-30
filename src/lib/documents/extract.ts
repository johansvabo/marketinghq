import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";
import { formatBytes, IMAGE_EXTENSIONS, MAX_UPLOAD_BYTES, PLAIN_EXTENSIONS } from "./limits";

/**
 * Turns an uploaded file into readable text.
 *
 * The text is what gets searched and what Claude reads; the original file is
 * kept separately (see lib/storage.ts) so nothing is lost to a lossy
 * conversion. A file we cannot read is still worth storing — it just says so
 * rather than pretending to be empty.
 */
export type Extraction = {
  text: string;
  /** Set when there is no text, explaining why, for display. */
  note?: string;
  /** A sensible document kind guessed from the file, overridable by the user. */
  suggestedKind: string;
};



const ends = (name: string, list: string[]) => list.some((ext) => name.endsWith(ext));

export async function extractFromFile(file: File): Promise<Extraction> {
  const name = file.name.toLowerCase();

  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error(`${file.name} is over ${formatBytes(MAX_UPLOAD_BYTES)}. Split it, or upload the part that matters.`);
  }

  if (name.endsWith(".pdf")) {
    try {
      const pdf = await getDocumentProxy(new Uint8Array(await file.arrayBuffer()));
      const { text, totalPages } = await extractText(pdf, { mergePages: true });
      const merged = (Array.isArray(text) ? text.join("\n\n") : text).trim();

      // A scan has pages but no text layer. Saying so is more useful than
      // storing an empty document that looks like a mistake.
      if (!merged) {
        return {
          text: "",
          note: "No text could be read from this PDF — most likely a scan. The file is stored and can be opened, but its contents are not searchable.",
          suggestedKind: "reference",
        };
      }
      return { text: `${merged}\n`, suggestedKind: totalPages > 6 ? "reference" : "brief" };
    } catch (error) {
      return {
        text: "",
        note: `This PDF could not be read (${error instanceof Error ? error.message.slice(0, 80) : "unknown error"}). The file is stored and can still be opened.`,
        suggestedKind: "reference",
      };
    }
  }

  if (name.endsWith(".docx")) {
    const { value } = await mammoth.extractRawText({ buffer: Buffer.from(await file.arrayBuffer()) });
    return { text: value.trim(), suggestedKind: "brief" };
  }

  if (ends(name, PLAIN_EXTENSIONS) || file.type.startsWith("text/")) {
    return { text: (await file.text()).trim(), suggestedKind: name.endsWith(".csv") ? "research" : "note" };
  }

  if (ends(name, IMAGE_EXTENSIONS) || file.type.startsWith("image/")) {
    return {
      text: "",
      note: "Image stored. There is no text to search, but you can open it from here.",
      suggestedKind: "reference",
    };
  }

  if (name.endsWith(".doc")) throw new Error("Old .doc files can't be read. Save it as .docx or PDF and upload that.");
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
    throw new Error("Spreadsheets aren't supported yet — export the sheet as CSV and upload that.");
  }
  if (name.endsWith(".pptx") || name.endsWith(".ppt") || name.endsWith(".key")) {
    throw new Error("Decks can't be read directly. Export to PDF and upload that — it reads well.");
  }

  throw new Error(`${file.name} isn't a file type this can read. Works: PDF, Word, text, markdown, CSV and images.`);
}

/** A readable title from a filename, for when the user doesn't type one. */
export function titleFromFileName(name: string): string {
  return name
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (c) => c.toUpperCase());
}

export { formatBytes, MAX_DIRECT_POST_BYTES, MAX_UPLOAD_BYTES, UPLOAD_ACCEPT } from "./limits";
