import Link from "next/link";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { clients, projects, tasks } from "@/lib/db/schema";
import { addDays, endOfDay, relativeDay, startOfDay } from "@/lib/dates";
import { AlarmClock, CalendarCheck, CalendarClock, Inbox, PauseCircle, Sparkles } from "lucide-react";
import { Card, Empty, PageHeader, toneStyle, Zone } from "@/components/ui";
import { TaskList, type TaskRowData } from "@/components/tasks";
import { QuickAdd, QuickAddHint } from "@/components/quick-add";

export const dynamic = "force-dynamic";

const OPEN = ["todo", "doing", "waiting"];

/** Time buckets beat a flat list: they answer "what now" instead of "what exists". */
function bucketOf(task: TaskRowData["task"], now: Date): string {
  if (task.status === "waiting") return "waiting";
  if (!task.dueDate) return "someday";
  if (task.dueDate < startOfDay(now)) return "overdue";
  if (task.dueDate <= endOfDay(now)) return "today";
  if (task.dueDate <= addDays(now, 7)) return "week";
  return "later";
}

/** Each bucket is a visibly different region — that is the whole overview. */
const BUCKETS = [
  { key: "overdue", label: "Overdue", tone: "urgent" as const, icon: AlarmClock, tint: 0.6 },
  { key: "today", label: "Today", tone: "brand" as const, icon: CalendarCheck, tint: 0.55 },
  { key: "week", label: "Next 7 days", tone: "neutral" as const, icon: CalendarClock, tint: 0 },
  { key: "waiting", label: "Waiting on someone else", tone: "info" as const, icon: PauseCircle, tint: 0.5 },
  { key: "later", label: "Later", tone: "neutral" as const, icon: Inbox, tint: 0 },
  { key: "someday", label: "No date", tone: "neutral" as const, icon: Inbox, tint: 0 },
];

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string; view?: string }>;
}) {
  const params = await searchParams;
  const view = params.view ?? "open";
  const now = new Date();

  const where = [];
  if (view === "open") where.push(inArray(tasks.status, OPEN));
  else if (view === "done") where.push(eq(tasks.status, "done"));
  if (params.client) where.push(eq(tasks.clientId, params.client));

  const [rows, clientRows, projectRows] = await Promise.all([
    db
      .select({ task: tasks, clientName: clients.name, clientColor: clients.color, projectName: projects.name })
      .from(tasks)
      .leftJoin(clients, eq(tasks.clientId, clients.id))
      .leftJoin(projects, eq(tasks.projectId, projects.id))
      .where(where.length ? and(...where) : undefined)
      .orderBy(asc(tasks.dueDate), asc(tasks.priority), desc(tasks.createdAt))
      .limit(400),
    db.select({ id: clients.id, name: clients.name, color: clients.color }).from(clients).where(eq(clients.status, "active")),
    db.select({ id: projects.id, name: projects.name }).from(projects).where(eq(projects.status, "active")),
  ]);

  const grouped = new Map<string, TaskRowData[]>();
  for (const row of rows) {
    const key = view === "done" ? "done" : bucketOf(row.task, now);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(row);
  }

  const buckets =
    view === "done"
      ? [{ key: "done", label: "Completed", tone: "good" as const, icon: Sparkles, tint: 0.5 }]
      : BUCKETS;

  return (
    <>
      <PageHeader
        title="Tasks"
        subtitle={`${rows.length} ${view === "done" ? "completed" : "open"}${params.client ? " for this client" : " across everything"}`}
      />

      <Card className="mb-4">
        <QuickAdd clients={clientRows} projects={projectRows} defaultClientId={params.client ?? null} />
        <QuickAddHint />
      </Card>

      <div className="scroll-x no-scrollbar mb-4 flex gap-1.5 pb-1">
        <Link href={`/tasks?view=open${params.client ? `&client=${params.client}` : ""}`} className={`btn btn-sm ${view === "open" ? "btn-primary" : ""}`}>
          Open
        </Link>
        <Link href={`/tasks?view=done${params.client ? `&client=${params.client}` : ""}`} className={`btn btn-sm ${view === "done" ? "btn-primary" : ""}`}>
          Done
        </Link>
        <span className="mx-1 w-px" style={{ background: "var(--hairline)" }} />
        <Link href={`/tasks?view=${view}`} className={`btn btn-sm ${!params.client ? "btn-primary" : ""}`}>
          All clients
        </Link>
        {clientRows.map((client) => (
          <Link
            key={client.id}
            href={`/tasks?view=${view}&client=${client.id}`}
            className={`btn btn-sm ${params.client === client.id ? "btn-primary" : ""}`}
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: client.color }} />
            {client.name}
          </Link>
        ))}
      </div>

      {rows.length === 0 ? (
        <Card>
          <Empty title="Nothing here" hint="Add the next thing you owe someone. The list is only useful if it is honest." />
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {buckets.map((bucket) => {
            const items = grouped.get(bucket.key) ?? [];
            if (items.length === 0) return null;
            const Icon = bucket.icon;
            return (
              <section
                key={bucket.key}
                className="card p-4 md:p-5"
                style={bucket.tint > 0 ? toneStyle(bucket.tone, { strength: bucket.tint }) : undefined}
              >
                <Zone title={bucket.label} icon={<Icon size={14} strokeWidth={2.2} />} tone={bucket.tone} count={items.length}>
                  <TaskList items={items} emptyText="" />
                </Zone>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
