"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, CalendarPlus, Sparkles, X } from "lucide-react";
import { setTaskStatus, snoozeTask, triageAll } from "@/server/actions";
import { Card, Empty } from "./ui";

type Item = {
  id: string;
  title: string;
  clientName: string | null;
  clientColor: string | null;
  projectName: string | null;
  daysOverdue: number;
  fromBrain: boolean;
};

/**
 * Clearing the backlog, one gesture per task.
 *
 * A long overdue list is usually a list of optimistic dates rather than
 * abandoned work, so the three honest answers — did it, later, not doing —
 * are each one tap, and moving the whole pile is one more.
 */
export function Triage({ items }: { items: Item[] }) {
  const router = useRouter();
  const [done, setDone] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  const left = items.filter((i) => !done[i.id]);
  const brainCount = left.filter((i) => i.fromBrain).length;

  const act = (id: string, label: string, run: () => Promise<unknown>) => {
    setDone((d) => ({ ...d, [id]: label }));
    startTransition(async () => { await run(); router.refresh(); });
  };

  const all = (action: "later" | "drop") =>
    startTransition(async () => {
      await triageAll(left.map((i) => i.id), action);
      setDone(Object.fromEntries(left.map((i) => [i.id, action === "drop" ? "dropped" : "moved"])));
      router.refresh();
    });

  if (items.length === 0) {
    return <Empty title="Nothing overdue" hint="The list is honest right now. That is the whole goal." />;
  }

  return (
    <div className="flex flex-col gap-3">
      <Card tone="warn">
        <p className="text-[13px] leading-relaxed">
          {left.length} thing{left.length === 1 ? "" : "s"} {left.length === 1 ? "is" : "are"} past{" "}
          {left.length === 1 ? "its" : "their"} date.
          {brainCount > 0 && (
            <>
              {" "}
              {brainCount} of {left.length === brainCount ? "them" : `those ${left.length}`} the brain added for you —
              those are suggestions you never agreed to, so dropping them costs nothing.
            </>
          )}
        </p>
        <div className="mt-2.5 flex flex-wrap gap-2">
          <button onClick={() => all("later")} disabled={pending || left.length === 0} className="btn btn-sm btn-primary">
            <CalendarPlus size={13} />
            Move all to next week
          </button>
          <button onClick={() => all("drop")} disabled={pending || left.length === 0} className="btn btn-sm">
            <X size={13} />
            Drop all
          </button>
        </div>
      </Card>

      <div className="card overflow-hidden">
        {items.map((item, index) => {
          const settled = done[item.id];
          return (
            <div
              key={item.id}
              className={`flex flex-wrap items-center gap-2 px-3.5 py-2.5 ${index > 0 ? "border-t" : ""}`}
              style={settled ? { opacity: 0.45 } : undefined}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  {item.fromBrain && (
                    <Sparkles size={11} className="shrink-0" style={{ color: "var(--color-brand)" }} />
                  )}
                  <span className={`truncate text-[13px] ${settled ? "line-through" : "font-medium"}`}>{item.title}</span>
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11.5px] text-muted">
                  {item.clientName && (
                    <span className="inline-flex items-center gap-1">
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: item.clientColor ?? "var(--ink-muted)" }} />
                      {item.clientName}
                    </span>
                  )}
                  {item.projectName && <span>· {item.projectName}</span>}
                  <span style={{ color: "var(--color-urgent)" }}>
                    · {item.daysOverdue}d late
                  </span>
                </div>
              </div>

              {settled ? (
                <span className="text-[11.5px]" style={{ color: "var(--color-good)" }}>{settled}</span>
              ) : (
                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    onClick={() => act(item.id, "done", () => setTaskStatus(item.id, "done"))}
                    className="btn btn-sm"
                    aria-label={`Mark ${item.title} done`}
                  >
                    <Check size={13} />
                    Did it
                  </button>
                  <button
                    onClick={() => act(item.id, "moved", () => snoozeTask(item.id, 7))}
                    className="btn btn-sm"
                    aria-label={`Move ${item.title} a week`}
                  >
                    Later
                  </button>
                  <button
                    onClick={() => act(item.id, "dropped", () => setTaskStatus(item.id, "dropped"))}
                    className="btn btn-ghost btn-sm"
                    aria-label={`Drop ${item.title}`}
                  >
                    <X size={13} />
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
