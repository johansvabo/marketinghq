"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Loader2, Pencil, Sparkles } from "lucide-react";
import { generateReportDraft, markReportSent, saveReportDraft } from "@/server/actions";
import { Card, CardTitle } from "./ui";
import { Markdown } from "./markdown";

export function ReportEditor({
  runId,
  initialDraft,
  status,
  aiReady,
}: {
  runId: string;
  initialDraft: string;
  status: string;
  aiReady: boolean;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState(initialDraft);
  const [editing, setEditing] = useState(!initialDraft);
  const [pending, startTransition] = useTransition();
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function generate() {
    setError(null);
    setGenerating(true);
    startTransition(async () => {
      const result = await generateReportDraft(runId);
      setGenerating(false);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
      // The server has the fresh draft; reload it into the editor.
      const response = await fetch(`/api/reports/${runId}/draft`);
      if (response.ok) {
        const body = await response.json();
        setDraft(body.draft ?? "");
        setEditing(false);
      }
    });
  }

  function save() {
    startTransition(async () => {
      await saveReportDraft(runId, draft);
      setEditing(false);
      router.refresh();
    });
  }

  async function copy() {
    await navigator.clipboard.writeText(draft);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  return (
    <Card>
      <CardTitle
        action={
          <div className="flex items-center gap-1.5">
            <button onClick={generate} disabled={generating || pending || !aiReady} className="btn btn-sm" title={aiReady ? "Write a draft from the real data" : "Needs ANTHROPIC_API_KEY"}>
              {generating ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
              {draft ? "Redraft" : "Draft it"}
            </button>
            {draft && !editing && (
              <>
                <button onClick={() => setEditing(true)} className="btn btn-sm">
                  <Pencil size={13} />
                  Edit
                </button>
                <button onClick={copy} className="btn btn-sm">
                  {copied ? <Check size={13} /> : <Copy size={13} />}
                  {copied ? "Copied" : "Copy"}
                </button>
              </>
            )}
          </div>
        }
      >
        Draft
      </CardTitle>

      {error && (
        <p className="mb-3 rounded-[10px] px-3 py-2 text-[12.5px]" style={{ background: "color-mix(in oklch, var(--color-urgent) 12%, transparent)", color: "var(--color-urgent)" }}>
          {error}
        </p>
      )}

      {generating && (
        <p className="mb-3 text-[12.5px] text-muted">
          Reading the period&apos;s numbers, completed work and captured learnings, then writing it up. Takes a moment.
        </p>
      )}

      {editing ? (
        <>
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={26}
            className="input font-mono text-[12.5px] leading-relaxed"
            placeholder={
              aiReady
                ? "Write it yourself, or hit “Draft it” to have the numbers, the work and the learnings pulled into a first pass."
                : "Write the report here. Markdown works — headings, bold, tables, lists."
            }
          />
          <div className="mt-3 flex justify-end gap-2">
            {initialDraft && (
              <button onClick={() => { setDraft(initialDraft); setEditing(false); }} className="btn">Cancel</button>
            )}
            <button onClick={save} disabled={pending} className="btn btn-primary">Save draft</button>
          </div>
        </>
      ) : (
        <>
          <Markdown source={draft} />
          {status !== "sent" && (
            <div className="mt-5 flex justify-end border-t pt-4">
              <button
                onClick={() => startTransition(async () => { await markReportSent(runId); router.refresh(); })}
                disabled={pending}
                className="btn btn-primary"
              >
                <Check size={14} />
                Mark as sent
              </button>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
