import { db } from "@/lib/db";
import { syncRuns } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { syncAll } from "@/lib/integrations/sync";
import { materializeReportRuns } from "@/lib/reporting/schedule";
import { runProactiveEngine } from "@/lib/proactive/engine";
import { getOrCreateBrief } from "@/lib/brief";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * The nightly pass, and the thing that makes this proactive rather than a place
 * you have to remember to visit:
 *   1. pull fresh data from every connected account
 *   2. queue any report that has come due
 *   3. re-run the rules and reconcile the signal feed
 *   4. write tomorrow's brief so Today loads instantly
 *
 * Schedule it with Vercel Cron, GitHub Actions, or any scheduler that can send
 * an authenticated GET. Safe to run more often than once a day.
 */
export async function GET(request: Request) {
  const authorized =
    !env.cronSecret ||
    request.headers.get("authorization") === `Bearer ${env.cronSecret}` ||
    new URL(request.url).searchParams.get("secret") === env.cronSecret;

  if (!authorized) return new Response("Unauthorized", { status: 401 });

  const startedAt = Date.now();
  const steps: Record<string, unknown> = {};

  try {
    steps.sync = await syncAll();
  } catch (error) {
    steps.sync = { error: error instanceof Error ? error.message : String(error) };
  }

  try {
    steps.reportsQueued = await materializeReportRuns();
  } catch (error) {
    steps.reportsQueued = { error: error instanceof Error ? error.message : String(error) };
  }

  try {
    steps.engine = await runProactiveEngine();
  } catch (error) {
    steps.engine = { error: error instanceof Error ? error.message : String(error) };
  }

  try {
    const brief = await getOrCreateBrief();
    steps.brief = brief.source;
  } catch (error) {
    steps.brief = { error: error instanceof Error ? error.message : String(error) };
  }

  const durationMs = Date.now() - startedAt;
  await db.insert(syncRuns).values({ source: "cron", status: "ok", itemsWritten: 0, durationMs, message: "nightly pass" });

  return Response.json({ ok: true, durationMs, ...steps });
}
