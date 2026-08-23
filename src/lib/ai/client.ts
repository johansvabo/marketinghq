import Anthropic from "@anthropic-ai/sdk";
import { env, isConfigured } from "@/lib/env";

let cached: Anthropic | null = null;

export function anthropic(): Anthropic {
  if (!isConfigured.anthropic()) {
    throw new AiNotConfiguredError();
  }
  cached ??= new Anthropic({ apiKey: env.anthropicKey });
  return cached;
}

export class AiNotConfiguredError extends Error {
  constructor() {
    super("ANTHROPIC_API_KEY is not set — add it in Settings → Integrations to turn the brain on.");
    this.name = "AiNotConfiguredError";
  }
}

export const MODEL = env.anthropicModel;

/** Turns SDK errors into something worth showing a human. */
export function describeAiError(error: unknown): string {
  if (error instanceof AiNotConfiguredError) return error.message;
  if (error instanceof Anthropic.AuthenticationError) return "Anthropic rejected the API key. Check ANTHROPIC_API_KEY.";
  if (error instanceof Anthropic.RateLimitError) return "Rate limited by Anthropic — try again in a moment.";
  if (error instanceof Anthropic.APIError) return `Anthropic API error ${error.status}: ${error.message}`;
  return error instanceof Error ? error.message : String(error);
}
