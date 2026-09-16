/**
 * The brain streams text from every turn to the screen but stored only the
 * last one, so an answer that paused to use a tool came back half-missing on
 * the next reload. That is invisible while you are reading it — the screen is
 * right and the record is wrong — so it is pinned here.
 */
import { joinTurns } from "../src/lib/ai/brain";

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? ` — ${detail}` : ""}`);
  ok ? pass++ : fail++;
};

// The shape that broke: say something, use a tool, say more.
const run = ["La meg se på oppgavene dine.", "", "Jeg har lukket tre av dem."];
const stored = run.reduce(joinTurns, "");
check("the opening line survives a tool call", stored.includes("La meg se"), stored);
check("...and so does what came after", stored.includes("lukket tre"), stored);
check("...in the order they were said", stored.indexOf("La meg se") < stored.indexOf("lukket tre"));

check("turns are separated so they do not run together", joinTurns("A", "B") === "A\n\nB", JSON.stringify(joinTurns("A", "B")));
check("a silent turn adds nothing", joinTurns("A", "") === "A");
check("a whitespace-only turn adds nothing", joinTurns("A", "   \n ") === "A");
check("the first turn does not start with blank lines", joinTurns("", "A") === "A", JSON.stringify(joinTurns("", "A")));
check("trailing whitespace is not doubled up", joinTurns("A  \n", "B") === "A\n\nB", JSON.stringify(joinTurns("A  \n", "B")));

// A long agentic run: several turns of commentary around several tool calls.
const many = ["Sjekker.", "", "Fant fire.", "", "Lukket dem.", ""].reduce(joinTurns, "");
check("every speaking turn is kept across a long run", many.split("\n\n").length === 3, JSON.stringify(many));
check("...and nothing is lost from the middle", many.includes("Fant fire"));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
