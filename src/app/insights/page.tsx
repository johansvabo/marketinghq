import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { clients, connections } from "@/lib/db/schema";
import { comparisonWindows, iso, subDays } from "@/lib/dates";
import { compare, formatMetric, metricLabel, series, SOURCE_LABEL, SOURCES } from "@/lib/metrics";
import { getOpenSignals } from "@/lib/proactive/engine";
import { Card, CardTitle, Chip, ClientDot, Delta, Empty, PageHeader, Sparkline } from "@/components/ui";
import { SignalCard } from "@/components/signals";

export const dynamic = "force-dynamic";

/** The metrics that lead a card, in the order a marketer reads them. */
const HEADLINE: Record<string, string[]> = {
  ga4: ["sessions", "users", "conversions", "revenue", "conversion_rate"],
  meta: ["spend", "impressions", "clicks", "conversions", "cost_per_conversion", "ctr"],
  google_ads: ["spend", "impressions", "clicks", "conversions", "cost_per_conversion", "ctr"],
  linkedin: ["spend", "impressions", "clicks", "conversions", "cost_per_conversion"],
};

/**
 * Which way is good, used only to colour the change. Volume dials like spend and
 * impressions are deliberately neutral — more spend is not a win by itself.
 */
const GOOD_DIRECTION: Record<string, "up" | "down" | "none"> = {
  spend: "none",
  impressions: "none",
  clicks: "none",
  cost_per_conversion: "down",
  cpc: "down",
  cpm: "down",
  bounce_rate: "down",
};

const WINDOWS = [
  { days: 7, label: "7 days" },
  { days: 28, label: "28 days" },
  { days: 90, label: "90 days" },
];

export default async function InsightsPage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string; days?: string }>;
}) {
  const params = await searchParams;
  const days = Number(params.days ?? 28);
  const clientId = params.client;

  const [clientRows, connectionRows, comparisons, metricSignals] = await Promise.all([
    db.select().from(clients).where(eq(clients.status, "active")),
    db.select().from(connections),
    compare({ clientId, days }),
    getOpenSignals({ limit: 20 }),
  ]);

  const client = clientRows.find((c) => c.id === clientId);
  const currency = client?.currency ?? "DKK";
  const windows = comparisonWindows(days);

  const bySource = new Map<string, typeof comparisons>();
  for (const row of comparisons) {
    if (!bySource.has(row.source)) bySource.set(row.source, []);
    bySource.get(row.source)!.push(row);
  }

  const shifts = metricSignals.filter((s) => s.rule === "metric_shift" && (!clientId || s.clientId === clientId));
  const clientNames = new Map(clientRows.map((c) => [c.id, c.name]));

  // One sparkline per source, on the metric that best represents it.
  const sparkMetric: Record<string, string> = { ga4: "sessions", meta: "spend", google_ads: "spend", linkedin: "spend" };
  const sparklines = await Promise.all(
    [...bySource.keys()].map(async (source) => ({
      source,
      points: (
        await series({
          clientId,
          source,
          metric: sparkMetric[source] ?? "spend",
          from: iso(subDays(new Date(), days)),
          to: windows.current.end,
        })
      ).map((p) => p.value),
    })),
  );
  const sparkBySource = new Map(sparklines.map((s) => [s.source, s.points]));

  const connected = new Set(connectionRows.map((c) => c.provider));
  const missing = SOURCES.filter((s) => !connected.has(s === "ga4" || s === "google_ads" ? "google" : s));

  return (
    <>
      <PageHeader
        title="Insights"
        subtitle={`${client?.name ?? "All clients"} · ${windows.current.start} → ${windows.current.end}, compared with the ${days} days before`}
      />

      <div className="scroll-x no-scrollbar mb-4 flex gap-1.5 pb-1">
        {WINDOWS.map((option) => (
          <Link
            key={option.days}
            href={`/insights?days=${option.days}${clientId ? `&client=${clientId}` : ""}`}
            className={`btn btn-sm ${days === option.days ? "btn-primary" : ""}`}
          >
            {option.label}
          </Link>
        ))}
        <span className="mx-1 w-px" style={{ background: "var(--hairline)" }} />
        <Link href={`/insights?days=${days}`} className={`btn btn-sm ${!clientId ? "btn-primary" : ""}`}>All clients</Link>
        {clientRows.map((c) => (
          <Link key={c.id} href={`/insights?days=${days}&client=${c.id}`} className={`btn btn-sm ${clientId === c.id ? "btn-primary" : ""}`}>
            <ClientDot color={c.color} />
            {c.name}
          </Link>
        ))}
      </div>

      {shifts.length > 0 && (
        <section className="mb-5">
          <CardTitle>What moved</CardTitle>
          <div className="flex flex-col gap-2.5">
            {shifts.slice(0, 5).map((signal) => (
              <SignalCard key={signal.id} signal={signal} clientName={signal.clientId ? clientNames.get(signal.clientId) : null} />
            ))}
          </div>
        </section>
      )}

      {bySource.size === 0 ? (
        <Card>
          <Empty
            title="No performance data yet"
            hint="Connect GA4, Meta, LinkedIn or Google Ads and the numbers land here every night — with week-over-week movement flagged before a client notices it."
            action={<Link href="/settings" className="btn btn-primary btn-sm">Connect a data source</Link>}
          />
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {[...bySource.entries()].map(([source, rows]) => {
            const wanted = HEADLINE[source] ?? [...new Set(rows.map((r) => r.metric))];
            const points = sparkBySource.get(source) ?? [];

            return (
              <Card key={source}>
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-[14px] font-semibold tracking-tight">{SOURCE_LABEL[source] ?? source}</h2>
                    <p className="mt-0.5 text-[11.5px] text-muted">
                      {metricLabel(sparkMetric[source] ?? "spend")} over {days} days
                    </p>
                  </div>
                  <Sparkline points={points} tone="brand" />
                </div>

                <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5">
                  {wanted
                    .map((metric) => rows.find((r) => r.metric === metric))
                    .filter((r): r is NonNullable<typeof r> => Boolean(r) && (r!.current !== 0 || r!.previous !== 0))
                    .map((row) => (
                      <div key={row.metric} className="border-t pt-2">
                        <dt className="text-[11px] uppercase tracking-[0.05em] text-muted">{metricLabel(row.metric)}</dt>
                        <dd className="mt-0.5 flex items-baseline gap-2">
                          <span className="text-[15px] font-semibold tabular-nums tracking-[-0.01em]">
                            {formatMetric(row.metric, row.current, currency)}
                          </span>
                          <Delta pct={row.changePct} goodDirection={GOOD_DIRECTION[row.metric] ?? "up"} />
                        </dd>
                      </div>
                    ))}
                </dl>
              </Card>
            );
          })}
        </div>
      )}

      {missing.length > 0 && (
        <p className="mt-5 text-[12.5px] text-muted">
          Not connected yet: {missing.map((m) => SOURCE_LABEL[m]).join(", ")}.{" "}
          <Link href="/settings" className="underline">Connect them</Link> to see the whole picture in one place.
        </p>
      )}
    </>
  );
}
