import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { metrics } from "@/lib/db/schema";
import { comparisonWindows } from "@/lib/dates";

export const SOURCES = ["ga4", "meta", "linkedin", "google_ads"] as const;
export type Source = (typeof SOURCES)[number];

export const SOURCE_LABEL: Record<string, string> = {
  ga4: "GA4",
  meta: "Meta",
  linkedin: "LinkedIn",
  google_ads: "Google Ads",
};

/** Metrics that are money, so the UI can format them without a lookup table. */
export const MONEY_METRICS = new Set(["spend", "revenue", "cost_per_conversion", "cpc", "cpm"]);
export const RATE_METRICS = new Set(["ctr", "conversion_rate", "engagement_rate", "bounce_rate"]);

export type Totals = Record<string, number>;

export async function totalsFor(opts: {
  clientId?: string;
  sources?: string[];
  from: string;
  to: string;
}): Promise<Record<string, Totals>> {
  const where = [gte(metrics.date, opts.from), lte(metrics.date, opts.to)];
  if (opts.clientId) where.push(eq(metrics.clientId, opts.clientId));
  if (opts.sources?.length) where.push(inArray(metrics.source, opts.sources));

  const rows = await db
    .select({
      source: metrics.source,
      metric: metrics.metric,
      total: sql<number>`sum(${metrics.value})`,
    })
    .from(metrics)
    .where(and(...where))
    .groupBy(metrics.source, metrics.metric);

  const out: Record<string, Totals> = {};
  for (const row of rows) {
    (out[row.source] ??= {})[row.metric] = Number(row.total);
  }
  for (const source of Object.keys(out)) out[source] = withDerived(out[source]);
  return out;
}

/** Adds the ratios everyone actually reports on. */
export function withDerived(t: Totals): Totals {
  const out = { ...t };
  if (t.spend && t.conversions) out.cost_per_conversion = t.spend / t.conversions;
  if (t.spend && t.clicks) out.cpc = t.spend / t.clicks;
  if (t.spend && t.impressions) out.cpm = (t.spend / t.impressions) * 1000;
  if (t.clicks && t.impressions) out.ctr = (t.clicks / t.impressions) * 100;
  if (t.conversions && t.sessions) out.conversion_rate = (t.conversions / t.sessions) * 100;
  if (t.revenue && t.spend) out.roas = t.revenue / t.spend;
  return out;
}

export type Comparison = {
  source: string;
  metric: string;
  current: number;
  previous: number;
  changePct: number | null;
};

/** Current window vs the equivalent window before it, per source and metric. */
export async function compare(opts: {
  clientId?: string;
  sources?: string[];
  days?: number;
  ref?: Date;
}): Promise<Comparison[]> {
  const { current, previous } = comparisonWindows(opts.days ?? 28, opts.ref);
  const [now, before] = await Promise.all([
    totalsFor({ ...opts, from: current.start, to: current.end }),
    totalsFor({ ...opts, from: previous.start, to: previous.end }),
  ]);

  const out: Comparison[] = [];
  for (const source of new Set([...Object.keys(now), ...Object.keys(before)])) {
    const a = now[source] ?? {};
    const b = before[source] ?? {};
    for (const metric of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const cur = a[metric] ?? 0;
      const prev = b[metric] ?? 0;
      out.push({
        source,
        metric,
        current: cur,
        previous: prev,
        changePct: prev === 0 ? null : ((cur - prev) / prev) * 100,
      });
    }
  }
  return out;
}

/** Daily series for one metric — what the sparklines draw. */
export async function series(opts: {
  clientId?: string;
  source: string;
  metric: string;
  from: string;
  to: string;
}): Promise<{ date: string; value: number }[]> {
  const where = [
    eq(metrics.source, opts.source),
    eq(metrics.metric, opts.metric),
    gte(metrics.date, opts.from),
    lte(metrics.date, opts.to),
  ];
  if (opts.clientId) where.push(eq(metrics.clientId, opts.clientId));

  const rows = await db
    .select({ date: metrics.date, total: sql<number>`sum(${metrics.value})` })
    .from(metrics)
    .where(and(...where))
    .groupBy(metrics.date)
    .orderBy(metrics.date);

  return rows.map((r) => ({ date: r.date, value: Number(r.total) }));
}

export function formatMetric(metric: string, value: number, currency = "DKK"): string {
  if (MONEY_METRICS.has(metric)) {
    return `${currency} ${value.toLocaleString("en-US", { maximumFractionDigits: value < 100 ? 2 : 0 })}`;
  }
  if (RATE_METRICS.has(metric)) return `${value.toFixed(2)}%`;
  if (metric === "roas") return `${value.toFixed(2)}x`;
  return value.toLocaleString("en-US", { maximumFractionDigits: value < 10 ? 2 : 0 });
}

export function metricLabel(metric: string): string {
  return metric.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
