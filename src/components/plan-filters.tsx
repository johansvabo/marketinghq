"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";

/** Filters in one row above the chart: what to show, and over what window. */
export function PlanFilters({
  clients,
  projects,
  year,
  quarter,
  label,
  range,
}: {
  clients: { id: string; name: string }[];
  projects: { id: string; name: string; clientId: string | null }[];
  year: number;
  quarter: number;
  label: string;
  range: string;
}) {
  const router = useRouter();
  const params = useSearchParams();

  const clientId = params.get("client") ?? "";
  const projectId = params.get("project") ?? "";

  function go(next: Record<string, string | null>) {
    const query = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value === null || value === "") query.delete(key);
      else query.set(key, value);
    }
    router.push(`/plan?${query.toString()}`);
  }

  const step = (by: number) => {
    const zero = year * 4 + (quarter - 1) + by;
    go({ y: String(Math.floor(zero / 4)), q: String((((zero % 4) + 4) % 4) + 1), range: "quarter" });
  };

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1">
        <button onClick={() => step(-1)} className="btn btn-sm" aria-label="Previous quarter">
          <ChevronLeft size={14} />
        </button>
        <span className="min-w-[92px] text-center text-[12.5px] font-medium tabular-nums">{label}</span>
        <button onClick={() => step(1)} className="btn btn-sm" aria-label="Next quarter">
          <ChevronRight size={14} />
        </button>
      </div>

      <select
        value={range}
        onChange={(e) => go({ range: e.target.value })}
        className="input w-auto py-1 text-[12px]"
        aria-label="Time frame"
      >
        <option value="quarter">This quarter</option>
        <option value="month">This month</option>
        <option value="90">Next 90 days</option>
        <option value="180">Next 6 months</option>
        <option value="year">This year</option>
      </select>

      <select
        value={clientId}
        onChange={(e) => go({ client: e.target.value, project: null })}
        className="input w-auto py-1 text-[12px]"
        aria-label="Filter by client"
      >
        <option value="">All clients</option>
        {clients.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>

      <select
        value={projectId}
        onChange={(e) => go({ project: e.target.value })}
        className="input w-auto py-1 text-[12px]"
        aria-label="Filter by project"
      >
        <option value="">All projects</option>
        {projects
          .filter((p) => !clientId || p.clientId === clientId)
          .map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
      </select>

      {(clientId || projectId || range !== "quarter") && (
        <button onClick={() => go({ client: null, project: null, range: null })} className="btn btn-ghost btn-sm">
          Clear
        </button>
      )}
    </div>
  );
}
