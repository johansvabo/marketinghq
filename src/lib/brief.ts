import { and, asc, desc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { briefs, calendarEvents, clients, projects, reportRuns, tasks } from "@/lib/db/schema";
import { addDays, endOfDay, format, iso, relativeDay, startOfDay, timeRange } from "@/lib/dates";
import { getOpenSignals } from "@/lib/proactive/engine";
import { generate } from "@/lib/ai/brain";
import { isConfigured } from "@/lib/env";

const OPEN = ["todo", "doing", "waiting"];

/** Timestamp columns are stored as unix seconds, so raw SQL has to match. */
const unix = (d: Date) => Math.floor(d.getTime() / 1000);

/**
 * The shape the Today view renders. Deliberately computed without the AI so
 * the page is fast and always works; the written headline is layered on top.
 */
export async function getDayPicture(now = new Date()) {
  const dayStart = startOfDay(now);
  const dayEnd = endOfDay(now);

  const [events, dueToday, overdue, nextUp, signals, reportsSoon, focusStats] = await Promise.all([
    db
      .select({ event: calendarEvents, clientName: clients.name, clientColor: clients.color })
      .from(calendarEvents)
      .leftJoin(clients, eq(calendarEvents.clientId, clients.id))
      .where(and(gte(calendarEvents.startsAt, dayStart), lte(calendarEvents.startsAt, dayEnd)))
      .orderBy(asc(calendarEvents.startsAt)),

    db
      .select({ task: tasks, clientName: clients.name, clientColor: clients.color, projectName: projects.name })
      .from(tasks)
      .leftJoin(clients, eq(tasks.clientId, clients.id))
      .leftJoin(projects, eq(tasks.projectId, projects.id))
      .where(and(inArray(tasks.status, OPEN), gte(tasks.dueDate, dayStart), lte(tasks.dueDate, dayEnd)))
      .orderBy(asc(tasks.priority)),

    db
      .select({ task: tasks, clientName: clients.name, clientColor: clients.color, projectName: projects.name })
      .from(tasks)
      .leftJoin(clients, eq(tasks.clientId, clients.id))
      .leftJoin(projects, eq(tasks.projectId, projects.id))
      .where(and(inArray(tasks.status, OPEN), lte(tasks.dueDate, dayStart)))
      .orderBy(asc(tasks.dueDate), asc(tasks.priority)),

    db
      .select({ task: tasks, clientName: clients.name, clientColor: clients.color, projectName: projects.name })
      .from(tasks)
      .leftJoin(clients, eq(tasks.clientId, clients.id))
      .leftJoin(projects, eq(tasks.projectId, projects.id))
      .where(
        and(
          inArray(tasks.status, OPEN),
          or(isNull(tasks.dueDate), gte(tasks.dueDate, addDays(dayStart, 1))),
          lte(tasks.priority, 2),
        ),
      )
      .orderBy(asc(tasks.priority), asc(tasks.dueDate))
      .limit(8),

    getOpenSignals({ limit: 12 }),

    db
      .select({ run: reportRuns, clientName: clients.name })
      .from(reportRuns)
      .innerJoin(clients, eq(reportRuns.clientId, clients.id))
      .where(and(inArray(reportRuns.status, ["pending", "drafted"]), lte(reportRuns.dueAt, addDays(now, 14))))
      .orderBy(asc(reportRuns.dueAt)),

    db
      .select({
        openTasks: sql<number>`sum(case when ${tasks.status} in ('todo','doing','waiting') then 1 else 0 end)`,
        doneToday: sql<number>`sum(case when ${tasks.status} = 'done' and ${tasks.completedAt} >= ${unix(dayStart)} then 1 else 0 end)`,
        doneWeek: sql<number>`sum(case when ${tasks.status} = 'done' and ${tasks.completedAt} >= ${unix(addDays(dayStart, -7))} then 1 else 0 end)`,
      })
      .from(tasks),
  ]);

  // How much of the day is already spoken for — the single most useful number
  // when deciding whether today's task list is realistic.
  const meetingMinutes = events
    .filter((e) => !e.event.isAllDay)
    .reduce((sum, e) => sum + (e.event.endsAt.getTime() - e.event.startsAt.getTime()) / 60_000, 0);

  const nextEvent = events.find((e) => e.event.startsAt > now);

  return {
    date: iso(now),
    events,
    dueToday,
    overdue,
    nextUp,
    signals,
    reportsSoon,
    nextEvent,
    stats: {
      meetingMinutes: Math.round(meetingMinutes),
      openTasks: Number(focusStats[0]?.openTasks ?? 0),
      doneToday: Number(focusStats[0]?.doneToday ?? 0),
      doneThisWeek: Number(focusStats[0]?.doneWeek ?? 0),
      urgentSignals: signals.filter((s) => s.severity === "urgent").length,
    },
  };
}

export type DayPicture = Awaited<ReturnType<typeof getDayPicture>>;

const BRIEF_SYSTEM = `You write the two-sentence orientation line at the top of a marketing consultant's day.

You are not summarising a list they can already see. You are telling them what today is actually about and where the risk sits. Think chief of staff, not calendar app.

Rules:
- Two or three sentences. Never more.
- Name the one thing that most needs to happen today, and why today specifically.
- If the day is heavily booked, say what that means for what they can realistically finish.
- Plain, direct, a little dry. No exclamation marks, no "you've got this", no bullet points.
- Never invent items that are not in the data you were given.`;

/** The written headline at the top of Today. Cached per day. */
export async function getOrCreateBrief(now = new Date()): Promise<{ headline: string; source: "ai" | "computed" }> {
  const date = iso(now);
  const [existing] = await db.select().from(briefs).where(eq(briefs.date, date)).limit(1);
  if (existing?.headline) return { headline: existing.headline, source: existing.body === "ai" ? "ai" : "computed" };

  const picture = await getDayPicture(now);
  const computed = computedHeadline(picture);

  if (!isConfigured.anthropic()) {
    await db.insert(briefs).values({ date, headline: computed, body: "computed", stats: picture.stats }).onConflictDoNothing();
    return { headline: computed, source: "computed" };
  }

  try {
    const headline = await generate({
      system: BRIEF_SYSTEM,
      prompt: describeDay(picture, now),
      effort: "low",
      maxTokens: 1_000,
    });
    await db.insert(briefs).values({ date, headline, body: "ai", stats: picture.stats }).onConflictDoNothing();
    return { headline, source: "ai" };
  } catch {
    await db.insert(briefs).values({ date, headline: computed, body: "computed", stats: picture.stats }).onConflictDoNothing();
    return { headline: computed, source: "computed" };
  }
}

/** Always-available fallback: no API key, no problem. */
function computedHeadline(p: DayPicture): string {
  const parts: string[] = [];
  const hours = (p.stats.meetingMinutes / 60).toFixed(1).replace(".0", "");

  if (p.events.length === 0) parts.push("No meetings today — this is the day to move the work that needs a run at it.");
  else parts.push(`${p.events.length} meeting${p.events.length === 1 ? "" : "s"} taking ${hours}h, leaving roughly ${Math.max(0, 8 - Math.round(p.stats.meetingMinutes / 60))}h of working time.`);

  if (p.overdue.length > 0) parts.push(`${p.overdue.length} task${p.overdue.length === 1 ? " is" : "s are"} already overdue — clear or kill them before adding anything new.`);
  else if (p.dueToday.length > 0) parts.push(`${p.dueToday.length} due today.`);

  const urgentReport = p.reportsSoon[0];
  if (urgentReport) parts.push(`${urgentReport.clientName} report due ${relativeDay(urgentReport.run.dueAt)}.`);

  return parts.join(" ");
}

function describeDay(p: DayPicture, now: Date): string {
  return [
    `Today is ${format(now, "EEEE d MMMM yyyy")}.`,
    ``,
    `Calendar (${p.stats.meetingMinutes} minutes booked):`,
    p.events.length
      ? p.events.map((e) => `- ${timeRange(e.event.startsAt, e.event.endsAt)} ${e.event.title}${e.clientName ? ` (${e.clientName})` : ""}${e.event.isExternal ? " [external]" : ""}`).join("\n")
      : "- nothing scheduled",
    ``,
    `Overdue tasks (${p.overdue.length}):`,
    p.overdue.slice(0, 10).map((t) => `- ${t.task.title}, due ${relativeDay(t.task.dueDate)}${t.clientName ? ` (${t.clientName})` : ""}`).join("\n") || "- none",
    ``,
    `Due today (${p.dueToday.length}):`,
    p.dueToday.map((t) => `- ${t.task.title}${t.clientName ? ` (${t.clientName})` : ""}`).join("\n") || "- none",
    ``,
    `Top signals the system raised:`,
    p.signals.slice(0, 8).map((s) => `- [${s.severity}] ${s.title}`).join("\n") || "- none",
    ``,
    `Reports coming up:`,
    p.reportsSoon.map((r) => `- ${r.clientName}, due ${relativeDay(r.run.dueAt)}, status ${r.run.status}`).join("\n") || "- none",
  ].join("\n");
}
