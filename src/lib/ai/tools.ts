import type Anthropic from "@anthropic-ai/sdk";
import { and, desc, eq, gte, inArray, like, lte, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  calendarEvents,
  clients,
  documents,
  insights,
  milestones,
  projects,
  reportRuns,
  stakeholders,
  tasks,
} from "@/lib/db/schema";
import { addDays, iso, relativeDay, subDays } from "@/lib/dates";
import { compare, formatMetric, metricLabel, totalsFor } from "@/lib/metrics";

/**
 * The tools Claude gets when it acts as the second brain. Read tools are
 * unrestricted; write tools are deliberately narrow — it can capture an
 * insight or add a task, but it cannot delete anything or touch integrations.
 */
export const BRAIN_TOOLS: Anthropic.Tool[] = [
  {
    name: "search_brain",
    description:
      "Search everything written down: captured insights, learnings, decisions and meeting notes, plus client documents — briefs, strategy, brand guidelines, ways of working. Use this first for any question about what was learned, decided, agreed or written. Matches on title and body text.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Free text to match. Keep it short — one or two keywords beat a sentence." },
        client: { type: "string", description: "Client name or id to scope to." },
        kind: {
          type: "string",
          enum: ["insight", "learning", "benchmark", "idea", "meeting_note", "decision", "reference"],
        },
        include: {
          type: "string",
          enum: ["all", "insights", "documents"],
          description: "Default all. Documents are reference material read whole; insights are individual findings.",
        },
        limit: { type: "number", description: "Default 12, max 40." },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: "list_work",
    description:
      "List tasks and projects. Use for 'what's on my plate', 'what's open for client X', 'what's overdue', and anything about workload.",
    input_schema: {
      type: "object",
      properties: {
        client: { type: "string" },
        status: {
          type: "string",
          enum: ["open", "todo", "doing", "waiting", "done", "all"],
          description: "'open' means todo + doing + waiting. Defaults to open.",
        },
        dueWithinDays: { type: "number", description: "Only tasks due within this many days." },
        includeProjects: { type: "boolean", description: "Also return the project list. Default true." },
        limit: { type: "number" },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: "get_metrics",
    description:
      "Marketing performance numbers from GA4, Meta, LinkedIn and Google Ads, with period-over-period comparison. Use for any question about spend, traffic, conversions, cost per conversion, ROAS or how a channel is doing.",
    input_schema: {
      type: "object",
      properties: {
        client: { type: "string", description: "Client name or id. Omit for all clients combined." },
        sources: {
          type: "array",
          items: { type: "string", enum: ["ga4", "meta", "linkedin", "google_ads"] },
        },
        days: { type: "number", description: "Window length in days, compared against the preceding window. Default 28." },
        from: { type: "string", description: "YYYY-MM-DD. Use with 'to' for a fixed period instead of 'days'." },
        to: { type: "string", description: "YYYY-MM-DD." },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: "get_schedule",
    description:
      "Upcoming calendar events and report deadlines. Use for 'what's my week look like', meeting prep, and anything time-boxed.",
    input_schema: {
      type: "object",
      properties: {
        days: { type: "number", description: "How far ahead to look. Default 7." },
        client: { type: "string" },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: "get_client_brief",
    description:
      "Everything on one client in one call: engagement details, active projects, open tasks, stakeholders, recent insights and headline numbers. Use this when the question is about a specific client.",
    input_schema: {
      type: "object",
      properties: { client: { type: "string", description: "Client name or id." } },
      required: ["client"],
      additionalProperties: false,
    },
  },
  {
    name: "capture_insight",
    description:
      "Save something worth remembering into the brain — a learning, a decision, a benchmark, a meeting note. Only call this when the user is telling you something new, or explicitly asks you to save it. Do not save your own analysis unless asked.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "One line, specific. 'LinkedIn CPL 3x Meta for enterprise leads' beats 'LinkedIn observations'." },
        body: { type: "string", description: "The detail, in the user's own framing where possible." },
        kind: {
          type: "string",
          enum: ["insight", "learning", "benchmark", "idea", "meeting_note", "decision", "reference"],
        },
        client: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
        confidence: { type: "number", description: "1-5, how well evidenced this is. Default 3." },
      },
      required: ["title", "body"],
      additionalProperties: false,
    },
  },
  {
    name: "save_draft",
    description:
      "Save a piece of work into the client's documents — a drafted post, a content plan, a competitor briefing, a review. ONLY call this when the user has asked for the work to be saved, filed or kept. If they simply asked you to write or plan something, put it in your reply and offer to file it instead; an unasked-for document is clutter they have to clean up. Never save a conversational answer.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Specific enough to find in a year. Include the client and what it is." },
        body: { type: "string", description: "The full piece, in markdown. Save the work itself, not a summary of it." },
        client: { type: "string", description: "Client name or id. Omit only if it genuinely belongs to no client." },
        project: {
          type: "string",
          description: "Project name or id, when the work belongs to one. Filing it under the project is what stops it becoming loose material later.",
        },
        kind: {
          type: "string",
          enum: ["brief", "strategy", "brand", "process", "research", "reference", "note"],
        },
      },
      required: ["title", "body"],
      additionalProperties: false,
    },
  },
  {
    name: "create_project",
    description:
      "Create a project — a body of work with an end state, like a campaign, an audit, a launch, or a workstream agreed in a meeting. Use this when several tasks belong together under one outcome. Do not create a project for a single task.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Short and recognisable. 'Paid media plan across markets', not 'Marketing'." },
        client: { type: "string" },
        goal: { type: "string", description: "What done looks like, ideally measurable. This is the field that makes a project worth having." },
        dueDate: { type: "string", description: "YYYY-MM-DD, when it should be finished, if a date was discussed." },
      },
      required: ["name"],
      additionalProperties: false,
    },
  },
  {
    name: "create_milestone",
    description:
      "Add a dated milestone to a project — a fixed point other people are counting on, like a webinar, a launch, or a deadline. Only for things with a real date.",
    input_schema: {
      type: "object",
      properties: {
        project: { type: "string", description: "Project name or id." },
        name: { type: "string" },
        dueDate: { type: "string", description: "YYYY-MM-DD." },
      },
      required: ["project", "name", "dueDate"],
      additionalProperties: false,
    },
  },
  {
    name: "add_person",
    description:
      "Record someone at a client — a contact, decision maker or partner mentioned in a meeting. Set a contact cadence when they are someone the relationship depends on.",
    input_schema: {
      type: "object",
      properties: {
        client: { type: "string" },
        name: { type: "string" },
        role: { type: "string" },
        email: { type: "string" },
        contactCadenceDays: {
          type: "number",
          description: "How often they should hear from us, in days. 0 for no cadence. Only set this when it was actually discussed or is clearly warranted.",
        },
      },
      required: ["client", "name"],
      additionalProperties: false,
    },
  },
  {
    name: "update_client_context",
    description:
      "Update a client's standing context — the few lines you would tell a colleague taking the account over. Read the existing context first and build on it rather than replacing what is already true. This is sent to every specialist with every question about them, so keep it short and durable.",
    input_schema: {
      type: "object",
      properties: {
        client: { type: "string" },
        notes: { type: "string", description: "The full replacement text, including anything still true from before." },
      },
      required: ["client", "notes"],
      additionalProperties: false,
    },
  },
  {
    name: "create_task",
    description:
      "Add a task. Use when the user commits to doing something, or asks you to remind them. Keep titles action-shaped: start with a verb.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        notes: { type: "string" },
        client: { type: "string" },
        project: { type: "string", description: "Project name or id." },
        dueInDays: { type: "number", description: "Relative due date. Use this rather than an absolute date where you can." },
        dueDate: { type: "string", description: "YYYY-MM-DD, if a specific date was named." },
        priority: { type: "number", description: "1 highest to 4 lowest. Default 2." },
      },
      required: ["title"],
      additionalProperties: false,
    },
  },
];

