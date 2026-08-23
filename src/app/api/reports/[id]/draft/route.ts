import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { reportRuns } from "@/lib/db/schema";
import { isSignedIn } from "@/lib/auth";

/** Lets the editor pull back a freshly generated draft without a full reload. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isSignedIn())) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;
  const [row] = await db.select({ draft: reportRuns.draft }).from(reportRuns).where(eq(reportRuns.id, id)).limit(1);
  if (!row) return new Response("Not found", { status: 404 });

  return Response.json({ draft: row.draft ?? "" });
}
