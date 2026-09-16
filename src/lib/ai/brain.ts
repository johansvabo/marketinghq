import type Anthropic from "@anthropic-ai/sdk";
import { asc, eq } from "drizzle-orm";
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
- Capture things worth remembering when they tell you something new. Do not silently save your own analysis — that clutters the brain.
- Keep it tight. No preamble, no "great question", no restating their question back at them.

## Keeping their work honest

You can close, move and drop tasks, and you are expected to. They are telling you what happened so the system reflects it — that is the entire point of saying it out loud.

- **When they say they have done something, close it.** Look it up with list_work, match it, call close_tasks. Never answer that you cannot tick things off, or that they have to do it manually. If you genuinely cannot tell which of two tasks they mean, ask — but ask about the ambiguity, not for permission to do your job.
- **When something is clearly not happening this week, move it.** An honest due date is worth more than a red one. Offer it: "Three of these have been open a fortnight — want them on Friday instead?" and do it when they say yes.
- **When they say they are not doing something, drop it.** Dropped is a real, respectable outcome and it stays on the record.
- **Never nag about something you have just been told is handled.** If your last message listed it as overdue and they replied that it is done, the correct next move is to close it and say so in half a line.

## Creating work, sparingly

A list nobody trusts is worse than no list. Every task you create is a small debt they have to service.

- **Only create a task for something they have actually committed to doing.** "We should probably look at X" is not a commitment; it is a thought. Put it in your reply, or capture it as an insight.
- **Prefer few and specific.** Three tasks they will do beats twelve that decay into a red wall. If a piece of notes yields fifteen candidates, file the three or four that matter and say in your summary what you deliberately left out.
- **Suggestions belong in your answer, not in their list.** If you think something is worth doing, say so and offer to add it. Let them say yes.
- **Watch the pile.** If they already have a lot overdue, adding more is not neutral. Say what you are seeing and offer to clear it before you add to it.

## Handing work to the team

The specialists can do real work for them, but briefing the team costs money and speaks in their name, so you never start it on your own.

- When the answer is really a piece of work for a specialist, use **propose_team_brief**. It drafts the brief and puts it in front of them with an approve button; nothing runs until they press it.
- Write the brief as you would for a colleague, and put what you already know from their records into it so nobody starts from scratch.
- Then say plainly what you have proposed, who would work it, and that it is waiting on their go-ahead. Do not pretend it has started.

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
/** Joins what successive turns said into the one answer the user actually read. */
export function joinTurns(soFar: string, next: string): string {
  const addition = next.trim();
  if (!addition) return soFar;
  return soFar ? `${soFar.trimEnd()}\n\n${addition}` : addition;
}

export const wantsWeb = (agent: Agent | null | undefined): boolean => (agent ? agent.web : true);

/** Facts about the current state of the world, refreshed on every request. */
async function runtimeContext(): Promise<string> {
  const [clientRows, projectRows] = await Promise.all([
    db.select().from(clients).where(eq(clients.status, "active")).orderBy(asc(clients.name)),
    // Ordered by name, not updatedAt: this text sits ahead of the whole
    // conversation in the cached prefix, and re-sorting it on every project
    // touch would invalidate the cache on essentially every request.
    db.select().from(projects).where(eq(projects.status, "active")).orderBy(asc(projects.name)).limit(25),
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
  /** A failed attempt is being retried: drop this many characters already shown. */
  | { type: "retry"; drop: number }
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

  /*
   * Ordered by how often each part changes, because caching is a prefix match:
   * anything above a change is reusable, everything below it is not. The
   * persona never changes, a thread's context is fixed for that conversation,
   * and the runtime block moves daily — so it goes last, with the breakpoints
   * on the two stable parts above it.
   */
  const system: Anthropic.TextBlockParam[] = [
    {
      type: "text",
      text: opts.agent ? agentSystemPrompt(opts.agent) : brainSystemPrompt(),
      cache_control: { type: "ephemeral" },
    },
  ];
  if (opts.systemExtra) {
    system.push({ type: "text", text: opts.systemExtra, cache_control: { type: "ephemeral" } });
  }
  system.push({ type: "text", text: await runtimeContext() });

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
      // What this attempt put on screen, so a retry can take it back rather
      // than streaming the same answer a second and third time.
      let shown = 0;
      const stream = client.messages.stream({
        model,
        max_tokens: 32_000,
        system,
        messages,
        tools,
        /*
         * The loop re-sends the whole conversation every turn — ten turns of a
         * specialist reading documents means the same history is paid for ten
         * times over. This moves the breakpoint to the end of the history as it
         * grows, so each turn reads the previous one instead of reprocessing it.
         */
        cache_control: { type: "ephemeral" },
        ...(containerId ? { container: containerId } : {}),
        thinking: { type: "adaptive" },
        output_config: { effort: "high" },
      });

      if (opts.onEvent) {
        stream.on("text", (delta) => {
          shown += delta.length;
          opts.onEvent!({ type: "text", text: delta });
        });
      }

      try {
        response = await stream.finalMessage();
        break;
      } catch (error) {
        if (!isTransient(error) || attempt >= 2) throw error;
        // Take back the half-answer before re-sending, or the same paragraph
        // arrives two and three times over.
        if (shown > 0) opts.onEvent?.({ type: "retry", drop: shown });
        await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
      }
    }
    containerId = response.container?.id ?? containerId;

    /*
     * The only way to know caching is working is to look: a run of turns where
     * cache_read stays at 0 means something above the breakpoint is changing
     * between requests. Logged rather than surfaced — it is a deployment
     * question, not something the user needs on screen.
     */
    const u = response.usage;
    console.log(
      `[claude] turn=${turn} model=${model} in=${u.input_tokens} cache_read=${u.cache_read_input_tokens ?? 0} cache_write=${u.cache_creation_input_tokens ?? 0} out=${u.output_tokens}`,
    );

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    // Every turn's text was already streamed to the screen, so every turn's
    // text belongs in what gets stored. Assigning here instead of appending
    // meant a run that said something, used a tool, then said more was saved
    // with only the last part — the earlier half vanished on the next reload.
    finalText = joinTurns(finalText, text);

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
      cache_control: { type: "ephemeral" },
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
