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
  /*
   * Monthly and quarterly reports cover whole calendar periods that have
   * finished — a monthly report due on the 3rd covers all of last month, not
   * the first two days of this one. Getting this wrong is the kind of error a
   * client spots before you do, because the totals will not match theirs.
   */
  if (cadence === "monthly" || cadence === "quarterly") {
    const monthsBack = cadence === "monthly" ? 1 : 3;
    const start = new Date(dueAt.getFullYear(), dueAt.getMonth() - monthsBack, 1);
    // Day 0 of the due month is the last day of the month before it.
    const end = new Date(dueAt.getFullYear(), dueAt.getMonth(), 0);
    return { start: iso(start), end: iso(end) };
  }

  // Weekly and biweekly are rolling windows ending the day before the report.
  const end = subDays(startOfDay(dueAt), 1);
  const lengths = { weekly: 7, biweekly: 14 } as const;
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
