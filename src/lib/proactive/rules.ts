import { and, eq, gte, isNull, lte, ne, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  calendarEvents,
  clients,
  insights,
  messages,
  metrics,
  projects,
  reportRuns,
  reportSchedules,
  stakeholders,
  tasks,
  type SignalAction,
} from "@/lib/db/schema";
import { addDays, comparisonWindows, daysSince, daysUntil, iso, relativeDay, subDays } from "@/lib/dates";

/**
 * A rule looks at the current state of the world and returns zero or more
 * signals. Rules are pure reads — the engine owns writing to the signals
 * table, deduping on `key`, and resolving signals that stopped firing.
 */
export type DraftSignal = {
  key: string;
  rule: string;
  severity: "urgent" | "important" | "fyi";
  title: string;
  body?: string;
  clientId?: string | null;
  projectId?: string | null;
  entityType?: string;
  entityId?: string;
  actions?: SignalAction[];
  score: number;
};

export type Rule = {
  name: string;
  description: string;
  run: (ctx: RuleContext) => Promise<DraftSignal[]>;
};

export type RuleContext = { now: Date };

const SEVERITY_BASE = { urgent: 70, important: 40, fyi: 15 } as const;

/**
 * "Urgent" has to stay rare or it stops meaning anything — and the Today feed
 * paints it, so an over-generous threshold turns the whole page red and costs
 * you the overview it exists to give. The bar: something is lost today if this
 * is ignored. Everything else is important, which is not the same as urgent.
 */

/** Signals compete for the top of the Today list; score decides who wins. */
function score(severity: keyof typeof SEVERITY_BASE, urgencyBoost = 0) {
  return SEVERITY_BASE[severity] + urgencyBoost;
}

/* ------------------------------------------------------------------ reports */

const reportsDue: Rule = {
  name: "report_due",
  description: "A scheduled client report is coming up or already late.",
  run: async ({ now }) => {
    const rows = await db
      .select({
        run: reportRuns,
        schedule: reportSchedules,
        client: clients,
      })
      .from(reportRuns)
      .innerJoin(clients, eq(reportRuns.clientId, clients.id))
      .leftJoin(reportSchedules, eq(reportRuns.scheduleId, reportSchedules.id))
      .where(or(eq(reportRuns.status, "pending"), eq(reportRuns.status, "drafted")));

    const out: DraftSignal[] = [];
    for (const { run, schedule, client } of rows) {
      const lead = schedule?.leadDays ?? 3;
      const until = daysUntil(run.dueAt, now)!;
      if (until > lead) continue;

      const late = until < 0;
      const drafted = run.status === "drafted";
      const severity = late || (until <= 1 && !drafted) ? "urgent" : "important";

      out.push({
        key: `report_due:${run.id}`,
        rule: "report_due",
        severity,
        title: late
          ? `${client.name} report is ${Math.abs(until)} day${Math.abs(until) === 1 ? "" : "s"} overdue`
          : `${client.name} report due ${relativeDay(run.dueAt)}`,
        body: drafted
          ? `A draft is ready for ${run.periodStart} → ${run.periodEnd}. Review, then send to ${(schedule?.recipients ?? []).join(", ") || "your stakeholders"}.`
          : `Covers ${run.periodStart} → ${run.periodEnd}. Pull the numbers and draft it before it becomes a fire drill.`,
        clientId: run.clientId,
        entityType: "report",
        entityId: run.id,
        actions: drafted
          ? [
              { kind: "open", label: "Review draft", payload: { href: `/reports/${run.id}` } },
              { kind: "complete_task", label: "Mark sent", payload: { reportRunId: run.id } },
            ]
          : [
              { kind: "draft_report", label: "Draft it now", payload: { reportRunId: run.id } },
              { kind: "open", label: "Open report", payload: { href: `/reports/${run.id}` } },
            ],
        score: score(severity, late ? Math.min(30, Math.abs(until) * 6) : (lead - until) * 3),
      });
    }
    return out;
  },
};

