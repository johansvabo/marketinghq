import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { documents } from "@/lib/db/schema";
import { isSignedIn } from "@/lib/auth";
import { extractFromFile, titleFromFileName } from "@/lib/documents/extract";

export const runtime = "nodejs";
export const maxDuration = 250;

/**
 * Called after the browser has uploaded a file straight to blob storage.
 * Fetches it back server-side — an outbound fetch has no body-size cap — pulls
 * the text out, and records the document.
 */
export async function POST(request: Request) {
  if (!(await isSignedIn())) return new Response("Unauthorized", { status: 401 });

  const { url, pathname, fileName, fileType, fileSize, clientId, projectId } = (await request.json()) as {
    url: string;
    pathname: string;
    fileName: string;
    fileType?: string;
    fileSize?: number;
    clientId?: string | null;
    projectId?: string | null;
  };

  if (!url || !fileName) return Response.json({ error: "Missing upload details." }, { status: 400 });

  let text = "";
  let note: string | null = null;
  let kind = "reference";

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Could not read the stored file back (${response.status}).`);

    const file = new File([await response.blob()], fileName, { type: fileType || undefined });
    const extraction = await extractFromFile(file);
    text = extraction.text;
    note = extraction.note ?? null;
    kind = extraction.suggestedKind;
  } catch (error) {
    // The file is safely stored either way — record it with an honest note
    // rather than losing the upload over a parsing failure.
    note = `The file is stored, but its text could not be read (${
      error instanceof Error ? error.message.slice(0, 100) : "unknown error"
    }).`;
  }

  const [row] = await db
    .insert(documents)
    .values({
      clientId: clientId || null,
      projectId: projectId || null,
      title: titleFromFileName(fileName),
      body: text,
      kind,
      source: "upload",
      fileName,
      fileType: fileType || null,
      fileSize: fileSize ?? null,
      fileUrl: url,
      filePathname: pathname,
      extractionNote: note,
    })
    .returning();

  revalidatePath("/clients");
  if (clientId) revalidatePath(`/clients/${clientId}`);

  return Response.json({ id: row.id, title: row.title, hasText: text.length > 0, stored: true });
}
