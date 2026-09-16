import type Anthropic from "@anthropic-ai/sdk";
import { and, desc, gte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { aiUsage } from "@/lib/db/schema";
import { costOf, type TokenUsage } from "./pricing";

/** Which part of the app made the call. Kept short — it groups the spend page. */
export type Surface = "chat" | "briefing" | "assignment" | "report" | "brief" | "import" | "other";

export function usageFrom(usage: Anthropic.Usage): TokenUsage {
  const server = (usage as { server_tool_use?: { web_search_requests?: number } }).server_tool_use;
  return {
    inputTokens: usage.input_tokens ?? 0,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    webSearches: server?.web_search_requests ?? 0,
  };
}

/**
 * Records what a turn cost. Best-effort on purpose: the model call has
 * already succeeded by the time this runs, and a bookkeeping failure must
 * never turn a good answer into an error. It swallows everything.
 */
export async function recordUsage(opts: {
  surface: Surface;
  model: string;
  agentKey?: string | null;
  usage: TokenUsage;
}): Promise<void> {
  try {
    await db.insert(aiUsage).values({
      surface: opts.surface,
      agentKey: opts.agentKey ?? null,
      model: opts.model,
      ...opts.usage,
      costUsd: costOf(opts.model, opts.usage),
    });
  } catch {
    /* Never fail a call over its own receipt. */
  }
}

export type SpendRow = { key: string; calls: number; costUsd: number };

export type SpendSummary = {
  days: number;
  totalUsd: number;
  calls: number;
  /** Share of input tokens served from cache, across the window. */
  cacheHitRate: number | null;
  webSearches: number;
  webSearchUsd: number;
  bySurface: SpendRow[];
  byDay: SpendRow[];
  /** What a full month would cost at the last seven days' rate. */
  projectedMonthlyUsd: number;
};

function since(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

export async function spendSummary(days = 30): Promise<SpendSummary> {
  const from = since(days);

  const [totals] = await db
    .select({
      calls: sql<number>`count(*)`,
      costUsd: sql<number>`coalesce(sum(${aiUsage.costUsd}), 0)`,
      input: sql<number>`coalesce(sum(${aiUsage.inputTokens}), 0)`,
      cacheRead: sql<number>`coalesce(sum(${aiUsage.cacheReadTokens}), 0)`,
      webSearches: sql<number>`coalesce(sum(${aiUsage.webSearches}), 0)`,
    })
    .from(aiUsage)
    .where(gte(aiUsage.createdAt, from));

  const bySurface = await db
    .select({
      key: aiUsage.surface,
      calls: sql<number>`count(*)`,
      costUsd: sql<number>`coalesce(sum(${aiUsage.costUsd}), 0)`,
    })
    .from(aiUsage)
    .where(gte(aiUsage.createdAt, from))
    .groupBy(aiUsage.surface)
    .orderBy(desc(sql`sum(${aiUsage.costUsd})`));

  const byDay = await db
    .select({
      key: sql<string>`date(${aiUsage.createdAt}, 'unixepoch')`,
      calls: sql<number>`count(*)`,
      costUsd: sql<number>`coalesce(sum(${aiUsage.costUsd}), 0)`,
    })
    .from(aiUsage)
    .where(gte(aiUsage.createdAt, from))
    .groupBy(sql`date(${aiUsage.createdAt}, 'unixepoch')`)
    .orderBy(desc(sql`date(${aiUsage.createdAt}, 'unixepoch')`));

  const [recent] = await db
    .select({ costUsd: sql<number>`coalesce(sum(${aiUsage.costUsd}), 0)` })
    .from(aiUsage)
    .where(and(gte(aiUsage.createdAt, since(7))));

  const inputTotal = Number(totals?.input ?? 0) + Number(totals?.cacheRead ?? 0);
  const webSearches = Number(totals?.webSearches ?? 0);

  return {
    days,
    totalUsd: Number(totals?.costUsd ?? 0),
    calls: Number(totals?.calls ?? 0),
    cacheHitRate: inputTotal === 0 ? null : Number(totals?.cacheRead ?? 0) / inputTotal,
    webSearches,
    webSearchUsd: webSearches * 0.01,
    bySurface: bySurface.map((r) => ({ ...r, calls: Number(r.calls), costUsd: Number(r.costUsd) })),
    byDay: byDay.map((r) => ({ ...r, calls: Number(r.calls), costUsd: Number(r.costUsd) })),
    projectedMonthlyUsd: (Number(recent?.costUsd ?? 0) / 7) * 30,
  };
}
