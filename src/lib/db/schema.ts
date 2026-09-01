import { sql } from "drizzle-orm";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

const createdAt = () =>
  integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`);

const updatedAt = () =>
  integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`)
    .$onUpdate(() => new Date());

/* ---------------------------------------------------------------- identity */

export const users = sqliteTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  name: text("name"),
  timezone: text("timezone").notNull().default("Europe/Copenhagen"),
  workdayStart: text("workday_start").notNull().default("08:30"),
  workdayEnd: text("workday_end").notNull().default("17:00"),
  createdAt: createdAt(),
});

/**
 * One row per connected external account. Tokens are encrypted at rest with
 * ENCRYPTION_KEY (see lib/crypto.ts) — never store raw tokens here.
 */
export const connections = sqliteTable(
  "connections",
  {
    id: id(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    // google | microsoft | meta | linkedin | google_ads | ga4
    provider: text("provider").notNull(),
    // the account identifier at the provider (email, ad account id, property id)
    externalId: text("external_id").notNull(),
    displayName: text("display_name"),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    expiresAt: integer("expires_at", { mode: "timestamp" }),
    scopes: text("scopes"),
    // Which data accounts on this connection belong to which client.
    // One Google login can serve several GA4 properties and Ads accounts.
    config: text("config", { mode: "json" }).$type<ConnectionConfig>(),
    status: text("status").notNull().default("connected"), // connected | needs_reauth | error
    lastSyncedAt: integer("last_synced_at", { mode: "timestamp" }),
    lastError: text("last_error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("connections_provider_external").on(t.provider, t.externalId)],
);

/* -------------------------------------------------------------- work graph */

/**
 * A connection is one login; a login can reach several accounts, each belonging
 * to a different client. `accounts` is that mapping, and it is what tells the
 * sync which client's numbers it is writing.
 */
export type DataAccount = {
  /** GA4 property id, Google Ads customer id, Meta ad account id, LinkedIn account id */
  accountId: string;
  clientId: string;
  label?: string;
  /** ga4 | google_ads | meta | linkedin — a Google connection carries both kinds */
  kind: "ga4" | "google_ads" | "meta" | "linkedin";
};

export type ConnectionConfig = { accounts?: DataAccount[] };

export const clients = sqliteTable("clients", {
  id: id(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  color: text("color").notNull().default("#6366f1"),
  // retainer | project | advisory | internal
  engagement: text("engagement").notNull().default("retainer"),
  status: text("status").notNull().default("active"), // active | paused | archived
  notes: text("notes"),
  monthlyValue: real("monthly_value"),
  currency: text("currency").notNull().default("DKK"),
  // domains used to attribute inbound email to this client
  emailDomains: text("email_domains", { mode: "json" }).$type<string[]>().default([]),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const projects = sqliteTable(
  "projects",
  {
    id: id(),
    clientId: text("client_id").references(() => clients.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    goal: text("goal"),
    status: text("status").notNull().default("active"), // planning | active | blocked | done | archived
    health: text("health").notNull().default("on_track"), // on_track | at_risk | off_track
    startDate: integer("start_date", { mode: "timestamp" }),
    dueDate: integer("due_date", { mode: "timestamp" }),
    // 0..100, derived from tasks but overridable
    progress: integer("progress").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("projects_client").on(t.clientId), index("projects_status").on(t.status)],
);

export const milestones = sqliteTable(
  "milestones",
  {
    id: id(),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    dueDate: integer("due_date", { mode: "timestamp" }).notNull(),
    completedAt: integer("completed_at", { mode: "timestamp" }),
    createdAt: createdAt(),
  },
  (t) => [index("milestones_project").on(t.projectId)],
);

export const tasks = sqliteTable(
  "tasks",
  {
    id: id(),
    projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
    clientId: text("client_id").references(() => clients.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    notes: text("notes"),
    // todo | doing | waiting | done | dropped
    status: text("status").notNull().default("todo"),
    priority: integer("priority").notNull().default(2), // 1 = highest, 4 = lowest
    dueDate: integer("due_date", { mode: "timestamp" }),
    startDate: integer("start_date", { mode: "timestamp" }),
    estimateMinutes: integer("estimate_minutes"),
    // who we are blocked on when status = waiting
    waitingOn: text("waiting_on"),
    // manual | email | calendar | proactive | report | claude
    source: text("source").notNull().default("manual"),
    sourceRef: text("source_ref"),
    tags: text("tags", { mode: "json" }).$type<string[]>().default([]),
    completedAt: integer("completed_at", { mode: "timestamp" }),
    lastTouchedAt: integer("last_touched_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("tasks_status_due").on(t.status, t.dueDate),
    index("tasks_project").on(t.projectId),
    index("tasks_client").on(t.clientId),
  ],
);

export const stakeholders = sqliteTable(
  "stakeholders",
  {
    id: id(),
    clientId: text("client_id").references(() => clients.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    email: text("email"),
    role: text("role"),
    // how often this person should hear from you, in days (0 = no cadence)
    contactCadenceDays: integer("contact_cadence_days").notNull().default(0),
    lastContactAt: integer("last_contact_at", { mode: "timestamp" }),
    // include on reports for this client
    receivesReports: integer("receives_reports", { mode: "boolean" }).notNull().default(false),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("stakeholders_client").on(t.clientId)],
);

/* ------------------------------------------------------------ second brain */

export const insights = sqliteTable(
  "insights",
  {
    id: id(),
    clientId: text("client_id").references(() => clients.id, { onDelete: "set null" }),
    projectId: text("project_id").references(() => projects.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    body: text("body").notNull(),
    // insight | learning | benchmark | idea | meeting_note | decision | reference
    kind: text("kind").notNull().default("insight"),
    // manual | claude | meeting | email | metrics
    source: text("source").notNull().default("manual"),
    sourceRef: text("source_ref"),
    tags: text("tags", { mode: "json" }).$type<string[]>().default([]),
    // 1..5 — how much you trust / weight this
    confidence: integer("confidence").notNull().default(3),
    pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
    /** active | archived — retires something that stopped being true. */
    status: text("status").notNull().default("active"),
    occurredAt: integer("occurred_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("insights_client").on(t.clientId), index("insights_kind").on(t.kind)],
);

/**
 * Reference material kept whole: briefs, brand guidelines, strategy docs, how a
 * client likes things done. Distinct from insights on purpose — an insight is
 * one finding you want surfaced and searched, a document is a thing you read.
 * Splitting a brand guideline into "insights" would destroy it.
 */
export const documents = sqliteTable(
  "documents",
  {
    id: id(),
    clientId: text("client_id").references(() => clients.id, { onDelete: "cascade" }),
    projectId: text("project_id").references(() => projects.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    // brief | strategy | brand | process | research | reference | note
    kind: text("kind").notNull().default("note"),
    tags: text("tags", { mode: "json" }).$type<string[]>().default([]),
    pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
    /*
     * Who produced this, which is the difference between ground truth and a
     * proposal. A brand book the client sent is authoritative; a draft an agent
     * wrote on Sunday is a suggestion. Mixing them means you cannot tell at a
     * glance which is which.
     *   upload | manual | import  → yours
     *   agent                     → produced by the team
     */
    source: text("source").notNull().default("manual"),
    /** Which specialist produced it, when source is "agent". */
    authorAgent: text("author_agent"),
    /** active | archived — archived stays searchable but is out of the way. */
    status: text("status").notNull().default("active"),

    // Set when the document came from a file. `body` then holds the extracted
    // text — that is what gets searched and what Claude reads — while these
    // point at the original, kept so the real thing is never lost.
    fileName: text("file_name"),
    fileType: text("file_type"),
    fileSize: integer("file_size"),
    fileUrl: text("file_url"),
    /** Storage key, needed to delete the original when the document goes. */
    filePathname: text("file_pathname"),
    /** Why a file has no extracted text, when it has none. */
    extractionNote: text("extraction_note"),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("documents_client").on(t.clientId), index("documents_kind").on(t.kind)],
);

/* ------------------------------------------------------------- marketing data */

/**
 * Daily grain metric rows from GA4 / Meta / LinkedIn / Google Ads.
 * One row per (connection, date, entity, metric).
 */
export const metrics = sqliteTable(
  "metrics",
  {
    id: id(),
    connectionId: text("connection_id").references(() => connections.id, { onDelete: "cascade" }),
    clientId: text("client_id").references(() => clients.id, { onDelete: "cascade" }),
    source: text("source").notNull(), // ga4 | meta | linkedin | google_ads
    date: text("date").notNull(), // YYYY-MM-DD
    // account | campaign | channel
    entityType: text("entity_type").notNull().default("account"),
    entityId: text("entity_id"),
    entityName: text("entity_name"),
    metric: text("metric").notNull(), // spend | impressions | clicks | conversions | sessions | revenue ...
    value: real("value").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("metrics_unique").on(t.source, t.date, t.entityId, t.metric),
    index("metrics_client_date").on(t.clientId, t.date),
    index("metrics_lookup").on(t.source, t.metric, t.date),
  ],
);

/* --------------------------------------------------------- comms & calendar */

export const messages = sqliteTable(
  "messages",
  {
    id: id(),
    connectionId: text("connection_id").references(() => connections.id, { onDelete: "cascade" }),
    clientId: text("client_id").references(() => clients.id, { onDelete: "set null" }),
    provider: text("provider").notNull(), // gmail | outlook
    externalId: text("external_id").notNull(),
    threadId: text("thread_id"),
    subject: text("subject"),
    fromName: text("from_name"),
    fromEmail: text("from_email"),
    toEmails: text("to_emails", { mode: "json" }).$type<string[]>().default([]),
    snippet: text("snippet"),
    body: text("body"),
    receivedAt: integer("received_at", { mode: "timestamp" }).notNull(),
    // true when the last message in the thread is from someone else and asks for something
    awaitingReply: integer("awaiting_reply", { mode: "boolean" }).notNull().default(false),
    isFromMe: integer("is_from_me", { mode: "boolean" }).notNull().default(false),
    // set once the triage pass has looked at it
    triagedAt: integer("triaged_at", { mode: "timestamp" }),
    // what the triage pass decided: { commitments: [], asks: [], urgency }
    triage: text("triage", { mode: "json" }).$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("messages_provider_external").on(t.provider, t.externalId),
    index("messages_received").on(t.receivedAt),
    index("messages_awaiting").on(t.awaitingReply),
  ],
);

export const calendarEvents = sqliteTable(
  "calendar_events",
  {
    id: id(),
    connectionId: text("connection_id").references(() => connections.id, { onDelete: "cascade" }),
    clientId: text("client_id").references(() => clients.id, { onDelete: "set null" }),
    projectId: text("project_id").references(() => projects.id, { onDelete: "set null" }),
    provider: text("provider").notNull(), // google | microsoft
    externalId: text("external_id").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    location: text("location"),
    startsAt: integer("starts_at", { mode: "timestamp" }).notNull(),
    endsAt: integer("ends_at", { mode: "timestamp" }).notNull(),
    isAllDay: integer("is_all_day", { mode: "boolean" }).notNull().default(false),
    attendees: text("attendees", { mode: "json" }).$type<{ name?: string; email: string }[]>().default([]),
    organizerEmail: text("organizer_email"),
    // external meetings get prep + follow-up treatment, internal focus blocks do not
    isExternal: integer("is_external", { mode: "boolean" }).notNull().default(false),
    prepTaskId: text("prep_task_id"),
    followUpTaskId: text("follow_up_task_id"),
    followUpDoneAt: integer("follow_up_done_at", { mode: "timestamp" }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("events_provider_external").on(t.provider, t.externalId),
    index("events_starts").on(t.startsAt),
  ],
);

/* ---------------------------------------------------------------- reporting */

export const reportSchedules = sqliteTable(
  "report_schedules",
  {
    id: id(),
    clientId: text("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // weekly | biweekly | monthly | quarterly
    cadence: text("cadence").notNull().default("monthly"),
    // for weekly: 1-7 (Mon-Sun). for monthly: day of month 1-28
    dayOf: integer("day_of").notNull().default(1),
    // how many days before the due date the prep reminder fires
    leadDays: integer("lead_days").notNull().default(3),
    // which metric sources to pull into the draft
    sources: text("sources", { mode: "json" }).$type<string[]>().default([]),
    // free text: what this report always needs to cover
    template: text("template"),
    recipients: text("recipients", { mode: "json" }).$type<string[]>().default([]),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    nextDueAt: integer("next_due_at", { mode: "timestamp" }),
    lastSentAt: integer("last_sent_at", { mode: "timestamp" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("report_schedules_due").on(t.nextDueAt)],
);

export const reportRuns = sqliteTable(
  "report_runs",
  {
    id: id(),
    scheduleId: text("schedule_id").references(() => reportSchedules.id, { onDelete: "cascade" }),
    clientId: text("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
    periodStart: text("period_start").notNull(), // YYYY-MM-DD
    periodEnd: text("period_end").notNull(),
    dueAt: integer("due_at", { mode: "timestamp" }).notNull(),
    // pending | drafted | sent | skipped
    status: text("status").notNull().default("pending"),
    draft: text("draft"),
    // the metric block the draft was generated from, kept for audit
    dataSnapshot: text("data_snapshot", { mode: "json" }).$type<Record<string, unknown>>(),
    sentAt: integer("sent_at", { mode: "timestamp" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("report_runs_status").on(t.status), index("report_runs_client").on(t.clientId)],
);

/* --------------------------------------------------------- proactive engine */

/**
 * A signal is something the system noticed that you probably want to act on.
 * Rules write these; the Today view and the nudge feed read them.
 */
export const signals = sqliteTable(
  "signals",
  {
    id: id(),
    // stable key so a rule updates its own signal instead of duplicating it
    dedupeKey: text("dedupe_key").notNull().unique(),
    rule: text("rule").notNull(),
    // urgent | important | fyi
    severity: text("severity").notNull().default("important"),
    title: text("title").notNull(),
    body: text("body"),
    clientId: text("client_id").references(() => clients.id, { onDelete: "cascade" }),
    projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
    entityType: text("entity_type"), // task | project | report | message | event | metric | stakeholder
    entityId: text("entity_id"),
    // [{ kind: 'create_task', label, payload }]
    actions: text("actions", { mode: "json" }).$type<SignalAction[]>().default([]),
    score: real("score").notNull().default(0),
    snoozedUntil: integer("snoozed_until", { mode: "timestamp" }),
    dismissedAt: integer("dismissed_at", { mode: "timestamp" }),
    actedAt: integer("acted_at", { mode: "timestamp" }),
    resolvedAt: integer("resolved_at", { mode: "timestamp" }),
    firstSeenAt: integer("first_seen_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    lastSeenAt: integer("last_seen_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [index("signals_open").on(t.dismissedAt, t.score)],
);

export type SignalAction = {
  kind: "create_task" | "open" | "draft_report" | "log_contact" | "ask_claude" | "complete_task";
  label: string;
  payload?: Record<string, unknown>;
};

export const briefs = sqliteTable("briefs", {
  id: id(),
  date: text("date").notNull().unique(), // YYYY-MM-DD
  headline: text("headline"),
  body: text("body"),
  stats: text("stats", { mode: "json" }).$type<Record<string, unknown>>(),
  generatedAt: createdAt(),
});

/* ------------------------------------------------------------- team briefings */

/**
 * A piece of proactive work from one specialist about one client.
 *
 * Rows are planned first and produced later: a scheduled run can involve
 * dozens of model sessions, far more than one request may spend, so the
 * schedule creates the work and a time-budgeted worker drains it across
 * however many passes it takes.
 */
export const briefings = sqliteTable(
  "briefings",
  {
    id: id(),
    agentKey: text("agent_key").notNull(),
    clientId: text("client_id").references(() => clients.id, { onDelete: "cascade" }),
    /** Identifies the scheduled occurrence, e.g. 2026-08-30T19. Keeps it idempotent. */
    slotKey: text("slot_key").notNull(),
    // pending | running | ready | empty | error
    status: text("status").notNull().default("pending"),
    title: text("title"),
    body: text("body"),
    /** What the agent looked at, for transparency. */
    sources: text("sources", { mode: "json" }).$type<string[]>().default([]),
    error: text("error"),
    readAt: integer("read_at", { mode: "timestamp" }),
    pinnedAt: integer("pinned_at", { mode: "timestamp" }),
    startedAt: integer("started_at", { mode: "timestamp" }),
    completedAt: integer("completed_at", { mode: "timestamp" }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("briefings_slot").on(t.agentKey, t.clientId, t.slotKey),
    index("briefings_status").on(t.status),
    index("briefings_unread").on(t.readAt, t.createdAt),
  ],
);

export type Briefing = typeof briefings.$inferSelect;

/* --------------------------------------------------------------- claude chat */

export const chatThreads = sqliteTable("chat_threads", {
  id: id(),
  title: text("title").notNull().default("New conversation"),
  /** Which specialist this conversation is with. Null is the general brain. */
  agentKey: text("agent_key"),
  clientId: text("client_id").references(() => clients.id, { onDelete: "set null" }),
  projectId: text("project_id").references(() => projects.id, { onDelete: "set null" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const chatMessages = sqliteTable(
  "chat_messages",
  {
    id: id(),
    threadId: text("thread_id").notNull().references(() => chatThreads.id, { onDelete: "cascade" }),
    role: text("role").notNull(), // user | assistant
    content: text("content").notNull(),
    // tool calls made while answering, for transparency
    toolCalls: text("tool_calls", { mode: "json" }).$type<unknown[]>(),
    createdAt: createdAt(),
  },
  (t) => [index("chat_messages_thread").on(t.threadId)],
);

/* ------------------------------------------------------------------ plumbing */

export const syncRuns = sqliteTable(
  "sync_runs",
  {
    id: id(),
    source: text("source").notNull(),
    status: text("status").notNull(), // ok | error | skipped
    itemsWritten: integer("items_written").notNull().default(0),
    message: text("message"),
    durationMs: integer("duration_ms"),
    startedAt: createdAt(),
  },
  (t) => [index("sync_runs_source").on(t.source, t.startedAt)],
);

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value", { mode: "json" }),
  updatedAt: updatedAt(),
});

export type Client = typeof clients.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type Insight = typeof insights.$inferSelect;
export type Signal = typeof signals.$inferSelect;
export type CalendarEvent = typeof calendarEvents.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type ReportSchedule = typeof reportSchedules.$inferSelect;
export type ReportRun = typeof reportRuns.$inferSelect;
export type Stakeholder = typeof stakeholders.$inferSelect;
export type Connection = typeof connections.$inferSelect;
export type Metric = typeof metrics.$inferSelect;
export type Document = typeof documents.$inferSelect;
