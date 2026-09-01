"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pin, Trash2 } from "lucide-react";
import type { Insight } from "@/lib/db/schema";
import { deleteInsight, togglePinInsight } from "@/server/actions";
import { Chip, ClientDot } from "./ui";

const KIND_TONE = {
  insight: "brand",
  learning: "good",
  benchmark: "info",
  idea: "warn",
  meeting_note: "neutral",
  decision: "urgent",
  reference: "neutral",
} as const;

export function InsightRow({
  insight,
  clientName,
  clientColor,
}: {
  insight: Insight;
  clientName?: string | null;
  clientColor?: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [expanded, setExpanded] = useState(false);
  const [gone, setGone] = useState(false);

  if (gone) return null;

  const long = insight.body.length > 280;

  return (
    <article className="card group p-4" style={{ opacity: pending ? 0.6 : 1 }}>
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <Chip tone={KIND_TONE[insight.kind as keyof typeof KIND_TONE] ?? "neutral"} solid>
          {insight.kind.replace("_", " ")}
        </Chip>
        {clientName && (
          <span className="inline-flex items-center gap-1.5 text-[11.5px] text-muted">
            <ClientDot color={clientColor} />
            {clientName}
          </span>
        )}
        <span className="text-[11.5px] text-muted">{insight.occurredAt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>
        <span className="text-[11.5px] text-muted" title="How well evidenced this is">
          {"●".repeat(insight.confidence)}
          <span className="opacity-30">{"●".repeat(5 - insight.confidence)}</span>
        </span>

        <div className="ml-auto flex items-center gap-0.5 row-actions">
          <button
            onClick={() => startTransition(async () => { await togglePinInsight(insight.id); router.refresh(); })}
            className="btn btn-ghost btn-sm"
            title={insight.pinned ? "Unpin" : "Pin to the top"}
            style={insight.pinned ? { color: "var(--color-brand)" } : undefined}
          >
            <Pin size={13} fill={insight.pinned ? "currentColor" : "none"} />
          </button>
          <button
            onClick={() => {
              if (!confirm("Delete this entry? The brain forgets it permanently.")) return;
              setGone(true);
              startTransition(async () => { await deleteInsight(insight.id); router.refresh(); });
            }}
            className="btn btn-ghost btn-sm"
            title="Delete"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      <h3 className="text-[14px] font-semibold leading-snug tracking-[-0.01em]">{insight.title}</h3>

      <p className={`mt-1.5 whitespace-pre-wrap text-[13px] leading-relaxed text-soft ${!expanded && long ? "line-clamp-3" : ""}`}>
        {insight.body}
      </p>

      {long && (
        <button onClick={() => setExpanded(!expanded)} className="btn btn-ghost btn-sm mt-1 -ml-2">
          {expanded ? "Less" : "More"}
        </button>
      )}

      {(insight.tags?.length ?? 0) > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {insight.tags!.map((tag) => (
            <span key={tag} className="chip">#{tag}</span>
          ))}
        </div>
      )}
    </article>
  );
}
