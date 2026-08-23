import type Anthropic from "@anthropic-ai/sdk";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { clients, projects } from "@/lib/db/schema";
import { format } from "@/lib/dates";
import { anthropic, MODEL } from "./client";
import { BRAIN_TOOLS, runBrainTool } from "./tools";

const IDENTITY = `You are the brain behind Marketing HQ — the working memory of an independent marketing consultant and fractional CMO.

You are not a general assistant. You are the part of their head that keeps track of everything: every client, every number, every thing they learned and then half-forgot. Your job is to make them faster and sharper, not to be pleasant company.

How you work:

- Look things up before answering. You have tools that read the real data — tasks, projects, captured insights, ad and analytics numbers, calendar, reports. Use them. An answer built from the actual database beats a plausible one every time.
- If the brain doesn't have something, say so plainly and say what would need to be captured for you to answer next time. Never fill a gap with a guess dressed as a fact.
- Give the answer first, then the reasoning. They are usually reading this between meetings.
- Be concrete about numbers: name the metric, the period, and the comparison. "Meta CPA is DKK 412 for the last 28 days, up 34% on the previous 28" — not "CPA is up quite a bit".
- When you spot something they should act on, say it as a next action, not an observation. "Worth pulling budget from the prospecting set this week" beats "prospecting is underperforming".
- You know this industry. Bring a point of view: what a number probably means, what usually causes it, what a good next test would be. They hired themselves out as the expert, so meet them at that level.
- Capture things worth remembering when they tell you something new, and create tasks when they commit to something. Do not silently save your own analysis — that clutters the brain.
- Keep it tight. No preamble, no "great question", no restating their question back at them.`;

/** Facts about the current state of the world, refreshed on every request. */
async function runtimeContext(): Promise<string> {
  const [clientRows, projectRows] = await Promise.all([
    db.select().from(clients).where(eq(clients.status, "active")),
    db.select().from(projects).where(eq(projects.status, "active")).orderBy(desc(projects.updatedAt)).limit(25),
  ]);

  return [
    `Today is ${format(new Date(), "EEEE d MMMM yyyy")}.`,
    ``,
    `Active clients: ${clientRows.length ? clientRows.map((c) => `${c.name} (${c.engagement})`).join(", ") : "none yet"}.`,
    `Active projects: ${projectRows.length ? projectRows.map((p) => p.name).join(", ") : "none yet"}.`,
    ``,
    `When the user says "the client" or refers to a project by a partial name, match it against these lists rather than asking which one they mean.`,
  ].join("\n");
}

export type BrainEvent =
  | { type: "text"; text: string }
  | { type: "tool_start"; name: string; input: unknown }
  | { type: "tool_end"; name: string; summary: string };

export type BrainResult = {
  text: string;
  toolCalls: { name: string; input: unknown }[];
};

/**
 * The agentic loop: ask, run whatever tools Claude asks for, feed the results
 * back, repeat until it stops asking. Streams text out as it arrives so the UI
 * can render progressively.
 */
export async function runBrain(opts: {
  messages: Anthropic.MessageParam[];
  onEvent?: (event: BrainEvent) => void;
  systemExtra?: string;
  maxTurns?: number;
}): Promise<BrainResult> {
  const client = anthropic();
  const messages = [...opts.messages];
  const toolCalls: BrainResult["toolCalls"] = [];
  const maxTurns = opts.maxTurns ?? 8;

  const system: Anthropic.TextBlockParam[] = [
    // Stable prefix first so it stays cacheable across every request.
    { type: "text", text: IDENTITY, cache_control: { type: "ephemeral" } },
    { type: "text", text: await runtimeContext() },
  ];
  if (opts.systemExtra) system.push({ type: "text", text: opts.systemExtra });

  let finalText = "";

  for (let turn = 0; turn < maxTurns; turn++) {
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 32_000,
      system,
      messages,
      tools: BRAIN_TOOLS,
      thinking: { type: "adaptive" },
      output_config: { effort: "high" },
    });

    if (opts.onEvent) {
      stream.on("text", (delta) => opts.onEvent!({ type: "text", text: delta }));
    }

    const response = await stream.finalMessage();

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    if (text) finalText = text;

    if (response.stop_reason !== "tool_use") {
      // Echo thinking blocks back untouched if the caller continues this thread.
      messages.push({ role: "assistant", content: response.content });
      break;
    }

    messages.push({ role: "assistant", content: response.content });

    const uses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    const results: Anthropic.ToolResultBlockParam[] = [];

    // Run them in parallel and return every result in one user message —
    // splitting results across messages teaches the model to stop batching.
    await Promise.all(
      uses.map(async (use) => {
        const input = (use.input ?? {}) as Record<string, unknown>;
        opts.onEvent?.({ type: "tool_start", name: use.name, input });
        toolCalls.push({ name: use.name, input });
        try {
          const result = await runBrainTool(use.name, input);
          opts.onEvent?.({ type: "tool_end", name: use.name, summary: result.text.slice(0, 120) });
          results.push({ type: "tool_result", tool_use_id: use.id, content: result.text });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          opts.onEvent?.({ type: "tool_end", name: use.name, summary: `failed: ${message}` });
          results.push({ type: "tool_result", tool_use_id: use.id, content: `Tool failed: ${message}`, is_error: true });
        }
      }),
    );

    messages.push({ role: "user", content: results });
  }

  return { text: finalText, toolCalls };
}

/** One-shot generation with no tools — used for drafts and summaries. */
export async function generate(opts: {
  system: string;
  prompt: string;
  maxTokens?: number;
  effort?: "low" | "medium" | "high";
}): Promise<string> {
  const client = anthropic();
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: opts.maxTokens ?? 16_000,
    system: opts.system,
    messages: [{ role: "user", content: opts.prompt }],
    thinking: { type: "adaptive" },
    output_config: { effort: opts.effort ?? "medium" },
  });

  const response = await stream.finalMessage();
  return response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}
