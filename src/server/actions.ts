"use server";

import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  clients,
  insights,
  milestones,
  projects,
  reportRuns,
  reportSchedules,
  signals,
  stakeholders,
  tasks,
} from "@/lib/db/schema";
import { addDays } from "@/lib/dates";
import { runProactiveEngine } from "@/lib/proactive/engine";
import { materializeReportRuns, nextDueDate, reportingPeriod, type Cadence } from "@/lib/reporting/schedule";
import { draftReport } from "@/lib/reporting/draft";
import { describeAiError } from "@/lib/ai/client";
import { syncAll } from "@/lib/integrations/sync";

function refresh(...paths: string[]) {
  for (const path of ["/", ...paths]) revalidatePath(path);
}

/* ------------------------------------------------------------------- tasks */

export async function createTask(input: {
  title: string;
  notes?: string;
  clientId?: string | null;
  projectId?: string | null;
  dueDate?: string | null;
  priority?: number;
  status?: string;
  waitingOn?: string | null;
  source?: string;
  sourceRef?: string | null;
}) {
  if (!input.title?.trim()) return { ok: false as const, error: "A task needs a title." };

  // A task on a project inherits that project's client, so filters stay honest.
  let clientId = input.clientId ?? null;
  if (!clientId && input.projectId) {
    const [project] = await db.select().from(projects).where(eq(projects.id, input.projectId)).limit(1);
    clientId = project?.clientId ?? null;
  }

  const [row] = await db
    .insert(tasks)
    .values({
      title: input.title.trim(),
      notes: input.notes?.trim() || null,
      clientId,
      projectId: input.projectId ?? null,
      dueDate: input.dueDate ? new Date(`${input.dueDate}T09:00:00`) : null,
      priority: Math.min(Math.max(input.priority ?? 2, 1), 4),
      status: input.status ?? "todo",
      waitingOn: input.waitingOn ?? null,
      source: input.source ?? "manual",
      sourceRef: input.sourceRef ?? null,
    })
    .returning();

  await recalcProjectProgress(row.projectId);
  refresh("/tasks", "/projects");
  return { ok: true as const, id: row.id };
}

export async function setTaskStatus(taskId: string, status: string) {
  const done = status === "done" || status === "dropped";
  await db
    .update(tasks)
    .set({ status, completedAt: done ? new Date() : null, lastTouchedAt: new Date() })
    .where(eq(tasks.id, taskId));

  const [row] = await db.select({ projectId: tasks.projectId }).from(tasks).where(eq(tasks.id, taskId)).limit(1);
  await recalcProjectProgress(row?.projectId ?? null);
  refresh("/tasks", "/projects");
  return { ok: true as const };
}

export async function updateTask(
  taskId: string,
  patch: { title?: string; notes?: string; dueDate?: string | null; priority?: number; projectId?: string | null; clientId?: string | null; waitingOn?: string | null },
) {
  await db
    .update(tasks)
    .set({
      ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes.trim() || null } : {}),
      ...(patch.dueDate !== undefined ? { dueDate: patch.dueDate ? new Date(`${patch.dueDate}T09:00:00`) : null } : {}),
      ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
      ...(patch.projectId !== undefined ? { projectId: patch.projectId } : {}),
      ...(patch.clientId !== undefined ? { clientId: patch.clientId } : {}),
      ...(patch.waitingOn !== undefined ? { waitingOn: patch.waitingOn } : {}),
      lastTouchedAt: new Date(),
    })
    .where(eq(tasks.id, taskId));

  refresh("/tasks", "/projects");
  return { ok: true as const };
}

export async function snoozeTask(taskId: string, days: number) {
  await db
    .update(tasks)
    .set({ dueDate: addDays(new Date(), days), lastTouchedAt: new Date() })
    .where(eq(tasks.id, taskId));
  refresh("/tasks");
  return { ok: true as const };
}

export async function deleteTask(taskId: string) {
  const [row] = await db.select({ projectId: tasks.projectId }).from(tasks).where(eq(tasks.id, taskId)).limit(1);
  await db.delete(tasks).where(eq(tasks.id, taskId));
  await recalcProjectProgress(row?.projectId ?? null);
  refresh("/tasks", "/projects");
  return { ok: true as const };
}

