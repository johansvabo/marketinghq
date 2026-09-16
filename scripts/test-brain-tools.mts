/**
 * The brain can now change the user's task list. Closing the wrong thing, or
 * claiming to have closed something it did not, is worse than refusing — so
 * these check what actually lands in the database and what gets reported back.
 */
import { eq, inArray } from "drizzle-orm";
import { db } from "../src/lib/db";
import { assignments, clients, contributions, documents, tasks } from "../src/lib/db/schema";
import { runBrainTool } from "../src/lib/ai/tools";
import { processAssignment, pendingProposals } from "../src/lib/ai/assignments";

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? ` — ${detail}` : ""}`);
  ok ? pass++ : fail++;
};

await db.delete(documents); await db.delete(tasks); await db.delete(assignments); await db.delete(clients);
const [c] = await db.insert(clients).values({ name: "Nattugla", slug: `n-${Date.now()}`, status: "active" }).returning();

const made = await db.insert(tasks).values([
  { clientId: c.id, title: "Send promoteringsplanen", status: "todo", dueDate: new Date(Date.now() - 3 * 864e5) },
  { clientId: c.id, title: "Book møte med Mariann", status: "todo", dueDate: new Date(Date.now() - 5 * 864e5) },
  { clientId: c.id, title: "Ikke aktuelt lenger", status: "todo" },
]).returning();
const [t1, t2, t3] = made;

// Closing
const closed = await runBrainTool("close_tasks", { ids: [t1.id], note: "sendt i går" });
const [after1] = await db.select().from(tasks).where(eq(tasks.id, t1.id));
check("close_tasks marks it done", after1.status === "done", after1.status);
check("...and stamps when", after1.completedAt !== null);
check("...and names it back so the brain can report honestly", closed.text.includes("Send promoteringsplanen"));
check("...and does not touch the others", (await db.select().from(tasks).where(eq(tasks.id, t2.id)))[0].status === "todo");

// Ids that match nothing must be admitted, not glossed over.
const bogus = await runBrainTool("close_tasks", { ids: ["nope-1", "nope-2"] });
check("unmatched ids are reported rather than silently ignored", /did not match/i.test(bogus.text), bogus.text);

const partial = await runBrainTool("close_tasks", { ids: [t2.id, "nope"] });
check("a partial match closes what it can and says what it could not", /Book møte/.test(partial.text) && /1 id/.test(partial.text), partial.text);

// Rescheduling
const moved = await runBrainTool("reschedule_tasks", { ids: [t3.id], dueInDays: 7 });
const [after3] = await db.select().from(tasks).where(eq(tasks.id, t3.id));
check("reschedule_tasks sets a new date", after3.dueDate !== null);
check("...and still says which task moved", moved.text.includes("Ikke aktuelt"));

const noDate = await runBrainTool("reschedule_tasks", { ids: [t3.id] });
check("rescheduling with no date changes nothing", /nothing moved/i.test(noDate.text), noDate.text);

// Dropping
await runBrainTool("drop_tasks", { ids: [t3.id], reason: "overtaken" });
const [after3b] = await db.select().from(tasks).where(eq(tasks.id, t3.id));
check("drop_tasks marks it dropped, not deleted", after3b.status === "dropped");
check("...and keeps the reason", after3b.notes === "overtaken");

// Proposing team work
const proposal = await runBrainTool("propose_team_brief", {
  title: "Lanseringsstrategi", brief: "Hvor skal vi lansere først?", client: "Nattugla", agents: ["strategy", "performance"],
});
const [asg] = await db.select().from(assignments);
check("a proposal is created", asg !== undefined);
check("...but is not running", asg?.status === "proposed", asg?.status);
check("...and says so rather than implying work started", /Nothing has started/i.test(proposal.text), proposal.text);

const work = await db.select().from(contributions).where(eq(contributions.assignmentId, asg.id));
check("the chosen specialists are lined up", work.some((w) => w.agentKey === "performance"));
check("...with the reviewer added", work.some((w) => w.agentKey === "editor"));

// The worker must not touch a proposal before it is approved.
const ran = await processAssignment(asg.id);
check("the team does not start on an unapproved proposal", ran.produced === 0 && ran.done === false);
const stillPending = await db.select().from(contributions).where(inArray(contributions.status, ["running", "ready"]));
check("...and nothing was marked as started", stillPending.length === 0, `${stillPending.length} started`);

const shown = await pendingProposals();
check("it is offered for approval", shown.length === 1 && shown[0].title === "Lanseringsstrategi");

// Filing a dropped file
const [unfiled] = await db.insert(documents).values({
  title: "Dokument (3).pdf", body: "Merkevareplattform for Nattugla. Tone: varm, tydelig.", kind: "note", source: "upload",
}).returning();

const read = await runBrainTool("read_document", { id: unfiled.id });
check("read_document returns the text", read.text.includes("Merkevareplattform for Nattugla"));
check("...and says it is not filed yet", /not filed under any client/i.test(read.text), read.text.slice(0, 120));

const filed = await runBrainTool("file_document", {
  id: unfiled.id, client: "Nattugla", kind: "brand", title: "Merkevareplattform",
});
const [after] = await db.select().from(documents).where(eq(documents.id, unfiled.id));
check("file_document attaches it to the client", after.clientId === c.id);
check("...sets the kind", after.kind === "brand", after.kind);
check("...and replaces a useless filename", after.title === "Merkevareplattform", after.title);
check("...and reports where it went", /Nattugla/.test(filed.text), filed.text);

// A client that does not exist must not be guessed at.
const [stray] = await db.insert(documents).values({ title: "Notat", body: "x", kind: "note", source: "upload" }).returning();
const bad = await runBrainTool("file_document", { id: stray.id, client: "Firma som ikke finnes" });
const [strayAfter] = await db.select().from(documents).where(eq(documents.id, stray.id));
check("an unknown client is refused, not approximated", strayAfter.clientId === null, String(strayAfter.clientId));
check("...and the brain is told to ask instead", /do not file it somewhere close enough/i.test(bad.text), bad.text);

const missing = await runBrainTool("file_document", { id: "no-such-doc", client: "Nattugla" });
check("a missing document is reported", /No document with that id/.test(missing.text));

await db.delete(documents);
await db.delete(assignments); await db.delete(tasks); await db.delete(clients);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
