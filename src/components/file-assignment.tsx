"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Check, FolderPlus } from "lucide-react";
import { fileAssignment } from "@/server/actions";

/** Keep the gathered answer as a document, so it outlives the assignment page. */
export function FileAssignment({ assignmentId, clientId }: { assignmentId: string; clientId: string | null }) {
  const [filed, setFiled] = useState(false);
  const [pending, startTransition] = useTransition();

  if (filed) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11.5px]" style={{ color: "var(--color-good)" }}>
        <Check size={12} />
        Filed
        {clientId && <Link href={`/clients/${clientId}`} className="underline">open the client</Link>}
      </span>
    );
  }

  return (
    <button
      onClick={() => startTransition(async () => { const r = await fileAssignment(assignmentId); if (r.ok) setFiled(true); })}
      disabled={pending}
      className="btn btn-ghost btn-sm"
    >
      <FolderPlus size={12} />
      Save as document
    </button>
  );
}
