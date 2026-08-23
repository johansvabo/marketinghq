import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import { clients, insights, milestones, projects, reportRuns, reportSchedules, tasks } from "@/lib/db/schema";
import { parseIso, subDays } from "@/lib/dates";
import { formatMetric, metricLabel, totalsFor, withDerived } from "@/lib/metrics";
import { generate } from "@/lib/ai/brain";
import { isConfigured } from "@/lib/env";

/**
 * Everything that goes into a client report, gathered from the actual record
 * rather than from memory: the numbers, what shipped, what was learned.
 */
export async function gatherReportData(runId: string) {
  const [row] = await db
    .select({ run: reportRuns, client: clients, schedule: reportSchedules })
    .from(reportRuns)
    .innerJoin(clients, eq(reportRuns.clientId, clients.id))
    .leftJoin(reportSchedules, eq(reportRuns.scheduleId, reportSchedules.id))
    .where(eq(reportRuns.id, runId));

  if (!row) throw new Error("Report run not found");
  const { run, client, schedule } = row;

  const start = parseIso(run.periodStart);
  const end = parseIso(run.periodEnd);
  const priorStart = subDays(start, (end.getTime() - start.getTime()) / 86_400_000 + 1);

  const sources = schedule?.sources?.length ? schedule.sources : undefined;

  const [current, previous, completed, activeProjects, learnings, hitMilestones] = await Promise.all([
    totalsFor({ clientId: client.id, sources, from: run.periodStart, to: run.periodEnd }),
    totalsFor({
      clientId: client.id,
      sources,
      from: priorStart.toISOString().slice(0, 10),
      to: subDays(start, 1).toISOString().slice(0, 10),
    }),
    db
      .select()
      .from(tasks)
      .where(and(eq(tasks.clientId, client.id), eq(tasks.status, "done"), gte(tasks.completedAt, start), lte(tasks.completedAt, end)))
      .orderBy(desc(tasks.completedAt)),
    db.select().from(projects).where(and(eq(projects.clientId, client.id), inArray(projects.status, ["active", "planning"]))),
    db
      .select()
      .from(insights)
      .where(and(eq(insights.clientId, client.id), gte(insights.occurredAt, start), lte(insights.occurredAt, end)))
      .orderBy(desc(insights.confidence)),
    db
      .select({ milestone: milestones, projectName: projects.name })
      .from(milestones)
      .innerJoin(projects, eq(milestones.projectId, projects.id))
      .where(and(eq(projects.clientId, client.id), gte(milestones.completedAt, start), lte(milestones.completedAt, end))),
  ]);

  return { run, client, schedule, current, previous, completed, activeProjects, learnings, hitMilestones };
}

export type ReportData = Awaited<ReturnType<typeof gatherReportData>>;

/** The numbers block, rendered the same way whether or not the AI is on. */
export function renderMetricsTable(data: ReportData): string {
  const { current, previous, client } = data;
  const sources = Object.keys(current);
  if (sources.length === 0) return "_No connected performance data for this period._";

  const headline = ["spend", "impressions", "clicks", "sessions", "conversions", "revenue", "cost_per_conversion", "ctr", "roas"];

  return sources
    .map((source) => {
      const cur = withDerived(current[source] ?? {});
      const prev = withDerived(previous[source] ?? {});
      const rows = headline
        .filter((m) => cur[m] != null)
        .map((m) => {
          const change = prev[m] ? ((cur[m] - prev[m]) / prev[m]) * 100 : null;
          return `| ${metricLabel(m)} | ${formatMetric(m, cur[m], client.currency)} | ${
            prev[m] != null ? formatMetric(m, prev[m], client.currency) : "—"
          } | ${change === null ? "—" : `${change >= 0 ? "+" : ""}${change.toFixed(1)}%`} |`;
        });
      if (rows.length === 0) return "";
      return `**${source}**\n\n| Metric | This period | Previous | Change |\n|---|---|---|---|\n${rows.join("\n")}`;
    })
    .filter(Boolean)
    .join("\n\n");
}

