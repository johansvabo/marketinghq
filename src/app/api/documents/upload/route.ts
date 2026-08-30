import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { documents } from "@/lib/db/schema";
import { isSignedIn } from "@/lib/auth";
import { extractFromFile, formatBytes, MAX_DIRECT_POST_BYTES, titleFromFileName } from "@/lib/documents/extract";
import { storageConfigured, storeFile } from "@/lib/storage";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Accepts one or more files, keeps the original where a blob store is
 * configured, and stores the extracted text as the document body so it is
 * searchable and readable by Claude. Each file is handled independently: one
 * unreadable file in a batch must not lose the rest.
 */
export async function POST(request: Request) {
  if (!(await isSignedIn())) return new Response("Unauthorized", { status: 401 });

  const form = await request.formData();
  const clientId = (form.get("clientId") as string) || null;
  const projectId = (form.get("projectId") as string) || null;
  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);

  if (files.length === 0) return Response.json({ error: "No files were received." }, { status: 400 });

  const created: { id: string; title: string; hasText: boolean; stored: boolean }[] = [];
  const failed: { name: string; reason: string }[] = [];

  for (const file of files) {
    try {
      // This route carries the file through a serverless function, so it is
      // bound by the platform's request-body cap. Refuse clearly rather than
      // letting the platform reject it with something unreadable.
      if (file.size > MAX_DIRECT_POST_BYTES) {
        throw new Error(
          `${file.name} is ${formatBytes(file.size)}. Without file storage configured, uploads go through the server and are capped at ${formatBytes(
            MAX_DIRECT_POST_BYTES,
          )}. Add a Blob store in Vercel under Storage to upload large files.`,
        );
      }

      const extraction = await extractFromFile(file);
      const stored = await storeFile(file, `documents/${clientId ?? "general"}`);

      const [row] = await db
        .insert(documents)
        .values({
          clientId,
          projectId,
          title: titleFromFileName(file.name),
          body: extraction.text,
          kind: extraction.suggestedKind,
          source: "upload",
          fileName: file.name,
          fileType: file.type || null,
          fileSize: file.size,
          fileUrl: stored?.url ?? null,
          filePathname: stored?.pathname ?? null,
          // Only genuine per-file problems go here. Missing blob storage is a
          // workspace setting: the file line already shows "original not kept",
          // and repeating a config warning on every row is noise.
          extractionNote: extraction.note ?? null,
        })
        .returning();

      created.push({ id: row.id, title: row.title, hasText: extraction.text.length > 0, stored: Boolean(stored) });
    } catch (error) {
      failed.push({ name: file.name, reason: error instanceof Error ? error.message : "Could not be read." });
    }
  }

  revalidatePath("/clients");
  if (clientId) revalidatePath(`/clients/${clientId}`);

  return Response.json({ created, failed, storageConfigured: storageConfigured() });
}
