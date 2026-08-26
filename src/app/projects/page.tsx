import Link from "next/link";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { clients, projects, tasks } from "@/lib/db/schema";
import { relativeDay } from "@/lib/dates";
import { Card, Chip, ClientBadge, Empty, PageHeader, Progress, toneStyle } from "@/components/ui";
import { NewProjectDialog } from "@/components/new-project";

export const dynamic = "force-dynamic";

/**
 * On track is the default state, so it gets no tint — colour is spent on
 * exceptions only. Three green cards say nothing; one amber card among white
 * ones says everything.
 */
const HEALTH_TONE = { on_track: "neutral", at_risk: "warn", off_track: "urgent" } as const;
const STATUS_ORDER = ["active", "planning", "blocked", "done", "archived"];

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<{ client?: string; status?: string }> }) {
  const params = await searchParams;
  const statusFilter = params.status ?? "open";

  const where = [];
  if (params.client) where.push(eq(projects.clientId, params.client));
  if (statusFilter === "open") where.push(inArray(projects.status, ["active", "planning", "blocked"]));
  else if (statusFilter !== "all") where.push(eq(projects.status, statusFilter));

  const [rows, clientRows] = await Promise.all([
    db
      .select({
        project: projects,
        clientName: clients.name,
        clientColor: clients.color,
        openTasks: sql<number>`(select count(*) from ${tasks} where ${tasks.projectId} = ${projects.id} and ${tasks.status} in ('todo','doing','waiting'))`,
        totalTasks: sql<number>`(select count(*) from ${tasks} where ${tasks.projectId} = ${projects.id} and ${tasks.status} != 'dropped')`,
      })
      .from(projects)
      .leftJoin(clients, eq(projects.clientId, clients.id))
      .where(where.length ? and(...where) : undefined)
      .orderBy(asc(projects.dueDate), desc(projects.updatedAt)),
    db.select().from(clients).orderBy(asc(clients.name)),
  ]);

  const byClient = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = row.clientName ?? "Internal";
    if (!byClient.has(key)) byClient.set(key, []);
    byClient.get(key)!.push(row);
  }

  return (
    <>
      <PageHeader
        title="Projects"
        subtitle={`${rows.length} project${rows.length === 1 ? "" : "s"} across ${byClient.size} client${byClient.size === 1 ? "" : "s"}`}
        actions={<NewProjectDialog clients={clientRows.map((c) => ({ id: c.id, name: c.name }))} />}
      />

      <div className="scroll-x no-scrollbar mb-4 flex gap-1.5 pb-1">
        {[
          { key: "open", label: "Open" },
          { key: "active", label: "Active" },
          { key: "blocked", label: "Blocked" },
          { key: "done", label: "Done" },
          { key: "all", label: "All" },
        ].map((option) => (
          <Link
            key={option.key}
            href={`/projects?status=${option.key}${params.client ? `&client=${params.client}` : ""}`}
            className={`btn btn-sm ${statusFilter === option.key ? "btn-primary" : ""}`}
          >
            {option.label}
          </Link>
        ))}
        {params.client && (
          <Link href={`/projects?status=${statusFilter}`} className="btn btn-sm btn-ghost">
            clear client filter
          </Link>
        )}
      </div>

      {rows.length === 0 ? (
        <Card>
          <Empty
            title="No projects here yet"
            hint="A project is any body of work with an end state — a campaign, a rebrand, an audit, a quarterly retainer stream."
          />
        </Card>
      ) : (
        <div className="flex flex-col gap-5">
          {[...byClient.entries()].map(([clientName, list]) => (
            <section key={clientName}>
              <div
                className="mb-2.5 flex items-center gap-2.5 rounded-[10px] px-3 py-2"
                style={{
                  background: `color-mix(in oklch, ${list[0]?.clientColor ?? "var(--ink-muted)"} 12%, var(--surface))`,
                  borderLeft: `3px solid ${list[0]?.clientColor ?? "var(--ink-muted)"}`,
                }}
              >
                <h2 className="text-[13.5px] font-semibold tracking-tight">{clientName}</h2>
                <span className="text-[11.5px] text-muted">
                  {list.length} project{list.length === 1 ? "" : "s"}
                </span>
                <span className="ml-auto text-[11.5px] text-muted">
                  {list.reduce((sum, r) => sum + Number(r.openTasks), 0)} open
                </span>
              </div>

              <div className="grid gap-2.5 md:grid-cols-2">
                {list.map(({ project, openTasks, totalTasks }) => {
                  const overdue = project.dueDate && project.dueDate < new Date() && project.status !== "done";
                  return (
                    <Link
                      key={project.id}
                      href={`/projects/${project.id}`}
                      className="card p-4 transition-colors hover:border-[var(--ink-muted)]"
                      style={toneStyle(HEALTH_TONE[project.health as keyof typeof HEALTH_TONE], { strength: 0.55 })}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="text-[14px] font-semibold leading-snug tracking-[-0.01em]">{project.name}</h3>
                        <Chip tone={HEALTH_TONE[project.health as keyof typeof HEALTH_TONE] ?? "neutral"} solid>
                          {project.health.replace("_", " ")}
                        </Chip>
                      </div>

                      {project.goal && <p className="mt-1.5 line-clamp-2 text-[12.5px] leading-relaxed text-muted">{project.goal}</p>}

                      <div className="mt-3">
                        <div className="mb-1.5 flex items-center justify-between text-[11.5px] text-muted">
                          <span>
                            {Number(totalTasks) - Number(openTasks)}/{totalTasks} tasks
                          </span>
                          <span style={overdue ? { color: "var(--color-urgent)", fontWeight: 600 } : undefined}>
                            {project.dueDate ? `due ${relativeDay(project.dueDate)}` : "no deadline"}
                          </span>
                        </div>
                        <Progress
                          value={project.progress}
                          tone={project.health === "off_track" ? "urgent" : project.health === "at_risk" ? "warn" : "brand"}
                        />
                      </div>

                      {Number(openTasks) === 0 && project.status === "active" && (
                        <p className="mt-2.5 text-[11.5px] font-medium" style={{ color: "var(--color-warn)" }}>
                          No next action — this one is drifting.
                        </p>
                      )}
                    </Link>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
