"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Project } from "@/lib/db/schema";
import { updateProject } from "@/server/actions";

const STATUSES = ["planning", "active", "blocked", "done", "archived"];
const HEALTHS = [
  { value: "on_track", label: "On track" },
  { value: "at_risk", label: "At risk" },
  { value: "off_track", label: "Off track" },
];

export function ProjectControls({ project }: { project: Project }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function patch(change: Parameters<typeof updateProject>[1]) {
    startTransition(async () => {
      await updateProject(project.id, change);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2" style={{ opacity: pending ? 0.6 : 1 }}>
      <select
        aria-label="Project status"
        className="input w-auto py-1.5 text-[12.5px]"
        defaultValue={project.status}
        onChange={(event) => patch({ status: event.target.value })}
      >
        {STATUSES.map((status) => (
          <option key={status} value={status}>{status}</option>
        ))}
      </select>
      <select
        aria-label="Project health"
        className="input w-auto py-1.5 text-[12.5px]"
        defaultValue={project.health}
        onChange={(event) => patch({ health: event.target.value })}
      >
        {HEALTHS.map((health) => (
          <option key={health.value} value={health.value}>{health.label}</option>
        ))}
      </select>
    </div>
  );
}
