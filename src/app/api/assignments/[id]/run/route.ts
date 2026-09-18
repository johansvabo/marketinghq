import { after } from "next/server";
import { processAssignment } from "@/lib/ai/assignments";
import { notifyFinishedAssignments } from "@/lib/ai/digest";
import { isSignedIn } from "@/lib/auth";
import { describeAiError } from "@/lib/ai/client";
import { env } from "@/lib/env";

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

/**
 * How many times a run may hand off to itself before stopping.
 *
 * Each hop is a fresh invocation with its own time limit, which is what lets
 * an assignment finish with nobody watching. The ceiling is what stops a bug
 * — an assignment that never reaches "done" — from billing in a loop forever.
 * Whatever is unfinished after this is picked up by the nightly pass.
 */
const MAX_HOPS = 8;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  /*
   * Either a signed-in person, or this route continuing its own work.
   *
   * A hop carries no session cookie, so it authenticates with CRON_SECRET
   * instead. If that is not configured there is no second door: the check
   * falls back to the session alone rather than opening up.
   */
  const secret = request.headers.get("authorization");
  const isSelfCall = Boolean(env.cronSecret) && secret === `Bearer ${env.cronSecret}`;
  if (!isSelfCall && !(await isSignedIn())) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const hop = Number(new URL(request.url).searchParams.get("hop") ?? 0);

  try {
    const progress = await processAssignment(id);

    if (progress.done) {
      // Guarded by its own sent-stamp, so this is a no-op unless this pass is
      // the one that finished the assignment.
      await notifyFinishedAssignments();
    } else if (canChain(hop) && (progress.produced > 0 || progress.failed > 0)) {
      /*
       * Carry on without the browser.
       *
       * Until this existed, the only thing that called this route was a
       * component on the assignment's page: close the tab and the work
       * stopped mid-brief. The response goes back now, and a fresh
       * invocation picks up where this one left off — so handing work over
       * and walking away is a normal thing to do rather than the way to
       * lose it.
       *
       * Only when this pass actually moved something: chaining on a pass
       * that produced nothing would spin against whatever is blocking it.
       */
      const next = new URL(request.url);
      next.searchParams.set("hop", String(hop + 1));

      after(async () => {
        try {
          await fetch(next, {
            method: "POST",
            headers: { authorization: `Bearer ${env.cronSecret}` },
          });
        } catch {
          // The nightly pass is the backstop; a failed handoff delays the
          // work rather than losing it.
        }
      });
    }

    return Response.json({ ok: true, ...progress, continues: !progress.done && canChain(hop) });
  } catch (error) {
    return Response.json({ ok: false, error: describeAiError(error) }, { status: 500 });
  }
}

/** A self-call needs a secret to authenticate with, and a hop left to spend. */
function canChain(hop: number): boolean {
  return Boolean(env.cronSecret) && hop < MAX_HOPS;
}
