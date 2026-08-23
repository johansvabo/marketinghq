"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createInsight } from "@/server/actions";

const KINDS = [
  { value: "insight", label: "Insight", hint: "Something true about a client, channel or audience" },
  { value: "learning", label: "Learning", hint: "A result from something you tried" },
  { value: "benchmark", label: "Benchmark", hint: "A number to compare against later" },
  { value: "idea", label: "Idea", hint: "Something to try when there's room" },
  { value: "meeting_note", label: "Meeting note", hint: "What was said and decided" },
  { value: "decision", label: "Decision", hint: "What was chosen, and why" },
  { value: "reference", label: "Reference", hint: "A link, a doc, a piece of context" },
];

export function CaptureForm({
  clients,
  projects,
  prefill = {},
}: {
  clients: { id: string; name: string }[];
  projects: { id: string; name: string; clientId: string | null }[];
  prefill?: { title?: string; body?: string; kind?: string; clientId?: string; projectId?: string; sourceRef?: string };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState(prefill.kind ?? "insight");
  const [clientId, setClientId] = useState(prefill.clientId ?? "");

  const visibleProjects = clientId ? projects.filter((p) => p.clientId === clientId) : projects;

  function submit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await createInsight({
        title: String(formData.get("title") ?? ""),
        body: String(formData.get("body") ?? ""),
        kind,
        clientId: (formData.get("clientId") as string) || null,
        projectId: (formData.get("projectId") as string) || null,
        confidence: Number(formData.get("confidence") ?? 3),
        occurredAt: (formData.get("occurredAt") as string) || null,
        sourceRef: prefill.sourceRef ?? null,
        tags: String(formData.get("tags") ?? "")
          .split(",")
          .map((t) => t.trim().toLowerCase().replace(/^#/, ""))
          .filter(Boolean),
      });

      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push("/brain?tab=library");
      router.refresh();
    });
  }

  return (
    <form action={submit} className="flex flex-col gap-4">
      <div>
        <span className="label">Type</span>
        <div className="flex flex-wrap gap-1.5">
          {KINDS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setKind(option.value)}
              className={`btn btn-sm ${kind === option.value ? "btn-primary" : ""}`}
              title={option.hint}
            >
              {option.label}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[11.5px] text-muted">{KINDS.find((k) => k.value === kind)?.hint}</p>
      </div>

      <div>
        <label className="label" htmlFor="title">Headline</label>
        <input
          id="title"
          name="title"
          className="input"
          defaultValue={prefill.title}
          placeholder="Retargeting audiences under 14 days convert 2x better for them"
          required
          autoFocus
        />
        <p className="mt-1.5 text-[11.5px] text-muted">Write it as the conclusion, not the topic. You will be scanning these in a year.</p>
      </div>

      <div>
        <label className="label" htmlFor="body">Detail</label>
        <textarea id="body" name="body" className="input font-[inherit]" rows={9} defaultValue={prefill.body} placeholder="What happened, what the numbers were, and what you would do differently." required />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="clientId">Client</label>
          <select id="clientId" name="clientId" className="input" value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="">None / general</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="projectId">Project</label>
          <select id="projectId" name="projectId" className="input" defaultValue={prefill.projectId ?? ""}>
            <option value="">None</option>
            {visibleProjects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="confidence">How solid is this?</label>
          <select id="confidence" name="confidence" className="input" defaultValue="3">
            <option value="1">1 — a hunch</option>
            <option value="2">2 — one weak signal</option>
            <option value="3">3 — reasonably confident</option>
            <option value="4">4 — well evidenced</option>
            <option value="5">5 — proven, repeatedly</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="occurredAt">When did this happen?</label>
          <input id="occurredAt" name="occurredAt" type="date" className="input" defaultValue={new Date().toISOString().slice(0, 10)} />
        </div>
      </div>

      <div>
        <label className="label" htmlFor="tags">Tags</label>
        <input id="tags" name="tags" className="input" placeholder="paid-social, creative, b2b" />
      </div>

      {error && <p className="text-[12.5px]" style={{ color: "var(--color-urgent)" }}>{error}</p>}

      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => router.back()} className="btn">Cancel</button>
        <button type="submit" disabled={pending} className="btn btn-primary">Save to brain</button>
      </div>
    </form>
  );
}
