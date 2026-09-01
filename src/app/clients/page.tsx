import Link from "next/link";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { clients, documents, insights, projects, stakeholders, tasks } from "@/lib/db/schema";
import { Card, ClientBadge, Empty, PageHeader } from "@/components/ui";
import { NewClientDialog } from "@/components/new-client";
import { formatMoney, monthByClient } from "@/lib/billing";

export const dynamic = "force-dynamic";
export const metadata = { title: "Clients" };

const OPEN = ["todo", "doing", "waiting"];

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
      // $count builds a properly qualified correlated subquery. Hand-writing
      // these in a sql`` template renders the columns unqualified, so both
      // sides resolve to the inner table and every count comes back zero.
      openTasks: db.$count(tasks, and(eq(tasks.clientId, clients.id), inArray(tasks.status, OPEN))),
      activeProjects: db.$count(projects, and(eq(projects.clientId, clients.id), eq(projects.status, "active"))),
      docCount: db.$count(documents, eq(documents.clientId, clients.id)),
      insightCount: db.$count(insights, eq(insights.clientId, clients.id)),
      peopleCount: db.$count(stakeholders, eq(stakeholders.clientId, clients.id)),
    })
    .from(clients)
    .orderBy(asc(clients.status), asc(clients.name));

  const months = await monthByClient(rows.map((r) => r.client));

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
                        {(() => {
                          const m = months.get(client.id);
                          if (!m || m.basis === "none") return null;
                          return (
                            <span className="ml-auto text-[12px] text-muted">
                              {formatMoney(m.value, m.currency)}
                              {m.basis === "hourly" ? " this month" : "/mo"}
                            </span>
                          );
                        })()}
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
