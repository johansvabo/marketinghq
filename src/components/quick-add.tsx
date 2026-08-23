"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { createTask } from "@/server/actions";

export type Option = { id: string; name: string; color?: string | null };

/**
 * Fast capture. Typing "Draft Q3 plan !1 @Acme ^fri" is faster than opening a
 * form, so the modifiers are parsed out of the text rather than made into fields.
 */
function parse(raw: string, clients: Option[], projects: Option[]) {
  let title = raw;
  let priority = 2;
  let clientId: string | null = null;
  let projectId: string | null = null;
  let dueDate: string | null = null;

  const priorityMatch = title.match(/(?:^|\s)!([1-4])(?=\s|$)/);
  if (priorityMatch) {
    priority = Number(priorityMatch[1]);
    title = title.replace(priorityMatch[0], " ");
  }

  const clientMatch = title.match(/(?:^|\s)@(\S+)/);
  if (clientMatch) {
    const needle = clientMatch[1].toLowerCase();
    const found = clients.find((c) => c.name.toLowerCase().startsWith(needle));
    if (found) {
      clientId = found.id;
      title = title.replace(clientMatch[0], " ");
    }
  }

  const projectMatch = title.match(/(?:^|\s)#(\S+)/);
  if (projectMatch) {
    const needle = projectMatch[1].toLowerCase();
    const found = projects.find((p) => p.name.toLowerCase().replace(/\s+/g, "-").startsWith(needle));
    if (found) {
      projectId = found.id;
      title = title.replace(projectMatch[0], " ");
    }
  }

  const dueMatch = title.match(/(?:^|\s)\^(today|tomorrow|mon|tue|wed|thu|fri|sat|sun|\d+d)(?=\s|$)/i);
  if (dueMatch) {
    dueDate = resolveDue(dueMatch[1].toLowerCase());
    title = title.replace(dueMatch[0], " ");
  }

  return { title: title.replace(/\s+/g, " ").trim(), priority, clientId, projectId, dueDate };
}

function resolveDue(token: string): string {
  const date = new Date();
  if (token === "today") return date.toISOString().slice(0, 10);
  if (token === "tomorrow") {
    date.setDate(date.getDate() + 1);
    return date.toISOString().slice(0, 10);
  }
  const relative = token.match(/^(\d+)d$/);
  if (relative) {
    date.setDate(date.getDate() + Number(relative[1]));
    return date.toISOString().slice(0, 10);
  }
  const days = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  const target = days.indexOf(token);
  if (target >= 0) {
    const delta = (target - date.getDay() + 7) % 7 || 7;
    date.setDate(date.getDate() + delta);
  }
  return date.toISOString().slice(0, 10);
}

export function QuickAdd({
  clients,
  projects,
  defaultClientId,
  defaultProjectId,
  placeholder = "Add a task…",
}: {
  clients: Option[];
  projects: Option[];
  defaultClientId?: string | null;
  defaultProjectId?: string | null;
  placeholder?: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!value.trim()) return;

    const parsed = parse(value, clients, projects);
    setValue("");
    inputRef.current?.focus();

    startTransition(async () => {
      await createTask({
        ...parsed,
        clientId: parsed.clientId ?? defaultClientId ?? null,
        projectId: parsed.projectId ?? defaultProjectId ?? null,
      });
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="flex items-center gap-2">
      <div className="relative flex-1">
        <input
          ref={inputRef}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={placeholder}
          className="input pr-2"
          aria-label="New task"
        />
      </div>
      <button type="submit" disabled={pending || !value.trim()} className="btn btn-primary">
        <Plus size={15} />
        Add
      </button>
    </form>
  );
}

export function QuickAddHint() {
  return (
    <p className="mt-2 text-[11.5px] leading-relaxed text-muted">
      <code className="rounded bg-[var(--raised)] px-1 py-0.5">!1</code> priority ·{" "}
      <code className="rounded bg-[var(--raised)] px-1 py-0.5">@client</code> ·{" "}
      <code className="rounded bg-[var(--raised)] px-1 py-0.5">#project</code> ·{" "}
      <code className="rounded bg-[var(--raised)] px-1 py-0.5">^fri</code> or{" "}
      <code className="rounded bg-[var(--raised)] px-1 py-0.5">^3d</code> due date
    </p>
  );
}
