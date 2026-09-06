"use client";

import { useState } from "react";
import { MessageSquare, X } from "lucide-react";
import { BrainChat } from "./brain-chat";

type Message = { role: "user" | "assistant"; content: string };

/**
 * Talking back to a specialist about work they have already delivered.
 *
 * Kept next to their answer rather than sent off to a separate chat page —
 * the whole point is arguing with the thing you are reading. What they wrote,
 * the brief and the gathered answer are attached to the thread server-side,
 * so they pick up mid-conversation rather than being reintroduced to it.
 */
export function Discuss({
  agentName,
  agentKey,
  assignmentId,
  clientId,
  projectId,
  threadId,
  initial = [],
}: {
  agentName: string;
  agentKey: string;
  assignmentId: string;
  clientId: string | null;
  projectId: string | null;
  threadId?: string;
  initial?: Message[];
}) {
  const [open, setOpen] = useState(initial.length > 0);

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn btn-ghost btn-sm">
        <MessageSquare size={12} />
        Discuss with {agentName}
      </button>
    );
  }

  return (
    <div className="mt-3 border-t pt-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="section-title">Discussing with {agentName}</span>
        <button onClick={() => setOpen(false)} className="btn btn-ghost btn-sm" aria-label="Close the discussion">
          <X size={12} />
        </button>
      </div>

      <BrainChat
        compact
        initial={initial}
        threadId={threadId}
        agentKey={agentKey}
        assignmentId={assignmentId}
        clientId={clientId}
        projectId={projectId}
        aiReady
        suggestions={[
          `Why this rather than the obvious alternative?`,
          `What is the weakest part of this, honestly?`,
          `What would change your recommendation?`,
        ]}
        placeholder={`Push back, ask for more, or tell ${agentName} what you know that they do not…`}
        emptyTitle={`Take it up with ${agentName}`}
        emptyHint={`They still have the brief, their own work and the gathered answer in front of them. Disagree with it, ask for the reasoning, or add what they were missing.`}
      />
    </div>
  );
}
