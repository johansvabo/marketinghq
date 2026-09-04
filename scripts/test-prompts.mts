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
