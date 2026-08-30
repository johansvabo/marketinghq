"use client";

import Link from "next/link";
import { useEffect } from "react";
import { AlertTriangle, RefreshCw, Stethoscope } from "lucide-react";

/**
 * Replaces the host's blank "A server error occurred" page. Almost every runtime
 * failure here is the database being unreachable, so the fastest useful thing is
 * to name that and point at Settings, which is built to render without one.
 */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[marketinghq]", error);
  }, [error]);

  return (
    <div className="flex min-h-[70dvh] items-center justify-center p-4">
      <div className="card w-full max-w-[520px] p-6">
        <div className="flex items-center gap-2.5">
          <span style={{ color: "var(--color-urgent)" }}>
            <AlertTriangle size={19} strokeWidth={2.2} />
          </span>
          <h1 className="text-[16px] font-semibold tracking-tight">This page couldn&apos;t load</h1>
        </div>

        <p className="mt-3 text-[13.5px] leading-relaxed text-soft">
          Nine times in ten this is the database being unreachable — a wrong or missing Turso setting — and no data has
          been lost. <strong>Settings</strong> is built to work even when this happens, and will tell you exactly what to
          fix.
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/settings" className="btn btn-primary">
            <Stethoscope size={15} />
            Check Settings
          </Link>
          <button onClick={reset} className="btn">
            <RefreshCw size={14} />
            Try again
          </button>
        </div>

        <details className="mt-5 border-t pt-3">
          <summary className="cursor-pointer text-[11.5px] font-semibold uppercase tracking-[0.06em] text-muted">
            Technical detail
          </summary>
          <p className="mt-2 break-words font-mono text-[11.5px] leading-relaxed text-muted">
            {error.message || "No message"}
            {error.digest && (
              <>
                <br />
                digest {error.digest}
              </>
            )}
          </p>
          <p className="mt-2 text-[11.5px] leading-relaxed text-muted">
            Send this to Claude if Settings doesn&apos;t make it obvious.
          </p>
        </details>
      </div>
    </div>
  );
}
