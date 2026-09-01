"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Plus, Trash2 } from "lucide-react";
import { clsx } from "clsx";
import type { TimeEntry } from "@/lib/db/schema";
import { formatHours, formatMoney, type MonthSummary } from "@/lib/billing-format";
import { deleteTimeEntry, logTime, updateTimeEntry } from "@/server/actions";
import { Card, CardTitle, Empty } from "./ui";

const today = () => new Date().toISOString().slice(0, 10);

/** Common increments, so logging a day takes one tap rather than typing. */
const QUICK = [1, 2, 3, 4, 6, 8];

export function TimeTracker({
  clientId,
  entries,
  summary,
  projects,
  month,
}: {
  clientId: string;
  entries: TimeEntry[];
  summary: MonthSummary;
  projects: { id: string; name: string }[];
  month: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [date, setDate] = useState(today());
  const [hours, setHours] = useState("");
  const [note, setNote] = useState("");
  const [projectId, setProjectId] = useState("");

  function add(explicitHours?: number) {
    const value = explicitHours ?? Number(hours.replace(",", "."));
    setError(null);

    startTransition(async () => {
      const result = await logTime({ clientId, date, hours: value, note, projectId: projectId || null });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setHours("");
      setNote("");
      router.refresh();
    });
  }

  const monthLabel = new Date(`${month}-01T12:00:00`).toLocaleDateString("en-GB", { month: "long", year: "numeric" });

  return (
    <Card>
      <CardTitle action={<span className="text-[11.5px] text-muted">{monthLabel}</span>}>Time</CardTitle>

      <div className="grid grid-cols-2 gap-3 border-b pb-3">
        <div>
          <div className="section-title">Hours</div>
          <div className="mt-1 text-[22px] font-bold leading-none tracking-[-0.02em]">{formatHours(summary.hours)}</div>
          {summary.billableHours !== summary.hours && (
            <div className="mt-1 text-[11px] text-muted">{formatHours(summary.billableHours)} billable</div>
          )}
        </div>
        <div>
          <div className="section-title">Value</div>
          <div
            className="mt-1 text-[22px] font-bold leading-none tracking-[-0.02em]"
            style={{ color: summary.basis === "none" ? "var(--ink-muted)" : "var(--ink)" }}
          >
            {summary.basis === "none" ? "—" : formatMoney(summary.value, summary.currency)}
          </div>
          <div className="mt-1 text-[11px] text-muted">
            {summary.basis === "hourly"
              ? "from hours logged"
              : summary.basis === "retainer"
                ? "retainer"
                : "set a rate or retainer"}
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="input w-auto py-1.5 text-[12.5px]"
          aria-label="Date"
        />
        {QUICK.map((h) => (
          <button key={h} onClick={() => add(h)} disabled={pending} className="btn btn-sm" title={`Log ${h} hours`}>
            {h}t
          </button>
        ))}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <input
          value={hours}
          onChange={(e) => setHours(e.target.value)}
          placeholder="1,5"
          inputMode="decimal"
          className="input w-[70px] py-1.5 text-[12.5px]"
          aria-label="Hours"
        />
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="What on?"
          className="input flex-1 min-w-[120px] py-1.5 text-[12.5px]"
          aria-label="Note"
        />
        {projects.length > 0 && (
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="input w-auto py-1.5 text-[12.5px]"
            aria-label="Project"
          >
            <option value="">No project</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        )}
        <button onClick={() => add()} disabled={pending || !hours.trim()} className="btn btn-sm btn-primary">
          <Plus size={13} />
          Log
        </button>
      </div>

      {error && <p className="mt-2 text-[12px]" style={{ color: "var(--color-urgent)" }}>{error}</p>}

      {entries.length === 0 ? (
        <div className="mt-2">
          <Empty title="No hours this month" hint="Log as you go, or catch up at the end of the week." />
        </div>
      ) : (
        <ul className="mt-3 flex flex-col gap-0.5 border-t pt-2">
          {entries.map((entry) => (
            <li
              key={entry.id}
              className={clsx("group flex items-center gap-2 rounded-[8px] px-1.5 py-1.5 hover:bg-[var(--raised)]", !entry.billable && "opacity-60")}
            >
              <span className="w-[46px] shrink-0 font-mono text-[11.5px] text-muted">
                {entry.date.slice(8)}.{entry.date.slice(5, 7)}
              </span>
              <span className="w-[42px] shrink-0 text-[12.5px] font-semibold tabular-nums">{formatHours(entry.hours)}</span>
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-soft">{entry.note ?? "—"}</span>

              <div className="flex shrink-0 items-center gap-0.5 row-actions">
                <button
                  onClick={() => startTransition(async () => { await updateTimeEntry(entry.id, { billable: !entry.billable }); router.refresh(); })}
                  className="btn btn-ghost btn-sm"
                  title={entry.billable ? "Mark as not billable" : "Mark as billable"}
                >
                  {entry.billable ? <Check size={12} /> : "kr"}
                </button>
                <button
                  onClick={() => startTransition(async () => { await deleteTimeEntry(entry.id); router.refresh(); })}
                  className="btn btn-ghost btn-sm"
                  title="Delete"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
