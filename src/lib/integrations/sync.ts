import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { connections, syncRuns, type Connection } from "@/lib/db/schema";
import { markSynced } from "./oauth";
import { syncGa4, syncGmail, syncGoogleAds, syncGoogleCalendar } from "./google";
import { syncOutlookCalendar, syncOutlookMail } from "./microsoft";
import { syncLinkedInAds, syncMetaAds } from "./ads";

export type SyncOutcome = {
  source: string;
  connectionId: string;
  status: "ok" | "error" | "skipped";
  itemsWritten: number;
  message?: string;
  durationMs: number;
};

/** Everything one connection knows how to pull. */
const JOBS: Record<string, { source: string; run: (c: Connection) => Promise<number> }[]> = {
  google: [
    { source: "gmail", run: (c) => syncGmail(c) },
    { source: "google_calendar", run: (c) => syncGoogleCalendar(c) },
  ],
  ga4: [{ source: "ga4", run: (c) => syncGa4(c) }],
  google_ads: [{ source: "google_ads", run: (c) => syncGoogleAds(c) }],
  microsoft: [
    { source: "outlook_mail", run: (c) => syncOutlookMail(c) },
    { source: "outlook_calendar", run: (c) => syncOutlookCalendar(c) },
  ],
  meta: [{ source: "meta", run: (c) => syncMetaAds(c) }],
  linkedin: [{ source: "linkedin", run: (c) => syncLinkedInAds(c) }],
};

/**
 * Syncs every connected account. One failing provider must never stop the
 * others — each job is isolated and its outcome recorded, so Settings can show
 * exactly what is healthy and what needs attention.
 */
export async function syncAll(opts: { only?: string } = {}): Promise<SyncOutcome[]> {
  const rows = await db.select().from(connections);
  const outcomes: SyncOutcome[] = [];

  for (const connection of rows) {
    if (opts.only && connection.provider !== opts.only) continue;

    const jobs = JOBS[connection.provider];
    if (!jobs) continue;

    if (connection.status === "needs_reauth") {
      outcomes.push({
        source: connection.provider,
        connectionId: connection.id,
        status: "skipped",
        itemsWritten: 0,
        message: "Connection needs re-authorising.",
        durationMs: 0,
      });
      continue;
    }

    let connectionFailed: string | undefined;

    for (const job of jobs) {
      const startedAt = Date.now();
      try {
        const itemsWritten = await job.run(connection);
        const outcome: SyncOutcome = {
          source: job.source,
          connectionId: connection.id,
          status: "ok",
          itemsWritten,
          durationMs: Date.now() - startedAt,
        };
        outcomes.push(outcome);
        await db.insert(syncRuns).values({ source: job.source, status: "ok", itemsWritten, durationMs: outcome.durationMs });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        connectionFailed = message;
        const durationMs = Date.now() - startedAt;
        outcomes.push({ source: job.source, connectionId: connection.id, status: "error", itemsWritten: 0, message, durationMs });
        await db.insert(syncRuns).values({ source: job.source, status: "error", itemsWritten: 0, message: message.slice(0, 500), durationMs });
      }
    }

    await markSynced(connection.id, connectionFailed);
  }

  return outcomes;
}

export async function syncOne(connectionId: string): Promise<SyncOutcome[]> {
  const [connection] = await db.select().from(connections).where(eq(connections.id, connectionId)).limit(1);
  if (!connection) throw new Error("Connection not found");

  const jobs = JOBS[connection.provider] ?? [];
  const outcomes: SyncOutcome[] = [];
  let failure: string | undefined;

  for (const job of jobs) {
    const startedAt = Date.now();
    try {
      const itemsWritten = await job.run(connection);
      outcomes.push({ source: job.source, connectionId, status: "ok", itemsWritten, durationMs: Date.now() - startedAt });
      await db.insert(syncRuns).values({ source: job.source, status: "ok", itemsWritten, durationMs: Date.now() - startedAt });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failure = message;
      outcomes.push({ source: job.source, connectionId, status: "error", itemsWritten: 0, message, durationMs: Date.now() - startedAt });
      await db.insert(syncRuns).values({ source: job.source, status: "error", itemsWritten: 0, message: message.slice(0, 500) });
    }
  }

  await markSynced(connectionId, failure);
  return outcomes;
}
