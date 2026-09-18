"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, RotateCcw } from "lucide-react";
import { retryTeam, reviseTeamBrief } from "@/server/actions";
import { Card, CardTitle } from "./ui";

/**
 * The brief, and the two ways out of a stuck one.
 *
 * Before this, a brief was write-once: a specialist that failed stayed
 * failed, because the queue only ever looks at "pending" — and the only way
 * to change a word of the brief was to delete the whole assignment and type
 * it again from memory.
 */
export function AssignmentBrief({
  assignmentId,
  brief,
  failedCount,
  outstanding,
}: {
  assignmentId: string;
  brief: string;
  failedCount: number;
  outstanding: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(brief);
  const [message, setMessage] = useState<string | null>(null);

  function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setMessage(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setMessage(result.error ?? "That did not work.");
        return;
      }
      setEditing(false);
      router.refresh();
    });
  }

  return (
    <Card tone="info">
      <CardTitle
        action={
          <span className="flex flex-wrap items-center gap-1.5">
            {failedCount > 0 && (
              <button
                onClick={() => run(() => retryTeam(assignmentId, false))}
                disabled={pending}
                className="btn btn-primary btn-sm"
              >
                <RotateCcw size={13} />
                Retry {failedCount} that failed
              </button>
            )}
            {outstanding === 0 && (
              <button
                onClick={() => run(() => retryTeam(assignmentId, true))}
                disabled={pending}
                className="btn btn-ghost btn-sm"
                title="Throw away every answer and ask the whole team again"
              >
                Run it all again
              </button>
            )}
            <button onClick={() => setEditing((v) => !v)} disabled={pending} className="btn btn-ghost btn-sm">
              <Pencil size={13} />
              {editing ? "Cancel" : "Edit"}
            </button>
          </span>
        }
      >
        The brief
      </CardTitle>

      {editing ? (
        <>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={14}
            className="input w-full resize-y text-[13px] leading-relaxed"
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              onClick={() => run(() => reviseTeamBrief(assignmentId, draft))}
              disabled={pending || draft.trim() === brief.trim()}
              className="btn btn-primary btn-sm"
            >
              {pending ? "Saving…" : "Save and run again"}
            </button>
            <span className="text-[11.5px] text-muted">
              Everyone starts over on the new brief. Their current answers are replaced.
            </span>
          </div>
        </>
      ) : (
        <p className="whitespace-pre-wrap text-[13px] leading-relaxed">{brief}</p>
      )}

      {message && (
        <p className="mt-2 text-[12px]" style={{ color: "var(--color-urgent)" }}>
          {message}
        </p>
      )}
    </Card>
  );
}
