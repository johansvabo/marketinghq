"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUp, Loader2, Sparkles, Square } from "lucide-react";
import { Markdown } from "./markdown";
import { SaveAnswer, type SaveTarget } from "./save-answer";
import { setThreadContext } from "@/server/actions";

type ChatMessage = { role: "user" | "assistant"; content: string; tools?: string[] };

const TOOL_LABEL: Record<string, string> = {
  web_search: "searching the web",
  save_draft: "saving it to the client's documents",
  search_brain: "searching what you've captured",
  list_work: "reading your tasks and projects",
  get_metrics: "pulling the numbers",
  get_schedule: "checking your calendar",
  get_client_brief: "loading the client file",
  capture_insight: "saving that to the brain",
  create_task: "adding a task",
};

export function BrainChat({
  initial,
  threadId: initialThreadId,
  suggestions,
  aiReady,
  agentKey,
  placeholder,
  emptyTitle,
  emptyHint,
  saveTargets,
  clientId,
  projectId,
  assignmentId,
  compact = false,
  about,
}: {
  initial: ChatMessage[];
  threadId?: string;
  suggestions: string[];
  aiReady: boolean;
  /** Which specialist answers. Omitted means the general brain. */
  agentKey?: string;
  placeholder?: string;
  emptyTitle?: string;
  emptyHint?: string;
  /** Clients and projects an answer can be filed under. */
  saveTargets?: SaveTarget;
  /** What a new conversation is about. Stored on the thread when it is created. */
  clientId?: string | null;
  projectId?: string | null;
  assignmentId?: string | null;
  /** Sits inside a card rather than owning the viewport. */
  compact?: boolean;
  /** Lets the conversation be filed under a client, so it can be found again. */
  about?: { clients: { id: string; name: string }[]; projects: { id: string; name: string; clientId: string | null }[] };
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMessage[]>(initial);
  const [input, setInput] = useState("");
  const [threadId, setThreadId] = useState(initialThreadId);
  const [aboutClient, setAboutClient] = useState(clientId ?? "");
  const [aboutProject, setAboutProject] = useState(projectId ?? "");
  const [busy, setBusy] = useState(false);
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, activeTool]);

  async function send(text: string) {
    if (!text.trim() || busy) return;

    setError(null);
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: text }, { role: "assistant", content: "", tools: [] }]);
    setBusy(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          threadId,
          message: text,
          agentKey,
          assignmentId,
          clientId: aboutClient || clientId || null,
          projectId: aboutProject || projectId || null,
        }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) throw new Error(await response.text());

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";

        for (const chunk of chunks) {
          const eventMatch = chunk.match(/^event: (.+)$/m);
          const dataMatch = chunk.match(/^data: (.+)$/m);
          if (!eventMatch || !dataMatch) continue;

          const payload = JSON.parse(dataMatch[1]);

          if (eventMatch[1] === "thread") setThreadId(payload.threadId);
          else if (eventMatch[1] === "text") {
            setActiveTool(null);
            setMessages((prev) => {
              const next = [...prev];
              next[next.length - 1] = { ...next[next.length - 1], content: next[next.length - 1].content + payload.text };
              return next;
            });
          } else if (eventMatch[1] === "tool") {
            if (payload.state === "start") {
              setActiveTool(TOOL_LABEL[payload.name] ?? payload.name);
              setMessages((prev) => {
                const next = [...prev];
                const last = next[next.length - 1];
                next[next.length - 1] = { ...last, tools: [...(last.tools ?? []), payload.name] };
                return next;
              });
            } else {
              setActiveTool(null);
            }
          } else if (eventMatch[1] === "error") {
            setError(payload.message);
          }
        }
      }
      // Tasks and insights the brain created should show up everywhere else too.
      router.refresh();
    } catch (caught) {
      if ((caught as Error).name !== "AbortError") {
        setError(caught instanceof Error ? caught.message : "Something went wrong.");
      }
    } finally {
      setBusy(false);
      setActiveTool(null);
      abortRef.current = null;
    }
  }

  return (
    <div className={compact ? "flex max-h-[70vh] min-h-[240px] flex-col" : "flex h-[calc(100dvh-190px)] flex-col md:h-[calc(100dvh-150px)]"}>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-5 px-4 text-center">
            <div className="flex flex-col items-center gap-2">
              <Sparkles size={22} style={{ color: "var(--color-brand)" }} />
              <h2 className="text-[17px] font-semibold tracking-tight">{emptyTitle ?? "Ask your own record"}</h2>
              <p className="max-w-[46ch] text-[13px] leading-relaxed text-muted">
                {emptyHint ??
                  "The one that sees everything at once — every client, all your captured thinking, your numbers, your calendar, and the live web. Ask it across clients, hand it meeting notes to file, or work out what deserves your day."}
              </p>
              {!emptyHint && (
                <p className="max-w-[46ch] text-[12px] leading-relaxed text-muted">
                  For work inside one discipline — a post, a search plan, a competitor read, a tender window —{" "}
                  <Link href="/team" className="underline">the team</Link> goes deeper on that one thing.
                </p>
              )}
            </div>
            <div className="flex w-full max-w-[560px] flex-col gap-1.5">
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => send(suggestion)}
                  disabled={!aiReady}
                  className="card px-3.5 py-2.5 text-left text-[13px] transition-colors hover:border-[var(--ink-muted)] disabled:opacity-50"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-5 pb-4">
            {messages.map((message, index) => (
              <div key={index} className={message.role === "user" ? "flex justify-end" : ""}>
                {message.role === "user" ? (
                  <div
                    className="max-w-[85%] rounded-[14px] rounded-br-[4px] px-3.5 py-2.5 text-[13.5px] leading-relaxed"
                    style={{ background: "var(--raised)" }}
                  >
                    {message.content}
                  </div>
                ) : (
                  <div className="max-w-[68ch]">
                    {(message.tools?.length ?? 0) > 0 && (
                      <div className="mb-2 flex flex-wrap gap-1.5">
                        {[...new Set(message.tools)].map((tool) => (
                          <span key={tool} className="chip">{TOOL_LABEL[tool] ?? tool}</span>
                        ))}
                      </div>
                    )}
                    {message.content ? (
                      <>
                        <Markdown source={message.content} />
                        {/* On every finished answer — never on the one still streaming. */}
                        {saveTargets && !(busy && index === messages.length - 1) && (
                          <div className="mt-2">
                            <SaveAnswer body={message.content} targets={saveTargets} />
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="flex items-center gap-2 text-[13px] text-muted">
                        <Loader2 size={14} className="animate-spin" />
                        {activeTool ?? "thinking"}…
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
            <div ref={endRef} />
          </div>
        )}
      </div>

      {about && (
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[11.5px] text-muted">About</span>
          <select
            value={aboutClient}
            onChange={(e) => {
              const next = e.target.value;
              setAboutClient(next);
              setAboutProject("");
              // Persist straight away once the thread exists; before that it
              // rides along on the message that creates it.
              if (threadId) void setThreadContext(threadId, next || null, null).then(() => router.refresh());
            }}
            className="input w-auto py-1 text-[11.5px]"
            aria-label="Which client this conversation is about"
          >
            <option value="">No client</option>
            {about.clients.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>

          {aboutClient && (
            <select
              value={aboutProject}
              onChange={(e) => {
                const next = e.target.value;
                setAboutProject(next);
                if (threadId) void setThreadContext(threadId, aboutClient || null, next || null).then(() => router.refresh());
              }}
              className="input w-auto py-1 text-[11.5px]"
              aria-label="Which project this conversation is about"
            >
              <option value="">Any project</option>
              {about.projects.filter((p) => p.clientId === aboutClient).map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          )}

          {aboutClient && (
            <span className="text-[11px] text-muted">
              They will read this client&rsquo;s material before answering.
            </span>
          )}
        </div>
      )}

      {error && (
        <p className="mb-2 rounded-[10px] px-3 py-2 text-[12.5px]" style={{ background: "color-mix(in oklch, var(--color-urgent) 12%, transparent)", color: "var(--color-urgent)" }}>
          {error}
        </p>
      )}

      {!aiReady && (
        <p className="mb-2 text-[12.5px] text-muted">
          Add an <code className="rounded bg-[var(--raised)] px-1">ANTHROPIC_API_KEY</code> to your environment to turn this on.
          Everything else in Marketing HQ works without it.
        </p>
      )}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          send(input);
        }}
        className="card flex items-end gap-2 p-2"
      >
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(event) => {
            setInput(event.target.value);
            const el = event.target;
            el.style.height = "auto";
            el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              send(input);
            }
          }}
          rows={1}
          disabled={!aiReady}
          placeholder={placeholder ?? "Ask anything, or tell it something worth remembering…"}
          className="max-h-[180px] flex-1 resize-none bg-transparent px-2 py-2 text-[14px] leading-relaxed outline-none placeholder:text-[var(--ink-muted)]"
        />
        {busy ? (
          <button type="button" onClick={() => abortRef.current?.abort()} className="btn btn-sm" title="Stop">
            <Square size={13} fill="currentColor" />
          </button>
        ) : (
          <button type="submit" disabled={!input.trim() || !aiReady} className="btn btn-primary btn-sm h-9 w-9 !p-0" aria-label="Send">
            <ArrowUp size={16} strokeWidth={2.5} />
          </button>
        )}
      </form>
    </div>
  );
}
