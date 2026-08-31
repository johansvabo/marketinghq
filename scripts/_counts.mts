import { asc, eq, sql } from "drizzle-orm";
import { db } from "../src/lib/db";
import { clients, documents, insights, projects, stakeholders, tasks } from "../src/lib/db/schema";

await db.delete(clients);
const [c] = await db.insert(clients).values({ name: "Nattugla", slug: "n-c", status: "active" }).returning();
await db.insert(documents).values([
  { clientId: c.id, title: "Brand", body: "x" },
  { clientId: c.id, title: "Brief", body: "y" },
  { clientId: c.id, title: "Plan", body: "z" },
]);
await db.insert(insights).values({ clientId: c.id, title: "i", body: "b" });
await db.insert(projects).values({ clientId: c.id, name: "P", status: "active" });
await db.insert(stakeholders).values({ clientId: c.id, name: "Mariann" });
await db.insert(tasks).values({ clientId: c.id, title: "t", status: "todo" });

console.log("actually in the database:");
console.log("  documents   ", (await db.select().from(documents)).length);
console.log("  insights    ", (await db.select().from(insights)).length);
console.log("  projects    ", (await db.select().from(projects)).length);

// The exact query the Clients list page runs.
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

console.log("\nwhat the Clients page query returns:");
const r = rows[0];
console.log("  openTasks   ", r.openTasks);
console.log("  projects    ", r.activeProjects);
console.log("  docs        ", r.docCount);
console.log("  insights    ", r.insightCount);
console.log("  people      ", r.peopleCount);
