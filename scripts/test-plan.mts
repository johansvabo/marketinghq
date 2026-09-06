/**
 * Timeline arithmetic: quarter edges, week boundaries, how a bar is placed and
 * clipped, and how an estimate is spread. All of it fails silently — a bar
 * lands in the wrong week and the chart still looks plausible.
 */
import { overlapDays, placeInWindow, quarterBounds, quarterOf, shiftQuarter, taskSpan, weeksIn } from "../src/lib/plan";

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? ` — ${detail}` : ""}`);
  ok ? pass++ : fail++;
};
const d = (s: string) => { const [y, m, day] = s.split("-").map(Number); return new Date(y, m - 1, day); };
const isoOf = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;

// Quarters
check("Q1 starts in January", isoOf(quarterBounds(2026, 1).start) === "2026-01-01");
check("Q1 ends on 31 March", isoOf(quarterBounds(2026, 1).end) === "2026-03-31");
check("Q3 covers July to September", isoOf(quarterBounds(2026, 3).start) === "2026-07-01" && isoOf(quarterBounds(2026, 3).end) === "2026-09-30");
check("Q4 ends on new year's eve", isoOf(quarterBounds(2026, 4).end) === "2026-12-31");
check("a leap February is handled", isoOf(quarterBounds(2028, 1).end) === "2028-03-31");
check("September is Q3", quarterOf(d("2026-09-06")).quarter === 3);
check("the next quarter after Q4 rolls the year", JSON.stringify(shiftQuarter(2026, 4, 1)) === JSON.stringify({ year: 2027, quarter: 1 }));
check("the previous quarter before Q1 rolls back", JSON.stringify(shiftQuarter(2026, 1, -1)) === JSON.stringify({ year: 2025, quarter: 4 }));

// Weeks — a quarter is 13 weeks, but only if the part-weeks at each end count.
const q = quarterBounds(2026, 1);
const w = weeksIn(q);
check("weeks start on a Monday", w.every((x) => x.start.getDay() === 1), String(w[0].start.getDay()));
check("the first week covers the quarter's first day", w[0].start <= q.start && w[0].end >= q.start);
check("the last week reaches the quarter's last day", w[w.length - 1].end >= q.end);
check("a quarter is thirteen or fourteen weeks", w.length === 13 || w.length === 14, String(w.length));

// Overlap
check("a span overlapping itself counts its own days", overlapDays({ start: d("2026-09-01"), end: d("2026-09-05") }, { start: d("2026-09-01"), end: d("2026-09-05") }) === 5);
check("a single day counts as one", overlapDays({ start: d("2026-09-01"), end: d("2026-09-01") }, { start: d("2026-09-01"), end: d("2026-09-07") }) === 1);
check("spans that do not touch overlap by nothing", overlapDays({ start: d("2026-09-01"), end: d("2026-09-02") }, { start: d("2026-09-03"), end: d("2026-09-09") }) === 0);
check("touching at one end counts that day", overlapDays({ start: d("2026-09-01"), end: d("2026-09-03") }, { start: d("2026-09-03"), end: d("2026-09-09") }) === 1);

// Placement
const win = { start: d("2026-07-01"), end: d("2026-09-30") };
const whole = placeInWindow({ start: d("2026-07-01"), end: d("2026-09-30") }, win)!;
check("a span filling the window starts at zero", Math.abs(whole.left) < 0.001, String(whole.left));
check("...and fills its width", Math.abs(whole.width - 100) < 0.001, String(whole.width));
check("a span before the window is not placed", placeInWindow({ start: d("2026-05-01"), end: d("2026-06-30") }, win) === null);
check("a span after the window is not placed", placeInWindow({ start: d("2026-10-01"), end: d("2026-10-05") }, win) === null);

const straddling = placeInWindow({ start: d("2026-06-01"), end: d("2026-07-15") }, win)!;
check("a span starting before the window is clipped to its edge", straddling.left === 0 && straddling.clippedStart);
check("...and is marked as continuing beyond", !straddling.clippedEnd);

const oneDay = placeInWindow({ start: d("2026-08-15"), end: d("2026-08-15") }, win)!;
check("a single day still has visible width", oneDay.width >= 0.6, String(oneDay.width));
check("...and sits about halfway through the quarter", oneDay.left > 45 && oneDay.left < 55, String(oneDay.left));

// Task spans
check("a task with both dates spans them", isoOf(taskSpan({ startDate: d("2026-09-01"), dueDate: d("2026-09-04") })!.end) === "2026-09-04");
check("a task with only a due date is one day", (() => { const s = taskSpan({ startDate: null, dueDate: d("2026-09-04") })!; return isoOf(s.start) === isoOf(s.end); })());
check("a task with no dates has no span", taskSpan({ startDate: null, dueDate: null }) === null);
check("dates the wrong way round are straightened out", (() => { const s = taskSpan({ startDate: d("2026-09-09"), dueDate: d("2026-09-02") })!; return isoOf(s.start) === "2026-09-02" && isoOf(s.end) === "2026-09-09"; })());

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