/* ------------------------------------------------------------------ lookups */

async function resolveClient(nameOrId?: string) {
  if (!nameOrId) return null;
  const rows = await db
    .select()
    .from(clients)
    .where(
      or(
        eq(clients.id, nameOrId),
        eq(clients.slug, nameOrId.toLowerCase()),
        like(clients.name, `%${nameOrId}%`),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

const OPEN_STATUSES = ["todo", "doing", "waiting"];

/* ---------------------------------------------------------------- execution */

export type ToolResult = { text: string; data?: unknown };

/** Who is calling, so anything written records who produced it. */
export type ToolContext = { agentKey?: string };

export async function runBrainTool(
  name: string,
  input: Record<string, any>,
  context: ToolContext = {},
): Promise<ToolResult> {
  switch (name) {
    case "search_brain":
      return searchBrain(input);
    case "list_work":
      return listWork(input);
    case "get_metrics":
      return getMetrics(input);
    case "get_schedule":
      return getSchedule(input);
    case "get_client_brief":
      return getClientBrief(input);
    case "capture_insight":
      return captureInsight(input);
    case "create_project":
      return createProjectTool(input);
    case "create_milestone":
      return createMilestoneTool(input);
    case "add_person":
      return addPerson(input);
    case "update_client_context":
      return updateClientContext(input);
    case "save_draft":
      return saveDraft(input, context);
    case "create_task":
      return createTaskTool(input);
    default:
      return { text: `Unknown tool: ${name}` };
  }
}

async function searchBrain(input: any): Promise<ToolResult> {
  const client = await resolveClient(input.client);
  const limit = Math.min(input.limit ?? 12, 40);
  const where = [];
  if (input.query) {
    const q = `%${String(input.query).toLowerCase()}%`;
    where.push(or(like(sql`lower(${insights.title})`, q), like(sql`lower(${insights.body})`, q)));
  }
  if (client) where.push(eq(insights.clientId, client.id));
  if (input.kind) where.push(eq(insights.kind, input.kind));

  const rows = await db
    .select({ insight: insights, clientName: clients.name })
    .from(insights)
    .leftJoin(clients, eq(insights.clientId, clients.id))
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(insights.pinned), desc(insights.occurredAt))
    .limit(limit);

  // Documents are reference material and usually the better answer to "what did
  // we agree", so they are searched alongside insights unless excluded.
  const include = input.include ?? "all";
  let docRows: { doc: typeof documents.$inferSelect; clientName: string | null }[] = [];

  if (include !== "insights") {
    const docWhere = [];
    if (input.query) {
      const q = `%${String(input.query).toLowerCase()}%`;
      docWhere.push(or(like(sql`lower(${documents.title})`, q), like(sql`lower(${documents.body})`, q)));
    }
    if (client) docWhere.push(eq(documents.clientId, client.id));

    docRows = await db
      .select({ doc: documents, clientName: clients.name })
      .from(documents)
      .leftJoin(clients, eq(documents.clientId, clients.id))
      .where(docWhere.length ? and(...docWhere) : undefined)
      .orderBy(desc(documents.pinned), desc(documents.updatedAt))
      .limit(limit);
  }

  if (rows.length === 0 && docRows.length === 0) {
    return { text: `Nothing found${input.query ? ` for "${input.query}"` : ""}. The brain may simply not have this yet — say so rather than guessing.` };
  }

  const insightText = rows
    .map(
      ({ insight, clientName }) =>
        `[${insight.kind}] ${insight.title}\n  ${clientName ? `client: ${clientName} · ` : ""}${iso(insight.occurredAt)} · confidence ${insight.confidence}/5${
          insight.tags?.length ? ` · ${insight.tags.join(", ")}` : ""
        }\n  ${insight.body.replace(/\s+/g, " ").slice(0, 600)}`,
    )
    .join("\n\n");

  // Documents get a bigger slice each: they are written to be read as a whole,
  // and truncating a brief to two lines makes it useless.
  const docText = docRows
    .map(
      ({ doc, clientName }) =>
        `[document · ${doc.kind}] ${doc.title}\n  ${clientName ? `client: ${clientName} · ` : ""}updated ${iso(doc.updatedAt)}\n  ${doc.body.replace(/\s+/g, " ").slice(0, 2000)}`,
    )
    .join("\n\n");

  const parts = [
    docRows.length ? `${docRows.length} document${docRows.length === 1 ? "" : "s"}:\n\n${docText}` : "",
    rows.length ? `${rows.length} captured entr${rows.length === 1 ? "y" : "ies"}:\n\n${insightText}` : "",
  ].filter(Boolean);

  return { text: parts.join("\n\n---\n\n") };
}

async function listWork(input: any): Promise<ToolResult> {
  const client = await resolveClient(input.client);
  const status: string = input.status ?? "open";
  const where = [];

  if (status === "open") where.push(inArray(tasks.status, OPEN_STATUSES));
  else if (status !== "all") where.push(eq(tasks.status, status));
  if (client) where.push(eq(tasks.clientId, client.id));
  if (input.dueWithinDays != null) where.push(lte(tasks.dueDate, addDays(new Date(), input.dueWithinDays)));

  const rows = await db
    .select({ task: tasks, clientName: clients.name, projectName: projects.name })
    .from(tasks)
    .leftJoin(clients, eq(tasks.clientId, clients.id))
    .leftJoin(projects, eq(tasks.projectId, projects.id))
    .where(where.length ? and(...where) : undefined)
    .orderBy(tasks.priority, tasks.dueDate)
    .limit(Math.min(input.limit ?? 40, 100));

  const taskLines = rows.map(
    ({ task, clientName, projectName }) =>
      `- [P${task.priority}] ${task.title} — ${task.status}${task.dueDate ? `, due ${relativeDay(task.dueDate)}` : ", no due date"}${
        clientName ? ` (${clientName}${projectName ? ` / ${projectName}` : ""})` : ""
      }${task.status === "waiting" && task.waitingOn ? ` — waiting on ${task.waitingOn}` : ""}`,
  );

  let text = rows.length ? `${rows.length} tasks:\n${taskLines.join("\n")}` : "No matching tasks.";

  if (input.includeProjects !== false) {
    const pWhere = [eq(projects.status, "active")];
    if (client) pWhere.push(eq(projects.clientId, client.id));
    const pRows = await db
      .select({ project: projects, clientName: clients.name })
      .from(projects)
      .leftJoin(clients, eq(projects.clientId, clients.id))
      .where(and(...pWhere))
      .limit(30);
    if (pRows.length) {
      text += `\n\nActive projects:\n${pRows
        .map(
          ({ project, clientName }) =>
            `- ${project.name}${clientName ? ` (${clientName})` : ""} — ${project.health.replace("_", " ")}, ${project.progress}% done${
              project.dueDate ? `, due ${relativeDay(project.dueDate)}` : ""
            }${project.goal ? `\n    goal: ${project.goal}` : ""}`,
        )
        .join("\n")}`;
    }
  }

  return { text };
}

async function getMetrics(input: any): Promise<ToolResult> {
  const client = await resolveClient(input.client);
  const currency = client?.currency ?? "DKK";

  if (input.from && input.to) {
    const totals = await totalsFor({ clientId: client?.id, sources: input.sources, from: input.from, to: input.to });
    if (Object.keys(totals).length === 0) return { text: "No metric data for that period. Check whether the integration is connected and synced." };
    const text = Object.entries(totals)
      .map(
        ([source, t]) =>
          `${source}: ${Object.entries(t)
            .map(([m, v]) => `${metricLabel(m)} ${formatMetric(m, v, currency)}`)
            .join(", ")}`,
      )
      .join("\n");
    return { text: `${client?.name ?? "All clients"} · ${input.from} → ${input.to}\n${text}` };
  }

  const days = input.days ?? 28;
  const rows = await compare({ clientId: client?.id, sources: input.sources, days });
  if (rows.length === 0) return { text: "No metric data available yet for that scope." };

  const bySource = new Map<string, typeof rows>();
  for (const r of rows) {
    if (!bySource.has(r.source)) bySource.set(r.source, []);
    bySource.get(r.source)!.push(r);
  }

  const text = [...bySource.entries()]
    .map(([source, list]) => {
      const lines = list
        .filter((r) => r.current !== 0 || r.previous !== 0)
        .map(
          (r) =>
            `  ${metricLabel(r.metric)}: ${formatMetric(r.metric, r.current, currency)} (prev ${formatMetric(
              r.metric,
              r.previous,
              currency,
            )}${r.changePct === null ? "" : `, ${r.changePct >= 0 ? "+" : ""}${r.changePct.toFixed(1)}%`})`,
        );
      return `${source}\n${lines.join("\n")}`;
    })
    .join("\n\n");

  return {
    text: `${client?.name ?? "All clients"} · last ${days} days vs the ${days} before\n\n${text}\n\nCurrency: ${currency}. Percentages are period over period.`,
  };
}

async function getSchedule(input: any): Promise<ToolResult> {
  const days = input.days ?? 7;
  const client = await resolveClient(input.client);
  const horizon = addDays(new Date(), days);

  const eventWhere = [gte(calendarEvents.startsAt, new Date()), lte(calendarEvents.startsAt, horizon)];
  if (client) eventWhere.push(eq(calendarEvents.clientId, client.id));

  const events = await db
    .select({ event: calendarEvents, clientName: clients.name })
    .from(calendarEvents)
    .leftJoin(clients, eq(calendarEvents.clientId, clients.id))
    .where(and(...eventWhere))
    .orderBy(calendarEvents.startsAt)
    .limit(50);

  const reportWhere = [lte(reportRuns.dueAt, addDays(new Date(), Math.max(days, 21))), inArray(reportRuns.status, ["pending", "drafted"])];
  if (client) reportWhere.push(eq(reportRuns.clientId, client.id));

  const reports = await db
    .select({ run: reportRuns, clientName: clients.name })
    .from(reportRuns)
    .innerJoin(clients, eq(reportRuns.clientId, clients.id))
    .where(and(...reportWhere))
    .orderBy(reportRuns.dueAt);

  const eventText = events.length
    ? events
        .map(
          ({ event, clientName }) =>
            `- ${iso(event.startsAt)} ${event.startsAt.toISOString().slice(11, 16)} ${event.title}${clientName ? ` (${clientName})` : ""}${
              event.isExternal ? " [external]" : ""
            }`,
        )
        .join("\n")
    : "Nothing on the calendar.";

  const reportText = reports.length
    ? reports
        .map(({ run, clientName }) => `- ${clientName} report due ${relativeDay(run.dueAt)} (${run.periodStart} → ${run.periodEnd}), status ${run.status}`)
        .join("\n")
    : "No reports due.";

  return { text: `Next ${days} days:\n${eventText}\n\nReports:\n${reportText}` };
}

async function getClientBrief(input: any): Promise<ToolResult> {
  const client = await resolveClient(input.client);
  if (!client) return { text: `No client matching "${input.client}". Say so rather than guessing which client was meant.` };

  const [projectRows, taskRows, people, recentInsights, metricRows, docRows] = await Promise.all([
    db.select().from(projects).where(eq(projects.clientId, client.id)).orderBy(desc(projects.updatedAt)).limit(20),
    db
      .select()
      .from(tasks)
      .where(and(eq(tasks.clientId, client.id), inArray(tasks.status, OPEN_STATUSES)))
      .orderBy(tasks.priority, tasks.dueDate)
      .limit(25),
    db.select().from(stakeholders).where(eq(stakeholders.clientId, client.id)),
    db.select().from(insights).where(eq(insights.clientId, client.id)).orderBy(desc(insights.occurredAt)).limit(10),
    compare({ clientId: client.id, days: 28 }),
    db.select().from(documents).where(eq(documents.clientId, client.id)).orderBy(desc(documents.pinned), desc(documents.updatedAt)).limit(12),
  ]);

  const sections = [
    `# ${client.name}`,
    `${client.engagement} engagement, ${client.status}${client.monthlyValue ? `, ${client.currency} ${client.monthlyValue.toLocaleString()}/mo` : ""}`,
    client.notes ? `Notes: ${client.notes}` : "",
    ``,
    `## Projects (${projectRows.length})`,
    projectRows.length
      ? projectRows
          .map((p) => `- ${p.name} — ${p.status}, ${p.health.replace("_", " ")}, ${p.progress}%${p.dueDate ? `, due ${relativeDay(p.dueDate)}` : ""}${p.goal ? `\n    goal: ${p.goal}` : ""}`)
          .join("\n")
      : "None.",
    ``,
    `## Open tasks (${taskRows.length})`,
    taskRows.length
      ? taskRows.map((t) => `- [P${t.priority}] ${t.title} (${t.status}${t.dueDate ? `, due ${relativeDay(t.dueDate)}` : ""})`).join("\n")
      : "None.",
    ``,
    `## Stakeholders`,
    people.length
      ? people.map((s) => `- ${s.name}${s.role ? `, ${s.role}` : ""}${s.email ? ` <${s.email}>` : ""}${s.lastContactAt ? ` — last contact ${relativeDay(s.lastContactAt)}` : ""}`).join("\n")
      : "None recorded.",
    ``,
    `## Documents (${docRows.length})`,
    docRows.length
      ? docRows.map((d) => `- [${d.kind}] ${d.title}${d.pinned ? " (pinned)" : ""}\n    ${d.body.replace(/\s+/g, " ").slice(0, 700)}`).join("\n")
      : "None yet.",
    ``,
    `## Recent captures`,
    recentInsights.length
      ? recentInsights.map((i) => `- [${i.kind}] ${i.title} (${iso(i.occurredAt)})\n    ${i.body.replace(/\s+/g, " ").slice(0, 300)}`).join("\n")
      : "Nothing captured yet.",
    ``,
    `## Performance, last 28 days vs prior 28`,
    metricRows.length
      ? metricRows
          .filter((r) => ["spend", "conversions", "sessions", "revenue", "cost_per_conversion", "roas"].includes(r.metric))
          .map(
            (r) =>
              `- ${r.source} ${metricLabel(r.metric)}: ${formatMetric(r.metric, r.current, client.currency)}${
                r.changePct === null ? "" : ` (${r.changePct >= 0 ? "+" : ""}${r.changePct.toFixed(1)}%)`
              }`,
          )
          .join("\n")
      : "No connected metric data.",
  ];

  return { text: sections.filter((s) => s !== "").join("\n") };
}

async function captureInsight(input: any): Promise<ToolResult> {
  const client = await resolveClient(input.client);
  const [row] = await db
    .insert(insights)
    .values({
      title: input.title,
      body: input.body,
      kind: input.kind ?? "insight",
      clientId: client?.id ?? null,
      tags: input.tags ?? [],
      confidence: Math.min(Math.max(input.confidence ?? 3, 1), 5),
      source: "claude",
    })
    .returning();

  return { text: `Saved to the brain: "${row.title}"${client ? ` under ${client.name}` : ""}.`, data: row.id };
}

async function resolveProject(nameOrId: string) {
  const rows = await db
    .select()
    .from(projects)
    .where(or(eq(projects.id, nameOrId), like(projects.name, `%${nameOrId}%`)))
    .limit(1);
  return rows[0] ?? null;
}

async function createProjectTool(input: any): Promise<ToolResult> {
  const client = await resolveClient(input.client);

  const [row] = await db
    .insert(projects)
    .values({
      name: input.name.trim(),
      clientId: client?.id ?? null,
      goal: input.goal?.trim() || null,
      status: "active",
      startDate: new Date(),
      dueDate: input.dueDate ? new Date(`${input.dueDate}T17:00:00`) : null,
    })
    .returning();

  return {
    text: `Project created: "${row.name}"${client ? ` for ${client.name}` : ""}${row.goal ? `, goal: ${row.goal}` : " — no goal set, which is worth fixing"}.`,
    data: row.id,
  };
}

async function createMilestoneTool(input: any): Promise<ToolResult> {
  const project = await resolveProject(input.project);
  if (!project) return { text: `No project matching "${input.project}". Create it first, then add the milestone.` };

  await db.insert(milestones).values({
    projectId: project.id,
    name: input.name.trim(),
    dueDate: new Date(`${input.dueDate}T17:00:00`),
  });

  return { text: `Milestone "${input.name}" added to ${project.name} for ${input.dueDate}.` };
}

async function addPerson(input: any): Promise<ToolResult> {
  const client = await resolveClient(input.client);
  if (!client) return { text: `No client matching "${input.client}".` };

  const [row] = await db
    .insert(stakeholders)
    .values({
      clientId: client.id,
      name: input.name.trim(),
      role: input.role?.trim() || null,
      email: input.email?.trim().toLowerCase() || null,
      contactCadenceDays: Math.max(0, Math.round(input.contactCadenceDays ?? 0)),
    })
    .returning();

  return {
    text: `${row.name} added to ${client.name}${row.role ? ` as ${row.role}` : ""}${
      row.contactCadenceDays ? `, with a ${row.contactCadenceDays}-day contact cadence` : ""
    }.`,
  };
}

async function updateClientContext(input: any): Promise<ToolResult> {
  const client = await resolveClient(input.client);
  if (!client) return { text: `No client matching "${input.client}".` };

  await db.update(clients).set({ notes: input.notes.trim() }).where(eq(clients.id, client.id));
  return { text: `Standing context updated for ${client.name}. Every specialist now sees this with every question about them.` };
}

async function saveDraft(input: any, context: ToolContext): Promise<ToolResult> {
  const client = await resolveClient(input.client);

  let projectId: string | null = null;
  if (input.project) {
    projectId = (await resolveProject(input.project))?.id ?? null;
  }

  const [row] = await db
    .insert(documents)
    .values({
      clientId: client?.id ?? null,
      projectId,
      title: input.title,
      body: input.body,
      kind: input.kind ?? "note",
      // Recorded as the team's work, not yours — the distinction is the point.
      source: context.agentKey ? "agent" : "manual",
      authorAgent: context.agentKey ?? null,
    })
    .returning();

  return {
    text: `Saved to ${client ? `${client.name}'s` : "the general"} documents as "${row.title}". It is now searchable and the rest of the team can read it.`,
    data: row.id,
  };
}

async function createTaskTool(input: any): Promise<ToolResult> {
  const client = await resolveClient(input.client);
  let projectId: string | null = null;
  if (input.project) {
    const rows = await db
      .select()
      .from(projects)
      .where(or(eq(projects.id, input.project), like(projects.name, `%${input.project}%`)))
      .limit(1);
    projectId = rows[0]?.id ?? null;
  }

  const dueDate = input.dueDate
    ? new Date(`${input.dueDate}T09:00:00`)
    : input.dueInDays != null
      ? addDays(new Date(), input.dueInDays)
      : null;

  const [row] = await db
    .insert(tasks)
    .values({
      title: input.title,
      notes: input.notes,
      clientId: client?.id ?? null,
      projectId,
      dueDate,
      priority: Math.min(Math.max(input.priority ?? 2, 1), 4),
      source: "claude",
    })
    .returning();

  return { text: `Task created: "${row.title}"${dueDate ? `, due ${relativeDay(dueDate)}` : ""}.`, data: row.id };
}
