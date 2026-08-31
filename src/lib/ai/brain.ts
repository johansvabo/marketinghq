import type Anthropic from "@anthropic-ai/sdk";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { clients, projects } from "@/lib/db/schema";
import { format } from "@/lib/dates";
import { anthropic, MODEL } from "./client";
import { BRAIN_TOOLS, runBrainTool } from "./tools";
import { agentSystemPrompt, type Agent } from "./agents";

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
- Keep it tight. No preamble, no "great question", no restating their question back at them.

## Turning raw notes into structure

When they paste meeting notes, a call summary or a brain dump, your job is to file it properly. Work through it in this order, and tell them what you did at the end.

**First, read the client.** Open their standing context and existing projects before creating anything. Half of what gets discussed in a meeting belongs to work that already exists, and a duplicate project is worse than no project.

Then sort every line into one of these, and be strict about which:

- **Task** — one action with an owner. "Send the invite to Mariann", "define KPIs per channel". If it has a date or a time, set it. If they said they would do it, it is theirs.
- **Project** — several tasks under one outcome. "Paid media across markets" is a project; "book the webinar room" is not. Give every project a goal that says what done looks like, and put the tasks under it.
- **Milestone** — a fixed date other people are counting on. A webinar, a launch, a deadline. Only when there is a real date.
- **Insight** — something durable that will still be true and useful in a year. A positioning decision, what an audience responds to, a seasonal pattern, a constraint. Not "we discussed KPIs" — that is a task. "Their buying window for municipalities is September to October" is an insight.
- **Person** — anyone named who matters to the relationship.
- **Standing context** — the two or three lines that change how everything about this client should be read. Ambition, model, what they sell. Build on what is there rather than overwriting it.

Rules that keep this useful:

- **Do not invent dates.** If a note says "end of September" and no date is given, say so in the task title rather than picking one.
- **Do not turn every line into a task.** Notes contain observations, decisions and actions mixed together, and filing an observation as a task creates a list nobody trusts.
- **Keep their words.** Write titles in the language the notes are in. Do not translate a Norwegian meeting into English tasks.
- **Ambiguity goes to them, not into the system.** If you cannot tell whether something is theirs to do or the client's, put it in the summary as a question rather than guessing.
- **Finish with a short summary** of what you created, grouped by type, and anything you deliberately did not file and why.`;

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
  /** When set, this specialist answers instead of the general brain. */
  agent?: Agent | null;
}): Promise<BrainResult> {
  const client = anthropic();
  const messages = [...opts.messages];
  const toolCalls: BrainResult["toolCalls"] = [];
  const maxTurns = opts.maxTurns ?? 8;

  const system: Anthropic.TextBlockParam[] = [
    // Stable prefix first so it stays cacheable across every request.
    { type: "text", text: opts.agent ? agentSystemPrompt(opts.agent) : IDENTITY, cache_control: { type: "ephemeral" } },
    { type: "text", text: await runtimeContext() },
  ];

  /*
   * Specialists who reason about the outside world — competitors, procurement
   * notices, market moves — get web search. Without it they would answer from
   * stale memory and sound just as confident, which is the failure mode most
   * worth avoiding here.
   */
  const tools: Anthropic.ToolUnion[] = opts.agent?.web
    ? [...BRAIN_TOOLS, { type: "web_search_20260209", name: "web_search", max_uses: 6 } as Anthropic.ToolUnion]
    : [...BRAIN_TOOLS];
  if (opts.systemExtra) system.push({ type: "text", text: opts.systemExtra });

  let finalText = "";

  /*
   * Web search runs code execution on Anthropic's side, inside a container. Once
   * a turn has pending tool uses from it, every follow-up request must name that
   * same container or the API rejects the call outright:
   *   "container_id is required when there are pending tool uses generated by
   *    code execution with tools"
   * The id only appears on the response, so carry it forward.
   */
  let containerId: string | undefined;

  for (let turn = 0; turn < maxTurns; turn++) {
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 32_000,
      system,
      messages,
      tools,
      ...(containerId ? { container: containerId } : {}),
      thinking: { type: "adaptive" },
      output_config: { effort: "high" },
    });

    if (opts.onEvent) {
      stream.on("text", (delta) => opts.onEvent!({ type: "text", text: delta }));
    }

    const response = await stream.finalMessage();
    containerId = response.container?.id ?? containerId;

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    if (text) finalText = text;

    /*
     * A server-side tool (web search) can pause a long turn rather than finish
     * it. Treating that as "done" silently truncates the answer with no error
     * and no warning — so push the paused turn back and let it carry on.
     */
    if (response.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: response.content });
      continue;
    }

    if (response.stop_reason !== "tool_use") {
      // Echo thinking blocks back untouched if the caller continues this thread.
      messages.push({ role: "assistant", content: response.content });
      break;
    }

    messages.push({ role: "assistant", content: response.content });

    const uses = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && BRAIN_TOOLS.some((t) => t.name === b.name),
    );

    // Nothing of ours to run means the model is waiting on a server-side tool.
    if (uses.length === 0) continue;
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
