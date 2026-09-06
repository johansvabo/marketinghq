import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { clients, projects } from "@/lib/db/schema";
import { buildPlan, quarterBounds, quarterOf, type Span } from "@/lib/plan";
import { PageHeader } from "@/components/ui";
import { PlanFilters } from "@/components/plan-filters";
import { Gantt } from "@/components/gantt";

export const dynamic = "force-dynamic";
export const metadata = { title: "Plan" };

/** The window being looked at, from the quarter controls or a preset range. */
function resolveWindow(range: string, year: number, quarter: number): { window: Span; label: string } {
  const today = new Date();

  if (range === "month") {
    return {
      window: {
        start: new Date(today.getFullYear(), today.getMonth(), 1),
        end: new Date(today.getFullYear(), today.getMonth() + 1, 0),
      },
      label: today.toLocaleDateString("en-GB", { month: "long", year: "numeric" }),
    };
  }
  if (range === "90" || range === "180") {
    const days = Number(range);
    return {
      window: { start: today, end: new Date(today.getFullYear(), today.getMonth(), today.getDate() + days) },
      label: `Next ${days} days`,
    };
  }
  if (range === "year") {
    return {
      window: { start: new Date(today.getFullYear(), 0, 1), end: new Date(today.getFullYear(), 11, 31) },
      label: String(today.getFullYear()),
    };
  }
  return { window: quarterBounds(year, quarter), label: `Q${quarter} ${year}` };
}

export default async function PlanPage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string; project?: string; q?: string; y?: string; range?: string }>;
}) {
  const params = await searchParams;
  const now = quarterOf(new Date());
  const year = Number(params.y) || now.year;
  const quarter = Number(params.q) || now.quarter;
  const range = params.range ?? "quarter";

  const { window, label } = resolveWindow(range, year, quarter);

  const [plan, clientOptions, projectOptions] = await Promise.all([
    buildPlan({ window, clientId: params.client ?? null, projectId: params.project ?? null }),
    db.select({ id: clients.id, name: clients.name }).from(clients).where(eq(clients.status, "active")).orderBy(asc(clients.name)),
    db.select({ id: projects.id, name: projects.name, clientId: projects.clientId }).from(projects).orderBy(asc(projects.name)),
  ]);

  const committed = plan.load.reduce((sum, w) => sum + w.committed, 0);
  const logged = plan.load.reduce((sum, w) => sum + w.logged, 0);

  return (
    <>
      <PageHeader
        title="Plan"
        subtitle={
          plan.totalTasks === 0
            ? "Everything with a date, across every client"
            : `${plan.totalTasks} scheduled item${plan.totalTasks === 1 ? "" : "s"} in ${label} · ${Math.round(logged)}t logged, ${Math.round(committed)}t still estimated`
        }
      />

      <PlanFilters
        clients={clientOptions}
        projects={projectOptions}
        year={year}
        quarter={quarter}
        label={label}
        range={range}
      />

      <Gantt window={window} rows={plan.rows} load={plan.load} undated={plan.undated} />
    </>
  );
}
