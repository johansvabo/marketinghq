import Link from "next/link";
import { asc, desc, eq, inArray } from "drizzle-orm";
import { CalendarClock, Check } from "lucide-react";
import { db } from "@/lib/db";
import { clients, reportRuns, reportSchedules, stakeholders } from "@/lib/db/schema";
import { relativeDay } from "@/lib/dates";
import { Card, CardTitle, Chip, ClientDot, Empty, PageHeader } from "@/components/ui";
import { NewScheduleDialog } from "@/components/new-schedule";
import { ScheduleToggle } from "@/components/schedule-toggle";

export const dynamic = "force-dynamic";

const CADENCE_LABEL: Record<string, string> = {
  weekly: "Weekly",
  biweekly: "Every two weeks",
  monthly: "Monthly",
  quarterly: "Quarterly",
};

export default async function ReportsPage() {
  const [upcoming, schedules, sent, clientRows] = await Promise.all([
    db
      .select({ run: reportRuns, client: clients, schedule: reportSchedules })
      .from(reportRuns)
      .innerJoin(clients, eq(reportRuns.clientId, clients.id))
      .leftJoin(reportSchedules, eq(reportRuns.scheduleId, reportSchedules.id))
      .where(inArray(reportRuns.status, ["pending", "drafted"]))
      .orderBy(asc(reportRuns.dueAt)),
    db
      .select({ schedule: reportSchedules, client: clients })
      .from(reportSchedules)
      .innerJoin(clients, eq(reportSchedules.clientId, clients.id))
      .orderBy(asc(reportSchedules.nextDueAt)),
    db
      .select({ run: reportRuns, client: clients })
      .from(reportRuns)
      .innerJoin(clients, eq(reportRuns.clientId, clients.id))
      .where(eq(reportRuns.status, "sent"))
      .orderBy(desc(reportRuns.sentAt))
      .limit(10),
    db.select().from(clients).where(eq(clients.status, "active")),
  ]);

  const recipients = await db
    .select({ clientId: stakeholders.clientId, name: stakeholders.name, email: stakeholders.email })
    .from(stakeholders)
    .where(eq(stakeholders.receivesReports, true));

  return (
    <>
      <PageHeader
        title="Reports"
        subtitle="Cadences, deadlines and drafts — so a report never arrives as a surprise"
        actions={<NewScheduleDialog clients={clientRows.map((c) => ({ id: c.id, name: c.name }))} />}
      />

      <section className="mb-5">
        <CardTitle>Due now</CardTitle>
        {upcoming.length === 0 ? (
          <Card>
            <Empty
              title="Nothing due"
              hint="Set a cadence per client and Marketing HQ starts reminding you ahead of time, with the numbers already pulled."
            />
          </Card>
        ) : (
          <div className="flex flex-col gap-2.5">
            {upcoming.map(({ run, client, schedule }) => {
              const days = Math.ceil((run.dueAt.getTime() - Date.now()) / 86_400_000);
              const late = days < 0;
              const clientRecipients = recipients.filter((r) => r.clientId === client.id);

              return (
                <Link
                  key={run.id}
                  href={`/reports/${run.id}`}
                  className="card flex flex-wrap items-center gap-3 p-4 transition-colors hover:border-[var(--ink-muted)]"
                  style={{ borderLeft: `2px solid ${late ? "var(--color-urgent)" : days <= 3 ? "var(--color-warn)" : "var(--hairline)"}` }}
                >
                  <div className="min-w-[180px] flex-1">
                    <div className="flex items-center gap-2">
                      <ClientDot color={client.color} />
                      <h3 className="text-[14px] font-semibold tracking-[-0.01em]">{client.name}</h3>
                      <span className="text-[12.5px] text-muted">{schedule?.name ?? "Report"}</span>
                    </div>
                    <p className="mt-1 text-[12px] text-muted">
                      Covers {run.periodStart} → {run.periodEnd}
                      {clientRecipients.length > 0 && ` · goes to ${clientRecipients.map((r) => r.name).join(", ")}`}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    {run.status === "drafted" ? (
                      <Chip tone="good" solid>draft ready</Chip>
                    ) : (
                      <Chip tone="neutral">not started</Chip>
                    )}
                    <Chip tone={late ? "urgent" : days <= 3 ? "warn" : "neutral"} solid={days <= 3}>
                      {late ? `${Math.abs(days)}d overdue` : `due ${relativeDay(run.dueAt)}`}
                    </Chip>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle>Cadences</CardTitle>
          {schedules.length === 0 ? (
            <Empty title="No cadences set" hint="One per client is usually enough. Monthly on the 3rd working day is the classic." />
          ) : (
            <ul className="flex flex-col gap-2">
              {schedules.map(({ schedule, client }) => (
                <li key={schedule.id} className="flex items-center gap-3 rounded-[10px] px-2 py-2 hover:bg-[var(--raised)]">
                  <ClientDot color={client.color} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium">
                      {client.name} · {schedule.name}
                    </p>
                    <p className="text-[11.5px] text-muted">
                      {CADENCE_LABEL[schedule.cadence] ?? schedule.cadence}
                      {schedule.nextDueAt ? ` · next ${relativeDay(schedule.nextDueAt)}` : ""}
                      {` · reminds ${schedule.leadDays}d ahead`}
                    </p>
                  </div>
                  <ScheduleToggle scheduleId={schedule.id} active={schedule.active} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardTitle>Sent</CardTitle>
          {sent.length === 0 ? (
            <Empty title="Nothing sent yet" hint="Marking a report sent also logs contact with everyone on its distribution list." />
          ) : (
            <ul className="flex flex-col gap-1.5">
              {sent.map(({ run, client }) => (
                <li key={run.id}>
                  <Link href={`/reports/${run.id}`} className="flex items-center gap-2.5 rounded-[10px] px-2 py-2 hover:bg-[var(--raised)]">
                    <Check size={14} style={{ color: "var(--color-good)" }} />
                    <span className="flex-1 truncate text-[13px]">
                      {client.name} — {run.periodStart} → {run.periodEnd}
                    </span>
                    <span className="text-[11.5px] text-muted">{run.sentAt ? relativeDay(run.sentAt) : ""}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
