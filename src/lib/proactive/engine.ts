import { and, desc, eq, gt, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { signals } from "@/lib/db/schema";
import { RULES, type DraftSignal } from "./rules";

export type EngineResult = {
  ran: number;
  raised: number;
  updated: number;
  resolved: number;
  errors: { rule: string; message: string }[];
  durationMs: number;
};

/**
 * Runs every rule, then reconciles the signals table:
 *   - a signal a rule still emits gets refreshed (score, copy, lastSeenAt)
 *   - a signal that stopped firing is resolved, not deleted, so the feed can
 *     show "you handled this" and so we keep a history of what was flagged
 *   - dismissed and snoozed signals are never re-raised while they are quiet
 */
export async function runProactiveEngine(now = new Date()): Promise<EngineResult> {
  const startedAt = Date.now();
  const errors: EngineResult["errors"] = [];
  const drafts: DraftSignal[] = [];

  for (const rule of RULES) {
    try {
      drafts.push(...(await rule.run({ now })));
    } catch (error) {
      errors.push({ rule: rule.name, message: error instanceof Error ? error.message : String(error) });
    }
  }

  const existing = await db.select().from(signals).where(isNull(signals.resolvedAt));
  const byKey = new Map(existing.map((s) => [s.dedupeKey, s]));

  let raised = 0;
  let updated = 0;

  for (const draft of drafts) {
    const prior = byKey.get(draft.key);

    if (!prior) {
      await db.insert(signals).values({
        dedupeKey: draft.key,
        rule: draft.rule,
        severity: draft.severity,
        title: draft.title,
        body: draft.body,
        clientId: draft.clientId ?? null,
        projectId: draft.projectId ?? null,
        entityType: draft.entityType,
        entityId: draft.entityId,
        actions: draft.actions ?? [],
        score: draft.score,
        firstSeenAt: now,
        lastSeenAt: now,
      });
      raised++;
      continue;
    }

    // A signal that keeps firing gets a little more insistent each day it
    // survives, so nothing important sits quietly at the bottom forever.
    const ageDays = Math.floor((now.getTime() - prior.firstSeenAt.getTime()) / 86_400_000);
    await db
      .update(signals)
      .set({
        severity: draft.severity,
        title: draft.title,
        body: draft.body,
        actions: draft.actions ?? [],
        score: draft.score + Math.min(15, ageDays * 2),
        lastSeenAt: now,
      })
      .where(eq(signals.id, prior.id));
    updated++;
  }

  const liveKeys = new Set(drafts.map((d) => d.key));
  const gone = existing.filter((s) => !liveKeys.has(s.dedupeKey));
  if (gone.length > 0) {
    await db
      .update(signals)
      .set({ resolvedAt: now })
      .where(inArray(signals.id, gone.map((s) => s.id)));
  }

  return {
    ran: RULES.length,
    raised,
    updated,
    resolved: gone.length,
    errors,
    durationMs: Date.now() - startedAt,
  };
}

/** Open signals, highest-scoring first, with snoozed and dismissed filtered out. */
export async function getOpenSignals(opts: { limit?: number; clientId?: string } = {}) {
  const now = new Date();
  const where = [
    isNull(signals.resolvedAt),
    isNull(signals.dismissedAt),
    or(isNull(signals.snoozedUntil), lt(signals.snoozedUntil, now)),
  ];
  if (opts.clientId) where.push(eq(signals.clientId, opts.clientId));

  return db
    .select()
    .from(signals)
    .where(and(...where))
    .orderBy(desc(signals.score))
    .limit(opts.limit ?? 50);
}

export async function countOpenSignals(): Promise<{ urgent: number; important: number; fyi: number }> {
  const now = new Date();
  const rows = await db
    .select({ severity: signals.severity, n: sql<number>`count(*)` })
    .from(signals)
    .where(
      and(
        isNull(signals.resolvedAt),
        isNull(signals.dismissedAt),
        or(isNull(signals.snoozedUntil), lt(signals.snoozedUntil, now)),
      ),
    )
    .groupBy(signals.severity);

  const out = { urgent: 0, important: 0, fyi: 0 };
  for (const r of rows) if (r.severity in out) out[r.severity as keyof typeof out] = Number(r.n);
  return out;
}

/** Signals resolved in the last N days — the "you dealt with this" trail. */
export async function getRecentlyResolved(days = 7) {
  const since = new Date(Date.now() - days * 86_400_000);
  return db
    .select()
    .from(signals)
    .where(and(gt(signals.resolvedAt, since)))
    .orderBy(desc(signals.resolvedAt))
    .limit(20);
}
