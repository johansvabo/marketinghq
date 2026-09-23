import Anthropic from "@anthropic-ai/sdk";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import { env, isConfigured } from "@/lib/env";
import { AVAILABLE_MODELS } from "./models";

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

/** The model ANTHROPIC_MODEL points at, or Anthropic's current default flagship. */
export const DEFAULT_MODEL = env.anthropicModel;

export { AVAILABLE_MODELS } from "./models";

const MODEL_SETTINGS_KEY = "model";

/**
 * A model chosen in Settings overrides ANTHROPIC_MODEL until cleared. Read
 * fresh each time rather than cached in memory — it needs to take effect on
 * the very next request, including one already queued behind a stuck one.
 */
export async function currentModel(): Promise<string> {
  const [row] = await db.select().from(settings).where(eq(settings.key, MODEL_SETTINGS_KEY)).limit(1);
  const override = (row?.value as { model?: string } | null)?.model;
  return override && AVAILABLE_MODELS.some((m) => m.id === override) ? override : DEFAULT_MODEL;
}

/**
 * Work that runs while nobody is waiting: scheduled briefings, the daily
 * headline, the weekly digest, document extraction.
 *
 * None of it is being read as it arrives, and none of it is a judgement call
 * you are sitting there weighing. Running it on the flagship at full depth
 * was a default nobody chose — it just inherited what the chat uses — and it
 * is most of the bill.
 */
const BACKGROUND_SURFACES = new Set(["briefing", "brief", "import"]);

const BACKGROUND_MODEL_KEY = "model:background";

/** Sonnet 5: $2/$10 against Opus 5's $5/$25, and strong at reading and writing. */
export const DEFAULT_BACKGROUND_MODEL = "claude-sonnet-5";

/**
 * The model for a given kind of work.
 *
 * Interactive work — the chat, a brief you handed over and are waiting on —
 * uses whatever is chosen in Settings. Background work uses the cheaper model
 * unless that is explicitly overridden too, because paying the flagship rate
 * for something produced overnight and read later, if at all, is spending
 * without deciding to.
 */
export async function modelFor(surface?: string): Promise<string> {
  if (!surface || !BACKGROUND_SURFACES.has(surface)) return currentModel();

  const [row] = await db.select().from(settings).where(eq(settings.key, BACKGROUND_MODEL_KEY)).limit(1);
  const override = (row?.value as { model?: string } | null)?.model;
  if (override && AVAILABLE_MODELS.some((m) => m.id === override)) return override;

  // A background model that no longer exists must not silently fall back to
  // the expensive one — fall back to what is configured overall instead.
  return AVAILABLE_MODELS.some((m) => m.id === DEFAULT_BACKGROUND_MODEL) ? DEFAULT_BACKGROUND_MODEL : currentModel();
}

export async function setBackgroundModel(modelId: string | null): Promise<void> {
  if (modelId === null) {
    await db.delete(settings).where(eq(settings.key, BACKGROUND_MODEL_KEY));
    return;
  }
  if (!AVAILABLE_MODELS.some((m) => m.id === modelId)) throw new Error("Unknown model.");
  await db
    .insert(settings)
    .values({ key: BACKGROUND_MODEL_KEY, value: { model: modelId } })
    .onConflictDoUpdate({ target: settings.key, set: { value: { model: modelId } } });
}

/** What is actually in effect right now, and whether that is a manual override. */
export async function modelStatus(): Promise<{ id: string; label: string; isOverride: boolean }> {
  const [row] = await db.select().from(settings).where(eq(settings.key, MODEL_SETTINGS_KEY)).limit(1);
  const override = (row?.value as { model?: string } | null)?.model;
  const isOverride = Boolean(override && AVAILABLE_MODELS.some((m) => m.id === override));
  const id = isOverride ? override! : DEFAULT_MODEL;
  return { id, label: AVAILABLE_MODELS.find((m) => m.id === id)?.label ?? id, isOverride };
}

