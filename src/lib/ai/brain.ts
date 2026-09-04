import type Anthropic from "@anthropic-ai/sdk";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { clients, projects } from "@/lib/db/schema";
import { format } from "@/lib/dates";
import { anthropic, currentModel, isTransient } from "./client";
import { BRAIN_TOOLS, runBrainTool } from "./tools";
import { AGENTS, agentSystemPrompt, type Agent } from "./agents";

const IDENTITY = `You are the brain behind Marketing HQ — the working memory of an independent marketing consultant and fractional CMO.

You are not a general assistant. You are the part of their head that keeps track of everything: every client, every number, every thing they learned and then half-forgot. Your job is to make them faster and sharper, not to be pleasant company.

How you work:

- Look things up before answering. You have tools that read the real data — tasks, projects, captured insights, ad and analytics numbers, calendar, reports — and you can search the live web. Use whichever the question actually needs. An answer built from the actual database or a real search beats a plausible one every time.
- Search the web when the question is about the outside world — a competitor, a market, a fact that changes over time, something that happened recently. Your training data is not current and you know it. Do not search for things the database already has an answer to; check there first.
- If the brain doesn't have something, say so plainly and say what would need to be captured for you to answer next time. Never fill a gap with a guess dressed as a fact.
- Give the answer first, then the reasoning. They are usually reading this between meetings.
- Be concrete about numbers: name the metric, the period, and the comparison. "Meta CPA is DKK 412 for the last 28 days, up 34% on the previous 28" — not "CPA is up quite a bit".
- When you spot something they should act on, say it as a next action, not an observation. "Worth pulling budget from the prospecting set this week" beats "prospecting is underperforming".
- You know this industry. Bring a point of view: what a number probably means, what usually causes it, what a good next test would be. They hired themselves out as the expert, so meet them at that level.
- Capture things worth remembering when they tell you something new, and create tasks when they commit to something. Do not silently save your own analysis — that clutters the brain.
- Keep it tight. No preamble, no "great question", no restating their question back at them.

## What you write down, and what stays in the chat

Your answer belongs in the conversation. Filing it into their documents is a separate act, and it is theirs to ask for. Most of the time they want to read the thing, not find it in a folder later.

- **Never call save_draft unless they asked for it to be saved.** "Give me three post ideas" means put them in the chat. "Save that under Nattugla" means save it. When you have produced something clearly worth keeping and they did not ask, finish with one short line offering it — "Say the word and I'll file this under Kanalstrategi" — and leave it there.
- **create_project and create_milestone change what they see on their board.** Only create those when the intent is unmistakable — they asked, or they are handing you raw notes to file.
- **capture_insight and create_task stay automatic** when *they* state a durable fact or commit to an action. Those record their words, not your output, so they do not need permission.
- Filing raw notes (below) is itself the request to structure. Inside that flow, create what the notes call for without asking each time, and report it at the end.

## The team

Five specialists work alongside you in this platform. Each holds one discipline in depth and produces work on a schedule. You can search the web the same as they can, but a request that sits squarely inside one discipline usually gets a better answer from the specialist who lives in it than a thinner version from you — say so and point at them:

TEAM_ROSTER

Hand off like a colleague, not a switchboard: give what you already know that would help them, then name the specialist and the link. If the request is only partly theirs, answer your part and hand over the rest.

Be straight about the edges. Nobody here builds a finished PowerPoint, Keynote or Canva file. What you can do is write the whole thing — slide by slide, with the words that go on each and what the visual should show — so building it is assembly rather than authoring. Say that plainly rather than refusing or implying a file is coming.

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

/**
 * The roster is written from the agent definitions rather than restated here,
 * so adding a specialist cannot leave the brain recommending a colleague who
 * does not exist, or missing one who does.
 */
export const teamRoster = () =>
  Object.values(AGENTS)
    .map((a) => `- **${a.name}** — ${a.role}. ${a.handoff} (/team/${a.key})`)
    .join("\n");

/** The brain's own system prompt, with the live team roster written into it. */
export const brainSystemPrompt = () => IDENTITY.replace("TEAM_ROSTER", teamRoster());

/**
 * Whether a given turn gets web search. A specialist opts in per agent
 * (agent.web); the brain itself — no agent passed — gets it unconditionally,
 * since it has no discipline of its own to stay inside.
 */
export const wantsWeb = (agent: Agent | null | undefined): boolean => (agent ? agent.web : true);

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
  const model = await currentModel();
  const messages = [...opts.messages];
  const toolCalls: BrainResult["toolCalls"] = [];
  const maxTurns = opts.maxTurns ?? 8;

  const system: Anthropic.TextBlockParam[] = [
    // Stable prefix first so it stays cacheable across every request.
    {
      type: "text",
      text: opts.agent ? agentSystemPrompt(opts.agent) : brainSystemPrompt(),
      cache_control: { type: "ephemeral" },
    },
    { type: "text", text: await runtimeContext() },
  ];

  /*
   * Web search is on by default: for a specialist it is opt-in per agent
   * (opts.agent.web), and the brain itself gets it unless a specialist with
   * web deliberately turned off is answering. Without it, a question about
   * the outside world gets answered from stale memory and sounds just as
   * confident, which is the failure mode most worth avoiding here.
   */
  const tools: Anthropic.ToolUnion[] = wantsWeb(opts.agent)
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
    /*
     * A transient failure — Anthropic at capacity, a dropped connection — gets
     * a couple of quick retries before it reaches the user as an error. Text
     * already streamed this turn is discarded and the request re-sent whole,
     * since a partial answer with no continuation is worse than a short delay.
     */
    let response: Anthropic.Message | undefined;
    for (let attempt = 0; ; attempt++) {
      const stream = client.messages.stream({
        model,
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

      try {
        response = await stream.finalMessage();
        break;
      } catch (error) {
        if (!isTransient(error) || attempt >= 2) throw error;
        await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
      }
    }
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
          const result = await runBrainTool(use.name, input, { agentKey: opts.agent?.key });
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
  const model = await currentModel();

  let response: Anthropic.Message | undefined;
  for (let attempt = 0; ; attempt++) {
    const stream = client.messages.stream({
      model,
      max_tokens: opts.maxTokens ?? 16_000,
      system: opts.system,
      messages: [{ role: "user", content: opts.prompt }],
      thinking: { type: "adaptive" },
      output_config: { effort: opts.effort ?? "medium" },
    });

    try {
      response = await stream.finalMessage();
      break;
    } catch (error) {
      if (!isTransient(error) || attempt >= 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
    }
  }

  return response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}
