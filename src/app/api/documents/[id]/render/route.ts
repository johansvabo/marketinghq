import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { documents } from "@/lib/db/schema";
import { isSignedIn } from "@/lib/auth";

export const runtime = "nodejs";

/**
 * Renders a layout document as a standalone page — the version you look at
 * full size and print to PDF.
 *
 * The body is written by a model, so it is treated as untrusted markup. Rather
 * than sanitising it (a filter that is wrong once is wrong forever), the
 * response is served under a content policy that makes the markup inert: the
 * `sandbox` directive drops the page into an opaque origin with scripts
 * disabled, and the source list allows nothing to load from the network at all.
 * Inline styles and data: images are what a self-contained layout is made of,
 * so those are all that is permitted.
 */
const POLICY = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  "img-src data:",
  "font-src data:",
  "sandbox allow-modals",
].join("; ");

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isSignedIn())) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;
  const [doc] = await db.select().from(documents).where(eq(documents.id, id)).limit(1);

  if (!doc) return new Response("Not found", { status: 404 });
  if (doc.format !== "html") return new Response("This document is not a layout.", { status: 400 });

  const title = doc.title.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

  const page = `<!doctype html>
<html lang="no">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  body { margin: 0; background: #f4f4f5; }
  @media print { body { background: #fff; } }
</style>
</head>
<body>
${doc.body}
</body>
</html>`;

  return new Response(page, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": POLICY,
      "x-content-type-options": "nosniff",
      // A layout is client material; it should never sit in a shared cache.
      "cache-control": "private, no-store",
    },
  });
}
