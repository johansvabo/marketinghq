/**
 * What a call costs, in dollars.
 *
 * No imports of its own, for the same reason models.ts has none: the spend
 * page renders some of this in the browser, and anything that reaches the
 * database drags node:fs into the client bundle.
 *
 * Rates are USD per million tokens, from Anthropic's published pricing. Cache
 * writes and reads are separate line items, not discounts on input: a write
 * costs 1.25x the base input rate and a read 0.1x, so a cache that never gets
 * read is a 25% surcharge rather than a saving.
 */
export type Rates = {
  /** Fresh input tokens, billed in full. */
  input: number;
  /** Tokens written into the cache — 1.25x input for the 5-minute duration. */
  cacheWrite: number;
  /** Tokens served from the cache — 0.1x input, or 0.025x on Fable. */
  cacheRead: number;
  output: number;
};

const RATES: Record<string, Rates> = {
  "claude-opus-5": { input: 5, cacheWrite: 6.25, cacheRead: 0.5, output: 25 },
  "claude-sonnet-5": { input: 2, cacheWrite: 2.5, cacheRead: 0.2, output: 10 },
  "claude-fable-5-1": { input: 10, cacheWrite: 12.5, cacheRead: 0.25, output: 50 },
  "claude-haiku-4-5-20251001": { input: 1, cacheWrite: 1.25, cacheRead: 0.1, output: 5 },
};

/** Opus rates when the model is unknown — better to overstate than to hide spend. */
const FALLBACK: Rates = RATES["claude-opus-5"];

export function ratesFor(model: string): Rates {
  return RATES[model] ?? RATES[model.replace(/-\d{8}$/, "")] ?? FALLBACK;
}

/** $10 per 1,000 searches, billed on top of the tokens the results cost. */
export const WEB_SEARCH_USD = 0.01;

export type TokenUsage = {
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  webSearches: number;
};

export function costOf(model: string, usage: TokenUsage): number {
  const r = ratesFor(model);
  return (
    (usage.inputTokens * r.input +
      usage.cacheReadTokens * r.cacheRead +
      usage.cacheWriteTokens * r.cacheWrite +
      usage.outputTokens * r.output) /
      1_000_000 +
    usage.webSearches * WEB_SEARCH_USD
  );
}

/**
 * Cents, not dollars, and to the nearest hundredth of a cent: a single turn
 * can cost less than a cent and rounding it to $0.00 makes the cheap paths
 * look free, which is exactly the illusion this is meant to dispel.
 */
export function formatUsd(amount: number): string {
  if (amount === 0) return "$0";
  if (amount < 0.01) return `${(amount * 100).toFixed(2)}¢`;
  if (amount < 1) return `${(amount * 100).toFixed(0)}¢`;
  return `$${amount.toFixed(2)}`;
}

/**
 * How much of the input was served from cache. The number that decides
 * whether caching is working at all — a warmed-up loop should sit high, and
 * a run of turns at 0 means something above the breakpoint is changing.
 */
export function cacheHitRate(usage: { inputTokens: number; cacheReadTokens: number }): number | null {
  const total = usage.inputTokens + usage.cacheReadTokens;
  return total === 0 ? null : usage.cacheReadTokens / total;
}
