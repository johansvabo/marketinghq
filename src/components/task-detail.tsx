"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Trash2 } from "lucide-react";
import type { Task } from "@/lib/db/schema";
import { deleteTask, logTime, setTaskStatus, updateTask } from "@/server/actions";
import { Card, CardTitle } from "./ui";

const STATUSES = [
  { id: "todo", label: "To do" },
  { id: "doing", label: "Doing" },
  { id: "waiting", label: "Waiting" },
  { id: "done", label: "Done" },
] as const;

const PRIORITIES = [
  { value: 1, label: "P1" },
  { value: 2, label: "P2" },
  { value: 3, label: "P3" },
  { value: 4, label: "P4" },
] as const;

function isoDate(date: Date | null): string {
  if (!date) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function TaskDetail({ task, clientId }: { task: Task; clientId: string | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [status, setStatus] = useState(task.status);
  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes ?? "");
  const [due, setDue] = useState(isoDate(task.dueDate));
  const [priority, setPriority] = useState(task.priority);
  const [waitingOn, setWaitingOn] = useState(task.waitingOn ?? "");
  const [saved, setSaved] = useState<string | null>(null);

  // What is on screen but not yet in the database. Without this the Save
  // button looks decorative, and you never know whether a note survived.
  const dirty =
    title !== task.title ||
    notes !== (task.notes ?? "") ||
    due !== isoDate(task.dueDate) ||
    priority !== task.priority ||
    waitingOn !== (task.waitingOn ?? "");

  function save() {
    startTransition(async () => {
      await updateTask(task.id, {
        title,
        notes,
        dueDate: due || null,
        priority,
        waitingOn: waitingOn.trim() || null,
      });
      setSaved("Saved");
      router.refresh();
      setTimeout(() => setSaved(null), 2000);
    });
  }

  function move(next: string) {
    setStatus(next);
    startTransition(async () => {
      await setTaskStatus(task.id, next);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <Card>
        <div className="flex flex-wrap gap-1.5">
          {STATUSES.map((s) => (
            <button
              key={s.id}
              onClick={() => move(s.id)}
              disabled={pending}
              className={status === s.id ? "btn btn-primary btn-sm" : "btn btn-ghost btn-sm"}
            >
              {status === s.id && <Check size={13} />}
              {s.label}
            </button>
          ))}
        </div>
      </Card>

      <Card>
        <CardTitle
          action={
            <span className="flex items-center gap-2">
              {saved && <span className="text-[11.5px]" style={{ color: "var(--color-good)" }}>{saved}</span>}
              <button onClick={save} disabled={!dirty || pending} className="btn btn-primary btn-sm">
                {pending ? "Saving…" : dirty ? "Save" : "Saved"}
              </button>
            </span>
          }
        >
          The task
        </CardTitle>

        <label className="mb-1 block section-title">Title</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} className="input mb-3 w-full" />

        <label className="mb-1 block section-title">
          What happened — notes, decisions, who said what
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={8}
          placeholder="Log it here as you go. This is what the Brain reads when you ask what the state of things is."
          className="input mb-3 w-full resize-y leading-relaxed"
        />

        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className="mb-1 block section-title">Due</label>
            <input type="date" value={due} onChange={(e) => setDue(e.target.value)} className="input w-full" />
          </div>
          <div>
            <label className="mb-1 block section-title">Priority</label>
            <div className="flex gap-1">
              {PRIORITIES.map((p) => (
                <button
                  key={p.value}
                  onClick={() => setPriority(p.value)}
                  className={priority === p.value ? "btn btn-primary btn-sm" : "btn btn-ghost btn-sm"}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="mb-1 block section-title">Waiting on</label>
            <input
              value={waitingOn}
              onChange={(e) => setWaitingOn(e.target.value)}
              placeholder="A name, if you are blocked"
              className="input w-full"
            />
          </div>
        </div>
      </Card>

      {clientId && <LogTime taskId={task.id} taskTitle={task.title} clientId={clientId} projectId={task.projectId} />}

      <div className="flex justify-end">
        <button
          onClick={() => {
            if (!confirm("Delete this task? This cannot be undone.")) return;
            startTransition(async () => {
              await deleteTask(task.id);
              router.push("/tasks");
            });
          }}
          className="btn btn-ghost btn-sm"
          style={{ color: "var(--color-urgent)" }}
        >
          <Trash2 size={13} /> Delete task
        </button>
      </div>
    </div>
  );
}

/** Hours against the client, with the task's name pre-filled as the note. */
function LogTime({
  taskId,
  taskTitle,
  clientId,
  projectId,
}: {
  taskId: string;
  taskTitle: string;
  clientId: string;
  projectId: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [hours, setHours] = useState("");
  const [note, setNote] = useState(taskTitle);
  const [message, setMessage] = useState<string | null>(null);

  function submit() {
    const value = Number(hours.replace(",", "."));
    if (!(value > 0)) {
      setMessage("Hours must be more than zero.");
      return;
    }
    startTransition(async () => {
      const result = await logTime({
        clientId,
        projectId,
        date: new Date().toISOString().slice(0, 10),
        hours: value,
        note,
      });
      setMessage(result.ok ? `Logged ${value} h` : result.error);
      if (result.ok) setHours("");
      router.refresh();
    });
  }

  return (
    <Card>
      <CardTitle>Log time</CardTitle>
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-24">
          <label className="mb-1 block section-title">Hours</label>
          <input
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            inputMode="decimal"
            placeholder="1.5"
            className="input w-full"
          />
        </div>
        <div className="min-w-[180px] flex-1">
          <label className="mb-1 block section-title">Note</label>
          <input value={note} onChange={(e) => setNote(e.target.value)} className="input w-full" />
        </div>
        <button onClick={submit} disabled={pending} className="btn btn-primary btn-sm" data-task={taskId}>
          {pending ? "Logging…" : "Log"}
        </button>
      </div>
      {message && <p className="mt-2 text-[11.5px] text-muted">{message}</p>}
    </Card>
  );
}
