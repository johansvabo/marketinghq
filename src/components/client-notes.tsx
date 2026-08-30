"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateClient } from "@/server/actions";
import { Card, CardTitle } from "./ui";

/** The short standing context you want in front of you on every visit. */
export function ClientNotes({ clientId, notes }: { clientId: string; notes: string | null }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();

  function save(formData: FormData) {
    startTransition(async () => {
      await updateClient(clientId, { notes: String(formData.get("notes") ?? "") });
      setEditing(false);
      router.refresh();
    });
  }

  return (
    <Card>
      <CardTitle
        action={
          !editing && (
            <button onClick={() => setEditing(true)} className="btn btn-ghost btn-sm">
              {notes ? "Edit" : "Add"}
            </button>
          )
        }
      >
        Standing context
      </CardTitle>

      {editing ? (
        <form action={save} className="flex flex-col gap-2">
          <textarea
            name="notes"
            defaultValue={notes ?? ""}
            rows={6}
            className="input font-[inherit] text-[12.5px] leading-relaxed"
            placeholder="What they sell, who actually decides, what they care about, how they like to be talked to."
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setEditing(false)} className="btn btn-sm">Cancel</button>
            <button type="submit" disabled={pending} className="btn btn-sm btn-primary">Save</button>
          </div>
        </form>
      ) : notes ? (
        <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-soft">{notes}</p>
      ) : (
        <p className="text-[12.5px] leading-relaxed text-muted">
          The two lines you would tell a colleague taking this over. It goes to Claude with every question about them.
        </p>
      )}
    </Card>
  );
}
