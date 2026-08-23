import { notFound } from "next/navigation";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import { db } from "@/lib/db";
import { clients, reportRuns, reportSchedules, stakeholders } from "@/lib/db/schema";
import { gatherReportData, renderMetricsTable } from "@/lib/reporting/draft";
import { isConfigured } from "@/lib/env";
import { relativeDay } from "@/lib/dates";
import { Card, CardTitle, Chip, ClientDot, PageHeader } from "@/components/ui";
import { Markdown } from "@/components/markdown";
import { ReportEditor } from "@/components/report-editor";

export const dynamic = "force-dynamic";

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [row] = await db
    .select({ run: reportRuns, client: clients, schedule: reportSchedules })
    .from(reportRuns)
    .innerJoin(clients, eq(reportRuns.clientId, clients.id))
    .leftJoin(reportSchedules, eq(reportRuns.scheduleId, reportSchedules.id))
    .where(eq(reportRuns.id, id))
    .limit(1);

  if (!row) notFound();
  const { run, client, schedule } = row;

  const [data, recipients] = await Promise.all([
    gatherReportData(id),
    db.select().from(stakeholders).where(eq(stakeholders.clientId, client.id)),
  ]);

  const days = Math.ceil((run.dueAt.getTime() - Date.now()) / 86_400_000);
  const reportRecipients = recipients.filter((r) => r.receivesReports);

  return (
    <>
      <Link href="/reports" className="btn btn-ghost btn-sm mb-3 -ml-2">
        <ArrowLeft size={14} />
        Reports
      </Link>

      <PageHeader
        title={`${client.name} — ${schedule?.name ?? "Report"}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5">
              <ClientDot color={client.color} />
              {run.periodStart} → {run.periodEnd}
            </span>
            <span>·</span>
            <span style={days < 0 && run.status !== "sent" ? { color: "var(--color-urgent)" } : undefined}>
              {run.status === "sent" ? `sent ${relativeDay(run.sentAt!)}` : `due ${relativeDay(run.dueAt)}`}
            </span>
          </span>
        }
        actions={
          <Chip tone={run.status === "sent" ? "good" : run.status === "drafted" ? "brand" : "neutral"} solid>
            {run.status}
          </Chip>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <ReportEditor
          runId={run.id}
          initialDraft={run.draft ?? ""}
          status={run.status}
          aiReady={isConfigured.anthropic()}
        />

        <div className="flex flex-col gap-4">
          <Card>
            <CardTitle>The numbers</CardTitle>
            <Markdown source={renderMetricsTable(data)} />
          </Card>

          <Card>
            <CardTitle>What shipped this period</CardTitle>
            {data.completed.length === 0 ? (
              <p className="text-[12.5px] text-muted">
                Nothing logged as completed between {run.periodStart} and {run.periodEnd}. If work happened, it did not
                get marked done — worth fixing before this becomes the client&apos;s impression.
              </p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {data.completed.map((task) => (
                  <li key={task.id} className="text-[13px] leading-snug text-soft">
                    · {task.title}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardTitle>Learnings in the window</CardTitle>
            {data.learnings.length === 0 ? (
              <p className="text-[12.5px] text-muted">Nothing captured. A report with no learning in it reads like an invoice.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {data.learnings.map((entry) => (
                  <li key={entry.id}>
                    <p className="text-[13px] font-medium leading-snug">{entry.title}</p>
                    <p className="mt-0.5 line-clamp-2 text-[12px] leading-relaxed text-muted">{entry.body}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {reportRecipients.length > 0 && (
            <Card>
              <CardTitle>Goes to</CardTitle>
              <ul className="flex flex-col gap-1.5">
                {reportRecipients.map((person) => (
                  <li key={person.id} className="text-[13px]">
                    {person.name}
                    {person.email && <span className="text-muted"> · {person.email}</span>}
                  </li>
                ))}
              </ul>
              <p className="mt-2.5 text-[11.5px] text-muted">Marking this sent logs contact with all of them.</p>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
