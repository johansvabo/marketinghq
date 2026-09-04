"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Play, RefreshCw } from "lucide-react";
import { runAssignment } from "@/server/actions";

/**
 * A whole team on one brief takes longer than a single request allows, so the
 * work runs in passes: each call does what it can and reports what is left,
 * and this keeps going until nothing is outstanding. Refreshing between passes
 * is what makes the page fill in as each specialist reports.
 */
export function AssignmentRunner({ assignmentId, outstanding }: { assignmentId: string; outstanding: number }) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  const pass = useCallback(async () => {
    setRunning(true);
    setError(null);
    try {
      let done = false;
      while (!done) {
        const result = await runAssignment(assignmentId);
        if (!result.ok) {
          setError(result.error);
          break;
        }
        done = result.done;
        router.refresh();
        // Nothing moved and nothing is left to move: stop rather than spin.
        if (!done && result.produced === 0 && result.failed === 0) break;
      }
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
  }, [outstanding, pass]);

  if (outstanding === 0 && !running) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {running ? (
        <span className="inline-flex items-center gap-2 text-[12.5px] text-muted">
          <Loader2 size={13} className="animate-spin" />
          Working — {outstanding} still to report. You can leave this page; it keeps going.
        </span>
      ) : (
        <button onClick={pass} className="btn btn-sm btn-primary">
          {error ? <RefreshCw size={13} /> : <Play size={13} />}
          {error ? "Pick it back up" : `Carry on — ${outstanding} left`}
        </button>
      )}
      {error && (
        <span className="text-[12px]" style={{ color: "var(--color-urgent)" }}>{error}</span>
      )}
    </div>
  );
}