export async function setModelOverride(modelId: string | null): Promise<void> {
  if (modelId === null) {
    await db.delete(settings).where(eq(settings.key, MODEL_SETTINGS_KEY));
    return;
  }
  if (!AVAILABLE_MODELS.some((m) => m.id === modelId)) throw new Error("Unknown model.");
  await db
    .insert(settings)
    .values({ key: MODEL_SETTINGS_KEY, value: { model: modelId } })
    .onConflictDoUpdate({ target: settings.key, set: { value: { model: modelId } } });
}

/** What Anthropic says when the account has run out of prepaid credit. */
export const CREDIT_EXHAUSTED =
  "Your Anthropic account is out of credit, so the Brain and the team are paused until it is topped up. " +
  "Add credit under Plans & Billing at console.anthropic.com. Everything else in Marketing HQ keeps working, " +
  "and Settings → Spend shows where the last of it went.";

/**
 * A credit-balance failure, wherever it turns up in the error body. It has no
 * dedicated status or error type — the only reliable marker is the sentence
 * itself, which can sit at any of three depths depending on whether it came
 * back as an HTTP body or as an SSE error frame mid-stream.
 */
export function isCreditExhausted(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const err = error as {
    message?: string;
    error?: { message?: string; error?: { message?: string } };
  };
  const haystack = [err.message, err.error?.message, err.error?.error?.message]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes("credit balance is too low");
}

/**
 * Anthropic overload/5xx/rate-limit/connection errors — worth a short
 * automatic retry rather than surfacing to the user immediately.
 *
 * Deliberately structural rather than `instanceof Anthropic.RateLimitError`
 * and friends: those checks come back false across certain module-loading
 * paths even for a genuine SDK error of that exact type, which would make
 * the retry silently never fire. `status` and `error` are plain fields the
 * SDK always sets in its APIError constructor, so they hold up regardless.
 */
export function isTransient(error: unknown): boolean {
  if (!(error instanceof Error) || !("status" in error)) return false;
  // Out of credit looks transient from the outside — no status, arrives
  // mid-stream — but no amount of retrying will find more money.
  if (isCreditExhausted(error)) return false;
  const err = error as { status?: number; error?: { type?: string; error?: { type?: string } } };

  if (typeof err.status === "number") return err.status === 429 || err.status >= 500;

  // No HTTP status at all: either nothing reached Anthropic — a dropped
  // connection, worth retrying on our side too — or it did, and came back
  // as a body describing the failure instead. A mid-stream overload arrives
  // this way, since the response itself had already started as 200 OK.
  if (!("error" in err) || err.error === undefined) return true;
  // The real kind sits nested one level in: the outer object is the SSE
  // envelope ({"type":"error", error: {...}}) or the generate() wrapper
  // ({error: {...}}), never the kind itself.
  const kind = err.error?.error?.type;
  return kind === "overloaded_error" || kind === "api_error" || kind === "rate_limit_error";
}


/** Turns SDK errors into something worth showing a human. */
export function describeAiError(error: unknown): string {
  if (error instanceof AiNotConfiguredError) return error.message;
  if (isCreditExhausted(error)) return CREDIT_EXHAUSTED;
  if (isTransient(error)) {
    return "Claude is at capacity right now — this usually clears in under a minute. Try again, or switch models under Settings → Claude if it keeps happening.";
  }
  if (error instanceof Error && "status" in error) {
    const err = error as { status?: number; error?: { message?: string; error?: { message?: string } }; message: string };
    if (err.status === 401) return "Anthropic rejected the API key. Check ANTHROPIC_API_KEY.";
    /*
     * The SDK's own .message is frequently the entire error body stringified
     * rather than the sentence inside it — the raw JSON a user reported
     * seeing came from exactly this. The real sentence sits nested one or
     * two levels into the body; use that when it is there.
     */
    const real = err.error?.error?.message ?? err.error?.message;
    return `Anthropic API error ${err.status ?? "(no status)"}: ${real ?? err.message}`;
  }
  return error instanceof Error ? error.message : String(error);
}
