import Link from "next/link";
import { eq } from "drizzle-orm";
import { CalendarClock, ExternalLink } from "lucide-react";
import { db } from "@/lib/db";
import { clients, projects } from "@/lib/db/schema";
import { getDayPicture, getOrCreateBrief } from "@/lib/brief";
import { format, relativeDay, timeRange } from "@/lib/dates";
import { Card, CardTitle, Chip, ClientDot, Empty, PageHeader, Stat } from "@/components/ui";
import { SignalCard } from "@/components/signals";
import { TaskList } from "@/components/tasks";
import { QuickAdd, QuickAddHint } from "@/components/quick-add";
import { RunEngineButton } from "@/components/run-engine";

export const dynamic = "force-dynamic";

export default async function TodayPage() {
  const [picture, brief, clientOptions, projectOptions] = await Promise.all([
    getDayPicture(),
    getOrCreateBrief(),
    db.select({ id: clients.id, name: clients.name, color: clients.color }).from(clients).where(eq(clients.status, "active")),
    db.select({ id: projects.id, name: projects.name }).from(projects).where(eq(projects.status, "active")),
  ]);

  const clientNames = new Map(clientOptions.map((c) => [c.id, c.name]));
  const urgent = picture.signals.filter((s) => s.severity === "urgent");
  const rest = picture.signals.filter((s) => s.severity !== "urgent");
  const bookedHours = (picture.stats.meetingMinutes / 60).toFixed(1).replace(/\.0$/, "");

  return (
    <>
      <PageHeader
        title={format(new Date(), "EEEE d MMMM")}
        subtitle={brief.headline}
        actions={<RunEngineButton />}
      />

      <div className="mb-5 grid grid-cols-2 gap-2.5 md:grid-cols-4">
        <Stat
          label="Needs attention"
          value={picture.signals.length}
          tone={urgent.length > 0 ? "urgent" : "neutral"}
          hint={urgent.length > 0 ? `${urgent.length} urgent` : "nothing on fire"}
        />
        <Stat
          label="Overdue"
          value={picture.overdue.length}
          tone={picture.overdue.length > 0 ? "urgent" : "good"}
          hint={picture.overdue.length === 0 ? "all clear" : "clear or kill these first"}
        />
        <Stat label="Booked today" value={`${bookedHours}h`} hint={`${picture.events.length} meeting${picture.events.length === 1 ? "" : "s"}`} />
        <Stat label="Done this week" value={picture.stats.doneThisWeek} tone="good" hint={`${picture.stats.doneToday} today`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
        {/* ------------------------------------------------------ left column */}
        <div className="flex flex-col gap-4">
          <section>
            <CardTitle
              action={
                picture.signals.length > 0 ? (
                  <span className="text-[11.5px] text-muted">ranked by what costs you most if ignored</span>
                ) : undefined
              }
            >
              Move the needle
            </CardTitle>

            {picture.signals.length === 0 ? (
              <Card>
                <Empty
                  title="Nothing is asking for you right now"
                  hint="No overdue work, no unanswered asks, no reports creeping up. Take the open run at something that matters."
                />
              </Card>
            ) : (
              <div className="flex flex-col gap-2.5">
                {[...urgent, ...rest].slice(0, 8).map((signal) => (
                  <SignalCard key={signal.id} signal={signal} clientName={signal.clientId ? clientNames.get(signal.clientId) : null} />
                ))}
                {picture.signals.length > 8 && (
                  <p className="px-1 text-[12px] text-muted">
                    +{picture.signals.length - 8} more, lower priority. They will surface as the top ones clear.
                  </p>
                )}
              </div>
            )}
          </section>

          <Card>
            <CardTitle action={<Link href="/tasks" className="btn btn-ghost btn-sm">All tasks</Link>}>
              Today&apos;s list
            </CardTitle>

            <QuickAdd clients={clientOptions} projects={projectOptions} />
            <QuickAddHint />

            {picture.overdue.length > 0 && (
              <div className="mt-4">
                <div className="mb-1.5 flex items-center gap-2">
                  <span className="section-title" style={{ color: "var(--color-urgent)" }}>
                    Overdue
                  </span>
                  <Chip tone="urgent" solid>{picture.overdue.length}</Chip>
                </div>
                <TaskList
                  items={picture.overdue}
                  emptyText=""
                />
              </div>
            )}

            <div className="mt-4">
              <div className="mb-1.5 section-title">Due today</div>
              <TaskList items={picture.dueToday} emptyText="Nothing due today." />
            </div>

            {picture.nextUp.length > 0 && (
              <div className="mt-4">
                <div className="mb-1.5 section-title">High priority, no deadline pressure</div>
                <TaskList
                  items={picture.nextUp}
                  emptyText=""
                />
              </div>
            )}
          </Card>
        </div>

        {/* ----------------------------------------------------- right column */}
        <div className="flex flex-col gap-4">
          <Card>
            <CardTitle>Today&apos;s calendar</CardTitle>
            {picture.events.length === 0 ? (
              <Empty title="No meetings" hint="A clear day. Good one for the work that needs a run-up." />
            ) : (
              <ul className="flex flex-col gap-2">
                {picture.events.map(({ event, clientName, clientColor }) => {
                  const past = event.endsAt < new Date();
                  const isNext = picture.nextEvent?.event.id === event.id;
                  return (
                    <li
                      key={event.id}
                      className="flex gap-3 rounded-[10px] p-2 transition-colors"
                      style={{
                        background: isNext ? "var(--raised)" : undefined,
                        opacity: past ? 0.45 : 1,
                      }}
                    >
                      <div className="w-[74px] shrink-0 font-mono text-[11.5px] leading-relaxed text-muted">
                        {event.isAllDay ? "all day" : timeRange(event.startsAt, event.endsAt)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-medium leading-snug">{event.title}</p>
                        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11.5px] text-muted">
                          {clientName && (
                            <span className="inline-flex items-center gap-1.5">
                              <ClientDot color={clientColor} />
                              {clientName}
                            </span>
                          )}
                          {event.isExternal && <span>external</span>}
                          {(event.attendees?.length ?? 0) > 0 && <span>{event.attendees!.length} others</span>}
                        </div>
                      </div>
                      {isNext && <Chip tone="brand" solid>next</Chip>}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card>
            <CardTitle action={<Link href="/reports" className="btn btn-ghost btn-sm">All</Link>}>
              Reports coming up
            </CardTitle>
            {picture.reportsSoon.length === 0 ? (
              <Empty
                title="No reports scheduled"
                hint="Set a cadence per client and this becomes the thing that stops a report ever sneaking up on you."
                action={
                  <Link href="/reports" className="btn btn-sm">
                    <CalendarClock size={14} />
                    Set one up
                  </Link>
                }
              />
            ) : (
              <ul className="flex flex-col gap-1.5">
                {picture.reportsSoon.slice(0, 5).map(({ run, clientName }) => {
                  const days = Math.ceil((run.dueAt.getTime() - Date.now()) / 86_400_000);
                  return (
                    <li key={run.id}>
                      <Link
                        href={`/reports/${run.id}`}
                        className="flex items-center gap-3 rounded-[10px] px-2 py-2 transition-colors hover:bg-[var(--raised)]"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px] font-medium">{clientName}</p>
                          <p className="text-[11.5px] text-muted">
                            {run.periodStart} → {run.periodEnd}
                          </p>
                        </div>
                        <Chip tone={days <= 1 ? "urgent" : days <= 3 ? "warn" : "neutral"} solid={days <= 3}>
                          {relativeDay(run.dueAt)}
                        </Chip>
                        {run.status === "drafted" && <Chip tone="good" solid>draft ready</Chip>}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card>
            <CardTitle>Ask the brain</CardTitle>
            <p className="text-[13px] leading-relaxed text-soft">
              Everything on this page is queryable. Ask what changed for a client, what you learned last quarter, or what
              to do about a number that moved.
            </p>
            <Link href="/brain" className="btn btn-primary mt-3 w-full">
              Open the brain
              <ExternalLink size={14} />
            </Link>
          </Card>
        </div>
      </div>
    </>
  );
}
