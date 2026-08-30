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
}: {
  clientId: string;
  documents: Document[];
  storageOn: boolean;
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
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

  return (
    <div className="flex flex-col gap-2.5">
      <DocumentUpload clientId={clientId} />

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

      {documents.map((doc) => {
        const isEditing = editingId === doc.id;
        const isOpen = openId === doc.id;

        return (
          <Card key={doc.id} className={clsx(pending && "opacity-70")}>
            {isEditing ? (
              <form action={(fd) => save(doc.id, fd)} className="flex flex-col gap-3">
                <div className="flex flex-wrap gap-2">
                  <input name="title" defaultValue={doc.title} className="input flex-1 min-w-[200px]" required />
                  <select name="kind" className="input w-auto" defaultValue={doc.kind}>
                    {KINDS.map((k) => (
                      <option key={k.value} value={k.value}>{k.label}</option>
                    ))}
                  </select>
                </div>
                <textarea name="body" defaultValue={doc.body} rows={18} className="input font-[inherit] text-[13px] leading-relaxed" />
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => setEditingId(null)} className="btn">Cancel</button>
                  <button type="submit" disabled={pending} className="btn btn-primary">Save</button>
                </div>
              </form>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  {doc.fileType?.startsWith("image/") ? (
                    <ImageIcon size={14} className="shrink-0 text-[var(--ink-muted)]" />
                  ) : (
                    <FileText size={14} className="shrink-0 text-[var(--ink-muted)]" />
                  )}
                  <button
                    onClick={() => setOpenId(isOpen ? null : doc.id)}
                    className="text-left text-[14px] font-semibold tracking-[-0.01em] hover:underline"
                  >
                    {doc.title}
                  </button>
                  <Chip tone={KIND_TONE[doc.kind] ?? "neutral"} solid>{doc.kind}</Chip>
                  {doc.pinned && <Chip tone="brand">pinned</Chip>}

                  <div className="ml-auto flex items-center gap-0.5">
                    {doc.fileUrl && (
                      <a
                        href={doc.fileUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn btn-ghost btn-sm"
                        title={`Open ${doc.fileName ?? "the original file"}`}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Download size={13} />
                      </a>
                    )}
                    <span className="mr-1 text-[11px] text-muted">
                      {doc.updatedAt.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                    </span>
                    <button
                      onClick={() => startTransition(async () => { await toggleDocumentPin(doc.id); router.refresh(); })}
                      className="btn btn-ghost btn-sm"
                      title={doc.pinned ? "Unpin" : "Pin to the top"}
                      style={doc.pinned ? { color: "var(--color-brand)" } : undefined}
                    >
                      <Pin size={13} fill={doc.pinned ? "currentColor" : "none"} />
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
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>

                {doc.fileName && (
                  <p className="mt-1 text-[11.5px] text-muted">
                    {doc.fileName}
                    {doc.fileSize ? ` · ${(doc.fileSize / 1024).toFixed(0)} KB` : ""}
                    {doc.fileUrl ? "" : " · original not kept"}
                  </p>
                )}

                {doc.extractionNote && (
                  <p className="mt-1.5 text-[11.5px] leading-relaxed" style={{ color: "var(--color-warn)" }}>
                    {doc.extractionNote}
                  </p>
                )}

                {isOpen ? (
                  <div className="mt-3 border-t pt-3">
                    {doc.body.trim() ? (
                      <Markdown source={doc.body} />
                    ) : (
                      <p className="text-[12.5px] text-muted">This document is empty. Hit Edit to write it.</p>
                    )}
                    <button onClick={() => setOpenId(null)} className="btn btn-ghost btn-sm mt-3 -ml-2">
                      <X size={13} />
                      Close
                    </button>
                  </div>
                ) : (
                  doc.body.trim() && (
                    <p className="mt-1.5 line-clamp-2 text-[12.5px] leading-relaxed text-muted">
                      {doc.body.replace(/[#*`>_-]/g, " ").replace(/\s+/g, " ").slice(0, 220)}
                    </p>
                  )
                )}
              </>
            )}
          </Card>
        );
      })}
    </div>
  );
}