/* -------------------------------------------------------------------- tasks */

const overdueTasks: Rule = {
  name: "task_overdue",
  description: "Open tasks whose due date has passed.",
  run: async ({ now }) => {
    const rows = await db
      .select({ task: tasks, client: clients })
      .from(tasks)
      .leftJoin(clients, eq(tasks.clientId, clients.id))
      .where(
        and(
          or(eq(tasks.status, "todo"), eq(tasks.status, "doing"), eq(tasks.status, "waiting")),
          lte(tasks.dueDate, now),
        ),
      );

    return rows.map(({ task, client }) => {
      const late = Math.abs(daysUntil(task.dueDate, now) ?? 0);
      const severity = late >= 7 || (late >= 3 && task.priority === 1) ? "urgent" : "important";
      return {
        key: `task_overdue:${task.id}`,
        rule: "task_overdue",
        severity: severity as DraftSignal["severity"],
        title: `Overdue: ${task.title}`,
        body: `Was due ${relativeDay(task.dueDate)}${
          late >= 7 ? ". If this no longer matters, drop it — a dead task on the list costs attention every day." : "."
        }`,
        clientId: task.clientId,
        projectId: task.projectId,
        entityType: "task",
        entityId: task.id,
        actions: [
          { kind: "complete_task", label: "Mark done", payload: { taskId: task.id } },
          { kind: "open", label: "Open task", payload: { href: `/tasks?focus=${task.id}` } },
        ],
        score: score(severity, Math.min(25, late * 3) + (5 - task.priority) * 2),
      };
    });
  },
};

const stalledTasks: Rule = {
  name: "task_stalled",
  description: "Tasks marked in-progress or waiting that nothing has happened to.",
  run: async ({ now }) => {
    const cutoff = subDays(now, 7);
    const rows = await db
      .select({ task: tasks, client: clients })
      .from(tasks)
      .leftJoin(clients, eq(tasks.clientId, clients.id))
      .where(
        and(
          or(eq(tasks.status, "doing"), eq(tasks.status, "waiting")),
          lte(tasks.lastTouchedAt, cutoff),
        ),
      );

    return rows.map(({ task, client }) => {
      const idle = daysSince(task.lastTouchedAt, now) ?? 0;
      const waiting = task.status === "waiting";
      return {
        key: `task_stalled:${task.id}`,
        rule: "task_stalled",
        severity: (idle >= 14 ? "important" : "fyi") as DraftSignal["severity"],
        title: waiting
          ? `Still waiting on ${task.waitingOn ?? "someone"}: ${task.title}`
          : `No movement in ${idle} days: ${task.title}`,
        body: waiting
          ? `You handed this off ${idle} days ago and it hasn't come back. Time to chase it.`
          : `Marked in progress ${idle} days ago. Either move it today or put it back on the shelf.`,
        clientId: task.clientId,
        projectId: task.projectId,
        entityType: "task",
        entityId: task.id,
        actions: [
          waiting
            ? { kind: "create_task", label: "Chase it", payload: { title: `Follow up: ${task.title}`, clientId: task.clientId, projectId: task.projectId, priority: 2 } }
            : { kind: "complete_task", label: "Mark done", payload: { taskId: task.id } },
          { kind: "open", label: "Open task", payload: { href: `/tasks?focus=${task.id}` } },
        ],
        score: score(idle >= 14 ? "important" : "fyi", Math.min(20, idle)),
      };
    });
  },
};

/* ----------------------------------------------------------------- projects */

