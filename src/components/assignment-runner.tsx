"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Play, RefreshCw } from "lucide-react";

/**
 * A whole team on one brief takes longer than any single request allows, so
 * the work runs one specialist at a time and this asks for the next until
 * nothing is outstanding.
 *
 * The browser is what drives that sequence, so closing the tab stops it after
 * the specialist currently running finishes. Coming back and pressing the
 * button picks it up exactly where it stopped — nothing is lost, since each
 * one is recorded as it lands.
 */
export function AssignmentRunner({
  assignmentId,
  outstanding,
  nextUp,
}: {
  assignmentId: string;
  outstanding: number;
  nextUp: string | null;
}) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const started = useRef(false);
  const stop = useRef(false);

  useEffect(() => {
    if (!running) return;
    setElapsed(0);
    const timer = setInterval(() => setElapsed((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [running]);

  const pass = useCallback(async () => {
    setRunning(true);
    setError(null);
    stop.current = false;

    try {
      for (;;) {
        const response = await fetch(`/api/assignments/${assignmentId}/run`, { method: "POST" });

        if (!response.ok) {
          const body = await response.json().catch(() => null);
          /*
           * A gateway timeout means the specialist outlived the request rather
           * than failing. The work is marked for retry server-side, so say so
           * plainly instead of showing a raw error.
           */
          setError(
            response.status === 504
              ? "That specialist ran over the time limit. Their work is queued to retry — press Carry on."
              : (body?.error ?? `The run failed (${response.status}).`),
          );
          break;
        }

        const result = await response.json();
        router.refresh();

        if (result.done || stop.current) break;

        // Nothing moved and nothing was available: something is mid-flight, or
        // was orphaned and is not yet old enough to reclaim. Say when rather
        // than looping on it.
        if (result.produced === 0 && result.failed === 0) {
          if (typeof result.retryAfterMs === "number") {
            const mins = Math.ceil(result.retryAfterMs / 60000);
            setError(
              result.retryAfterMs > 0
                ? `A specialist is still marked as working from an earlier run. If it does not finish, it can be retried in about ${mins} minute${mins === 1 ? "" : "s"}.`
                : "A specialist is still marked as working. Press Carry on to retry it.",
            );
          }
          break;
        }
      }
    } catch {
      setError("Lost the connection while they were working. Their finished work is saved — press Carry on to continue.");
    } finally {
      setRunning(false);
      router.refresh();
    }
  }, [assignmentId, router]);

  // Start on arrival, once — this page is reached straight after briefing them.
  useEffect(() => {
    if (started.current || outstanding === 0) return;
    started.current = true;
    void pass();
    return () => {
      stop.current = true;
    };
  }, [outstanding, pass]);

  if (outstanding === 0 && !running) return null;

  const minutes = Math.floor(elapsed / 60);
  const seconds = String(elapsed % 60).padStart(2, "0");

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        {running ? (
          <span className="inline-flex items-center gap-2 text-[12.5px] text-muted">
            <Loader2 size={13} className="animate-spin" />
            {nextUp ? `${nextUp} is working` : "Working"} — {minutes}:{seconds} elapsed, {outstanding} still to report.
          </span>
        ) : (
          <button onClick={pass} className="btn btn-sm btn-primary">
            {error ? <RefreshCw size={13} /> : <Play size={13} />}
            {error ? "Carry on" : `Carry on — ${outstanding} left`}
          </button>
        )}
      </div>

      {running && elapsed > 90 && (
        <p className="text-[11.5px] leading-relaxed text-muted">
          A specialist reading the client's material and searching the web genuinely takes a few minutes. Keep this tab
          open — it is driving the queue.
        </p>
      )}

      {error && (
        <p className="text-[12px] leading-relaxed" style={{ color: "var(--color-urgent)" }}>{error}</p>
      )}
    </div>
  );
}
