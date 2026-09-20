/**
 * The prompts are the product here — a rule that silently stops being included
 * changes how the brain behaves with no compile error and no failing page.
 * These check the text the model actually receives, not the source that builds it.
 */
import { AGENTS, agentSystemPrompt } from "../src/lib/ai/agents";
import { brainSystemPrompt, wantsWeb } from "../src/lib/ai/brain";

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  ok ? pass++ : fail++;
};

const brain = brainSystemPrompt();

check("the brain is told not to save unless asked", /Never call save_draft unless they asked/.test(brain));
check("it offers instead of saving", /offering it/.test(brain));
check("filing raw notes is still exempt", /Filing raw notes .*is itself the request to structure/.test(brain));
check("the roster placeholder is replaced", !brain.includes("TEAM_ROSTER"));

/* -------------------------------------------- the roster covers the disciplines */

// A writing job went to the media buyer because nobody on the team wrote for
// a living, and his answer was fluent, well-argued and flat. A missing
// discipline does not announce itself: the nearest specialist takes the work
// and does it at the level a non-specialist would.
const roles = Object.values(AGENTS).map((a) => `${a.role} ${a.blurb} ${a.handoff}`.toLowerCase());
const covers = (term: string) => roles.some((r) => r.includes(term));
check("somebody's craft is the words themselves", covers("copywriting") || covers("copy"));
check("somebody owns strategy", covers("strategy"));
check("somebody owns the numbers", covers("performance"));
check("somebody owns how it looks", covers("art direction"));
check("somebody reviews the rest", Object.values(AGENTS).some((a) => a.runsLast));

// Two people who both write need a boundary, or the brain picks arbitrarily.
check("the writer is distinguished from the LinkedIn specialist", /Iver writes for LinkedIn/.test(AGENTS.copy.handoff));
check("...and from the art director", !AGENTS.design.handoff.includes("ad copy"));

// The failure that caused the hire, encoded as a rule she is held to.
const nora = AGENTS.copy.persona;
check("she refuses variants that are synonyms", /different arguments, not different wordings/i.test(nora));
check("she will not let a headline repeat the body", /headline does a different job/i.test(nora));
check("she keeps spec language out of copy", /vocabulary is not copy/i.test(nora));
check("she insists on something concrete", /Something has to be seen/i.test(nora));
check("she says what each variant tests", /say what each one tests/i.test(nora));
check("she can say the problem is not the copy", /the problem is not the copy/i.test(nora));
check("she knows B2B buyers carry personal risk", /fired for doing nothing/i.test(nora));
check("she knows Norwegian public procurement", /framework agreement|procurement is a process/i.test(nora));
check("she reads the named source in full, not the excerpt", /read that document in full, not the excerpt/i.test(nora));
check("she writes Norwegian from the idea, not from English", /not translated English/i.test(nora));

for (const agent of Object.values(AGENTS)) {
  check(`the brain knows to hand off to ${agent.name}`, brain.includes(agent.name) && brain.includes(`/team/${agent.key}`));
  check(`${agent.name} has a handoff line`, agent.handoff.trim().length > 20);
}

check("the brain is honest about decks", /Nobody here builds a finished PowerPoint/.test(brain));

// The brain used to tell itself it had no web access while agents did —
// wrong once web search was turned on for it too. Both the capability and
// what the prompt claims about it need to agree.
check("the brain gets web search with no agent selected", wantsWeb(undefined) === true);
check("a specialist with web on keeps it", wantsWeb(AGENTS.market) === true);
check("a specialist with web off stays off", wantsWeb({ ...AGENTS.market, web: false }) === false);
check("the brain's own prompt no longer denies it can search", !/which you cannot/i.test(brain));
check("the brain is told when to search", /Search the web when the question is about the outside world/.test(brain));
check("the brain is told not to search what the database already answers", /database already has an answer/.test(brain));

// Every specialist carries the shared rules, whichever persona they lead with.
for (const agent of Object.values(AGENTS)) {
  const prompt = agentSystemPrompt(agent);
  check(`${agent.name} only files when asked`, /Only file something into their documents when they ask/.test(prompt));
  check(`${agent.name} still files scheduled briefings`, /scheduled briefing is the exception/.test(prompt));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
