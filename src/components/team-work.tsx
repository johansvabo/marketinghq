"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, FolderInput, Trash2 } from "lucide-react";
import { clsx } from "clsx";
import type { Document } from "@/lib/db/schema";
import { AGENTS, type AgentKey } from "@/lib/ai/agents";
import { deleteDocument, setDocumentProject, toggleDocumentArchived } from "@/server/actions";
import { Card, Chip, Empty } from "./ui";
import { Markdown } from "./markdown";

type Project = { id: string; name: string };

/**
 * What the team produced, kept apart from the client's own material.
 *
 * Grouped by project, because a draft that belongs to a workstream is a
 * different thing from a loose idea — and anything unfiled is shown first so it
 * either gets a home or gets archived rather than quietly accumulating.
 */
export function TeamWork({
  documents,
  projects,
  showArchived,
}: {
  documents: Document[];
  projects: Project[];
  showArchived: boolean;
}) {
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const visible = documents.filter((d) => (showArchived ? true : d.status !== "archived"));

  if (visible.length === 0) {
    return (
      <Card>
        <Empty
          title="The team hasn't produced anything here yet"
          hint="Drafts, plans and briefings they save land here — separate from your own material, so you always know which is which."
        />
      </Card>
    );
  }

  const projectName = new Map(projects.map((p) => [p.id, p.name]));
  const groups = new Map<string, Document[]>();
  for (const doc of visible) {
    const key = doc.projectId ?? "";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(doc);
  }

  // Unfiled first: it is the pile that needs a decision.
  const ordered = [...groups.entries()].sort(([a], [b]) => (a === "" ? -1 : b === "" ? 1 : 0));

  return (
    <div className="flex flex-col gap-4">
      {ordered.map(([projectId, docs]) => (
        <section key={projectId || "unfiled"}>
          <div className="mb-1.5 flex items-center gap-2">
            <h3 className="section-title">{projectId ? projectName.get(projectId) ?? "Project" : "Not filed to a project"}</h3>
            <span className="text-[11px] text-muted">{docs.length}</span>
          </div>

          <div className="flex flex-col gap-2">
            {docs.map((doc) => {
              const agent = doc.authorAgent ? AGENTS[doc.authorAgent as AgentKey] : undefined;
              const isOpen = openId === doc.id;
              const archived = doc.status === "archived";

              return (
                <div
                  key={doc.id}
                  className={clsx("card p-3.5", archived && "opacity-50")}
                  style={{ borderLeft: `3px solid ${agent?.colour ?? "var(--hairline)"}` }}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => setOpenId(isOpen ? null : doc.id)}
                      className="text-left text-[13.5px] font-semibold leading-snug tracking-[-0.01em] hover:underline"
                    >
                      {doc.title}
                    </button>
                    <Chip tone="neutral">{doc.kind}</Chip>
                    {archived && <Chip tone="neutral">archived</Chip>}

                    <div className="ml-auto flex items-center gap-1.5">
                      <span className="text-[11px] text-muted">
                        {agent?.name ?? "team"} · {doc.updatedAt.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                      </span>

                      <select
                        value={doc.projectId ?? ""}
                        onChange={(e) =>
                          startTransition(async () => {
                            await setDocumentProject(doc.id, e.target.value || null);
                            router.refresh();
                          })
                        }
                        className="input w-auto py-1 text-[11.5px]"
                        aria-label="File under a project"
                        title="File under a project"
                      >
                        <option value="">Unfiled</option>
                        {projects.map((p) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>

                      <button
                        onClick={() => startTransition(async () => { await toggleDocumentArchived(doc.id); router.refresh(); })}
                        className="btn btn-ghost btn-sm"
                        title={archived ? "Bring back" : "Archive — keeps it searchable, out of the way"}
                        disabled={pending}
                      >
                        {archived ? <ArchiveRestore size={12} /> : <Archive size={12} />}
                      </button>
                      <button
                        onClick={() => {
                          if (!confirm(`Delete “${doc.title}”? Archiving keeps it searchable instead.`)) return;
                          startTransition(async () => { await deleteDocument(doc.id); router.refresh(); });
                        }}
                        className="btn btn-ghost btn-sm"
                        title="Delete permanently"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>

                  {isOpen ? (
                    <div className="mt-3 border-t pt-3">
                      <Markdown source={doc.body} />
                    </div>
                  ) : (
                    <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-muted">
                      {doc.body.replace(/[#*`>_-]/g, " ").replace(/\s+/g, " ").slice(0, 180)}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
