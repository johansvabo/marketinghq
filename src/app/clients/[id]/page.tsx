import { notFound } from "next/navigation";
import Link from "next/link";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { ArrowLeft, FileText, Lightbulb, Users } from "lucide-react";
import { db } from "@/lib/db";
import { clients, documents, insights, projects, reportRuns, stakeholders, tasks } from "@/lib/db/schema";
import { relativeDay } from "@/lib/dates";
import { compare, formatMetric, metricLabel, SOURCE_LABEL } from "@/lib/metrics";
import { Card, CardTitle, Chip, Delta, Empty, PageHeader, Progress, StatStrip, Zone } from "@/components/ui";
import { TaskList } from "@/components/tasks";
import { InsightRow } from "@/components/insight-row";
import { DocumentList } from "@/components/document-list";
import { ClientNotes } from "@/components/client-notes";
import { storageConfigured } from "@/lib/storage";

export const dynamic = "force-dynamic";

const OPEN = ["todo", "doing", "waiting"];
const HEALTH_TONE = { on_track: "neutral", at_risk: "warn", off_track: "urgent" } as const;

export default async function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [client] = await db.select().from(clients).where(eq(clients.id, id)).limit(1);
  if (!client) notFound();

  const [projectRows, openTasks, docs, clientInsights, people, upcomingReports, movement] = await Promise.all([
    db
      .select({
        project: projects,
        open: sql<number>`(select count(*) from ${tasks} where ${tasks.projectId} = ${projects.id} and ${tasks.status} in ('todo','doing','waiting'))`,
      })
      .from(projects)
      .where(eq(projects.clientId, id))
      .orderBy(asc(projects.status), asc(projects.dueDate)),
    db
      .select({ task: tasks, projectName: projects.name })
      .from(tasks)
      .leftJoin(projects, eq(tasks.projectId, projects.id))
      .where(and(eq(tasks.clientId, id), inArray(tasks.status, OPEN)))
      .orderBy(asc(tasks.priority), asc(tasks.dueDate))
      .limit(12),
    db.select().from(documents).where(eq(documents.clientId, id)).orderBy(desc(documents.pinned), desc(documents.updatedAt)),
    db.select().from(insights).where(eq(insights.clientId, id)).orderBy(desc(insights.pinned), desc(insights.occurredAt)).limit(8),
    db.select().from(stakeholders).where(eq(stakeholders.clientId, id)).orderBy(asc(stakeholders.name)),
    db
      .select()
      .from(reportRuns)
      .where(and(eq(reportRuns.clientId, id), inArray(reportRuns.status, ["pending", "drafted"])))
      .orderBy(asc(reportRuns.dueAt))
      .limit(3),
    compare({ clientId: id, days: 28 }),
  ]);

  const headline = movement.filter((m) => ["spend", "conversions", "sessions", "cost_per_conversion"].includes(m.metric));

  return (
    <>
      <Link href="/clients" className="btn btn-ghost btn-sm mb-3 -ml-2">
        <ArrowLeft size={14} />
        Clients
      </Link>

      <PageHeader
        title={client.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ background: client.color }} />
              {client.engagement}
            </span>
            {client.monthlyValue ? (
              <>
                <span>·</span>
                <span>
                  {client.currency} {client.monthlyValue.toLocaleString("en-US")}/mo
                </span>
              </>
            ) : null}
            {(client.emailDomains?.length ?? 0) > 0 && (
              <>
                <span>·</span>
                <span>{client.emailDomains!.join(", ")}</span>
              </>
            )}
          </span>
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href={`/brain?tab=library&client=${id}`} className="btn btn-sm">Ask the brain</Link>
            <Link href={`/tasks?client=${id}`} className="btn btn-sm">Tasks</Link>
          </div>
        }
      />

      <div className="mb-5">
        <StatStrip
          items={[
            { label: "Open tasks", value: openTasks.length, tone: openTasks.length > 0 ? "neutral" : "good" },
            { label: "Active projects", value: projectRows.filter((p) => p.project.status === "active").length },
            { label: "Documents", value: docs.length },
            { label: "Insights", value: clientInsights.length },
          ]}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="flex flex-col gap-4">
          <Zone title="Documents" icon={<FileText size={14} strokeWidth={2.2} />} tone="info" count={docs.length || undefined}>
            <DocumentList clientId={id} documents={docs} storageOn={storageConfigured()} />
          </Zone>

          <Zone title="What we know" icon={<Lightbulb size={14} strokeWidth={2.2} />} tone="brand" count={clientInsights.length || undefined}
            aside={<Link href={`/brain/new?client=${id}`} className="underline">capture</Link>}>
            {clientInsights.length === 0 ? (
              <Card>
                <Empty
                  title="Nothing captured yet"
                  hint="Findings, decisions, what they respond to. Short entries you will want back in six months."
                  action={
                    <div className="flex gap-2">
                      <Link href={`/brain/new?client=${id}`} className="btn btn-sm btn-primary">Capture one</Link>
                      <Link href="/brain/import" className="btn btn-sm">Import notes</Link>
                    </div>
                  }
                />
              </Card>
            ) : (
              <div className="flex flex-col gap-2.5">
                {clientInsights.map((entry) => (
                  <InsightRow key={entry.id} insight={entry} clientName={client.name} clientColor={client.color} />
                ))}
              </div>
            )}
          </Zone>

          {projectRows.length > 0 && (
            <Card>
              <CardTitle action={<Link href={`/projects?client=${id}`} className="btn btn-ghost btn-sm">All</Link>}>
                Projects
              </CardTitle>
              <div className="flex flex-col gap-2">
                {projectRows.map(({ project, open }) => (
                  <Link
                    key={project.id}
                    href={`/projects/${project.id}`}
                    className="rounded-[10px] px-2.5 py-2 transition-colors hover:bg-[var(--raised)]"
                  >
                    <div className="flex items-center gap-2">
                      <span className="flex-1 truncate text-[13.5px] font-medium">{project.name}</span>
                      <Chip tone={HEALTH_TONE[project.health as keyof typeof HEALTH_TONE] ?? "neutral"}>
                        {project.health.replace("_", " ")}
                      </Chip>
                    </div>
                    <div className="mt-1.5 flex items-center gap-2 text-[11.5px] text-muted">
                      <span>{Number(open)} open</span>
                      {project.dueDate && <span>· due {relativeDay(project.dueDate)}</span>}
                      <span className="ml-auto">{project.progress}%</span>
                    </div>
                    <div className="mt-1">
                      <Progress value={project.progress} tone={project.health === "off_track" ? "urgent" : "brand"} />
                    </div>
                  </Link>
                ))}
              </div>
            </Card>
          )}
        </div>

        <div className="flex flex-col gap-3 rounded-[16px] p-3 md:p-3.5" style={{ background: "var(--sunken)" }}>
          <ClientNotes clientId={id} notes={client.notes} />

          <Card>
            <CardTitle action={<Link href="/settings" className="btn btn-ghost btn-sm">Edit</Link>}>
              <span className="inline-flex items-center gap-1.5">
                <Users size={12} />
                People
              </span>
            </CardTitle>
            {people.length === 0 ? (
              <p className="text-[12.5px] leading-relaxed text-muted">
                No one recorded. Adding them with a contact cadence is what turns “I should check in” into something the
                system tells you.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {people.map((person) => {
                  const since = person.lastContactAt
                    ? Math.floor((Date.now() - person.lastContactAt.getTime()) / 86_400_000)
                    : null;
                  const overdue = person.contactCadenceDays > 0 && (since === null || since > person.contactCadenceDays);
                  return (
                    <li key={person.id} className="flex items-center gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-medium">{person.name}</p>
                        <p className="truncate text-[11.5px] text-muted">
                          {person.role ?? "—"}
                          {since !== null ? ` · spoke ${since}d ago` : person.contactCadenceDays > 0 ? " · never contacted" : ""}
                        </p>
                      </div>
                      {overdue && <Chip tone="warn" solid>due</Chip>}
                      {person.receivesReports && <Chip tone="brand">reports</Chip>}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          {upcomingReports.length > 0 && (
            <Card>
              <CardTitle>Reports due</CardTitle>
              <ul className="flex flex-col gap-1.5">
                {upcomingReports.map((run) => (
                  <li key={run.id}>
                    <Link href={`/reports/${run.id}`} className="flex items-center gap-2 rounded-[9px] px-1.5 py-1.5 hover:bg-[var(--raised)]">
                      <span className="flex-1 truncate text-[12.5px]">
                        {run.periodStart} → {run.periodEnd}
                      </span>
                      <Chip tone={run.dueAt < new Date() ? "urgent" : "neutral"}>{relativeDay(run.dueAt)}</Chip>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {headline.length > 0 && (
            <Card>
              <CardTitle action={<Link href={`/insights?client=${id}`} className="btn btn-ghost btn-sm">More</Link>}>
                Last 28 days
              </CardTitle>
              <dl className="flex flex-col gap-2">
                {headline.slice(0, 6).map((row) => (
                  <div key={`${row.source}-${row.metric}`} className="flex items-baseline gap-2">
                    <dt className="text-[11.5px] text-muted">
                      {SOURCE_LABEL[row.source] ?? row.source} {metricLabel(row.metric)}
                    </dt>
                    <dd className="ml-auto flex items-baseline gap-2">
                      <span className="text-[13px] font-semibold tabular-nums">
                        {formatMetric(row.metric, row.current, client.currency)}
                      </span>
                      <Delta pct={row.changePct} goodDirection={row.metric === "cost_per_conversion" ? "down" : "none"} />
                    </dd>
                  </div>
                ))}
              </dl>
            </Card>
          )}

          {openTasks.length > 0 && (
            <Card>
              <CardTitle action={<Link href={`/tasks?client=${id}`} className="btn btn-ghost btn-sm">All</Link>}>
                Open work
              </CardTitle>
              <TaskList items={openTasks.map((t) => ({ task: t.task, projectName: t.projectName }))} emptyText="" />
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
