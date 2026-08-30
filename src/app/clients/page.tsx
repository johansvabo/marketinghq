import Link from "next/link";
import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { clients, documents, insights, projects, stakeholders, tasks } from "@/lib/db/schema";
import { Card, ClientBadge, Empty, PageHeader } from "@/components/ui";
import { NewClientDialog } from "@/components/new-client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Clients" };

const ENGAGEMENT_LABEL: Record<string, string> = {
  retainer: "Retainer",
  project: "Project",
  advisory: "Advisory",
  internal: "Internal",
};

export default async function ClientsPage() {
  const rows = await db
    .select({
      client: clients,
      openTasks: sql<number>`(select count(*) from ${tasks} where ${tasks.clientId} = ${clients.id} and ${tasks.status} in ('todo','doing','waiting'))`,
      activeProjects: sql<number>`(select count(*) from ${projects} where ${projects.clientId} = ${clients.id} and ${projects.status} = 'active')`,
      docCount: sql<number>`(select count(*) from ${documents} where ${documents.clientId} = ${clients.id})`,
      insightCount: sql<number>`(select count(*) from ${insights} where ${insights.clientId} = ${clients.id})`,
      peopleCount: sql<number>`(select count(*) from ${stakeholders} where ${stakeholders.clientId} = ${clients.id})`,
    })
    .from(clients)
    .orderBy(asc(clients.status), asc(clients.name));

  const active = rows.filter((r) => r.client.status === "active");
  const rest = rows.filter((r) => r.client.status !== "active");

  return (
    <>
      <PageHeader
        title="Clients"
        subtitle={
          rows.length === 0
            ? "The layer everything else hangs off"
            : `${active.length} active${rest.length ? ` · ${rest.length} paused or archived` : ""}`
        }
        actions={<NewClientDialog />}
      />

      {rows.length === 0 ? (
        <Card>
          <Empty
            title="No clients yet"
            hint="Add your first one and it becomes the home for that client's projects, documents, insights, people and reports."
            action={<NewClientDialog />}
          />
        </Card>
      ) : (
        <div className="flex flex-col gap-5">
          {[
            { label: "Active", list: active },
            { label: "Paused and archived", list: rest },
          ]
            .filter((g) => g.list.length > 0)
            .map((group) => (
              <section key={group.label}>
                {rest.length > 0 && <h2 className="section-title mb-2">{group.label}</h2>}
                <div className="grid gap-2.5 md:grid-cols-2">
                  {group.list.map(({ client, openTasks, activeProjects, docCount, insightCount, peopleCount }) => (
                    <Link
                      key={client.id}
                      href={`/clients/${client.id}`}
                      className="card p-4 transition-colors hover:border-[var(--ink-muted)]"
                      style={{
                        borderLeft: `3px solid ${client.color}`,
                        opacity: client.status === "active" ? 1 : 0.6,
                      }}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-[15px] font-semibold tracking-[-0.01em]">{client.name}</h3>
                        <span className="chip">{ENGAGEMENT_LABEL[client.engagement] ?? client.engagement}</span>
                        {client.monthlyValue ? (
                          <span className="ml-auto text-[12px] text-muted">
                            {client.currency} {client.monthlyValue.toLocaleString("en-US")}/mo
                          </span>
                        ) : null}
                      </div>

                      {client.notes && (
                        <p className="mt-1.5 line-clamp-2 text-[12.5px] leading-relaxed text-muted">{client.notes}</p>
                      )}

                      <dl className="mt-3 grid grid-cols-5 gap-1 border-t pt-2.5 text-center">
                        {[
                          { label: "projects", value: activeProjects },
                          { label: "open", value: openTasks },
                          { label: "docs", value: docCount },
                          { label: "insights", value: insightCount },
                          { label: "people", value: peopleCount },
                        ].map((stat) => (
                          <div key={stat.label}>
                            <dt className="text-[10px] uppercase tracking-[0.05em] text-muted">{stat.label}</dt>
                            <dd className="mt-0.5 text-[15px] font-semibold tabular-nums">{Number(stat.value)}</dd>
                          </div>
                        ))}
                      </dl>
                    </Link>
                  ))}
                </div>
              </section>
            ))}
        </div>
      )}
    </>
  );
}
