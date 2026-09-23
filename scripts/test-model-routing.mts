/**
 * Which model does which work.
 *
 * Everything ran on the flagship because that was the chat's default and
 * nothing else ever chose. Scheduled briefings, the daily headline and
 * document extraction inherited it silently — work produced overnight and
 * read later, if at all, billed at the rate you pay for judgement you are
 * sitting there waiting on.
 */
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { db } from "../src/lib/db";
import { settings } from "../src/lib/db/schema";
import { AVAILABLE_MODELS, DEFAULT_BACKGROUND_MODEL, modelFor, setBackgroundModel, setModelOverride } from "../src/lib/ai/client";
import { ratesFor } from "../src/lib/ai/pricing";

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? ` — ${detail}` : ""}`);
  ok ? pass++ : fail++;
};

await setModelOverride(null);
await setBackgroundModel(null);
await setModelOverride("claude-opus-5");

// The whole point: the cheap one has to actually be cheaper, or this is theatre.
const interactive = ratesFor("claude-opus-5");
const background = ratesFor(DEFAULT_BACKGROUND_MODEL);
check("the background model exists in the catalogue", AVAILABLE_MODELS.some((m) => m.id === DEFAULT_BACKGROUND_MODEL));
check("...and costs less on input", background.input < interactive.input, `${background.input} vs ${interactive.input}`);
check("...and on output", background.output < interactive.output, `${background.output} vs ${interactive.output}`);

/* ------------------------------------------------------------------ routing */

check("the chat uses the chosen model", (await modelFor("chat")) === "claude-opus-5");
check("a brief you are waiting on uses it too", (await modelFor("assignment")) === "claude-opus-5");
check("an unknown surface defaults to the chosen model", (await modelFor("something-new")) === "claude-opus-5");
check("no surface at all defaults to the chosen model", (await modelFor()) === "claude-opus-5");

check("scheduled briefings use the cheaper one", (await modelFor("briefing")) === DEFAULT_BACKGROUND_MODEL);
check("the daily headline does too", (await modelFor("brief")) === DEFAULT_BACKGROUND_MODEL);
check("so does document extraction", (await modelFor("import")) === DEFAULT_BACKGROUND_MODEL);

// Changing the interactive model must not drag the background work up with it.
await setModelOverride("claude-fable-5-1");
check("picking a pricier model for chat leaves the background alone", (await modelFor("briefing")) === DEFAULT_BACKGROUND_MODEL);
check("...while the chat follows the choice", (await modelFor("chat")) === "claude-fable-5-1");

/* ---------------------------------------------------------------- overriding */

await setBackgroundModel("claude-haiku-4-5-20251001");
check("the background model can be set explicitly", (await modelFor("briefing")) === "claude-haiku-4-5-20251001");
check("...without touching the chat", (await modelFor("chat")) === "claude-fable-5-1");
await setBackgroundModel(null);
check("clearing it returns to the default", (await modelFor("briefing")) === DEFAULT_BACKGROUND_MODEL);

let refused = false;
try {
  await setBackgroundModel("not-a-model");
} catch {
  refused = true;
}
check("an unknown model is refused rather than stored", refused);

/* -------------------------------------------- nothing resolves the model globally */

// A call site that still asks for "the" model silently opts its work back
// into the expensive path, and nothing about it would look wrong.
for (const file of ["src/lib/ai/brain.ts", "src/lib/ai/import.ts"]) {
  check(`${file} routes by surface`, !readFileSync(file, "utf8").includes("currentModel("));
}

/* ------------------------------------------------ scheduled work is not run deep */

const briefings = readFileSync("src/lib/ai/briefings.ts", "utf8");
check("a scheduled briefing runs at medium effort", /effort: "medium"/.test(briefings));
check("...and for fewer turns", /maxTurns: 6/.test(briefings));

await setModelOverride(null);
await setBackgroundModel(null);
await db.delete(settings).where(eq(settings.key, "model:background"));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
