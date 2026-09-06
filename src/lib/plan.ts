import { and, asc, eq, gte, inArray, isNotNull, lte, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { clients, milestones, projects, tasks, timeEntries } from "@/lib/db/schema";

export type Span = { start: Date; end: Date };

const DAY = 24 * 60 * 60 * 1000;
const OPEN = ["todo", "doing", "waiting"];

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export const quarterOf = (d: Date) => ({ year: d.getFullYear(), quarter: Math.floor(d.getMonth() / 3) + 1 });

export function quarterBounds(year: number, quarter: number): Span {
  const firstMonth = (quarter - 1) * 3;
  return { start: new Date(year, firstMonth, 1), end: new Date(year, firstMonth + 3, 0) };
}

/** Move a quarter forward or back, rolling the year over at the edges. */
export function shiftQuarter(year: number, quarter: number, by: number) {
  const zero = year * 4 + (quarter - 1) + by;
  return { year: Math.floor(zero / 4), quarter: (((zero % 4) + 4) % 4) + 1 };
}

/**
 * Mondays through the window. The last one is included even when the window
 * ends mid-week, since work in that part-week still has to be done.
 */
export function weeksIn({ start, end }: Span): Span[] {
  const first = startOfDay(start);
  // getDay() is 0 for Sunday, so shift into a Monday-first week.
  first.setDate(first.getDate() - ((first.getDay() + 6) % 7));

  const out: Span[] = [];
  for (let cursor = first; cursor <= end; cursor = addDays(cursor, 7)) {
    out.push({ start: cursor, end: addDays(cursor, 6) });
  }
  return out;
}

/** Whole days two spans share. 0 when they do not touch. */
export function overlapDays(a: Span, b: Span): number {
  const start = Math.max(startOfDay(a.start).getTime(), startOfDay(b.start).getTime());
  const end = Math.min(startOfDay(a.end).getTime(), startOfDay(b.end).getTime());
  return end < start ? 0 : Math.round((end - start) / DAY) + 1;
}

/** Where a span sits in the window, as percentages, clamped to its edges. */
export function placeInWindow(item: Span, window: Span): { left: number; width: number; clippedStart: boolean; clippedEnd: boolean } | null {
  const windowStart = startOfDay(window.start).getTime();
  const windowEnd = startOfDay(window.end).getTime() + DAY;
  const total = windowEnd - windowStart;

  const rawStart = startOfDay(item.start).getTime();
  const rawEnd = startOfDay(item.end).getTime() + DAY;
  if (rawEnd <= windowStart || rawStart >= windowEnd) return null;

  const start = Math.max(rawStart, windowStart);
  const end = Math.min(rawEnd, windowEnd);
  return {
    left: ((start - windowStart) / total) * 100,
    width: Math.max(((end - start) / total) * 100, 0.6), // stays visible at one day
    clippedStart: rawStart < windowStart,
    clippedEnd: rawEnd > windowEnd,
  };
}

/**
 * The span a task occupies. A task with both dates spans them; one with only a
 * due date is treated as a single day's work on that date, which is the
 * honest reading — nobody said when it starts.
 */
export function taskSpan(task: { startDate: Date | null; dueDate: Date | null }): Span | null {
  if (task.startDate && task.dueDate) {
    return task.startDate <= task.dueDate
      ? { start: task.startDate, end: task.dueDate }
      : { start: task.dueDate, end: task.startDate };
  }
  const single = task.dueDate ?? task.startDate;
  return single ? { start: single, end: single } : null;
}

export type PlanTask = {
  id: string;
  title: string;
  status: string;
  priority: number;
  span: Span;
  estimateMinutes: number | null;
  clientId: string | null;
  projectId: string | null;
  overdue: boolean;
};

export type PlanRow = {
  client: { id: string; name: string; color: string } | null;
  projects: {
    project: { id: string; name: string; status: string } | null;
    span: Span | null;
    tasks: PlanTask[];
    milestones: { id: string; name: string; dueDate: Date }[];
  }[];
};

export type WeekLoad = {
  week: Span;
  label: string;
  /** Hours already logged against this week. */
  logged: number;
  /** Estimated hours still outstanding that fall in this week. */
  committed: number;
  taskCount: number;
};

/**
 * Spreads a task's estimate evenly across the days it spans, so a two-week
 * task does not land as a spike on its due date. Tasks with no estimate
 * contribute to the count but not the hours — guessing an average would make
 * the number look more certain than it is.
 */
function spreadEstimate(task: PlanTask, week: Span): number {
  if (!task.estimateMinutes) return 0;
  const span = task.span;
  const totalDays = Math.max(1, overlapDays(span, span));
  const inWeek = overlapDays(span, week);
  return inWeek === 0 ? 0 : (task.estimateMinutes / 60) * (inWeek / totalDays);
}

export async function buildPlan(opts: { window: Span; clientId?: string | null; projectId?: string | null }) {
  const { window } = opts;

  const taskWhere = [
    or(isNotNull(tasks.dueDate), isNotNull(tasks.startDate))!,
    ...(opts.clientId ? [eq(tasks.clientId, opts.clientId)] : []),
    ...(opts.projectId ? [eq(tasks.projectId, opts.projectId)] : []),
  ];

  const [taskRows, projectRows, clientRows, milestoneRows, logged, undated] = await Promise.all([
    db.select().from(tasks).where(and(...taskWhere)).orderBy(asc(tasks.dueDate)),
    db.select().from(projects).orderBy(asc(projects.name)),
    db.select().from(clients).orderBy(asc(clients.name)),
    db.select().from(milestones).orderBy(asc(milestones.dueDate)),
    db
      .select({ date: timeEntries.date, hours: sql<number>`sum(${timeEntries.hours})` })
      .from(timeEntries)
      .where(
        and(
          gte(timeEntries.date, iso(window.start)),
          lte(timeEntries.date, iso(window.end)),
          ...(opts.clientId ? [eq(timeEntries.clientId, opts.clientId)] : []),
        ),
      )
      .groupBy(timeEntries.date),
    db.$count(
      tasks,
      and(
        inArray(tasks.status, OPEN),
        sql`${tasks.dueDate} is null and ${tasks.startDate} is null`,
        ...(opts.clientId ? [eq(tasks.clientId, opts.clientId)] : []),
        ...(opts.projectId ? [eq(tasks.projectId, opts.projectId)] : []),
      ),
    ),
  ]);

  const today = startOfDay(new Date());

  const planTasks: PlanTask[] = taskRows
    .map((t) => {
      const span = taskSpan(t);
      return span
        ? {
            id: t.id,
            title: t.title,
            status: t.status,
            priority: t.priority,
            span,
            estimateMinutes: t.estimateMinutes,
            clientId: t.clientId,
            projectId: t.projectId,
            overdue: OPEN.includes(t.status) && span.end < today,
          }
        : null;
    })
    .filter((t): t is PlanTask => t !== null)
    .filter((t) => placeInWindow(t.span, window) !== null);

  // Rows: client → project → its tasks, with anything unattached kept visible
  // rather than dropped, since unassigned work still costs time.
  const projectById = new Map(projectRows.map((p) => [p.id, p]));
  const visibleProjects = projectRows.filter(
    (p) => (!opts.clientId || p.clientId === opts.clientId) && (!opts.projectId || p.id === opts.projectId),
  );

  const rows: PlanRow[] = [];
  const clientsToShow = clientRows.filter((c) => !opts.clientId || c.id === opts.clientId);

  for (const client of [...clientsToShow, null]) {
    const forClient = visibleProjects.filter((p) => p.clientId === (client?.id ?? null));
    const groups: PlanRow["projects"] = [];

    for (const project of forClient) {
      const own = planTasks.filter((t) => t.projectId === project.id);
      const span =
        project.startDate && project.dueDate
          ? { start: project.startDate, end: project.dueDate }
          : project.dueDate
            ? { start: project.dueDate, end: project.dueDate }
            : null;
      const placed = span && placeInWindow(span, window);
      if (!placed && own.length === 0) continue;
      groups.push({
        project: { id: project.id, name: project.name, status: project.status },
        span: placed ? span : null,
        tasks: own,
        milestones: milestoneRows
          .filter((m) => m.projectId === project.id && placeInWindow({ start: m.dueDate, end: m.dueDate }, window))
          .map((m) => ({ id: m.id, name: m.name, dueDate: m.dueDate })),
      });
    }

    // Tasks on this client but not under any project.
    const loose = planTasks.filter(
      (t) => t.clientId === (client?.id ?? null) && (!t.projectId || !projectById.has(t.projectId)),
    );
    if (loose.length > 0 && !opts.projectId) {
      groups.push({ project: null, span: null, tasks: loose, milestones: [] });
    }

    if (groups.length > 0) {
      rows.push({
        client: client ? { id: client.id, name: client.name, color: client.color } : null,
        projects: groups,
      });
    }
  }

  // Weekly load: what is already logged, and what is still outstanding.
  const loggedByDate = new Map(logged.map((l) => [l.date, Number(l.hours)]));
  const load: WeekLoad[] = weeksIn(window).map((week) => {
    let loggedHours = 0;
    for (let d = week.start; d <= week.end; d = addDays(d, 1)) loggedHours += loggedByDate.get(iso(d)) ?? 0;

    const open = planTasks.filter((t) => OPEN.includes(t.status) && overlapDays(t.span, week) > 0);
    return {
      week,
      label: `${week.start.getDate()}/${week.start.getMonth() + 1}`,
      logged: loggedHours,
      committed: open.reduce((sum, t) => sum + spreadEstimate(t, week), 0),
      taskCount: open.length,
    };
  });

  return { rows, load, undated: Number(undated), totalTasks: planTasks.length };
}
