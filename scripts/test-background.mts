/**
 * Work that has to survive you walking away.
 *
 * All three failures here are invisible from the outside: the answer simply
 * never appears, and there is nothing to read that says why. Closing a tab
 * cancels the response stream, and the next write to it throws — inside the
 * callback the model streams text through, which is how a whole answer used
 * to be lost the moment the window closed.
 */
import { readFileSync } from "node:fs";

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? ` — ${detail}` : ""}`);
  ok ? pass++ : fail++;
};

/* ---------------------------------- the platform behaviour being guarded against */

// Establish it rather than assume it: an enqueue after the reader cancels
// throws, and that throw is what used to kill the run.
let sawThrow = false;
let ranToCompletion = false;
const raw = new ReadableStream({
  async start(controller) {
    controller.enqueue(new TextEncoder().encode("a"));
    await new Promise((r) => setTimeout(r, 10));
    try {
      controller.enqueue(new TextEncoder().encode("b"));
    } catch {
      sawThrow = true;
    }
    ranToCompletion = true;
  },
});
const rawReader = raw.getReader();
await rawReader.read();
await rawReader.cancel();
await new Promise((r) => setTimeout(r, 60));
check("writing to a cancelled stream throws", sawThrow);
check("...but the work itself can still run on", ranToCompletion);

/* ------------------------------------------- the guard, as the chat route has it */

const chat = readFileSync("src/app/api/chat/route.ts", "utf8");
check("the sender swallows a dead reader", /catch \{\s*listening = false;?\s*\}/.test(chat), "no try/catch around enqueue");
check("...and stops writing once it is gone", chat.includes("if (!listening) return;"));
check("closing a cancelled stream is guarded too", /try \{\s*controller\.close\(\);/.test(chat));
check(
  "the finished answer is still saved when nobody is listening",
  chat.indexOf("db.insert(chatMessages)") < chat.indexOf('send("done"'),
  "the save must not sit behind a send that can throw",
);

// Reproduce the shape of the fixed sender and prove a run survives it.
let delivered = 0;
let completed = false;
const guarded = new ReadableStream({
  async start(controller) {
    let listening = true;
    const send = (text: string) => {
      if (!listening) return;
      try {
        controller.enqueue(new TextEncoder().encode(text));
        delivered++;
      } catch {
        listening = false;
      }
    };
    send("first");
    for (let i = 0; i < 4; i++) {
      await new Promise((r) => setTimeout(r, 10));
      send(`chunk ${i}`);
    }
    completed = true; // where the answer gets written to the database
    try {
      controller.close();
    } catch {
      /* gone */
    }
  },
});
const reader = guarded.getReader();
await reader.read();
await reader.cancel();
await new Promise((r) => setTimeout(r, 150));
check("a run whose reader left still reaches the end", completed);
check("...and stops trying to write after the first refusal", delivered <= 1, `${delivered} delivered`);

/* ------------------------------------------------ assignments continue themselves */

const run = readFileSync("src/app/api/assignments/[id]/run/route.ts", "utf8");
check("a run hands off to a fresh invocation", run.includes("after(") && run.includes("hop"));
check("the chain is bounded", run.includes("MAX_HOPS") && /hop < MAX_HOPS/.test(run));
check(
  "it only chains when the pass actually moved something",
  /progress\.produced > 0 \|\| progress\.failed > 0/.test(run),
  "chaining on a stalled pass would spin",
);
check("a hop authenticates with the cron secret", run.includes("Bearer ${env.cronSecret}"));
check(
  "an unset secret closes the door rather than opening it",
  run.includes("Boolean(env.cronSecret) && secret ==="),
  "self-call auth must require a configured secret",
);
check(
  "a signed-in person is still required otherwise",
  run.includes("!isSelfCall && !(await isSignedIn())"),
);
check("no secret configured means no chaining", /return Boolean\(env\.cronSecret\) && hop < MAX_HOPS;/.test(run));

/* ------------------------------------------------------------- being told about it */

const digest = readFileSync("src/lib/ai/digest.ts", "utf8");
check("finished work is announced", digest.includes("notifyFinishedAssignments"));
check("...once only", digest.includes("isNull(assignments.notifiedAt)"));
check(
  "...and is only marked sent if the send worked",
  digest.indexOf("if (result.ok) {") < digest.indexOf("notifiedAt: now"),
  "a failed send must be retried, not silently dropped",
);
check("a brief that failed is reported too, not just a successful one", digest.includes("Teamet stoppet opp"));

const cron = readFileSync("src/app/api/cron/route.ts", "utf8");
check("the nightly pass is the backstop for notifications", cron.includes("notifyFinishedAssignments("));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
