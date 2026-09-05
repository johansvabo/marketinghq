/**
 * A team assignment is only useful if the running order holds: the strategist
 * frames the brief before the others build on it, and the reviewer cannot
 * gather anything until everyone else has actually reported. Both are
 * scheduling rules with no compile-time protection, so they are checked here.
 */
import { and, eq } from "drizzle-orm";
import { db } from "../src/lib/db";
import { assignments, clients, contributions } from "../src/lib/db/schema";
import { createAssignment, nextPending, processAssignment, ASSIGNABLE, REVIEWER } from "../src/lib/ai/assignments";
import { AGENTS, ORDERED_AGENTS, agentRank } from "../src/lib/ai/agents";

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? ` — ${detail}` : ""}`);
  ok ? pass++ : fail++;
};

check("Odin exists and is the strategist", AGENTS.strategy?.name === "Odin");
check("Odin frames the work first", agentRank("strategy") === 0);
check("Ragnhild closes it out", agentRank("editor") === 2);
check("everyone else works in the middle", agentRank("linkedin") === 1 && agentRank("design") === 1);
check("the ordered roster starts with Odin", ORDERED_AGENTS[0].key === "strategy");
check("...and ends with Ragnhild", ORDERED_AGENTS[ORDERED_AGENTS.length - 1].key === "editor");
check("the reviewer is not offered as an optional contributor", !ASSIGNABLE.some((a) => a.runsLast));
check("the reviewer is identified", REVIEWER?.key === "editor");

await db.delete(assignments);
const [client] = await db.insert(clients).values({ name: "Nattugla", slug: `n-${Date.now()}`, status: "active" }).returning();

// A brief given to two specialists, deliberately excluding the reviewer.
const created = await createAssignment({
  title: "Ireland or Sweden",
  brief: "Where should Nattugla launch first outside Norway, and why?",
  clientId: client.id,
  agentKeys: ["linkedin", "strategy"],
});
check("the assignment is created", created.ok === true);
if (!created.ok) process.exit(1);

const work = await db.select().from(contributions).where(eq(contributions.assignmentId, created.id));
check("the reviewer is added even when not picked", work.some((w) => w.agentKey === "editor"), work.map((w) => w.agentKey).join(","));
check("only the chosen specialists plus the reviewer are assigned", work.length === 3, `${work.length} rows`);

// An empty brief is a mistake, not an instruction.
const empty = await createAssignment({ title: "", brief: "   ", agentKeys: ["strategy"] });
check("an empty brief is refused", empty.ok === false);

const noOne = await createAssignment({ title: "x", brief: "real brief", agentKeys: [] });
check("a brief with nobody on it is refused", noOne.ok === false);

// A brief with no client is legitimate — a market question may precede the client.
const standalone = await createAssignment({ title: "Market scan", brief: "Where is the gap in Nordic eldercare tech?", agentKeys: ["strategy"] });
check("an assignment without a client is allowed", standalone.ok === true);

if (standalone.ok) {
  const [row] = await db.select().from(assignments).where(eq(assignments.id, standalone.id)).limit(1);
  check("it starts as running with nothing gathered", row.status === "running" && row.synthesis === null);
  check("its title is kept", row.title === "Market scan");
}

// A brief with no title falls back to the brief itself rather than going blank.
const untitled = await createAssignment({ title: "", brief: "Size the opportunity for digital nattilsyn in Ireland", agentKeys: ["strategy"] });
if (untitled.ok) {
  const [row] = await db.select().from(assignments).where(eq(assignments.id, untitled.id)).limit(1);
  check("an untitled brief still gets a usable name", row.title.startsWith("Size the opportunity"));
}

/*
 * The scheduling rule that matters most: the reviewer has nothing to gather
 * until the specialists have reported, so she must not be handed work early.
 */
const seq = await createAssignment({
  title: "Sequencing",
  brief: "A brief the whole team works",
  agentKeys: ["strategy", "linkedin", "seo"],
});
if (!seq.ok) process.exit(1);

const pick = async () => (await nextPending(seq.id)).next?.agentKey;
const finish = async (agentKey: string, status = "ready") =>
  db.update(contributions).set({ status, body: "done", completedAt: new Date() })
    .where(and(eq(contributions.assignmentId, seq.id), eq(contributions.agentKey, agentKey)));

check("the strategist is handed the brief first", (await pick()) === "strategy");

await finish("strategy");
const second = await pick();
check("a specialist goes next, not the reviewer", second !== "editor" && second !== undefined, String(second));

await finish("linkedin");
check("the reviewer still waits while one specialist is outstanding", (await pick()) !== "editor");

await finish("seo");
check("the reviewer goes once everyone has reported", (await pick()) === "editor");

const before = await nextPending(seq.id);
check("only the reviewer is outstanding by then", before.outstanding === 1);

await finish("editor");
const after = await nextPending(seq.id);
check("nothing is left once she is done", after.outstanding === 0 && after.next === undefined);

// A specialist that fails must not stall the reviewer forever.
const withFailure = await createAssignment({ title: "Failure", brief: "b", agentKeys: ["strategy", "seo"] });
if (withFailure.ok) {
  await db.update(contributions).set({ status: "error", error: "boom", completedAt: new Date() })
    .where(and(eq(contributions.assignmentId, withFailure.id), eq(contributions.agentKey, "strategy")));
  await db.update(contributions).set({ status: "empty", completedAt: new Date() })
    .where(and(eq(contributions.assignmentId, withFailure.id), eq(contributions.agentKey, "seo")));
  const nextUp = await nextPending(withFailure.id);
  check("a failed or empty specialist still releases the reviewer", nextUp.next?.agentKey === "editor", String(nextUp.next?.agentKey));
}

/*
 * Recovery from a request killed mid-answer — the failure that made a
 * specialist look stuck at "working" indefinitely.
 */
const { STALE_MS_FOR_TEST, MAX_ATTEMPTS_FOR_TEST } = await import("../src/lib/ai/assignments");

const stuck = await createAssignment({ title: "Stuck", brief: "b", agentKeys: ["strategy"] });
if (!stuck.ok) process.exit(1);

const setRunning = async (agentKey: string, startedAgo: number, attempts: number) =>
  db.update(contributions)
    .set({ status: "running", startedAt: new Date(Date.now() - startedAgo), attempts })
    .where(and(eq(contributions.assignmentId, stuck.id), eq(contributions.agentKey, agentKey)));

const statusOf = async (agentKey: string) => {
  const [r] = await db.select().from(contributions)
    .where(and(eq(contributions.assignmentId, stuck.id), eq(contributions.agentKey, agentKey))).limit(1);
  return r;
};

// Still inside the window: genuinely running, must not be restarted underneath.
await setRunning("strategy", 60_000, 1);
await processAssignment(stuck.id);
check("work still inside the time limit is left alone", (await statusOf("strategy")).status === "running");

const fresh = await nextPending(stuck.id);
check("...and is not offered as available work", fresh.next === undefined);

// Past the window: the request that owned it is gone, so requeue it.
await setRunning("strategy", STALE_MS_FOR_TEST + 60_000, 1);
await processAssignment(stuck.id);
const requeued = await statusOf("strategy");
check("abandoned work is requeued, not left hanging", requeued.status !== "running", requeued.status);

// Past the window and out of attempts: fail it loudly instead of looping.
await setRunning("strategy", STALE_MS_FOR_TEST + 60_000, MAX_ATTEMPTS_FOR_TEST);
await processAssignment(stuck.id);
const givenUp = await statusOf("strategy");
check("work that keeps timing out fails instead of retrying forever", givenUp.status === "error", givenUp.status);
check("...and says why, in terms that suggest a fix", /too big|narrowing/i.test(givenUp.error ?? ""), givenUp.error ?? "");

// The stale window must outlast the route limit, or live work gets double-run.
check("the reclaim window is longer than the route's 300s limit", STALE_MS_FOR_TEST > 300_000, `${STALE_MS_FOR_TEST}ms`);

await db.delete(assignments);
await db.delete(clients).where(eq(clients.id, client.id));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
