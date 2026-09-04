"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Users } from "lucide-react";
import { briefTheTeam } from "@/server/actions";
import { Card, CardTitle } from "./ui";

type Option = { id: string; name: string };

export function BriefTeam({
  agents,
  reviewer,
  clients,
  projects,
}: {
  agents: { key: string; name: string; role: string; colour: string }[];
  reviewer: { name: string } | null;
  clients: Option[];
  projects: (Option & { clientId: string | null })[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [clientId, setClientId] = useState("");
  const [chosen, setChosen] = useState<string[]>(agents.map((a) => a.key));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const toggle = (key: string) =>
    setChosen((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));

  function submit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await briefTheTeam({
        title: String(formData.get("title") ?? ""),
        brief: String(formData.get("brief") ?? ""),
        clientId: clientId || null,
        projectId: String(formData.get("projectId") ?? "") || null,
        agentKeys: chosen,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      // The work starts on the assignment page, which is where it is watched.
      router.push(`/team/assignments/${result.id}`);
    });
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn btn-primary btn-sm">
        <Users size={14} />
        Brief the team
      </button>
    );
  }

  return (
    <Card className="mb-4">
      <CardTitle>Brief the team</CardTitle>
      <form action={submit} className="flex flex-col gap-3">
        <div>
          <label className="label" htmlFor="brief">What do you want them to work on?</label>
          <textarea
            id="brief"
            name="brief"
            rows={7}
            required
            autoFocus
            className="input font-[inherit] text-[13px] leading-relaxed"
            placeholder={
              "Be specific — this is the whole team's instruction, and detail is what separates a useful answer from a generic one.\n\nE.g. Nattugla want to launch digital nattilsyn outside Norway. Should we go to Ireland or Sweden first? We have limited capital, no local presence, and the product is sold to municipalities. I need a recommendation I can take to their board in three weeks."
            }
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className="label" htmlFor="title">Call it</label>
            <input id="title" name="title" className="input" placeholder="optional" />
          </div>
          <div>
            <label className="label" htmlFor="clientId">Client</label>
            <select
              id="clientId"
              name="clientId"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              className="input"
            >
              <option value="">No client</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="projectId">Project</label>
            <select id="projectId" name="projectId" className="input" defaultValue="">
              <option value="">Unfiled</option>
              {projects.filter((p) => p.clientId === clientId).map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <span className="label">Who works it</span>
          <div className="flex flex-wrap gap-1.5">
            {agents.map((agent) => {
              const on = chosen.includes(agent.key);
              return (
                <button
                  key={agent.key}
                  type="button"
                  onClick={() => toggle(agent.key)}
                  aria-pressed={on}
                  className="btn btn-sm"
                  style={on ? { borderColor: agent.colour, color: agent.colour } : { opacity: 0.55 }}
                >
                  {agent.name}
                  <span className="text-[11px] text-muted">{agent.role}</span>
                </button>
              );
            })}
          </div>
          {reviewer && (
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-muted">
              {reviewer.name} always goes last and gathers everything into one document — that is the thing you read.
              Each of them works in turn and can see what the others have said, so this takes a few minutes.
            </p>
          )}
        </div>

        {error && <p className="text-[12.5px]" style={{ color: "var(--color-urgent)" }}>{error}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => setOpen(false)} className="btn btn-sm">Cancel</button>
          <button type="submit" disabled={pending || chosen.length === 0} className="btn btn-sm btn-primary">
            {pending ? "Starting…" : "Send it to them"}
          </button>
        </div>
      </form>
    </Card>
  );
}
