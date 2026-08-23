"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { createProject } from "@/server/actions";

export function NewProjectDialog({ clients }: { clients: { id: string; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await createProject({
        name: String(formData.get("name") ?? ""),
        clientId: (formData.get("clientId") as string) || null,
        goal: String(formData.get("goal") ?? ""),
        dueDate: (formData.get("dueDate") as string) || null,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      router.refresh();
      router.push(`/projects/${result.id}`);
    });
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn btn-primary">
        <Plus size={15} />
        New project
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-3 md:items-center" style={{ background: "oklch(0 0 0 / 0.55)" }}>
      <div className="card w-full max-w-[440px] p-5 rise">
        <h2 className="mb-4 text-[15px] font-semibold">New project</h2>
        <form action={submit} className="flex flex-col gap-3">
          <div>
            <label className="label" htmlFor="name">Name</label>
            <input id="name" name="name" className="input" placeholder="Q4 demand gen" required autoFocus />
          </div>
          <div>
            <label className="label" htmlFor="clientId">Client</label>
            <select id="clientId" name="clientId" className="input">
              <option value="">Internal / no client</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="goal">What does done look like?</label>
            <textarea id="goal" name="goal" className="input" rows={2} placeholder="Pipeline from paid up 30% by December without raising CAC" />
          </div>
          <div>
            <label className="label" htmlFor="dueDate">Target date</label>
            <input id="dueDate" name="dueDate" type="date" className="input" />
          </div>

          {error && <p className="text-[12px]" style={{ color: "var(--color-urgent)" }}>{error}</p>}

          <div className="mt-1 flex justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className="btn">Cancel</button>
            <button type="submit" disabled={pending} className="btn btn-primary">Create</button>
          </div>
        </form>
      </div>
    </div>
  );
}