/** Project progress is derived from its tasks, so it can never be stale. */
async function recalcProjectProgress(projectId: string | null) {
  if (!projectId) return;
  const [row] = await db
    .select({
      total: sql<number>`sum(case when ${tasks.status} != 'dropped' then 1 else 0 end)`,
      done: sql<number>`sum(case when ${tasks.status} = 'done' then 1 else 0 end)`,
    })
    .from(tasks)
    .where(eq(tasks.projectId, projectId));

  const total = Number(row?.total ?? 0);
  const done = Number(row?.done ?? 0);
  await db
    .update(projects)
    .set({ progress: total === 0 ? 0 : Math.round((done / total) * 100) })
    .where(eq(projects.id, projectId));
}

/* ----------------------------------------------------------------- signals */

export async function dismissSignal(signalId: string) {
  await db.update(signals).set({ dismissedAt: new Date() }).where(eq(signals.id, signalId));
  refresh();
  return { ok: true as const };
}

export async function snoozeSignal(signalId: string, days: number) {
  await db.update(signals).set({ snoozedUntil: addDays(new Date(), days) }).where(eq(signals.id, signalId));
  refresh();
  return { ok: true as const };
}

/** Runs the action a signal offered, then marks the signal as acted on. */
export async function actOnSignal(signalId: string, actionIndex: number) {
  const [signal] = await db.select().from(signals).where(eq(signals.id, signalId)).limit(1);
  if (!signal) return { ok: false as const, error: "Signal not found." };

  const action = (signal.actions ?? [])[actionIndex];
  if (!action) return { ok: false as const, error: "That action is no longer available." };

  switch (action.kind) {
    case "create_task": {
      const payload = (action.payload ?? {}) as Record<string, any>;
      await createTask({
        title: payload.title ?? signal.title,
        clientId: payload.clientId ?? signal.clientId,
        projectId: payload.projectId ?? signal.projectId,
        priority: payload.priority ?? 2,
        dueDate: payload.dueDate ? new Date(payload.dueDate).toISOString().slice(0, 10) : null,
        source: payload.source ?? "proactive",
        sourceRef: payload.sourceRef ?? signal.entityId,
      });
      break;
    }
    case "complete_task": {
      const payload = (action.payload ?? {}) as Record<string, any>;
      if (payload.taskId) await setTaskStatus(payload.taskId, "done");
      if (payload.reportRunId) await markReportSent(payload.reportRunId);
      break;
    }
    case "log_contact": {
      const payload = (action.payload ?? {}) as Record<string, any>;
      if (payload.stakeholderId) {
        await db.update(stakeholders).set({ lastContactAt: new Date() }).where(eq(stakeholders.id, payload.stakeholderId));
      }
      break;
    }
    case "draft_report": {
      const payload = (action.payload ?? {}) as Record<string, any>;
      if (payload.reportRunId) {
        const result = await generateReportDraft(payload.reportRunId);
        if (!result.ok) return result;
      }
      break;
    }
    default:
      break;
  }

  await db.update(signals).set({ actedAt: new Date(), resolvedAt: new Date() }).where(eq(signals.id, signalId));
  refresh("/tasks", "/reports", "/projects");
  return { ok: true as const };
}

export async function runEngineNow() {
  await materializeReportRuns();
  const result = await runProactiveEngine();
  refresh("/reports");
  return { ok: true as const, result };
}

/* ---------------------------------------------------------------- insights */

export async function createInsight(input: {
  title: string;
  body: string;
  kind?: string;
  clientId?: string | null;
  projectId?: string | null;
  tags?: string[];
  confidence?: number;
  occurredAt?: string | null;
  sourceRef?: string | null;
}) {
  if (!input.title?.trim() || !input.body?.trim()) return { ok: false as const, error: "An entry needs a title and a body." };

  const [row] = await db
    .insert(insights)
    .values({
      title: input.title.trim(),
      body: input.body.trim(),
      kind: input.kind ?? "insight",
      clientId: input.clientId || null,
      projectId: input.projectId || null,
      tags: input.tags ?? [],
      confidence: Math.min(Math.max(input.confidence ?? 3, 1), 5),
      occurredAt: input.occurredAt ? new Date(`${input.occurredAt}T12:00:00`) : new Date(),
      sourceRef: input.sourceRef ?? null,
      source: "manual",
    })
    .returning();

  refresh("/insights", "/brain");
  return { ok: true as const, id: row.id };
}

