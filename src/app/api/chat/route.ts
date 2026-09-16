import type Anthropic from "@anthropic-ai/sdk";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { chatMessages, chatThreads } from "@/lib/db/schema";
import { isSignedIn } from "@/lib/auth";
import { runBrain } from "@/lib/ai/brain";
import { getAgent } from "@/lib/ai/agents";
import { describeAiError } from "@/lib/ai/client";
import { threadContext } from "@/lib/ai/thread-context";

export const runtime = "nodejs";
export const maxDuration = 250;

/**
 * Streams the brain's answer as server-sent events. Tool activity is streamed
 * too — seeing "searching the brain…" is what makes the wait feel like work
 * rather than a hang.
 */
export async function POST(request: Request) {
  if (!(await isSignedIn())) return new Response("Unauthorized", { status: 401 });

  const { threadId, message, context, agentKey, clientId, projectId, assignmentId } = (await request.json()) as {
    threadId?: string;
    message: string;
    context?: string;
    agentKey?: string;
    clientId?: string | null;
    projectId?: string | null;
    assignmentId?: string | null;
  };

  if (!message?.trim()) return new Response("Empty message", { status: 400 });

  let thread = threadId ? (await db.select().from(chatThreads).where(eq(chatThreads.id, threadId)).limit(1))[0] : undefined;
  if (!thread) {
    [thread] = await db
      .insert(chatThreads)
      .values({
        title: message.trim().slice(0, 60),
        agentKey: agentKey ?? null,
        // What the conversation is about, kept on the thread so it survives
        // a reload and so the context can be rebuilt server-side each turn.
        clientId: clientId || null,
        projectId: projectId || null,
        assignmentId: assignmentId || null,
      })
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

      /*
       * What actually reached the screen. If the run dies partway — Claude at
       * capacity, a dropped connection — the answer the user has already read
       * must still be there when they come back, so it is kept as it streams
       * rather than only being written once the whole run succeeds.
       */
      let streamed = "";

      try {
        const result = await runBrain({
          messages,
          // The thread's own links decide the context; anything the page adds
          // is appended rather than trusted in its place.
          systemExtra: [await threadContext(thread), context].filter(Boolean).join("\n\n") || undefined,
          agent: getAgent(agentKey ?? thread.agentKey),
          onEvent: (event) => {
            if (event.type === "text") {
              streamed += event.text;
              send("text", { text: event.text });
            } else if (event.type === "retry") {
              streamed = streamed.slice(0, Math.max(0, streamed.length - event.drop));
              send("retry", { drop: event.drop });
            }
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
        const message = describeAiError(error);

        // Keep the half-answer rather than losing it. Marked, so it is clear
        // on re-reading that it stopped rather than ended.
        if (streamed.trim()) {
          await db.insert(chatMessages).values({
            threadId: threadIdForClient,
            role: "assistant",
            content: `${streamed.trimEnd()}\n\n---\n\n_This answer stopped early: ${message}_`,
          });
        }

        send("error", { message });
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
