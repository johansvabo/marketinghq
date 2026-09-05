import { processAssignment } from "@/lib/ai/assignments";
import { isSignedIn } from "@/lib/auth";
import { describeAiError } from "@/lib/ai/client";

export const runtime = "nodejs";

/*
 * A specialist working a full brief takes minutes, and a server action inherits
 * whatever limit its page declares — which was none, so the host killed the
 * work after a few seconds and left it sitting at "running" forever. Route
 * handlers state their own limit, so the work lives here instead. 300 is the
 * ceiling on Vercel's Hobby plan; the stale-reclaim window in assignments.ts
 * is deliberately longer than this.
 */
export const maxDuration = 300;

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isSignedIn())) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  try {
    const progress = await processAssignment(id);
    return Response.json({ ok: true, ...progress });
  } catch (error) {
    return Response.json({ ok: false, error: describeAiError(error) }, { status: 500 });
  }
}
