"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { Check, FolderPlus } from "lucide-react";
import { createDocument } from "@/server/actions";

const KINDS = ["brief", "strategy", "brand", "process", "research", "reference", "note"];

export type SaveTarget = {
  clients: { id: string; name: string }[];
  projects: { id: string; name: string; clientId: string | null }[];
};

/**
 * Filing an answer is the user's call, not the brain's — it writes documents
 * only when asked, so this is how "actually, keep that one" happens without
 * having to ask for it again in words.
 */
export function SaveAnswer({ body, targets }: { body: string; targets: SaveTarget }) {
  const [open, setOpen] = useState(false);
  const [clientId, setClientId] = useState(targets.clients[0]?.id ?? "");
  const [saved, setSaved] = useState<{ id: string; clientId: string } | null>(null);
  const [pending, startTransition] = useTransition();

  // A first heading or first line is almost always the right title.
  const suggestedTitle = useMemo(() => {
    const line = body.split("\n").find((l) => l.trim().length > 0) ?? "";
    return line.replace(/^#+\s*/, "").replace(/[*_`]/g, "").slice(0, 90).trim();
  }, [body]);

  const projectsForClient = targets.projects.filter((p) => p.clientId === clientId);

  function save(formData: FormData) {
    startTransition(async () => {
      const result = await createDocument({
        clientId: clientId || null,
        projectId: String(formData.get("projectId") ?? "") || null,
        title: String(formData.get("title") ?? "").trim() || suggestedTitle || "Saved from the brain",
        kind: String(formData.get("kind") ?? "note"),
        body,
      });
      if (result.ok) {
        setSaved({ id: result.id, clientId });
        setOpen(false);
      }
    });
  }

  if (saved) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11.5px]" style={{ color: "var(--color-good)" }}>
        <Check size={12} />
        Filed
        {saved.clientId && (
          <Link href={`/clients/${saved.clientId}`} className="underline">
            open the client
          </Link>
        )}
      </span>
    );
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn btn-ghost btn-sm">
        <FolderPlus size={12} />
        Save to documents
      </button>
    );
  }

  return (
    <form action={save} className="card flex flex-col gap-2 p-3">
      <input
        name="title"
        defaultValue={suggestedTitle}
        className="input text-[13px]"
        placeholder="Title"
        aria-label="Document title"
        autoFocus
      />
      <div className="flex flex-wrap gap-2">
        <select
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          className="input w-auto flex-1 text-[12.5px]"
          aria-label="Client"
        >
          <option value="">No client</option>
          {targets.clients.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>

        <select name="projectId" className="input w-auto flex-1 text-[12.5px]" aria-label="Project" defaultValue="">
          <option value="">Unfiled</option>
          {projectsForClient.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>

        <select name="kind" className="input w-auto text-[12.5px]" defaultValue="note" aria-label="Kind">
          {KINDS.map((k) => (
            <option key={k} value={k}>{k}</option>
          ))}
        </select>
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => setOpen(false)} className="btn btn-sm">Cancel</button>
        <button type="submit" disabled={pending} className="btn btn-sm btn-primary">Save</button>
      </div>
    </form>
  );
}
