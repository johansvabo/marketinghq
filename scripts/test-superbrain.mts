/**
 * One mind with a bench, instead of nine colleagues.
 *
 * The specialists were good because of what they knew and what they refused
 * to accept — not because each was a separate person to brief, wait for and
 * collect from. That separateness cost two steps on every deliverable and
 * most of the failure surface: routing that broke, work that stalled, a job
 * that went to the wrong discipline because the right one did not exist.
 *
 * What has to survive the move is the strictness. A lens that agrees with
 * everything is worth nothing.
 */
import { readFileSync } from "node:fs";
import { AGENT_LIST, LENS_KEYS, lensMenu, lensOf } from "../src/lib/ai/agents";
import { brainSystemPrompt } from "../src/lib/ai/brain";
import { BRAIN_TOOLS, runBrainTool } from "../src/lib/ai/tools";

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? ` — ${detail}` : ""}`);
  ok ? pass++ : fail++;
};

/* --------------------------------------------- the expertise survived intact */

for (const agent of AGENT_LIST) {
  const lens = lensOf(agent.key)!;
  check(`${agent.name}'s craft is still there`, lens.text.length > 1_000, `${lens.text.length} chars`);
  check(`...without "You are ${agent.name}"`, !lens.text.startsWith(`You are ${agent.name}`));
}

// Content on the same line as the identity sentence must not be lost with it.
check("the editor keeps the line that followed her name", lensOf("editor")!.text.startsWith("Nothing reaches a client"));

// The specifics are the whole point. A summary would pass a length check.
check("the paid-media lens still knows platform ROAS double-counts", /double-counts/i.test(lensOf("performance")!.text));
check("the copy lens still refuses synonym variants", /different arguments, not different wordings/i.test(lensOf("copy")!.text));
check("the copy lens still knows B2B buyers carry risk", /fired for doing nothing/i.test(lensOf("copy")!.text));
check("the strategy lens is intact", lensOf("strategy")!.text.length > 2_500);

check("every discipline is reachable", LENS_KEYS.length === AGENT_LIST.length, `${LENS_KEYS.length}`);
check("an unknown discipline has no lens", lensOf("astrology") === null);

/* ------------------------------------------------------- the brain is one mind */

const brain = brainSystemPrompt();
check("it is told it carries the bench", /one mind with nine disciplines/i.test(brain));
check("it is told there is nobody to hand to", /nobody to hand work to/i.test(brain));
check("the menu of disciplines is generated", LENS_KEYS.every((k) => brain.includes(k)));
check("it is told to load before starting, not after", /before you start, not after/i.test(brain));
check("it is warned what improvising actually looks like", /fluent, reasonable and flat/i.test(brain));
check("it must not hide behind a lens", /never use a lens as cover/i.test(brain));
check("it is told to get finished work reviewed", /critique_work/.test(brain));
check("it no longer routes anywhere", !brain.includes("/team/") && !/[Hh]and off/.test(brain));

/* -------------------------------------------------------------------- tooling */

const names = BRAIN_TOOLS.map((t) => t.name);
check("the hand-off tool is gone", !names.includes("propose_team_brief"));
check("consulting a discipline is a tool", names.includes("consult_specialist"));
check("so is a cold review", names.includes("critique_work"));

const consult = BRAIN_TOOLS.find((t) => t.name === "consult_specialist")!;
const disciplines = (consult.input_schema as { properties: { discipline: { enum: string[] } } }).properties.discipline.enum;
check("every discipline is offered by the tool", LENS_KEYS.every((k) => disciplines.includes(k)));
check("the tool description lists what each one is for", LENS_KEYS.every((k) => consult.description!.includes(k)));
check("the menu is generated from the roster", lensMenu().split("\n").length === AGENT_LIST.length);

/* ------------------------------------------------------------ loading a lens */

const loaded = await runBrainTool("consult_specialist", { discipline: "performance" }, {});
check("loading returns the craft", /double-counts/i.test(loaded.text));
check("...under the discipline's name, not a person's", loaded.text.includes("Paid media & performance"));
check("...and says it is knowledge, not a second person", /still yourself/i.test(loaded.text));
check("...and forbids signing it", /Do not sign it/i.test(loaded.text));
check("an unknown discipline is refused with the real options", (await runBrainTool("consult_specialist", { discipline: "nope" }, {})).text.includes("performance"));

/* -------------------------------------------------------------- cold review */

const tooShort = await runBrainTool("critique_work", { work: "Fine." }, {});
check("there is nothing to judge in a fragment", /nothing here to judge/i.test(tooShort.text));

// Without an API key the review cannot run — and must say so rather than
// letting the work pass as reviewed, which is the dangerous failure.
const noKey = await runBrainTool("critique_work", { work: "x".repeat(200), brief: "Say something." }, {});
check(
  "a review that cannot run says so",
  /could not be run/i.test(noKey.text) || /reviewer read this cold/i.test(noKey.text),
  noKey.text.slice(0, 100),
);
check("...and never implies the work was reviewed anyway", !/looks good/i.test(noKey.text));

const src = readFileSync("src/lib/ai/tools.ts", "utf8");
check("the review is a separate call, not this conversation", /A model\s*\n?\s*\* reviewing its own draft/i.test(src) || /separate call with none of this conversation/i.test(src));
check("the reviewer is told it cannot see how the work was made", /cannot see how it was made/i.test(src));
check("...and not to manufacture criticism", /manufacturing criticism/i.test(src));
check("...and to check it against the brief", /answers a different question/i.test(src));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