const REPORT_SYSTEM = `You write client reports for an independent marketing consultant. Their clients are busy operators and founders, not analysts.

Rules:
- Lead with the answer: is this period good, flat or bad, and why. One short paragraph, no hedging.
- Every claim ties to a number that is actually in the data you were given. Never invent a figure, a channel, or a campaign name.
- Explain movement in plain business language. "Cost per lead rose because we shifted budget into a colder audience to test scale" — not "CPA increased 34% WoW".
- Be honest about bad periods and say what is being done about it. A report that hides a problem costs the relationship more than the problem does.
- Where the data does not support a conclusion, say what you would need to see. Flag those as [NEEDS INPUT] so the consultant can fill them in before sending.
- End with what happens next, as commitments with owners and rough timing.
- Write in markdown. No preamble, no "I hope this finds you well". Start with the heading.
- Match the length to the substance — a monthly retainer report is typically 400-700 words.`;

export async function draftReport(runId: string): Promise<string> {
  const data = await gatherReportData(runId);
  const { run, client, schedule, completed, activeProjects, learnings, hitMilestones } = data;

  const metricsBlock = renderMetricsTable(data);

  const deterministicDraft = [
    `# ${client.name} — ${schedule?.name ?? "Performance report"}`,
    `**Period:** ${run.periodStart} → ${run.periodEnd}`,
    ``,
    `## Performance`,
    ``,
    metricsBlock,
    ``,
    `## What we shipped`,
    completed.length ? completed.map((t) => `- ${t.title}`).join("\n") : "_Nothing logged as completed in this period._",
    ``,
    hitMilestones.length ? `## Milestones reached\n${hitMilestones.map((m) => `- ${m.projectName}: ${m.milestone.name}`).join("\n")}\n` : "",
    `## What we learned`,
    learnings.length ? learnings.map((i) => `- **${i.title}** — ${i.body.replace(/\s+/g, " ")}`).join("\n") : "_No insights captured for this period._",
    ``,
    `## Next period`,
    activeProjects.length ? activeProjects.map((p) => `- ${p.name}${p.goal ? ` — ${p.goal}` : ""}`).join("\n") : "_No active projects._",
  ]
    .filter((s) => s !== "")
    .join("\n");

  if (!isConfigured.anthropic()) return deterministicDraft;

  const prompt = [
    `Write the ${schedule?.cadence ?? "monthly"} report for ${client.name}, covering ${run.periodStart} to ${run.periodEnd}.`,
    ``,
    schedule?.template ? `The client expects this report to always cover:\n${schedule.template}\n` : "",
    `## Performance data (currency ${client.currency})`,
    metricsBlock,
    ``,
    `## Work completed this period`,
    completed.length ? completed.map((t) => `- ${t.title}${t.notes ? ` — ${t.notes}` : ""}`).join("\n") : "Nothing logged.",
    ``,
    hitMilestones.length ? `## Milestones reached\n${hitMilestones.map((m) => `- ${m.projectName}: ${m.milestone.name}`).join("\n")}\n` : "",
    `## Insights captured this period`,
    learnings.length ? learnings.map((i) => `- [${i.kind}, confidence ${i.confidence}/5] ${i.title}: ${i.body}`).join("\n") : "None captured.",
    ``,
    `## Active projects going into next period`,
    activeProjects.length
      ? activeProjects.map((p) => `- ${p.name}${p.goal ? ` (goal: ${p.goal})` : ""} — ${p.progress}% complete, health ${p.health}`).join("\n")
      : "None.",
    ``,
    `Keep the performance table exactly as given — do not restate the numbers differently in prose than they appear in the table.`,
  ]
    .filter((s) => s !== "")
    .join("\n");

  return generate({ system: REPORT_SYSTEM, prompt, effort: "high", maxTokens: 16_000 });
}
