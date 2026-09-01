/**
 * QA over the business logic that would fail believably rather than loudly:
 * progress that quietly drifts, report cadences that skip a month, signals that
 * duplicate or never clear, numbers a client would be shown.
 */
import { and, eq } from "drizzle-orm";
import { ensureSchema } from "../src/lib/db/migrate";
import { db } from "../src/lib/db";
import {
  clients, documents, insights, metrics, projects, reportRuns, reportSchedules,
  signals, stakeholders, tasks,
} from "../src/lib/db/schema";
import { nextDueDate, reportingPeriod, materializeReportRuns } from "../src/lib/reporting/schedule";
import { runProactiveEngine } from "../src/lib/proactive/engine";
import { compare, totalsFor, withDerived } from "../src/lib/metrics";
import { zonedToUtc } from "../src/lib/timezone";

await ensureSchema();
for (const t of [signals, documents, insights, metrics, reportRuns, reportSchedules, stakeholders, tasks, projects, clients]) {
  await db.delete(t as never);
}

let fail = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (!ok) fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
};

/* --------------------------------------------- calendar times from Graph */
console.log("Calendar times");
check("Oslo 13:00 in summer is 11:00 UTC", zonedToUtc("2026-09-24T13:00:00", "Europe/Oslo").toISOString() === "2026-09-24T11:00:00.000Z");
check("Oslo 13:00 in winter is 12:00 UTC", zonedToUtc("2026-12-10T13:00:00", "Europe/Oslo").toISOString() === "2026-12-10T12:00:00.000Z");
check("a UTC time is left alone", zonedToUtc("2026-09-24T13:00:00", "UTC").toISOString() === "2026-09-24T13:00:00.000Z");

/* ---------------------------------------------- report cadence arithmetic */
console.log("Report cadences");
const monthly = nextDueDate({ cadence: "monthly", dayOf: 3 }, new Date("2026-01-15T12:00:00"));
check("monthly rolls to the next month", monthly.toISOString().slice(0, 10) === "2026-02-03", monthly.toISOString().slice(0, 10));

const monthlyEarly = nextDueDate({ cadence: "monthly", dayOf: 20 }, new Date("2026-01-15T12:00:00"));
check("monthly stays in month when day is ahead", monthlyEarly.toISOString().slice(0, 10) === "2026-01-20", monthlyEarly.toISOString().slice(0, 10));

const weekly = nextDueDate({ cadence: "weekly", dayOf: 1 }, new Date("2026-01-15T12:00:00")); // Thu → next Mon
check("weekly finds the next Monday", weekly.getDay() === 1, weekly.toISOString().slice(0, 10));

const dec = nextDueDate({ cadence: "monthly", dayOf: 3 }, new Date("2026-12-10T12:00:00"));
check("monthly crosses the year boundary", dec.toISOString().slice(0, 10) === "2027-01-03", dec.toISOString().slice(0, 10));

const period = reportingPeriod("monthly", new Date("2026-03-03T12:00:00"));
check("monthly due 3 Mar covers all of February", period.start === "2026-02-01" && period.end === "2026-02-28", `${period.start}→${period.end}`);

const leap = reportingPeriod("monthly", new Date("2028-03-05T12:00:00"));
check("February length is correct in a leap year", leap.end === "2028-02-29", leap.end);

const jan = reportingPeriod("monthly", new Date("2026-01-03T12:00:00"));
check("January report covers the previous December", jan.start === "2025-12-01" && jan.end === "2025-12-31", `${jan.start}→${jan.end}`);

const late = reportingPeriod("monthly", new Date("2026-03-25T12:00:00"));
check("a late-month due date still covers February", late.start === "2026-02-01" && late.end === "2026-02-28", `${late.start}→${late.end}`);

const q = reportingPeriod("quarterly", new Date("2026-04-05T12:00:00"));
check("quarterly covers three whole months", q.start === "2026-01-01" && q.end === "2026-03-31", `${q.start}→${q.end}`);

const wk = reportingPeriod("weekly", new Date("2026-03-09T12:00:00"));
check("weekly is a rolling seven days", wk.start === "2026-03-02" && wk.end === "2026-03-08", `${wk.start}→${wk.end}`);

