import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { documents } from "@/lib/db/schema";
import { isSignedIn } from "@/lib/auth";
import { readFile } from "@/lib/storage";

export const runtime = "nodejs";

/**
 * Serves a document's original file to a signed-in user.
 *
 * Files go through here rather than a direct storage URL so that a client's
 * brand book is reachable only by someone logged into this workspace — a public
 * blob link is unguessable but permanent, unauthenticated, and impossible to
 * revoke once it has been forwarded.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isSignedIn())) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;
  const [doc] = await db.select().from(documents).where(eq(documents.id, id)).limit(1);

  if (!doc) return new Response("Not found", { status: 404 });
  if (!doc.filePathname) return new Response("This document has no stored file.", { status: 404 });

  try {
    const stored = await readFile(doc.filePathname);
    if (!stored) return new Response("The stored file could not be read.", { status: 404 });

    return new Response(stored.stream, {
      headers: {
        "content-type": stored.contentType || doc.fileType || "application/octet-stream",
        // inline so a PDF opens in the browser rather than forcing a download
        "content-disposition": `inline; filename="${encodeURIComponent(doc.fileName ?? "document")}"`,
        "cache-control": "private, max-age=300",
      },
    });
  } catch (error) {
    return new Response(
      `Could not read the file: ${error instanceof Error ? error.message : "unknown error"}`,
      { status: 500 },
    );
  }
}