export async function togglePinInsight(insightId: string) {
  const [row] = await db.select().from(insights).where(eq(insights.id, insightId)).limit(1);
  if (!row) return { ok: false as const, error: "Not found." };
  await db.update(insights).set({ pinned: !row.pinned }).where(eq(insights.id, insightId));
  refresh("/insights");
  return { ok: true as const };
}

export async function deleteInsight(insightId: string) {
  await db.delete(insights).where(eq(insights.id, insightId));
  refresh("/insights");
  return { ok: true as const };
}

/* --------------------------------------------------------- clients & work */

export async function createClient(input: { name: string; engagement?: string; color?: string; emailDomains?: string; monthlyValue?: number; notes?: string }) {
  if (!input.name?.trim()) return { ok: false as const, error: "A client needs a name." };

  const slug = input.name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  const [row] = await db
    .insert(clients)
    .values({
      name: input.name.trim(),
      slug: `${slug}-${Math.random().toString(36).slice(2, 6)}`,
      engagement: input.engagement ?? "retainer",
      color: input.color ?? "#6366f1",
      monthlyValue: input.monthlyValue ?? null,
      notes: input.notes?.trim() || null,
      emailDomains: (input.emailDomains ?? "")
        .split(",")
        .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
        .filter(Boolean),
    })
    .returning();

  refresh("/projects", "/settings");
  return { ok: true as const, id: row.id };
}

export async function createProject(input: { name: string; clientId?: string | null; goal?: string; dueDate?: string | null; status?: string }) {
  if (!input.name?.trim()) return { ok: false as const, error: "A project needs a name." };

  const [row] = await db
    .insert(projects)
    .values({
      name: input.name.trim(),
      clientId: input.clientId || null,
      goal: input.goal?.trim() || null,
      status: input.status ?? "active",
      startDate: new Date(),
      dueDate: input.dueDate ? new Date(`${input.dueDate}T17:00:00`) : null,
    })
    .returning();

  refresh("/projects");
  return { ok: true as const, id: row.id };
}

export async function updateProject(
  projectId: string,
  patch: { name?: string; goal?: string; status?: string; health?: string; dueDate?: string | null },
) {
  await db
    .update(projects)
    .set({
      ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
      ...(patch.goal !== undefined ? { goal: patch.goal.trim() || null } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.health !== undefined ? { health: patch.health } : {}),
      ...(patch.dueDate !== undefined ? { dueDate: patch.dueDate ? new Date(`${patch.dueDate}T17:00:00`) : null } : {}),
    })
    .where(eq(projects.id, projectId));

  refresh("/projects", `/projects/${projectId}`);
  return { ok: true as const };
}

export async function createMilestone(input: { projectId: string; name: string; dueDate: string }) {
  await db.insert(milestones).values({
    projectId: input.projectId,
    name: input.name.trim(),
    dueDate: new Date(`${input.dueDate}T17:00:00`),
  });
  refresh(`/projects/${input.projectId}`);
  return { ok: true as const };
}

export async function toggleMilestone(milestoneId: string) {
  const [row] = await db.select().from(milestones).where(eq(milestones.id, milestoneId)).limit(1);
  if (!row) return { ok: false as const, error: "Not found." };
  await db
    .update(milestones)
    .set({ completedAt: row.completedAt ? null : new Date() })
    .where(eq(milestones.id, milestoneId));
  refresh(`/projects/${row.projectId}`);
  return { ok: true as const };
}