const projectsWithoutNextAction: Rule = {
  name: "project_no_next_action",
  description: "An active project with nothing open on it is a project quietly dying.",
  run: async () => {
    const rows = await db
      .select({
        project: projects,
        client: clients,
        open: sql<number>`(
          select count(*) from ${tasks}
          where ${tasks.projectId} = ${projects.id}
            and ${tasks.status} in ('todo','doing','waiting')
        )`,
      })
      .from(projects)
      .leftJoin(clients, eq(projects.clientId, clients.id))
      .where(eq(projects.status, "active"));

    return rows
      .filter((r) => Number(r.open) === 0)
      .map(({ project, client }) => ({
        key: `project_no_next_action:${project.id}`,
        rule: "project_no_next_action",
        severity: "important" as const,
        title: `${project.name} has no next action`,
        body: `The project is active but nothing is open on it. Decide the next concrete step, or move it to done.`,
        clientId: project.clientId,
        projectId: project.id,
        entityType: "project",
        entityId: project.id,
        actions: [
          { kind: "create_task", label: "Add next action", payload: { projectId: project.id, clientId: project.clientId } },
          { kind: "open", label: "Open project", payload: { href: `/projects/${project.id}` } },
        ],
        score: score("important", 8),
      }));
  },
};

const projectDeadlineRisk: Rule = {
  name: "project_deadline_risk",
  description: "Deadline is close but the work isn't.",
  run: async ({ now }) => {
    const rows = await db
      .select({
        project: projects,
        client: clients,
        open: sql<number>`(select count(*) from ${tasks} where ${tasks.projectId} = ${projects.id} and ${tasks.status} in ('todo','doing','waiting'))`,
        total: sql<number>`(select count(*) from ${tasks} where ${tasks.projectId} = ${projects.id} and ${tasks.status} != 'dropped')`,
      })
      .from(projects)
      .leftJoin(clients, eq(projects.clientId, clients.id))
      .where(and(eq(projects.status, "active"), gte(projects.dueDate, subDays(now, 30))));

    const out: DraftSignal[] = [];
    for (const { project, client, open, total } of rows) {
      const until = daysUntil(project.dueDate, now);
      if (until === null || until > 14) continue;
      const done = Number(total) - Number(open);
      const pct = Number(total) > 0 ? Math.round((done / Number(total)) * 100) : 0;
      // Comfortable if the work is further along than the calendar is.
      const calendarSpent = until <= 0 ? 100 : Math.round(((14 - until) / 14) * 100);
      if (pct >= calendarSpent && until > 0) continue;

      const severity = until < 0 ? "urgent" : "important";
      out.push({
        key: `project_deadline_risk:${project.id}`,
        rule: "project_deadline_risk",
        severity,
        title:
          until < 0
            ? `${project.name} passed its deadline with ${open} open`
            : `${project.name} due ${relativeDay(project.dueDate)} — ${open} task${Number(open) === 1 ? "" : "s"} open`,
        body: `${pct}% of tasks done. Either cut scope, move the date, or block time this week.`,
        clientId: project.clientId,
        projectId: project.id,
        entityType: "project",
        entityId: project.id,
        actions: [{ kind: "open", label: "Open project", payload: { href: `/projects/${project.id}` } }],
        score: score(severity, Math.max(0, 20 - (until ?? 0) * 2)),
      });
    }
    return out;
  },
};

/* -------------------------------------------------------------------- inbox */

const awaitingReply: Rule = {
  name: "email_awaiting_reply",
  description: "Someone asked you something and you haven't answered.",
  run: async ({ now }) => {
    const cutoff = subDays(now, 2);
    const rows = await db
      .select({ message: messages, client: clients })
      .from(messages)
      .leftJoin(clients, eq(messages.clientId, clients.id))
      .where(and(eq(messages.awaitingReply, true), lte(messages.receivedAt, cutoff)));

    return rows.map(({ message, client }) => {
      const waiting = daysSince(message.receivedAt, now) ?? 0;
      const severity = waiting >= 7 ? "urgent" : "important";
      return {
        key: `email_awaiting_reply:${message.id}`,
        rule: "email_awaiting_reply",
        severity: severity as DraftSignal["severity"],
        title: `${waiting} days unanswered: ${message.subject ?? "(no subject)"}`,
        body: `From ${message.fromName ?? message.fromEmail} — "${(message.snippet ?? "").slice(0, 160)}"`,
        clientId: message.clientId,
        entityType: "message",
        entityId: message.id,
        actions: [
          { kind: "create_task", label: "Task it", payload: { title: `Reply: ${message.subject}`, clientId: message.clientId, priority: 2, source: "email", sourceRef: message.id } },
          { kind: "ask_claude", label: "Draft a reply", payload: { messageId: message.id } },
        ],
        score: score(severity, Math.min(25, waiting * 4)),
      };
    });
  },
};

