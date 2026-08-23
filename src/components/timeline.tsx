"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Flag, Plus } from "lucide-react";
import { createMilestone, toggleMilestone } from "@/server/actions";
import { Empty } from "./ui";

type Milestone = { id: string; name: string; dueDate: Date; completedAt: Date | null };

/**
 * A horizontal timeline when there is a date range to draw against, and a plain
 * list when there isn't. Dates are the point — a milestone with no date is just
 * a task.
 */
export function Timeline({
  projectId,
  milestones,
  startDate,
  dueDate,
}: {
  projectId: string;
  milestones: Milestone[];
  startDate: Date | null;
  dueDate: Date | null;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [pending, startTransition] = useTransition();

  const start = startDate ?? milestones[0]?.dueDate ?? null;
  const end = dueDate ?? milestones[milestones.length - 1]?.dueDate ?? null;
  const span = start && end ? Math.max(end.getTime() - start.getTime(), 1) : null;
  const todayPct = span && start ? ((Date.now() - start.getTime()) / span) * 100 : null;

  function add(formData: FormData) {
    startTransition(async () => {
      await createMilestone({
        projectId,
        name: String(formData.get("name") ?? ""),
        dueDate: String(formData.get("dueDate") ?? ""),
      });
      setAdding(false);
      router.refresh();
    });
  }

  return (
    <div>
      {span && start && milestones.length > 0 && (
        <div className="relative mb-5 mt-2 h-12">
          <div className="absolute inset-x-0 top-3 h-0.5 rounded-full" style={{ background: "var(--raised)" }} />
          {todayPct !== null && todayPct >= 0 && todayPct <= 100 && (
            <div className="absolute top-0 h-9 w-px" style={{ left: `${todayPct}%`, background: "var(--color-brand)" }}>
              <span className="absolute -top-0.5 left-1 text-[9px] font-bold uppercase tracking-wider" style={{ color: "var(--color-brand)" }}>
                now
              </span>
            </div>
          )}
          {milestones.map((milestone) => {
            const pct = Math.max(0, Math.min(100, ((milestone.dueDate.getTime() - start.getTime()) / span) * 100));
            const done = Boolean(milestone.completedAt);
            const late = !done && milestone.dueDate < new Date();
            return (
              <div key={milestone.id} className="absolute top-2" style={{ left: `${pct}%`, transform: "translateX(-50%)" }}>
                <span
                  className="block h-2.5 w-2.5 rounded-full ring-2"
                  style={{
                    background: done ? "var(--color-good)" : late ? "var(--color-urgent)" : "var(--ink-muted)",
                    // @ts-expect-error CSS custom property on ring colour
                    "--tw-ring-color": "var(--surface)",
                  }}
                  title={milestone.name}
                />
              </div>
            );
          })}
        </div>
      )}

      {milestones.length === 0 && !adding ? (
        <Empty title="No milestones" hint="Milestones are the dates other people are counting on. Add the ones you would be embarrassed to miss." />
      ) : (
        <ul className="flex flex-col gap-1">
          {milestones.map((milestone) => {
            const done = Boolean(milestone.completedAt);
            const late = !done && milestone.dueDate < new Date();
            return (
              <li key={milestone.id} className="flex items-center gap-2.5 rounded-[9px] px-1.5 py-1.5 hover:bg-[var(--raised)]">
                <button
                  onClick={() => startTransition(async () => { await toggleMilestone(milestone.id); router.refresh(); })}
                  className="shrink-0"
                  style={{ color: done ? "var(--color-good)" : late ? "var(--color-urgent)" : "var(--ink-muted)" }}
                  aria-label={done ? "Reopen milestone" : "Mark milestone reached"}
                >
                  {done ? <Check size={15} strokeWidth={2.5} /> : <Flag size={14} />}
                </button>
                <span className={`flex-1 text-[13px] ${done ? "line-through opacity-50" : ""}`}>{milestone.name}</span>
                <span className="text-[11.5px] text-muted" style={late ? { color: "var(--color-urgent)" } : undefined}>
                  {milestone.dueDate.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {adding ? (
        <form action={add} className="mt-3 flex flex-wrap gap-2">
          <input name="name" className="input flex-1 min-w-[140px]" placeholder="Milestone" required autoFocus />
          <input name="dueDate" type="date" className="input w-[150px]" required />
          <button type="submit" disabled={pending} className="btn btn-primary btn-sm">Add</button>
          <button type="button" onClick={() => setAdding(false)} className="btn btn-ghost btn-sm">Cancel</button>
        </form>
      ) : (
        <button onClick={() => setAdding(true)} className="btn btn-ghost btn-sm mt-2 -ml-2">
          <Plus size={13} />
          Add milestone
        </button>
      )}
    </div>
  );
}
