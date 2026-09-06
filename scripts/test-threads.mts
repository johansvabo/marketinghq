/**
 * A follow-up conversation is only worth having if the specialist still has
 * the brief and their own work in front of them. That context is assembled
 * server-side from what the thread is linked to, so this checks the assembly
 * rather than trusting that the page passed the right thing.
 */
import { and, eq } from "drizzle-orm";
import { db } from "../src/lib/db";
import { assignments, chatThreads, clients, contributions, projects } from "../src/lib/db/schema";
import { createAssignment, assignmentDiscussions } from "../src/lib/ai/assignments";
import { threadContext } from "../src/lib/ai/thread-context";

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? ` — ${detail}` : ""}`);
  ok ? pass++ : fail++;
};

await db.delete(assignments);
await db.delete(chatThreads);
const [client] = await db.insert(clients).values({ name: "Nattugla", slug: `n-${Date.now()}`, status: "active" }).returning();
const [project] = await db.insert(projects).values({ clientId: client.id, name: "Kanalstrategi", status: "active", goal: "Godkjent strategi" }).returning();

const made = await createAssignment({
  title: "Ireland or Sweden",
  brief: "Where should Nattugla launch first outside Norway?",
  clientId: client.id,
  projectId: project.id,
  agentKeys: ["strategy", "performance"],
});
if (!made.ok) process.exit(1);

await db.update(contributions)
  .set({ status: "ready", body: "Ireland, on regulatory friction.", completedAt: new Date() })
  .where(and(eq(contributions.assignmentId, made.id), eq(contributions.agentKey, "strategy")));
await db.update(contributions)
  .set({ status: "ready", body: "Meta CPMs are lower in Ireland.", completedAt: new Date() })
  .where(and(eq(contributions.assignmentId, made.id), eq(contributions.agentKey, "performance")));
await db.update(assignments).set({ synthesis: "## Recommendation\n\nIreland first." }).where(eq(assignments.id, made.id));

// A conversation with the specialist about their own contribution.
const [odinThread] = await db.insert(chatThreads).values({
  title: "Why Ireland?", agentKey: "strategy",
  clientId: client.id, projectId: project.id, assignmentId: made.id,
}).returning();

const odin = (await threadContext(odinThread)) ?? "";
check("the client is named", odin.includes("Nattugla"));
check("the project is named", odin.includes("Kanalstrategi"));
check("the original brief is included", odin.includes("Where should Nattugla launch first"));
check("their own contribution is included", odin.includes("Ireland, on regulatory friction"));
check("the gathered answer is included", odin.includes("Ireland first"));
check("they are told not to redo the whole analysis", /do not start from scratch/i.test(odin));
check("they are told to change their mind on merit", /change your mind/i.test(odin));
check("a specialist does not get another specialist's raw work", !odin.includes("Meta CPMs are lower"));

// The reviewer holds everyone's work, so she keeps it in a follow-up too.
const [ragnhild] = await db.insert(chatThreads).values({
  title: "About the synthesis", agentKey: "editor", clientId: client.id, assignmentId: made.id,
}).returning();
const rag = (await threadContext(ragnhild)) ?? "";
check("the reviewer still sees what the team gave her", rag.includes("Meta CPMs are lower") && rag.includes("Ireland, on regulatory friction"));

// A plain client conversation carries context without any assignment.
const [plain] = await db.insert(chatThreads).values({ title: "Random", clientId: client.id }).returning();
const plainCtx = (await threadContext(plain)) ?? "";
check("a client conversation names the client", plainCtx.includes("Nattugla"));
check("...and mentions no brief", !/brief this follows up on/i.test(plainCtx));

// An unattached conversation gets no manufactured context.
const [bare] = await db.insert(chatThreads).values({ title: "Nothing" }).returning();
check("an unattached conversation gets no context", (await threadContext(bare)) === undefined);

// Discussions are found again by who they are with.
const talk = await assignmentDiscussions(made.id);
check("discussions are keyed by specialist", talk.get("strategy")?.threadId === odinThread.id);
check("...and the reviewer's is separate", talk.get("editor")?.threadId === ragnhild.id);

/*
 * Deleting an assignment must take its discussions with it. The generated
 * migration dropped the ON DELETE CASCADE, which turned this into a foreign
 * key error rather than a cascade.
 */
let deleteFailed = false;
try {
  await db.delete(assignments).where(eq(assignments.id, made.id));
} catch {
  deleteFailed = true;
}
check("an assignment with discussions can be deleted", !deleteFailed);
const orphans = await db.select().from(chatThreads).where(eq(chatThreads.assignmentId, made.id));
check("...and its discussions go with it", orphans.length === 0, `${orphans.length} left`);

await db.delete(assignments);
await db.delete(chatThreads);
await db.delete(clients).where(eq(clients.id, client.id));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
