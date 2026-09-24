/**
 * What the nightly pass is allowed to touch.
 *
 * Both failures here are the same mistake: a new state column, and every row
 * of history inheriting "not done yet". The pass that made assignments
 * finish without a browser tab also woke every abandoned brief and billed for
 * it; the stamp that stops a finished brief being announced twice made the
 * entire back catalogue look unannounced, and it went to a real inbox.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "../src/lib/db";
import { assignments, clients, contributions } from "../src/lib/db/schema";
import { ABANDONED_AFTER_MS_FOR_TEST, createAssignment, processAssignments } from "../src/lib/ai/assignments";
import { NOTIFY_WINDOW_MS_FOR_TEST, notifyFinishedAssignments } from "../src/lib/ai/digest";

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? ` — ${detail}` : ""}`);
  ok ? pass++ : fail++;
};

const day = 24 * 60 * 60 * 1000;
await db.delete(assignments);
const [client] = await db
  .insert(clients)
  .values({ name: `Nattugla-${Date.now()}`, slug: `n-${Date.now()}`, status: "active" })
  .returning();

async function makeAssignment(title: string, ageDays: number, status = "running") {
  const made = await createAssignment({ title, brief: `${title} brief`, clientId: client.id, agentKeys: ["strategy"] });
  if (!made.ok) throw new Error(made.error);
  const at = new Date(Date.now() - ageDays * day);
  await db.update(assignments).set({ status, createdAt: at, updatedAt: at, completedAt: at }).where(eq(assignments.id, made.id));
  return made.id;
}

/* ------------------------------------------- what the nightly pass picks up */

const fresh = await makeAssignment("Handed over yesterday", 1);
const weekend = await makeAssignment("Handed over on Friday", 2.5);
const abandoned = await makeAssignment("Stuck since weeks ago", 21);

check("the abandoned window is a few days, not unbounded", ABANDONED_AFTER_MS_FOR_TEST === 3 * day, String(ABANDONED_AFTER_MS_FOR_TEST));

// No API key here, so nothing runs — but the count reports what it *would*
// drive, which is the number this is about.
const swept = await processAssignments(2_000);
check("only live work is counted as outstanding", swept.stillOutstanding === 2, `${swept.stillOutstanding}`);

const drivable = await db
  .select({ n: sql<number>`count(*)` })
  .from(assignments)
  .where(and(eq(assignments.status, "running"), sql`${assignments.updatedAt} >= ${Math.floor((Date.now() - ABANDONED_AFTER_MS_FOR_TEST) / 1000)}`));
check("yesterday's brief is still driven", Number(drivable[0].n) >= 1);

const [old] = await db.select().from(assignments).where(eq(assignments.id, abandoned));
check("a brief abandoned for weeks is left where it was", old.status === "running", old.status);
check("...and is not silently restarted", old.completedAt !== null);

// Freshness is measured from the last touch, not from when it was created:
// a long brief you are actively working must not age out mid-flight.
await db.update(assignments).set({ updatedAt: new Date() }).where(eq(assignments.id, abandoned));
const afterTouch = await processAssignments(2_000);
check("touching an old brief brings it back into the pass", afterTouch.stillOutstanding === 3, `${afterTouch.stillOutstanding}`);

/* ------------------------------------------------------- who gets an email */

check("the notification window is a couple of days", NOTIFY_WINDOW_MS_FOR_TEST === 2 * day, String(NOTIFY_WINDOW_MS_FOR_TEST));

await db.delete(assignments);
const recent = await makeAssignment("Finished this morning", 0.2, "ready");
const ancient = await makeAssignment("Finished in August", 40, "ready");

// Both look unannounced — exactly the state the whole back catalogue was in.
const unannounced = await db.select().from(assignments).where(isNull(assignments.notifiedAt));
check("both look unannounced before the window applies", unannounced.length === 2, String(unannounced.length));

const outcome = await notifyFinishedAssignments();
check("nothing is sent without email configured", outcome.notified === 0 && outcome.skipped !== null, JSON.stringify(outcome));

// The window is what matters, so assert the selection directly.
const since = Math.floor((Date.now() - NOTIFY_WINDOW_MS_FOR_TEST) / 1000);
const eligible = await db
  .select({ id: assignments.id, title: assignments.title })
  .from(assignments)
  .where(and(isNull(assignments.notifiedAt), sql`${assignments.completedAt} >= ${since}`));

check("this morning's brief would be announced", eligible.some((e) => e.id === recent), eligible.map((e) => e.title).join(","));
check("August's would not", !eligible.some((e) => e.id === ancient));

/* ------------------------------------------------ the back catalogue is stamped */

const migration = (await import("node:fs")).readFileSync("drizzle/0013_backfill_notified.sql", "utf8");
check("a migration stamps everything already finished", /UPDATE .assignments./i.test(migration));
check("...only where it was never announced", /notified_at. IS NULL/i.test(migration));
check("...and only for work that actually ended", /status. IN \('ready', 'error'\)/i.test(migration));
check("...using a real timestamp rather than now for everything", /COALESCE/i.test(migration));

await db.delete(assignments);
await db.delete(clients).where(eq(clients.id, client.id));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