/* ----------------------------------------------------------------- calendar */

const meetingPrep: Rule = {
  name: "meeting_prep",
  description: "An external meeting is coming and nothing is prepared.",
  run: async ({ now }) => {
    const horizon = addDays(now, 2);
    const rows = await db
      .select({ event: calendarEvents, client: clients })
      .from(calendarEvents)
      .leftJoin(clients, eq(calendarEvents.clientId, clients.id))
      .where(
        and(
          eq(calendarEvents.isExternal, true),
          gte(calendarEvents.startsAt, now),
          lte(calendarEvents.startsAt, horizon),
          isNull(calendarEvents.prepTaskId),
        ),
      );

    return rows.map(({ event, client }) => {
      const hours = Math.max(0, Math.round((event.startsAt.getTime() - now.getTime()) / 3_600_000));
      const severity = hours <= 6 ? "urgent" : "important";
      return {
        key: `meeting_prep:${event.id}`,
        rule: "meeting_prep",
        severity: severity as DraftSignal["severity"],
        title: `Prep needed: ${event.title}`,
        body: `${relativeDay(event.startsAt)} with ${
          (event.attendees ?? []).map((a) => a.name ?? a.email).slice(0, 3).join(", ") || "external attendees"
        }. Walk in with an agenda and the numbers.`,
        clientId: event.clientId,
        projectId: event.projectId,
        entityType: "event",
        entityId: event.id,
        actions: [
          { kind: "create_task", label: "Add prep task", payload: { title: `Prep: ${event.title}`, clientId: event.clientId, projectId: event.projectId, dueDate: event.startsAt, priority: 1, source: "calendar", sourceRef: event.id } },
          { kind: "ask_claude", label: "Build me an agenda", payload: { eventId: event.id } },
        ],
        score: score(severity, Math.max(0, 30 - hours)),
      };
    });
  },
};

const meetingFollowUp: Rule = {
  name: "meeting_follow_up",
  description: "A meeting happened and nothing came out of it.",
  run: async ({ now }) => {
    const from = subDays(now, 5);
    const rows = await db
      .select({ event: calendarEvents, client: clients })
      .from(calendarEvents)
      .leftJoin(clients, eq(calendarEvents.clientId, clients.id))
      .where(
        and(
          eq(calendarEvents.isExternal, true),
          gte(calendarEvents.endsAt, from),
          lte(calendarEvents.endsAt, now),
          isNull(calendarEvents.followUpDoneAt),
        ),
      );

    const out: DraftSignal[] = [];
    for (const { event, client } of rows) {
      const since = daysSince(event.endsAt, now) ?? 0;
      if (since < 1) continue;

      // A logged note or a follow-up task both count as "handled".
      const notes = await db
        .select({ id: insights.id })
        .from(insights)
        .where(and(eq(insights.sourceRef, event.id)))
        .limit(1);
      if (notes.length > 0) continue;

      out.push({
        key: `meeting_follow_up:${event.id}`,
        rule: "meeting_follow_up",
        severity: (since >= 3 ? "important" : "fyi") as DraftSignal["severity"],
        title: `No follow-up from ${event.title}`,
        body: `Met ${relativeDay(event.endsAt)}. Capture what was decided while you still remember it — that is what makes the brain worth having.`,
        clientId: event.clientId,
        projectId: event.projectId,
        entityType: "event",
        entityId: event.id,
        actions: [
          { kind: "open", label: "Log the notes", payload: { href: `/brain/new?eventId=${event.id}` } },
          { kind: "create_task", label: "Send recap", payload: { title: `Send recap: ${event.title}`, clientId: event.clientId, priority: 2, source: "calendar", sourceRef: event.id } },
        ],
        score: score(since >= 3 ? "important" : "fyi", since * 3),
      });
    }
    return out;
  },
};