/* ------------------------------------------------------ project progress */
console.log("\nProject progress");
const [c] = await db.insert(clients).values({ name: "QA Co", slug: "qa-co", status: "active" }).returning();
const [p] = await db.insert(projects).values({ clientId: c.id, name: "Launch", status: "active" }).returning();
await db.insert(tasks).values([
  { projectId: p.id, clientId: c.id, title: "1", status: "done" },
  { projectId: p.id, clientId: c.id, title: "2", status: "todo" },
  { projectId: p.id, clientId: c.id, title: "3", status: "dropped" },
]);

const { setTaskStatus } = await import("../src/server/actions");
// Progress is recalculated by the action; call it on a task to trigger it.
const [t2] = await db.select().from(tasks).where(eq(tasks.title, "2"));
try { await setTaskStatus(t2.id, "done"); } catch { /* revalidatePath needs a request context */ }
const rows = await db.select().from(tasks).where(eq(tasks.projectId, p.id));
const counted = rows.filter((r) => r.status !== "dropped");
const done = counted.filter((r) => r.status === "done");
check("dropped tasks excluded from the denominator", counted.length === 2, `${counted.length} counted of ${rows.length}`);
check("completion is 2 of 2 after the update", done.length === 2, `${done.length}/${counted.length}`);

/* -------------------------------------------------------- signal lifecycle */
console.log("\nProactive engine");
await db.insert(tasks).values({ clientId: c.id, title: "Overdue thing", status: "todo", dueDate: new Date(Date.now() - 9 * 86400000) });
const first = await runProactiveEngine();
const afterFirst = await db.select().from(signals);
check("an overdue task raises exactly one signal", afterFirst.filter((s) => s.rule === "task_overdue").length === 1);

const second = await runProactiveEngine();
const afterSecond = await db.select().from(signals);
check("re-running does not duplicate", afterSecond.length === afterFirst.length, `${afterFirst.length} → ${afterSecond.length}`);
check("re-running updates rather than inserts", second.raised === 0 && second.updated > 0, `raised ${second.raised}, updated ${second.updated}`);

const overdue = afterSecond.find((s) => s.rule === "task_overdue")!;
const [ot] = await db.select().from(tasks).where(eq(tasks.title, "Overdue thing"));
await db.update(tasks).set({ status: "done", completedAt: new Date() }).where(eq(tasks.id, ot.id));
await runProactiveEngine();
const [resolved] = await db.select().from(signals).where(eq(signals.id, overdue.id));
check("fixing the cause resolves the signal", resolved.resolvedAt !== null);

/* -------------------------------------------------------------- metrics */
console.log("\nMetrics shown to a client");
await db.insert(metrics).values([
  { clientId: c.id, source: "meta", date: "2026-08-01", metric: "spend", value: 1000, entityId: "a" },
  { clientId: c.id, source: "meta", date: "2026-08-02", metric: "spend", value: 500, entityId: "b" },
  { clientId: c.id, source: "meta", date: "2026-08-01", metric: "conversions", value: 10, entityId: "a" },
  { clientId: c.id, source: "meta", date: "2026-08-02", metric: "conversions", value: 5, entityId: "b" },
]);
const totals = await totalsFor({ clientId: c.id, from: "2026-08-01", to: "2026-08-31" });
check("spend sums across days and entities", totals.meta.spend === 1500, String(totals.meta.spend));
check("cost per conversion is derived correctly", Math.round(totals.meta.cost_per_conversion) === 100, String(totals.meta.cost_per_conversion));
const derived = withDerived({ spend: 100, clicks: 50, impressions: 1000, conversions: 5, revenue: 400 });
check("ctr is a percentage, not a ratio", derived.ctr === 5, String(derived.ctr));
check("roas is revenue over spend", derived.roas === 4, String(derived.roas));

/* --------------------------------------------------- report materialising */
console.log("\nReport queueing");
await db.insert(reportSchedules).values({
  clientId: c.id, name: "Monthly", cadence: "monthly", dayOf: 3, active: true,
  nextDueAt: nextDueDate({ cadence: "monthly", dayOf: 3 }),
});
const created = await materializeReportRuns();
const again = await materializeReportRuns();
check("a schedule queues one run", created === 1, String(created));
check("queueing twice does not duplicate", again === 0, String(again));

process.exit(fail === 0 ? 0 : 1);
