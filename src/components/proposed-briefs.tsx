"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Users, X } from "lucide-react";
import { approveAssignment, deleteAssignment } from "@/server/actions";
import { Card } from "./ui";

type Proposal = {
  id: string;
  title: string;
  brief: string;
  clientName: string | null;
  agents: { key: string; name: string; colour: string }[];
};

/**
 * Work the brain has drafted for the team and left waiting. It speaks in the
 * user's name and costs money to run, so it needs a yes — but the yes is one
 * button next to the brief, not a trip to another page.
 */
export function ProposedBriefs({ proposals }: { proposals: Proposal[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState<string | null>(null);

  if (proposals.length === 0) return null;

  return (
    <div className="mb-3 flex flex-col gap-2">
      {proposals.map((p) => (
        <Card key={p.id} tone="brand">
          <div className="flex flex-wrap items-center gap-2">
            <Users size={13} style={{ color: "var(--color-brand)" }} />
            <span className="text-[13px] font-semibold">{p.title}</span>
            {p.clientName && <span className="text-[11.5px] text-muted">{p.clientName}</span>}
            <span className="ml-auto text-[11.5px] text-muted">waiting on you</span>
          </div>

          <p className="mt-1.5 text-[11.5px] leading-relaxed text-muted">
            The brain drafted this for {p.agents.map((a) => a.name).join(", ")}. Nothing has started.
          </p>

          <button
            onClick={() => setOpen(open === p.id ? null : p.id)}
            className="mt-1.5 text-[11.5px] underline"
            style={{ color: "var(--ink-muted)" }}
          >
            {open === p.id ? "Hide the brief" : "Read the brief"}
          </button>

          {open === p.id && (
            <p className="mt-2 whitespace-pre-wrap rounded-[10px] p-2.5 text-[12px] leading-relaxed" style={{ background: "var(--raised)" }}>
              {p.brief}
            </p>
          )}

          <div className="mt-2.5 flex flex-wrap gap-2">
            <button
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const r = await approveAssignment(p.id);
                  router.push(`/team/assignments/${r.id}`);
                })
              }
              className="btn btn-sm btn-primary"
            >
              <Check size={13} />
              Send it to them
            </button>
            <button
              disabled={pending}
              onClick={() => startTransition(async () => { await deleteAssignment(p.id); router.refresh(); })}
              className="btn btn-sm"
            >
              <X size={13} />
              No thanks
            </button>
          </div>
        </Card>
      ))}
    </div>
  );
}
