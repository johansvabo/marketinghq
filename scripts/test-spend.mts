/**
 * What a call costs, and whether the error a user actually has to act on
 * reads like one. Both fail quietly: a wrong multiplier understates the bill
 * by exactly the amount you would want to know about, and a billing failure
 * dressed up as a crash sends you looking in the wrong place.
 */
import { cacheHitRate, costOf, formatUsd, ratesFor, WEB_SEARCH_USD } from "../src/lib/ai/pricing";
import { CREDIT_EXHAUSTED, describeAiError, isCreditExhausted, isTransient } from "../src/lib/ai/client";

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? ` — ${detail}` : ""}`);
  ok ? pass++ : fail++;
};
const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;

// ---- Published rates. These are the numbers the whole page is built on.
check("Opus 5 input is $5/MTok", ratesFor("claude-opus-5").input === 5);
check("Opus 5 output is $25/MTok", ratesFor("claude-opus-5").output === 25);
check("a cache write costs 1.25x input", near(ratesFor("claude-opus-5").cacheWrite, 5 * 1.25));
check("a cache read costs 0.1x input", near(ratesFor("claude-opus-5").cacheRead, 5 * 0.1));
check("Sonnet 5 is cheaper than Opus 5", ratesFor("claude-sonnet-5").input < ratesFor("claude-opus-5").input);
check("a dated model id resolves to its family", ratesFor("claude-haiku-4-5-20251001").input === 1);
check("an unknown model is priced as Opus, not as free", ratesFor("made-up-model").input === 5);

// ---- The arithmetic.
const usage = { inputTokens: 10_000, cacheReadTokens: 40_000, cacheWriteTokens: 0, outputTokens: 15_000, webSearches: 0 };
// Anthropic's own worked example: $0.05 + $0.02 + $0.375.
check("matches the published worked example", near(costOf("claude-opus-5", usage), 0.445), String(costOf("claude-opus-5", usage)));

check(
  "web searches are billed on top of the tokens",
  near(costOf("claude-opus-5", { ...usage, webSearches: 10 }), 0.445 + 10 * WEB_SEARCH_USD),
);
check("a search costs one cent", WEB_SEARCH_USD === 0.01);

// A cache read must never be priced as full input — the whole saving lives here.
const allFresh = costOf("claude-opus-5", { inputTokens: 50_000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0, webSearches: 0 });
const allCached = costOf("claude-opus-5", { inputTokens: 0, cacheReadTokens: 50_000, cacheWriteTokens: 0, outputTokens: 0, webSearches: 0 });
check("50k cached tokens cost a tenth of 50k fresh ones", near(allCached * 10, allFresh), `${allCached} vs ${allFresh}`);

// A write is a surcharge, not a discount. If this ever inverts, the panel
// would recommend caching things that are read once and never again.
const write = costOf("claude-opus-5", { inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 50_000, outputTokens: 0, webSearches: 0 });
check("a cache write costs more than sending the tokens fresh", write > allFresh);
check("one write plus one read is cheaper than two fresh sends", write + allCached < allFresh * 2);

// ---- Hit rate.
check("hit rate is reads over all input", near(cacheHitRate({ inputTokens: 25, cacheReadTokens: 75 })!, 0.75));
check("no traffic means no rate, not zero", cacheHitRate({ inputTokens: 0, cacheReadTokens: 0 }) === null);

// ---- Formatting. Sub-cent calls must not round away to nothing.
check("a fifth of a cent shows as a fifth of a cent", formatUsd(0.002) === "0.20¢");
check("under a dollar shows in cents", formatUsd(0.34) === "34¢");
check("over a dollar shows in dollars", formatUsd(12.5) === "$12.50");
check("zero is zero", formatUsd(0) === "$0");

// ---- The out-of-credit error.
// Shaped exactly as it reached the user: no HTTP status, message nested in the body.
const creditMidStream = Object.assign(new Error("Your credit balance is too low to access the Anthropic API."), {
  status: undefined,
  error: { error: { type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API." } },
});
check("an out-of-credit failure is recognised", isCreditExhausted(creditMidStream));
check("it is not treated as transient", !isTransient(creditMidStream));
check("the user is told to top up, not shown a stack trace", describeAiError(creditMidStream) === CREDIT_EXHAUSTED);
check("the message names where to do it", CREDIT_EXHAUSTED.includes("console.anthropic.com"));
check("the old raw wording is gone", !describeAiError(creditMidStream).includes("(no status)"));

// It must not swallow unrelated failures.
const overloaded = Object.assign(new Error("overloaded"), { status: 529, error: { error: { type: "overloaded_error" } } });
check("an overload is still transient", isTransient(overloaded));
check("an overload is not reported as a billing problem", describeAiError(overloaded) !== CREDIT_EXHAUSTED);
const notFound = Object.assign(new Error("nope"), { status: 404, error: { error: { message: "model not found" } } });
check("a 404 is neither transient nor a billing problem", !isTransient(notFound) && !isCreditExhausted(notFound));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
