import Link from "next/link";
import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import { db } from "@/lib/db";
import { clients, projects, tasks, timeEntries } from "@/lib/db/schema";
import { relativeDay } from "@/lib/dates";
import { Card, CardTitle, ClientBadge, PageHeader } from "@/components/ui";
import { TaskDetail } from "@/components/task-detail";

export const dynamic = "force-dynamic";

export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [row] = await db
    .select({ task: tasks, client: clients, project: projects })
    .from(tasks)
    .leftJoin(clients, eq(tasks.clientId, clients.id))
    .leftJoin(projects, eq(tasks.projectId, projects.id))
    .where(eq(tasks.id, id))
    .limit(1);

  if (!row) notFound();
  const { task, client, project } = row;

  // Time already booked against this task, matched on the note the log form
  // pre-fills. Rough, but it means the hours are visible where the work is.
  const entries = client
    ? await db
        .select()
        .from(timeEntries)
        .where(eq(timeEntries.clientId, client.id))
        .orderBy(desc(timeEntries.date))
        .limit(6)
    : [];

  return (
    <>
      <div className="mb-3">
        <Link href="/tasks" className="btn btn-ghost btn-sm">
          <ArrowLeft size={13} /> All tasks
        </Link>
      </div>

      <PageHeader
        title={task.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            {client && <ClientBadge name={client.name} color={client.color} />}
            {project && (
              <Link href={`/projects/${project.id}`} className="text-muted underline-offset-2 hover:underline">
                {project.name}
              </Link>
            )}
            {task.dueDate && <span>due {relativeDay(task.dueDate)}</span>}
            <span className="text-muted">added {relativeDay(task.createdAt)}</span>
          </span>
        }
      />

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_300px]">
        <TaskDetail task={task} clientId={client?.id ?? null} />

        <div className="flex flex-col gap-3">
          <Card>
            <CardTitle>Where it came from</CardTitle>
            <p className="text-[12.5px] leading-relaxed text-soft">
              {SOURCE_TEXT[task.source] ?? "Added by hand."}
            </p>
          </Card>

          {client && (
            <Card>
              <CardTitle
                action={
                  <Link href={`/clients/${client.id}`} className="btn btn-ghost btn-sm">
                    Client
                  </Link>
                }
              >
                Recent hours
              </CardTitle>
              {entries.length === 0 ? (
                <p className="text-[12.5px] text-muted">Nothing logged for {client.name} yet.</p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {entries.map((entry) => (
                    <li key={entry.id} className="flex items-baseline gap-2 text-[12.5px]">
                      <span className="tabular-nums font-medium">{entry.hours} h</span>
                      <span className="truncate text-muted">{entry.note ?? "—"}</span>
                      <span className="ml-auto shrink-0 text-[11.5px] text-muted">{entry.date}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

const SOURCE_TEXT: Record<string, string> = {
  manual: "Added by hand.",
  email: "Picked out of an email.",
  calendar: "Came from something in the calendar.",
  proactive: "Raised by the rules engine — it spotted something that needed doing.",
  report: "Created alongside a report.",
  claude: "Created by the Brain during a conversation.",
};
