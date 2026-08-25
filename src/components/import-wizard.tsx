"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, FileText, Loader2, Quote, Sparkles, Trash2, Upload, X } from "lucide-react";
import { clsx } from "clsx";
import { commitImportedInsights } from "@/server/actions";
import { Card, CardTitle, Chip, Empty } from "./ui";

type Candidate = {
  title: string;
  body: string;
  kind: string;
  clientName: string;
  tags: string[];
  confidence: number;
  occurredAt: string;
  sourceQuote: string;
};

type Row = Candidate & { id: number; clientId: string; selected: boolean; expanded: boolean };

const KINDS = ["insight", "learning", "benchmark", "idea", "meeting_note", "decision", "reference"];

const ACCEPT = ".txt,.md,.markdown,.csv,.tsv,.json,.html,.rtf,.docx,.pdf";

/** An input would clip a long headline on a phone; this wraps and grows instead. */
function AutoTextarea({
  value,
  onChange,
  className,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  ariaLabel: string;
}) {
  const fit = (el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };

  return (
    <textarea
      ref={fit}
      value={value}
      rows={1}
      aria-label={ariaLabel}
      className={className}
      onChange={(event) => {
        fit(event.target);
        onChange(event.target.value);
      }}
    />
  );
}

export function ImportWizard({ clients }: { clients: { id: string; name: string }[] }) {
  const router = useRouter();
  const [stage, setStage] = useState<"source" | "working" | "review">("source");
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [hint, setHint] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [progress, setProgress] = useState<{ index: number; total: number; label: string } | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);
  const nextId = useRef(0);

  const byName = new Map(clients.map((c) => [c.name.toLowerCase(), c.id]));
  const selected = rows.filter((r) => r.selected);

  function addCandidates(candidates: Candidate[]) {
    setRows((prev) => [
      ...prev,
      ...candidates.map((candidate) => ({
        ...candidate,
        id: nextId.current++,
        clientId: byName.get(candidate.clientName.toLowerCase()) ?? "",
        selected: true,
        expanded: false,
      })),
    ]);
  }

  async function extract() {
    setError(null);
    setNotes([]);
    setRows([]);
    setStage("working");

    const body = new FormData();
    body.set("text", text);
    body.set("hint", hint);
    for (const file of files) body.append("files", file);

    try {
      const response = await fetch("/api/import/extract", { method: "POST", body });

      if (!response.ok || !response.body) {
        const detail = await response.json().catch(() => ({ error: "Import failed." }));
        setError(detail.error ?? "Import failed.");
        setStage("source");
        return;
      }

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
          const event = chunk.match(/^event: (.+)$/m)?.[1];
          const data = chunk.match(/^data: (.+)$/m)?.[1];
          if (!event || !data) continue;
          const payload = JSON.parse(data);

          if (event === "progress") setProgress(payload);
          else if (event === "entries") addCandidates(payload.entries);
          else if (event === "note") setNotes((prev) => [...prev, payload.message]);
          else if (event === "error") setError(payload.message);
        }
      }

      setProgress(null);
      setStage("review");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Import failed.");
      setStage("source");
    }
  }

  function patch(id: number, change: Partial<Row>) {
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, ...change } : row)));
  }

  function commit() {
    startTransition(async () => {
      const result = await commitImportedInsights(
        selected.map((row) => ({
          title: row.title,
          body: row.body,
          kind: row.kind,
          clientId: row.clientId || null,
          tags: row.tags,
          confidence: row.confidence,
          occurredAt: row.occurredAt || null,
        })),
      );

      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push("/brain?tab=library");
      router.refresh();
    });
  }

  /* ------------------------------------------------------------- source */

  if (stage === "source") {
    return (
      <div className="flex flex-col gap-4">
        {error && (
          <p className="rounded-[10px] px-3 py-2 text-[12.5px]" style={{ background: "color-mix(in oklch, var(--color-urgent) 12%, transparent)", color: "var(--color-urgent)" }}>
            {error}
          </p>
        )}

        <Card>
          <CardTitle>Paste your notes</CardTitle>
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={12}
            className="input font-[inherit] text-[13px] leading-relaxed"
            placeholder={"Anything goes — old meeting notes, a Notion page, a channel audit, the running doc you keep for a client.\n\nIt doesn't need tidying up first. That's the job."}
          />
        </Card>

        <Card>
          <CardTitle action={<span className="text-[11.5px] text-muted">.md .txt .docx .pdf .csv</span>}>
            Or add files
          </CardTitle>

          <input
            ref={fileInput}
            type="file"
            multiple
            accept={ACCEPT}
            className="hidden"
            onChange={(event) => {
              setFiles((prev) => [...prev, ...Array.from(event.target.files ?? [])]);
              event.target.value = "";
            }}
          />

          <button onClick={() => fileInput.current?.click()} className="btn w-full justify-center py-6">
            <Upload size={15} />
            Choose files
          </button>

          {files.length > 0 && (
            <ul className="mt-3 flex flex-col gap-1.5">
              {files.map((file, index) => (
                <li key={index} className="flex items-center gap-2 text-[12.5px]">
                  <FileText size={13} className="shrink-0 text-[var(--ink-muted)]" />
                  <span className="truncate">{file.name}</span>
                  <span className="shrink-0 text-muted">{(file.size / 1024).toFixed(0)} KB</span>
                  <button
                    onClick={() => setFiles((prev) => prev.filter((_, i) => i !== index))}
                    className="btn btn-ghost btn-sm ml-auto"
                    aria-label={`Remove ${file.name}`}
                  >
                    <X size={12} />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <p className="mt-3 text-[11.5px] leading-relaxed text-muted">
            A Notion export works — unzip it and select the markdown files. For a deck, export to PDF first and it will be
            read properly, layout and all.
          </p>
        </Card>

        <Card>
          <label className="label" htmlFor="hint">Is this all about one client?</label>
          <select id="hint" className="input" value={hint} onChange={(event) => setHint(event.target.value)}>
            <option value="">No — work it out from the content</option>
            {clients.map((client) => (
              <option key={client.id} value={client.name}>{client.name}</option>
            ))}
          </select>
          <p className="mt-1.5 text-[11.5px] text-muted">
            Only a default. Anything the source clearly attributes elsewhere still goes where it belongs.
          </p>
        </Card>

        <div className="flex items-center justify-between gap-3">
          <p className="text-[12px] text-muted">
            Nothing is saved until you have reviewed it.
          </p>
          <button onClick={extract} disabled={!text.trim() && files.length === 0} className="btn btn-primary">
            <Sparkles size={15} />
            Find the insights
          </button>
        </div>
      </div>
    );
  }

  /* ------------------------------------------------------------ working */

  if (stage === "working") {
    return (
      <Card>
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <Loader2 size={22} className="animate-spin" style={{ color: "var(--color-brand)" }} />
          <p className="text-[14px] font-semibold">Reading it properly</p>
          {progress && (
            <>
              <p className="text-[12.5px] text-muted">
                {progress.label} — {progress.index} of {progress.total}
              </p>
              <div className="h-1 w-[240px] overflow-hidden rounded-full" style={{ background: "var(--raised)" }}>
                <div
                  className="h-full rounded-full transition-[width] duration-300"
                  style={{ width: `${(progress.index / progress.total) * 100}%`, background: "var(--color-brand)" }}
                />
              </div>
            </>
          )}
          <p className="max-w-[44ch] text-[12px] leading-relaxed text-muted">
            Pulling out what will still matter in a year and leaving the status updates behind.
            {rows.length > 0 && ` ${rows.length} found so far.`}
          </p>
        </div>
      </Card>
    );
  }

  /* ------------------------------------------------------------- review */

  return (
    <div className="flex flex-col gap-3 pb-24">
      {error && (
        <p className="rounded-[10px] px-3 py-2 text-[12.5px]" style={{ background: "color-mix(in oklch, var(--color-urgent) 12%, transparent)", color: "var(--color-urgent)" }}>
          {error}
        </p>
      )}

      {notes.map((note, index) => (
        <p key={index} className="text-[12px] text-muted">{note}</p>
      ))}

      {rows.length === 0 ? (
        <Card>
          <Empty
            title="Nothing durable in there"
            hint="That usually means the source was status updates, logistics or action items rather than findings. Not a failure — better an empty result than a brain full of noise."
            action={<button onClick={() => setStage("source")} className="btn btn-sm">Try another source</button>}
          />
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[13px]">
              <strong>{rows.length}</strong> found · <strong>{selected.length}</strong> selected
            </p>
            <div className="ml-auto flex items-center gap-1.5">
              <button onClick={() => setRows((prev) => prev.map((r) => ({ ...r, selected: true })))} className="btn btn-sm">All</button>
              <button onClick={() => setRows((prev) => prev.map((r) => ({ ...r, selected: false })))} className="btn btn-sm">None</button>
              <select
                className="input w-auto py-1.5 text-[12px]"
                defaultValue=""
                onChange={(event) => {
                  const value = event.target.value;
                  setRows((prev) => prev.map((r) => (r.selected ? { ...r, clientId: value } : r)));
                  event.target.value = "";
                }}
                aria-label="Set client on selected"
              >
                <option value="">Set client on selected…</option>
                <option value="">No client</option>
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>{client.name}</option>
                ))}
              </select>
            </div>
          </div>

          {rows.map((row) => (
            <article
              key={row.id}
              className={clsx("card p-4 transition-opacity", !row.selected && "opacity-45")}
              style={row.selected ? { borderLeft: "2px solid var(--color-brand)" } : undefined}
            >
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={row.selected}
                  onChange={(event) => patch(row.id, { selected: event.target.checked })}
                  className="mt-1 h-4 w-4 shrink-0"
                  aria-label={`Include ${row.title}`}
                />

                <div className="min-w-0 flex-1">
                  <AutoTextarea
                    value={row.title}
                    onChange={(value) => patch(row.id, { title: value })}
                    className="w-full resize-none overflow-hidden border-0 bg-transparent p-0 text-[14px] font-semibold leading-snug tracking-[-0.01em] outline-none"
                    ariaLabel="Headline"
                  />

                  {row.sourceQuote && (
                    <p className="mt-1.5 flex gap-1.5 text-[11.5px] italic leading-relaxed text-muted">
                      <Quote size={11} className="mt-0.5 shrink-0" />
                      {row.sourceQuote}
                    </p>
                  )}

                  {row.expanded ? (
                    <textarea
                      value={row.body}
                      onChange={(event) => patch(row.id, { body: event.target.value })}
                      rows={7}
                      className="input mt-2 font-[inherit] text-[12.5px] leading-relaxed"
                      aria-label="Detail"
                    />
                  ) : (
                    <p className="mt-2 line-clamp-2 text-[12.5px] leading-relaxed text-soft">{row.body}</p>
                  )}

                  <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                    <select
                      value={row.kind}
                      onChange={(event) => patch(row.id, { kind: event.target.value })}
                      className="input w-auto py-1 text-[11.5px]"
                      aria-label="Type"
                    >
                      {KINDS.map((kind) => (
                        <option key={kind} value={kind}>{kind.replace("_", " ")}</option>
                      ))}
                    </select>

                    <select
                      value={row.clientId}
                      onChange={(event) => patch(row.id, { clientId: event.target.value })}
                      className="input w-auto py-1 text-[11.5px]"
                      aria-label="Client"
                    >
                      <option value="">No client</option>
                      {clients.map((client) => (
                        <option key={client.id} value={client.id}>{client.name}</option>
                      ))}
                    </select>

                    <select
                      value={row.confidence}
                      onChange={(event) => patch(row.id, { confidence: Number(event.target.value) })}
                      className="input w-auto py-1 text-[11.5px]"
                      aria-label="Confidence"
                    >
                      {[1, 2, 3, 4, 5].map((n) => (
                        <option key={n} value={n}>{n}/5 confidence</option>
                      ))}
                    </select>

                    <input
                      type="date"
                      value={row.occurredAt}
                      onChange={(event) => patch(row.id, { occurredAt: event.target.value })}
                      className="input w-auto py-1 text-[11.5px]"
                      aria-label="When this happened"
                    />

                    {row.tags.map((tag) => (
                      <Chip key={tag}>#{tag}</Chip>
                    ))}

                    <div className="ml-auto flex items-center gap-0.5">
                      <button onClick={() => patch(row.id, { expanded: !row.expanded })} className="btn btn-ghost btn-sm">
                        {row.expanded ? "Collapse" : "Edit"}
                      </button>
                      <button
                        onClick={() => setRows((prev) => prev.filter((r) => r.id !== row.id))}
                        className="btn btn-ghost btn-sm"
                        aria-label="Discard"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </article>
          ))}

          <div
            className="fixed inset-x-0 bottom-0 z-40 border-t px-4 py-3 md:pl-[248px]"
            style={{
              background: "color-mix(in oklch, var(--surface) 94%, transparent)",
              backdropFilter: "blur(14px)",
              paddingBottom: "calc(env(safe-area-inset-bottom) + 0.75rem)",
            }}
          >
            <div className="mx-auto flex max-w-[1180px] items-center gap-3">
              <button onClick={() => setStage("source")} className="btn">Back</button>
              <p className="hidden text-[12px] text-muted sm:block">
                Drop anything that isn&apos;t worth keeping. Being ruthless here is what keeps search useful later.
              </p>
              <button onClick={commit} disabled={pending || selected.length === 0} className="btn btn-primary ml-auto">
                {pending ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                Add {selected.length} to the brain
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
