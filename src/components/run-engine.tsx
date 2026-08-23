"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { clsx } from "clsx";
import { runEngineNow } from "@/server/actions";

/** Forces a proactive pass now instead of waiting for the next scheduled run. */
export function RunEngineButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState<string | null>(null);

  return (
    <div className="flex items-center gap-2">
      {note && <span className="text-[11.5px] text-muted">{note}</span>}
      <button
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const { result } = await runEngineNow();
            setNote(`${result.raised} new · ${result.resolved} cleared`);
            router.refresh();
          })
        }
        className="btn btn-sm"
        title="Re-run the proactive rules against current data"
      >
        <RefreshCw size={13} className={clsx(pending && "animate-spin")} />
        Re-scan
      </button>
    </div>
  );
}
