import type Anthropic from "@anthropic-ai/sdk";
import { asc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { chatMessages, chatThreads, documents } from "@/lib/db/schema";
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

  const { threadId, message, context, agentKey, clientId, projectId, assignmentId, documentIds } = (await request.json()) as {
    threadId?: string;
    message: string;
    context?: string;
    agentKey?: string;
    clientId?: string | null;
    projectId?: string | null;
    assignmentId?: string | null;
    /** Files dropped into the conversation, already uploaded and unfiled. */
    documentIds?: string[];
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

  /*
   * A file dropped into the chat arrives unfiled. Describe what came in — with
   * enough of the text to recognise it — so the brain can put it away, or ask
   * where it goes, without a round trip just to find out what it is.
   */
  let attachmentNote: string | undefined;
  if (documentIds?.length) {
    const rows = await db.select().from(documents).where(inArray(documents.id, documentIds));
    if (rows.length) {
      attachmentNote = [
        `They have just uploaded ${rows.length === 1 ? "a file" : `${rows.length} files`} into this conversation. ${
          rows.length === 1 ? "It is" : "They are"
        } saved but not filed under any client yet.`,
        ``,
        ...rows.map((d) =>
          [
            `### ${d.title}`,
            `id: ${d.id}`,
            d.fileName ? `file: ${d.fileName}` : "",
            d.extractionNote ? `note: ${d.extractionNote}` : "",
            ``,
            d.body ? d.body.slice(0, 4000) + (d.body.length > 4000 ? "\n\n…(truncated — read_document for the rest)" : "") : "(no readable text could be extracted)",
          ]
            .filter(Boolean)
            .join("\n"),
        ),
        ``,
        `File each one with file_document. If what they wrote makes the destination clear, just do it and say where it went. If it does not, ask — one short question.`,
      ].join("\n");
    }
  }

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
          // Specific to this message, so it must not sit inside the cached prefix.
          turnExtra: attachmentNote,
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
