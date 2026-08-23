import { and, desc, eq, isNull, lte, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { reportRuns, reportSchedules, type ReportSchedule } from "@/lib/db/schema";
import { addDays, iso, startOfDay, subDays } from "@/lib/dates";

export type Cadence = "weekly" | "biweekly" | "monthly" | "quarterly";

/**
 * Next date this schedule is due, strictly after `after`.
 * weekly/biweekly: dayOf is 1-7 (Mon-Sun). monthly/quarterly: dayOf is 1-28.
 */
export function nextDueDate(schedule: Pick<ReportSchedule, "cadence" | "dayOf">, after = new Date()): Date {
  const from = startOfDay(after);
  const dayOf = schedule.dayOf;

  if (schedule.cadence === "weekly" || schedule.cadence === "biweekly") {
    const target = Math.min(Math.max(dayOf, 1), 7); // 1 = Monday
    const step = schedule.cadence === "weekly" ? 7 : 14;
    let d = addDays(from, 1);
    for (let i = 0; i < step * 2; i++) {
      const isoDow = d.getDay() === 0 ? 7 : d.getDay();
      if (isoDow === target) return d;
      d = addDays(d, 1);
    }
    return addDays(from, step);
  }

  const day = Math.min(Math.max(dayOf, 1), 28);
  const monthStep = schedule.cadence === "quarterly" ? 3 : 1;
  let candidate = new Date(from.getFullYear(), from.getMonth(), day);
  while (candidate <= from) {
    candidate = new Date(candidate.getFullYear(), candidate.getMonth() + monthStep, day);
  }
  return candidate;
}

/** The period a report published on `dueAt` should cover. */
export function reportingPeriod(cadence: Cadence, dueAt: Date): { start: string; end: string } {
  const end = subDays(startOfDay(dueAt), 1);
  const lengths: Record<Cadence, number> = { weekly: 7, biweekly: 14, monthly: 30, quarterly: 91 };
  if (cadence === "monthly") {
    // Calendar month, which is what clients actually expect on a monthly report.
    const start = new Date(end.getFullYear(), end.getMonth(), 1);
    return { start: iso(start), end: iso(end) };
  }
  return { start: iso(subDays(end, lengths[cadence] - 1)), end: iso(end) };
}

/**
 * Makes sure every active schedule has its next run materialised as a pending
 * row, so the proactive engine and the reports view have something to point at.
 * Idempotent — safe to call on every cron tick.
 */
export async function materializeReportRuns(now = new Date()): Promise<number> {
  const schedules = await db.select().from(reportSchedules).where(eq(reportSchedules.active, true));
  let created = 0;

  for (const schedule of schedules) {
    const open = await db
      .select()
      .from(reportRuns)
      .where(
        and(
          eq(reportRuns.scheduleId, schedule.id),
          or(eq(reportRuns.status, "pending"), eq(reportRuns.status, "drafted")),
        ),
      )
      .limit(1);

    if (open.length > 0) {
      if (!schedule.nextDueAt || schedule.nextDueAt.getTime() !== open[0].dueAt.getTime()) {
        await db.update(reportSchedules).set({ nextDueAt: open[0].dueAt }).where(eq(reportSchedules.id, schedule.id));
      }
      continue;
    }

    const dueAt = nextDueDate(schedule, schedule.lastSentAt ?? now);
    const period = reportingPeriod(schedule.cadence as Cadence, dueAt);

    await db.insert(reportRuns).values({
      scheduleId: schedule.id,
      clientId: schedule.clientId,
      periodStart: period.start,
      periodEnd: period.end,
      dueAt,
      status: "pending",
    });
    await db.update(reportSchedules).set({ nextDueAt: dueAt }).where(eq(reportSchedules.id, schedule.id));
    created++;
  }

  return created;
}

/** Everything due in the next `days`, soonest first. */
export async function upcomingReports(days = 21) {
  const horizon = addDays(new Date(), days);
  return db
    .select()
    .from(reportRuns)
    .where(
      and(
        or(eq(reportRuns.status, "pending"), eq(reportRuns.status, "drafted")),
        lte(reportRuns.dueAt, horizon),
      ),
    )
    .orderBy(reportRuns.dueAt);
}
