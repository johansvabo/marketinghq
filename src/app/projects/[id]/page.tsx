import { notFound } from "next/navigation";
import Link from "next/link";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import { db } from "@/lib/db";
import { clients, documents, insights, milestones, projects, stakeholders, tasks } from "@/lib/db/schema";
import { format, iso, relativeDay } from "@/lib/dates";
import { Card, CardTitle, Chip, ClientDot, Empty, PageHeader, Progress } from "@/components/ui";
import { TaskList } from "@/components/tasks";
import { QuickAdd } from "@/components/quick-add";
import { ProjectControls } from "@/components/project-controls";
import { Timeline } from "@/components/timeline";
import { DocumentList } from "@/components/document-list";
import { blobAccess, canDirectUpload, storageAvailable } from "@/lib/storage";

export const dynamic = "force-dynamic";

const OPEN = ["todo", "doing", "waiting"];

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [row] = await db
    .select({ project: projects, client: clients })
    .from(projects)
    .leftJoin(clients, eq(projects.clientId, clients.id))
    .where(eq(projects.id, id))
    .limit(1);

  if (!row) notFound();
  const { project, client } = row;

  const [openTasks, doneTasks, milestoneRows, projectInsights, people, clientOptions, projectOptions, projectDocs, siblingProjects, storage] =
    await Promise.all([
    db
      .select({ task: tasks })
      .from(tasks)
      .where(and(eq(tasks.projectId, id), inArray(tasks.status, OPEN)))
      .orderBy(asc(tasks.priority), asc(tasks.dueDate)),
    db
      .select({ task: tasks })
      .from(tasks)
      .where(and(eq(tasks.projectId, id), eq(tasks.status, "done")))
      .orderBy(desc(tasks.completedAt))
      .limit(12),
    db.select().from(milestones).where(eq(milestones.projectId, id)).orderBy(asc(milestones.dueDate)),
    db.select().from(insights).where(eq(insights.projectId, id)).orderBy(desc(insights.occurredAt)).limit(8),
    client ? db.select().from(stakeholders).where(eq(stakeholders.clientId, client.id)) : Promise.resolve([]),
    db.select({ id: clients.id, name: clients.name }).from(clients),
    db.select({ id: projects.id, name: projects.name }).from(projects),
    db.select().from(documents).where(eq(documents.projectId, id)).orderBy(desc(documents.pinned), desc(documents.updatedAt)),
    // Where else a document from this project could be filed.
    client
      ? db.select({ id: projects.id, name: projects.name }).from(projects).where(eq(projects.clientId, client.id))
      : Promise.resolve([]),
    storageAvailable(),
  ]);

  return (
    <>
      <Link href="/projects" className="btn btn-ghost btn-sm mb-3 -ml-2">
        <ArrowLeft size={14} />
        Projects
      </Link>

      <PageHeader
        title={project.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            {client && (
              <Link href={`/projects?client=${client.id}`} className="inline-flex items-center gap-1.5 hover:underline">
                <ClientDot color={client.color} />
                {client.name}
              </Link>
            )}
            <span>·</span>
            <span>{project.progress}% complete</span>
            {project.dueDate && (
              <>
                <span>·</span>
                <span style={project.dueDate < new Date() && project.status !== "done" ? { color: "var(--color-urgent)" } : undefined}>
                  due {format(project.dueDate, "d MMM yyyy")}
                </span>
              </>
            )}
          </span>
        }
        actions={<ProjectControls project={project} />}
      />

      {project.goal && (
        <Card className="mb-4">
          <div className="section-title mb-1.5">What done looks like</div>
          <p className="text-[14px] leading-relaxed text-soft">{project.goal}</p>
        </Card>
      )}

      <div className="mb-4">
        <Progress
          value={project.progress}
          tone={project.health === "off_track" ? "urgent" : project.health === "at_risk" ? "warn" : "brand"}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <div className="flex flex-col gap-4">
          <Card>
            <CardTitle action={<span className="text-[11.5px] text-muted">{openTasks.length} open</span>}>Tasks</CardTitle>
            <QuickAdd
              clients={clientOptions}
              projects={projectOptions}
              defaultProjectId={project.id}
              defaultClientId={project.clientId}
              placeholder="Add a task to this project…"
            />
            <div className="mt-3">
              <TaskList
                items={openTasks.map((t) => ({ task: t.task }))}
                emptyText="Nothing open. Either this project is done, or it needs a next action."
                showMeta
              />
            </div>

            {doneTasks.length > 0 && (
              <details className="mt-3 border-t pt-3">
                <summary className="cursor-pointer section-title">Completed ({doneTasks.length})</summary>
                <div className="mt-2">
                  <TaskList items={doneTasks.map((t) => ({ task: t.task }))} emptyText="" showMeta={false} showDue={false} />
                </div>
              </details>
            )}
          </Card>

          <Card>
            <CardTitle action={<span className="text-[11.5px] text-muted">{projectDocs.length || ""}</span>}>
              Documents
            </CardTitle>
            {client ? (
              <DocumentList
                clientId={client.id}
                projectId={project.id}
                projects={siblingProjects}
                documents={projectDocs}
                storageOn={storage.ok}
                canDirect={canDirectUpload()}
                access={blobAccess()}
              />
            ) : (
              <p className="text-[12.5px] text-muted">
                Give this project a client and you can keep its drafts and deliverables here.
              </p>
            )}
          </Card>

          <Card>
            <CardTitle>Timeline</CardTitle>
            <Timeline projectId={project.id} milestones={milestoneRows} startDate={project.startDate} dueDate={project.dueDate} />
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardTitle action={<Link href={`/brain?project=${project.id}`} className="btn btn-ghost btn-sm">Capture</Link>}>
              What we know
            </CardTitle>
            {projectInsights.length === 0 ? (
              <Empty title="Nothing captured on this project" hint="Decisions, test results, client preferences — this is what makes the next project faster." />
            ) : (
              <ul className="flex flex-col gap-3">
                {projectInsights.map((entry) => (
                  <li key={entry.id}>
                    <div className="flex items-start gap-2">
                      <Chip tone="info">{entry.kind.replace("_", " ")}</Chip>
                      <span className="ml-auto shrink-0 text-[11px] text-muted">{iso(entry.occurredAt)}</span>
                    </div>
                    <p className="mt-1 text-[13px] font-medium leading-snug">{entry.title}</p>
                    <p className="mt-0.5 line-clamp-3 text-[12.5px] leading-relaxed text-muted">{entry.body}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {people.length > 0 && (
            <Card>
              <CardTitle>Stakeholders</CardTitle>
              <ul className="flex flex-col gap-2">
                {people.map((person) => (
                  <li key={person.id} className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium">{person.name}</p>
                      <p className="truncate text-[11.5px] text-muted">
                        {person.role ?? "—"}
                        {person.lastContactAt ? ` · last spoke ${relativeDay(person.lastContactAt)}` : ""}
                      </p>
                    </div>
                    {person.receivesReports && <Chip tone="brand">reports</Chip>}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
