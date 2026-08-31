/**
 * Guards against a bug that returned zero everywhere: a correlated subquery
 * written by hand in a sql`` template renders its columns unqualified, so both
 * sides resolve to the inner table. Every count silently became 0 — client
 * cards looked empty, and the proactive rules thought every project had been
 * abandoned. Use db.$count for these.
 */
import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { ensureSchema } from "../src/lib/db/migrate";
import { db } from "../src/lib/db";
import { clients, documents, insights, projects, stakeholders, tasks } from "../src/lib/db/schema";
import { runProactiveEngine } from "../src/lib/proactive/engine";
import { signals } from "../src/lib/db/schema";

await ensureSchema();
for (const t of [signals, documents, insights, stakeholders, tasks, projects, clients]) await db.delete(t as never);

let failures = 0;
const check = (label: string, actual: unknown, expected: unknown) => {
  const ok = Number(actual) === Number(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label.padEnd(38)} got ${actual}, want ${expected}`);
};

const [c] = await db.insert(clients).values({ name: "Nattugla", slug: "n-tc", status: "active" }).returning();
const [p] = await db.insert(projects).values({ clientId: c.id, name: "Paid media", status: "active" }).returning();
await db.insert(tasks).values([
  { projectId: p.id, clientId: c.id, title: "a", status: "todo" },
  { projectId: p.id, clientId: c.id, title: "b", status: "doing" },
  { projectId: p.id, clientId: c.id, title: "c", status: "done" },
  { projectId: p.id, clientId: c.id, title: "d", status: "dropped" },
]);
await db.insert(documents).values([
  { clientId: c.id, title: "Brand", body: "x" },
  { clientId: c.id, title: "Brief", body: "y" },
  { clientId: c.id, title: "Plan", body: "z" },
]);
await db.insert(insights).values({ clientId: c.id, title: "i", body: "b" });
await db.insert(stakeholders).values({ clientId: c.id, name: "Mariann" });

const OPEN = ["todo", "doing", "waiting"];

const [row] = await db
  .select({
    openTasks: db.$count(tasks, and(eq(tasks.clientId, clients.id), inArray(tasks.status, OPEN))),
    activeProjects: db.$count(projects, and(eq(projects.clientId, clients.id), eq(projects.status, "active"))),
    docCount: db.$count(documents, eq(documents.clientId, clients.id)),
    insightCount: db.$count(insights, eq(insights.clientId, clients.id)),
    peopleCount: db.$count(stakeholders, eq(stakeholders.clientId, clients.id)),
  })
  .from(clients)
  .orderBy(asc(clients.name));

console.log("Clients list card:");
check("open tasks", row.openTasks, 2);
check("active projects", row.activeProjects, 1);
check("documents", row.docCount, 3);
check("insights", row.insightCount, 1);
check("people", row.peopleCount, 1);

const [proj] = await db
  .select({
    open: db.$count(tasks, and(eq(tasks.projectId, projects.id), inArray(tasks.status, OPEN))),
    total: db.$count(tasks, and(eq(tasks.projectId, projects.id), ne(tasks.status, "dropped"))),
  })
  .from(projects);

console.log("\nProject card:");
check("open tasks on project", proj.open, 2);
check("total counted tasks", proj.total, 3);

await runProactiveEngine();
const raised = await db.select().from(signals);
const noNextAction = raised.filter((s) => s.rule === "project_no_next_action");

console.log("\nProactive rules:");
check("'no next action' on a busy project", noNextAction.length, 0);

process.exit(failures === 0 ? 0 : 1);
