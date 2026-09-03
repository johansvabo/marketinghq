/**
 * A user got stuck on a raw Anthropic error JSON when the model was at
 * capacity. This checks the pieces that fix that: transient errors are
 * recognised (including the shape a mid-stream overload actually arrives
 * in), the message shown is plain language, and a chosen model actually
 * takes effect and can be cleared again.
 */
import Anthropic from "@anthropic-ai/sdk";
import { describeAiError, isTransient, currentModel, setModelOverride, modelStatus, DEFAULT_MODEL } from "../src/lib/ai/client";
import { AVAILABLE_MODELS } from "../src/lib/ai/models";

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? ` — ${detail}` : ""}`);
  ok ? pass++ : fail++;
};

// The exact shape the SDK throws for a mid-stream overload: status undefined,
// the real error nested under .error.error.type.
const midStreamOverload = new Anthropic.APIError(
  undefined,
  { type: "error", error: { details: null, type: "overloaded_error", message: "Overloaded" }, request_id: "req_1" },
  undefined,
  undefined,
);

check("a mid-stream overload is recognised as transient", isTransient(midStreamOverload));
check("its message is plain language, not raw JSON", !describeAiError(midStreamOverload).includes("overloaded_error"));
check("it points at the fallback", describeAiError(midStreamOverload).includes("Settings"));

const rateLimit = Anthropic.APIError.generate(429, { error: { type: "rate_limit_error" } }, "slow down", new Headers());
check("a 429 is transient", isTransient(rateLimit));

const serverError = Anthropic.APIError.generate(529, { error: { type: "overloaded_error" } }, undefined, new Headers());
check("a 5xx is transient", isTransient(serverError));

// The real shape Anthropic's API returns: the sentence worth showing lives
// nested under error.message, not at the top level.
const badRequest = Anthropic.APIError.generate(
  400,
  { type: "error", error: { type: "invalid_request_error", message: "max_tokens is too large for this model" } },
  undefined,
  new Headers(),
);
check("a 400 is NOT transient — retrying would just repeat the same failure", !isTransient(badRequest));
check("a genuine error surfaces its real nested message, not the raw body", describeAiError(badRequest).includes("max_tokens is too large"));
check("...and does not just dump the JSON envelope", !describeAiError(badRequest).includes("invalid_request_error"));

const notAnApiError = new Error("network cable unplugged");
check("a plain Error is not treated as transient", !isTransient(notAnApiError));

// Model override round-trip.
const before = await modelStatus();
check("starts on the default, no override", !before.isOverride && before.id === DEFAULT_MODEL);

const other = AVAILABLE_MODELS.find((m) => m.id !== DEFAULT_MODEL)!;
await setModelOverride(other.id);
check("an override takes effect immediately", (await currentModel()) === other.id);
const during = await modelStatus();
check("modelStatus reports it as an override", during.isOverride && during.id === other.id);

await setModelOverride(null);
check("clearing it returns to the default", (await currentModel()) === DEFAULT_MODEL);
check("clearing it is reported as no longer an override", !(await modelStatus()).isOverride);

try {
  await setModelOverride("not-a-real-model");
  check("an unknown model id is rejected", false, "did not throw");
} catch {
  check("an unknown model id is rejected", true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
