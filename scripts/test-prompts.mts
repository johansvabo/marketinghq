/**
 * The prompts are the product here — a rule that silently stops being included
 * changes how the brain behaves with no compile error and no failing page.
 * These check the text the model actually receives, not the source that builds it.
 */
import { AGENTS, agentSystemPrompt } from "../src/lib/ai/agents";
import { brainSystemPrompt } from "../src/lib/ai/brain";

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

// Every specialist carries the shared rules, whichever persona they lead with.
for (const agent of Object.values(AGENTS)) {
  const prompt = agentSystemPrompt(agent);
  check(`${agent.name} only files when asked`, /Only file something into their documents when they ask/.test(prompt));
  check(`${agent.name} still files scheduled briefings`, /scheduled briefing is the exception/.test(prompt));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