export async function createStakeholder(input: {
  clientId: string;
  name: string;
  email?: string;
  role?: string;
  contactCadenceDays?: number;
  receivesReports?: boolean;
}) {
  await db.insert(stakeholders).values({
    clientId: input.clientId,
    name: input.name.trim(),
    email: input.email?.trim().toLowerCase() || null,
    role: input.role?.trim() || null,
    contactCadenceDays: input.contactCadenceDays ?? 0,
    receivesReports: input.receivesReports ?? false,
  });
  refresh("/settings", "/projects");
  return { ok: true as const };
}

export async function logStakeholderContact(stakeholderId: string) {
  await db.update(stakeholders).set({ lastContactAt: new Date() }).where(eq(stakeholders.id, stakeholderId));
  refresh();
  return { ok: true as const };
}

/* --------------------------------------------------------------- reporting */

export async function createReportSchedule(input: {
  clientId: string;
  name: string;
  cadence: Cadence;
  dayOf: number;
  leadDays?: number;
  sources?: string[];
  template?: string;
  recipients?: string;
}) {
  if (!input.clientId) return { ok: false as const, error: "Pick a client for this report." };

  const dueAt = nextDueDate({ cadence: input.cadence, dayOf: input.dayOf });

  const [schedule] = await db
    .insert(reportSchedules)
    .values({
      clientId: input.clientId,
      name: input.name.trim() || "Performance report",
      cadence: input.cadence,
      dayOf: input.dayOf,
      leadDays: input.leadDays ?? 3,
      sources: input.sources ?? [],
      template: input.template?.trim() || null,
      recipients: (input.recipients ?? "")
        .split(",")
        .map((r) => r.trim())
        .filter(Boolean),
      nextDueAt: dueAt,
    })
    .returning();

  const period = reportingPeriod(input.cadence, dueAt);
  await db.insert(reportRuns).values({
    scheduleId: schedule.id,
    clientId: input.clientId,
    periodStart: period.start,
    periodEnd: period.end,
    dueAt,
    status: "pending",
  });

  refresh("/reports");
  return { ok: true as const, id: schedule.id };
}

export async function toggleReportSchedule(scheduleId: string) {
  const [row] = await db.select().from(reportSchedules).where(eq(reportSchedules.id, scheduleId)).limit(1);
  if (!row) return { ok: false as const, error: "Not found." };
  await db.update(reportSchedules).set({ active: !row.active }).where(eq(reportSchedules.id, scheduleId));
  refresh("/reports");
  return { ok: true as const };
}

export async function generateReportDraft(runId: string) {
  try {
    const draft = await draftReport(runId);
    await db.update(reportRuns).set({ draft, status: "drafted" }).where(eq(reportRuns.id, runId));
    refresh("/reports", `/reports/${runId}`);
    return { ok: true as const };
  } catch (error) {
    return { ok: false as const, error: describeAiError(error) };
  }
}

export async function saveReportDraft(runId: string, draft: string) {
  await db.update(reportRuns).set({ draft, status: draft.trim() ? "drafted" : "pending" }).where(eq(reportRuns.id, runId));
  refresh("/reports", `/reports/${runId}`);
  return { ok: true as const };
}

export async function markReportSent(runId: string) {
  const [run] = await db.select().from(reportRuns).where(eq(reportRuns.id, runId)).limit(1);
  if (!run) return { ok: false as const, error: "Report not found." };

  await db.update(reportRuns).set({ status: "sent", sentAt: new Date() }).where(eq(reportRuns.id, runId));

  if (run.scheduleId) {
    await db.update(reportSchedules).set({ lastSentAt: new Date() }).where(eq(reportSchedules.id, run.scheduleId));
    // Queue the next one immediately so the cadence never silently stops.
    await materializeReportRuns();
  }

  // Everyone on the distribution list has now heard from us.
  await db
    .update(stakeholders)
    .set({ lastContactAt: new Date() })
    .where(and(eq(stakeholders.clientId, run.clientId), eq(stakeholders.receivesReports, true)));

  refresh("/reports", `/reports/${runId}`);
  return { ok: true as const };
}

/* ------------------------------------------------------------ integrations */

export async function syncNow(provider?: string) {
  const outcomes = await syncAll(provider ? { only: provider } : {});
  await runEngineNow();
  refresh("/settings", "/insights");
  return { ok: true as const, outcomes };
}