/* ------------------------------------------------------------- stakeholders */

const quietStakeholders: Rule = {
  name: "stakeholder_quiet",
  description: "A relationship you said you'd keep warm has gone cold.",
  run: async ({ now }) => {
    const rows = await db
      .select({ person: stakeholders, client: clients })
      .from(stakeholders)
      .leftJoin(clients, eq(stakeholders.clientId, clients.id))
      .where(and(ne(stakeholders.contactCadenceDays, 0)));

    return rows
      .map(({ person, client }) => {
        const since = daysSince(person.lastContactAt, now);
        const overdue = since === null ? 999 : since - person.contactCadenceDays;
        return { person, client, since, overdue };
      })
      .filter((r) => r.overdue > 0)
      .map(({ person, client, since, overdue }) => ({
        key: `stakeholder_quiet:${person.id}`,
        rule: "stakeholder_quiet",
        severity: (overdue > person.contactCadenceDays ? "important" : "fyi") as DraftSignal["severity"],
        title: `${person.name} hasn't heard from you in ${since === null ? "a while" : `${since} days`}`,
        body: `${person.role ?? "Stakeholder"} · you set a ${person.contactCadenceDays}-day cadence. A two-line update now beats an awkward call later.`,
        clientId: person.clientId,
        entityType: "stakeholder",
        entityId: person.id,
        actions: [
          { kind: "create_task", label: "Reach out", payload: { title: `Check in with ${person.name}`, clientId: person.clientId, priority: 3 } },
          { kind: "log_contact", label: "Already did", payload: { stakeholderId: person.id } },
        ],
        score: score(overdue > person.contactCadenceDays ? "important" : "fyi", Math.min(20, overdue)),
      }));
  },
};

/* --------------------------------------------------------------- ad metrics */

type MetricAgg = Record<string, number>;

async function aggregate(clientId: string, source: string, from: string, to: string): Promise<MetricAgg> {
  const rows = await db
    .select({ metric: metrics.metric, total: sql<number>`sum(${metrics.value})` })
    .from(metrics)
    .where(
      and(
        eq(metrics.clientId, clientId),
        eq(metrics.source, source),
        gte(metrics.date, from),
        lte(metrics.date, to),
      ),
    )
    .groupBy(metrics.metric);
  return Object.fromEntries(rows.map((r) => [r.metric, Number(r.total)]));
}

const SOURCE_LABEL: Record<string, string> = {
  ga4: "GA4",
  meta: "Meta Ads",
  linkedin: "LinkedIn Ads",
  google_ads: "Google Ads",
};

