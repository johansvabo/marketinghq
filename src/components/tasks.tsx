"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Circle, CircleCheck, CircleDot, PauseCircle } from "lucide-react";
import { clsx } from "clsx";
import type { Task } from "@/lib/db/schema";
import { relativeDay, startOfDay } from "@/lib/dates";
import { setTaskStatus, snoozeTask } from "@/server/actions";
import { ClientDot } from "./ui";

const PRIORITY_COLOR = ["", "var(--color-urgent)", "var(--color-warn)", "var(--ink-muted)", "var(--ink-muted)"];

const STATUS_ICON = {
  todo: Circle,
  doing: CircleDot,
  waiting: PauseCircle,
  done: CircleCheck,
  dropped: Circle,
} as const;

export type TaskRowData = {
  task: Task;
  clientName?: string | null;
  clientColor?: string | null;
  projectName?: string | null;
};

export function TaskRow({
  data,
  showMeta = true,
  showDue = true,
}: {
  data: TaskRowData;
  showMeta?: boolean;
  showDue?: boolean;
}) {
  const { task, clientName, clientColor, projectName } = data;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(task.status === "done");

  const Icon = STATUS_ICON[task.status as keyof typeof STATUS_ICON] ?? Circle;
  const dueLabel = showDue && task.dueDate ? `due ${relativeDay(task.dueDate)}` : undefined;
  const overdue = Boolean(task.dueDate && task.dueDate < startOfDay(new Date()) && task.status !== "done");

  function toggle() {
    const next = done ? "todo" : "done";
    setDone(!done);
    startTransition(async () => {
      await setTaskStatus(task.id, next);
      router.refresh();
    });
  }

  function cycle() {
    const order = ["todo", "doing", "waiting"];
    const next = order[(order.indexOf(task.status) + 1) % order.length];
    startTransition(async () => {
      await setTaskStatus(task.id, next);
      router.refresh();
    });
  }

  return (
    <div
      className={clsx(
        "group flex items-start gap-2.5 rounded-[10px] px-2 py-2 transition-colors hover:bg-[var(--raised)]",
        pending && "opacity-60",
      )}
    >
      <button
        onClick={toggle}
        aria-label={done ? "Mark as not done" : "Mark done"}
        className="mt-0.5 shrink-0 transition-transform active:scale-90"
        style={{ color: done ? "var(--color-good)" : PRIORITY_COLOR[task.priority] }}
      >
        {done ? <CircleCheck size={17} strokeWidth={2.2} /> : <Icon size={17} strokeWidth={1.9} />}
      </button>

      <div className="min-w-0 flex-1">
        <p className={clsx("text-[13.5px] leading-snug", done && "line-through opacity-50")}>{task.title}</p>

        {showMeta && (clientName || projectName || dueLabel || task.waitingOn) && (
          <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11.5px] text-muted">
            {clientName && (
              <span className="inline-flex items-center gap-1.5">
                <ClientDot color={clientColor} />
                {clientName}
              </span>
            )}
            {projectName && <span className="truncate">{projectName}</span>}
            {task.status === "waiting" && task.waitingOn && <span>waiting on {task.waitingOn}</span>}
            {dueLabel && (
              <span style={overdue ? { color: "var(--color-urgent)", fontWeight: 600 } : undefined}>{dueLabel}</span>
            )}
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-0.5 row-actions">
        <button onClick={cycle} className="btn btn-ghost btn-sm" title="Cycle status: to do → doing → waiting">
          {task.status === "todo" ? "start" : task.status === "doing" ? "waiting" : "to do"}
        </button>
        <button
          onClick={() => startTransition(async () => { await snoozeTask(task.id, 1); router.refresh(); })}
          className="btn btn-ghost btn-sm"
          title="Push to tomorrow"
        >
          +1d
        </button>
      </div>
    </div>
  );
}

export function TaskList({
  items,
  emptyText,
  showMeta = true,
  showDue = true,
}: {
  items: TaskRowData[];
  emptyText: string;
  showMeta?: boolean;
  showDue?: boolean;
}) {
  if (items.length === 0) {
    return <p className="px-2 py-6 text-center text-[12.5px] text-muted">{emptyText}</p>;
  }

  return (
    <div className="-mx-2">
      {items.map((item) => (
        <TaskRow key={item.task.id} data={item} showMeta={showMeta} showDue={showDue} />
      ))}
    </div>
  );
}
