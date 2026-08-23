"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, Clock, Info, X } from "lucide-react";
import type { Signal } from "@/lib/db/schema";
import { actOnSignal, dismissSignal, snoozeSignal } from "@/server/actions";
import { Chip, SEVERITY_TONE } from "./ui";

const SEVERITY_ICON = { urgent: AlertTriangle, important: Clock, fyi: Info } as const;

export function SignalCard({ signal, clientName }: { signal: Signal; clientName?: string | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [gone, setGone] = useState(false);

  if (gone) return null;

  const Icon = SEVERITY_ICON[signal.severity as keyof typeof SEVERITY_ICON] ?? Info;
  const tone = SEVERITY_TONE[signal.severity] ?? "info";
  const accent = `var(--color-${tone === "warn" ? "warn" : tone === "urgent" ? "urgent" : "info"})`;

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, optimisticHide = true) {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) {
        setError(result.error ?? "That didn't work.");
        return;
      }
      if (optimisticHide) setGone(true);
      router.refresh();
    });
  }

  return (
    <article
      className="card rise relative overflow-hidden p-4"
      style={{ borderLeft: `2px solid ${accent}` }}
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 shrink-0" style={{ color: accent }}>
          <Icon size={16} strokeWidth={2.1} />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[14px] font-semibold leading-snug tracking-[-0.01em]">{signal.title}</h3>
            {clientName && <Chip tone="neutral">{clientName}</Chip>}
          </div>

          {signal.body && <p className="mt-1.5 text-[13px] leading-relaxed text-soft">{signal.body}</p>}

          {error && <p className="mt-2 text-[12px]" style={{ color: "var(--color-urgent)" }}>{error}</p>}

          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {(signal.actions ?? []).map((action, index) =>
              action.kind === "open" && typeof action.payload?.href === "string" ? (
                <Link key={index} href={action.payload.href as string} className="btn btn-sm">
                  {action.label}
                </Link>
              ) : (
                <button
                  key={index}
                  disabled={pending}
                  onClick={() => run(() => actOnSignal(signal.id, index))}
                  className={index === 0 ? "btn btn-sm btn-primary" : "btn btn-sm"}
                >
                  {index === 0 && <Check size={13} />}
                  {action.label}
                </button>
              ),
            )}

            <div className="ml-auto flex items-center gap-1">
              <button
                disabled={pending}
                onClick={() => run(() => snoozeSignal(signal.id, 3))}
                className="btn btn-ghost btn-sm"
                title="Snooze for 3 days"
              >
                <Clock size={13} />
              </button>
              <button
                disabled={pending}
                onClick={() => run(() => dismissSignal(signal.id))}
                className="btn btn-ghost btn-sm"
                title="Dismiss — I don't need this"
              >
                <X size={13} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}