const metricAnomalies: Rule = {
  name: "metric_shift",
  description: "Week-over-week movement in spend, cost per conversion or traffic worth a look.",
  run: async ({ now }) => {
    const { current, previous } = comparisonWindows(7, now);
    const activeClients = await db.select().from(clients).where(eq(clients.status, "active"));
    const out: DraftSignal[] = [];

    for (const client of activeClients) {
      for (const source of ["meta", "google_ads", "linkedin", "ga4"]) {
        const [now_, prev] = await Promise.all([
          aggregate(client.id, source, current.start, current.end),
          aggregate(client.id, source, previous.start, previous.end),
        ]);
        if (Object.keys(now_).length === 0 || Object.keys(prev).length === 0) continue;

        const checks: { label: string; now: number; prev: number; goodDirection: "up" | "down" }[] = [];

        if (now_.spend && prev.spend) checks.push({ label: "spend", now: now_.spend, prev: prev.spend, goodDirection: "down" });
        if (now_.conversions && prev.conversions)
          checks.push({ label: "conversions", now: now_.conversions, prev: prev.conversions, goodDirection: "up" });
        if (now_.sessions && prev.sessions)
          checks.push({ label: "sessions", now: now_.sessions, prev: prev.sessions, goodDirection: "up" });
        if (now_.revenue && prev.revenue)
          checks.push({ label: "revenue", now: now_.revenue, prev: prev.revenue, goodDirection: "up" });
        if (now_.spend && now_.conversions && prev.spend && prev.conversions)
          checks.push({
            label: "cost per conversion",
            now: now_.spend / now_.conversions,
            prev: prev.spend / prev.conversions,
            goodDirection: "down",
          });

        for (const check of checks) {
          const delta = (check.now - check.prev) / check.prev;
          const pct = Math.round(delta * 100);
          if (Math.abs(pct) < 20) continue;

          const bad = check.goodDirection === "up" ? delta < 0 : delta > 0;
          // Rising spend on its own is not bad news — only flag it when it is not buying more.
          if (check.label === "spend" && delta > 0 && (now_.conversions ?? 0) >= (prev.conversions ?? 0)) continue;

          const severity = bad && Math.abs(pct) >= 50 ? "urgent" : bad ? "important" : "fyi";
          out.push({
            key: `metric_shift:${client.id}:${source}:${check.label}`,
            rule: "metric_shift",
            severity: severity as DraftSignal["severity"],
            title: `${client.name} · ${SOURCE_LABEL[source] ?? source} ${check.label} ${pct > 0 ? "up" : "down"} ${Math.abs(pct)}% WoW`,
            body: `${check.prev.toLocaleString(undefined, { maximumFractionDigits: 1 })} → ${check.now.toLocaleString(undefined, { maximumFractionDigits: 1 })} comparing ${current.start}–${current.end} against the week before.${
              bad ? " Worth a look before the client asks." : " Worth understanding so you can repeat it."
            }`,
            clientId: client.id,
            entityType: "metric",
            entityId: `${source}:${check.label}`,
            actions: [
              { kind: "open", label: "See the numbers", payload: { href: `/insights?client=${client.id}` } },
              { kind: "ask_claude", label: "Why did this move?", payload: { clientId: client.id, source, metric: check.label } },
            ],
            score: score(severity as keyof typeof SEVERITY_BASE, Math.min(25, Math.abs(pct) / 3)),
          });
        }
      }
    }
    return out;
  },
};

/* --------------------------------------------------------------- the brain */

const insightDrought: Rule = {
  name: "insight_drought",
  description: "An active client you have learned nothing new about in weeks.",
  run: async ({ now }) => {
    const cutoff = iso(subDays(now, 30));
    const rows = await db
      .select({
        client: clients,
        recent: sql<number>`(
          select count(*) from ${insights}
          where ${insights.clientId} = ${clients.id}
            and date(${insights.occurredAt}, 'unixepoch') >= ${cutoff}
        )`,
      })
      .from(clients)
      .where(eq(clients.status, "active"));

    return rows
      .filter((r) => Number(r.recent) === 0)
      .map(({ client }) => ({
        key: `insight_drought:${client.id}`,
        rule: "insight_drought",
        severity: "fyi" as const,
        title: `Nothing captured for ${client.name} in a month`,
        body: `You have been doing the work — the thinking behind it just isn't written down anywhere. One paragraph on what is working keeps this brain worth asking.`,
        clientId: client.id,
        entityType: "client",
        entityId: client.id,
        actions: [{ kind: "open", label: "Capture something", payload: { href: `/brain/new?client=${client.id}` } }],
        score: score("fyi", 5),
      }));
  },
};

export const RULES: Rule[] = [
  reportsDue,
  overdueTasks,
  stalledTasks,
  projectsWithoutNextAction,
  projectDeadlineRisk,
  awaitingReply,
  meetingPrep,
  meetingFollowUp,
  quietStakeholders,
  metricAnomalies,
  insightDrought,
];
