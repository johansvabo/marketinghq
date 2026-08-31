"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUp, Loader2, Sparkles, Square } from "lucide-react";
import { Markdown } from "./markdown";

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
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMessage[]>(initial);
  const [input, setInput] = useState("");
  const [threadId, setThreadId] = useState(initialThreadId);
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
        body: JSON.stringify({ threadId, message: text, agentKey }),
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
    <div className="flex h-[calc(100dvh-190px)] flex-col md:h-[calc(100dvh-150px)]">
      <div className="min-h-0 flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-5 px-4 text-center">
            <div className="flex flex-col items-center gap-2">
              <Sparkles size={22} style={{ color: "var(--color-brand)" }} />
              <h2 className="text-[17px] font-semibold tracking-tight">{emptyTitle ?? "Ask your own record"}</h2>
              <p className="max-w-[46ch] text-[13px] leading-relaxed text-muted">
                {emptyHint ??
                  "This reads your real tasks, projects, captured insights and connected marketing data — not the open web. The more you put in, the better it gets."}
              </p>
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
                      <Markdown source={message.content} />
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
