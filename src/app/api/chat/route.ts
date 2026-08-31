import type Anthropic from "@anthropic-ai/sdk";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { chatMessages, chatThreads } from "@/lib/db/schema";
import { isSignedIn } from "@/lib/auth";
import { runBrain } from "@/lib/ai/brain";
import { getAgent } from "@/lib/ai/agents";
import { describeAiError } from "@/lib/ai/client";

export const runtime = "nodejs";
export const maxDuration = 250;

/**
 * Streams the brain's answer as server-sent events. Tool activity is streamed
 * too — seeing "searching the brain…" is what makes the wait feel like work
 * rather than a hang.
 */
export async function POST(request: Request) {
  if (!(await isSignedIn())) return new Response("Unauthorized", { status: 401 });

  const { threadId, message, context, agentKey } = (await request.json()) as {
    threadId?: string;
    message: string;
    context?: string;
    agentKey?: string;
  };

  if (!message?.trim()) return new Response("Empty message", { status: 400 });

  let thread = threadId ? (await db.select().from(chatThreads).where(eq(chatThreads.id, threadId)).limit(1))[0] : undefined;
  if (!thread) {
    [thread] = await db
      .insert(chatThreads)
      .values({ title: message.trim().slice(0, 60), agentKey: agentKey ?? null })
      .returning();
  }

  await db.insert(chatMessages).values({ threadId: thread.id, role: "user", content: message.trim() });

  const history = await db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.threadId, thread.id))
    .orderBy(asc(chatMessages.createdAt));

  // Only text is replayed — tool round-trips stay inside the turn that made them.
  const messages: Anthropic.MessageParam[] = history.map((row) => ({
    role: row.role === "user" ? "user" : "assistant",
    content: row.content,
  }));

  const encoder = new TextEncoder();
  const threadIdForClient = thread.id;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      send("thread", { threadId: threadIdForClient });

      try {
        const result = await runBrain({
          messages,
          systemExtra: context,
          agent: getAgent(agentKey ?? thread.agentKey),
          onEvent: (event) => {
            if (event.type === "text") send("text", { text: event.text });
            else if (event.type === "tool_start") send("tool", { name: event.name, state: "start" });
            else send("tool", { name: event.name, state: "end", summary: event.summary });
          },
        });

        await db.insert(chatMessages).values({
          threadId: threadIdForClient,
          role: "assistant",
          content: result.text,
          toolCalls: result.toolCalls,
        });

        send("done", { ok: true });
      } catch (error) {
        send("error", { message: describeAiError(error) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
