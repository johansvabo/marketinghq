import { formatUsd } from "@/lib/ai/pricing";
import type { SpendSummary } from "@/lib/ai/spend";
import { Card, CardTitle, StatStrip } from "@/components/ui";

/** Plain English for each surface, so the table reads without a key. */
const LABELS: Record<string, string> = {
  chat: "Talking to the Brain",
  briefing: "Scheduled team briefings",
  assignment: "Team assignments you handed out",
  report: "Report drafts",
  brief: "The daily headline",
  import: "Importing documents",
  other: "Everything else",
};

export function SpendPanel({ summary }: { summary: SpendSummary }) {
  const { totalUsd, calls, bySurface, cacheHitRate, webSearches, webSearchUsd, projectedMonthlyUsd } = summary;
  const biggest = bySurface[0];

  return (
    <div className="flex flex-col gap-3">
      <StatStrip
        items={[
          {
            label: `Last ${summary.days} days`,
            value: formatUsd(totalUsd),
            hint: `${calls} model calls`,
          },
          {
            label: "At this rate",
            value: formatUsd(projectedMonthlyUsd),
            hint: "per month, from the last seven days",
            tone: projectedMonthlyUsd > 100 ? "urgent" : projectedMonthlyUsd > 40 ? "warn" : "neutral",
          },
          {
            label: "Served from cache",
            value: cacheHitRate === null ? "—" : `${Math.round(cacheHitRate * 100)}%`,
            hint:
              cacheHitRate === null
                ? "nothing recorded yet"
                : cacheHitRate < 0.5
                  ? "low — repeated context is being paid for twice"
                  : "repeated context costs a tenth of full price",
            tone: cacheHitRate !== null && cacheHitRate < 0.5 ? "warn" : "neutral",
          },
          {
            label: "Web searches",
            value: String(webSearches),
            hint: `${formatUsd(webSearchUsd)} on top of the tokens`,
          },
        ]}
      />

      <Card>
        <CardTitle action={biggest ? <span className="text-[11.5px] text-muted">largest first</span> : undefined}>
          Where it went
        </CardTitle>
        <p className="mb-2 text-[11.5px] leading-relaxed text-muted">
          Scheduled work — briefings, the daily headline, document extraction — runs on the cheaper model at lower
          depth, because nobody is waiting on it. The chat and briefs you hand over use whichever model is chosen
          above.
        </p>
        {bySurface.length === 0 ? (
          <p className="text-[12.5px] text-muted">
            Nothing recorded yet. Every model call from here on is logged with what it cost, so this fills in as you work.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {bySurface.map((row) => {
              const share = totalUsd > 0 ? row.costUsd / totalUsd : 0;
              return (
                <li key={row.key} className="flex flex-col gap-1">
                  <div className="flex items-baseline gap-2 text-[12.5px]">
                    <span className="font-medium">{LABELS[row.key] ?? row.key}</span>
                    <span className="ml-auto shrink-0 tabular-nums font-semibold">{formatUsd(row.costUsd)}</span>
                    <span className="w-10 shrink-0 text-right text-[11.5px] tabular-nums text-muted">
                      {Math.round(share * 100)}%
                    </span>
                  </div>
                  <div className="h-1 overflow-hidden rounded-full" style={{ background: "var(--hairline)" }}>
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${Math.max(2, share * 100)}%`, background: "var(--color-brand)" }}
                    />
                  </div>
                  <div className="text-[11.5px] text-muted">{row.calls} calls</div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
