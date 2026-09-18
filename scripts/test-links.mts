/**
 * Where the buttons go. A link that lands on the wrong page fails silently —
 * you get *a* page, it just isn't the one you asked for, which is exactly how
 * "Open task" spent its life dropping people on the full list instead of the
 * task they had clicked.
 */
import { readFileSync } from "node:fs";

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? ` — ${detail}` : ""}`);
  ok ? pass++ : fail++;
};

const rules = readFileSync("src/lib/proactive/rules.ts", "utf8");

check(
  "signals link straight to the task",
  rules.includes("href: `/tasks/${task.id}`"),
);
check(
  "no signal still links to the list with a dead query param",
  !rules.includes("/tasks?focus="),
  "found /tasks?focus= — that param renders the whole list",
);

// Every "Open task" action must carry an id, or it cannot open anything.
const openActions = [...rules.matchAll(/label: "Open task", payload: \{ href: `([^`]+)` \}/g)].map((m) => m[1]);
check("every Open task action was found", openActions.length >= 2, `${openActions.length}`);
check(
  "every Open task href names a specific task",
  openActions.every((href) => href.includes("${task.id}") && !href.includes("?")),
  openActions.join(" | "),
);

// The old links are already stored in the database on existing signals, so
// the route has to keep honouring them.
const tasksPage = readFileSync("src/app/tasks/page.tsx", "utf8");
check("the list still redirects an old ?focus= link", tasksPage.includes("redirect(`/tasks/${params.focus}`)"));
check("focus is declared as a search param", /focus\?: string/.test(tasksPage));

// The page those links point at has to exist and be able to log something.
const detail = readFileSync("src/app/tasks/[id]/page.tsx", "utf8");
check("a task page exists", detail.includes("export default async function TaskPage"));
check("it looks the task up by id", detail.includes("eq(tasks.id, id)"));
check("a missing task 404s rather than rendering empty", detail.includes("notFound()"));

const detailUi = readFileSync("src/components/task-detail.tsx", "utf8");
check("it can save notes", detailUi.includes("updateTask(") && detailUi.includes("notes,"));
check("it can log time", detailUi.includes("logTime("));
check("it can move the task through its statuses", detailUi.includes("setTaskStatus("));

// And there has to be a way in from the lists themselves.
const taskList = readFileSync("src/components/tasks.tsx", "utf8");
check("task titles link to the task", taskList.includes("href={`/tasks/${task.id}`}"));

// Unread briefings must surface somewhere other than a page you never visit.
const home = readFileSync("src/app/page.tsx", "utf8");
check("the front page loads unread briefings", home.includes("isNull(briefings.readAt)"));
check("and only counts ones that actually produced something", home.includes('eq(briefings.status, "ready")'));

// The cost line that used to be wrong by two orders of magnitude.
const schedule = readFileSync("src/components/briefing-schedule.tsx", "utf8");
// Check the rendered string, not the file — the comment above it quotes the
// old wording on purpose, and matching that would be a false alarm.
const costLine = schedule.split("\n").find((l) => l.includes("Each run is about")) ?? "";
check("the cost line was found", costLine.length > 0);
check("it no longer claims a briefing costs a few cents", !costLine.includes("a few cents"), costLine.trim().slice(0, 120));
check("it quotes a monthly figure instead", costLine.includes("${monthlyUsd.toFixed(0)}"));
check("and points at the real numbers", costLine.includes("Spend"));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
