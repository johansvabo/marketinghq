"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, FileText, Image as ImageIcon, Pin, Plus, Trash2, X } from "lucide-react";
import { clsx } from "clsx";
import type { Document } from "@/lib/db/schema";
import { createDocument, deleteDocument, toggleDocumentPin, updateDocument } from "@/server/actions";
import { Card, Chip, Empty } from "./ui";
import { Markdown } from "./markdown";
import { DocumentUpload } from "./document-upload";

const KINDS = [
  { value: "brief", label: "Brief" },
  { value: "strategy", label: "Strategy" },
  { value: "brand", label: "Brand" },
  { value: "process", label: "Process" },
  { value: "research", label: "Research" },
  { value: "reference", label: "Reference" },
  { value: "note", label: "Note" },
];

const KIND_TONE: Record<string, "brand" | "info" | "good" | "warn" | "neutral"> = {
  brief: "brand",
  strategy: "info",
  brand: "warn",
  process: "good",
  research: "info",
  reference: "neutral",
  note: "neutral",
};

/**
 * Documents are kept whole and read as written — markdown in, markdown out.
 * Editing happens in place rather than on a separate page, because most of
 * these get amended in thirty-second bursts between other things.
 */
export function DocumentList({
  clientId,
  documents,
  storageOn,
  canDirect,
  access,
}: {
  clientId: string;
  documents: Document[];
  storageOn: boolean;
  canDirect: boolean;
  access: "public" | "private";
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function create(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await createDocument({
        clientId,
        title: String(formData.get("title") ?? ""),
        kind: String(formData.get("kind") ?? "note"),
        body: String(formData.get("body") ?? ""),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setCreating(false);
      router.refresh();
    });
  }

  function save(documentId: string, formData: FormData) {
    startTransition(async () => {
      await updateDocument(documentId, {
        title: String(formData.get("title") ?? ""),
        kind: String(formData.get("kind") ?? "note"),
        body: String(formData.get("body") ?? ""),
      });
      setEditingId(null);
      router.refresh();
    });
  }

  /*
   * One line per document, grouped by kind. A stack of full-height cards buries
   * a client's material under its own scroll — the folder is for finding
   * something, and the content is one click away when you want it.
   */
  const groups = new Map<string, Document[]>();
  for (const doc of documents) {
    if (!groups.has(doc.kind)) groups.set(doc.kind, []);
    groups.get(doc.kind)!.push(doc);
  }
  const orderedGroups = KINDS.map((k) => [k.value, groups.get(k.value) ?? []] as const).filter(([, d]) => d.length > 0);

  return (
    <div className="flex flex-col gap-2.5">
      {showUpload ? (
        <DocumentUpload clientId={clientId} storageOn={storageOn} canDirect={canDirect} access={access} />
      ) : (
        <div className="flex items-center gap-2">
          <button onClick={() => setShowUpload(true)} className="btn btn-sm btn-primary">
            <Plus size={14} />
            Add documents
          </button>
          <span className="text-[11.5px] text-muted">
            {documents.length} file{documents.length === 1 ? "" : "s"}
          </span>
        </div>
      )}

      {!storageOn && documents.some((d) => d.fileName && !d.fileUrl) && (
        <p className="text-[11.5px] leading-relaxed text-muted">
          Uploaded text is stored and searchable, but the original files are not being kept. Add a Blob store in Vercel
          under <strong>Storage</strong> and every upload from then on keeps its original.
        </p>
      )}

      {creating ? (
        <Card>
          <form action={create} className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              <input name="title" className="input flex-1 min-w-[200px]" placeholder="Document title" required autoFocus />
              <select name="kind" className="input w-auto" defaultValue="brief">
                {KINDS.map((k) => (
                  <option key={k.value} value={k.value}>{k.label}</option>
                ))}
              </select>
            </div>
            <textarea
              name="body"
              rows={14}
              className="input font-[inherit] text-[13px] leading-relaxed"
              placeholder={"Paste or write it here. Markdown works — # headings, **bold**, - lists, and tables.\n\nThis is for things you read: briefs, brand guidelines, how they like to work, account structure, the strategy you agreed."}
            />
            {error && <p className="text-[12.5px]" style={{ color: "var(--color-urgent)" }}>{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setCreating(false)} className="btn">Cancel</button>
              <button type="submit" disabled={pending} className="btn btn-primary">Save document</button>
            </div>
          </form>
        </Card>
      ) : (
        <button onClick={() => setCreating(true)} className="btn self-start">
          <Plus size={15} />
          Or write one by hand
        </button>
      )}

      {documents.length === 0 && !creating && (
        <Card>
          <Empty
            title="No documents yet"
            hint="Drop in briefs, brand guidelines, decks exported to PDF, the strategy you agreed. Kept whole and readable — and the brain can read them too."
          />
        </Card>
      )}

      {orderedGroups.map(([kind, docs]) => (
        <section key={kind}>
          <div className="mb-1 flex items-center gap-2 px-1">
            <h4 className="section-title">{KINDS.find((k) => k.value === kind)?.label ?? kind}</h4>
            <span className="text-[11px] text-muted">{docs.length}</span>
          </div>

          <div className="card overflow-hidden">
            {docs.map((doc, index) => {
              const isEditing = editingId === doc.id;
              const isOpen = openId === doc.id;

              if (isEditing) {
                return (
                  <div key={doc.id} className={clsx("p-3.5", index > 0 && "border-t")}>
                    <form action={(fd) => save(doc.id, fd)} className="flex flex-col gap-3">
                      <div className="flex flex-wrap gap-2">
                        <input name="title" defaultValue={doc.title} className="input flex-1 min-w-[200px]" required />
                        <select name="kind" className="input w-auto" defaultValue={doc.kind}>
                          {KINDS.map((k) => (
                            <option key={k.value} value={k.value}>{k.label}</option>
                          ))}
                        </select>
                      </div>
                      <textarea name="body" defaultValue={doc.body} rows={16} className="input font-[inherit] text-[13px] leading-relaxed" />
                      <div className="flex justify-end gap-2">
                        <button type="button" onClick={() => setEditingId(null)} className="btn">Cancel</button>
                        <button type="submit" disabled={pending} className="btn btn-primary">Save</button>
                      </div>
                    </form>
                  </div>
                );
              }

              return (
                <div key={doc.id} className={clsx(index > 0 && "border-t")}>
                  <div className="group flex items-center gap-2 px-3 py-2 transition-colors hover:bg-[var(--raised)]">
                    {doc.fileType?.startsWith("image/") ? (
                      <ImageIcon size={13} className="shrink-0 text-[var(--ink-muted)]" />
                    ) : (
                      <FileText size={13} className="shrink-0 text-[var(--ink-muted)]" />
                    )}

                    <button
                      onClick={() => setOpenId(isOpen ? null : doc.id)}
                      className="min-w-0 flex-1 truncate text-left text-[13px] font-medium hover:underline"
                      title={doc.title}
                    >
                      {doc.title}
                    </button>

                    {doc.pinned && <Pin size={11} style={{ color: "var(--color-brand)" }} fill="currentColor" />}

                    <span className="hidden shrink-0 text-[11px] text-muted sm:inline">
                      {doc.fileSize ? `${Math.round(doc.fileSize / 1024)} KB · ` : ""}
                      {doc.updatedAt.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                    </span>

                    <div className="flex shrink-0 items-center gap-0.5 row-actions">
                      {doc.filePathname && (
                        <a
                          href={`/api/documents/${doc.id}/file`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn btn-ghost btn-sm"
                          title={`Open ${doc.fileName ?? "the original"}`}
                        >
                          <Download size={12} />
                        </a>
                      )}
                      <button
                        onClick={() => startTransition(async () => { await toggleDocumentPin(doc.id); router.refresh(); })}
                        className="btn btn-ghost btn-sm"
                        title={doc.pinned ? "Unpin" : "Pin"}
                      >
                        <Pin size={12} fill={doc.pinned ? "currentColor" : "none"} />
                      </button>
                      <button onClick={() => { setEditingId(doc.id); setOpenId(doc.id); }} className="btn btn-ghost btn-sm">
                        Edit
                      </button>
                      <button
                        onClick={() => {
                          if (!confirm(`Delete “${doc.title}”? This cannot be undone.`)) return;
                          startTransition(async () => { await deleteDocument(doc.id); router.refresh(); });
                        }}
                        className="btn btn-ghost btn-sm"
                        title="Delete"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>

                  {isOpen && (
                    <div className="border-t px-3.5 py-3">
                      {doc.extractionNote && (
                        <p className="mb-2 text-[11.5px] leading-relaxed" style={{ color: "var(--color-warn)" }}>
                          {doc.extractionNote}
                        </p>
                      )}
                      {doc.body.trim() ? (
                        <Markdown source={doc.body} />
                      ) : (
                        <p className="text-[12.5px] text-muted">Nothing readable in this one — open the original above.</p>
                      )}
                      <button onClick={() => setOpenId(null)} className="btn btn-ghost btn-sm mt-3 -ml-2">
                        <X size={13} />
                        Close
                      </button>
                    </div>
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
