"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileUp, Loader2 } from "lucide-react";
import { clsx } from "clsx";
import { UPLOAD_ACCEPT } from "@/lib/documents/extract";

type Result = {
  created: { title: string; hasText: boolean; stored: boolean }[];
  failed: { name: string; reason: string }[];
  storageConfigured: boolean;
};

/**
 * Drag a file anywhere on the drop zone, or click to pick. Multiple at once is
 * the normal case — a client handover is rarely one file.
 */
export function DocumentUpload({ clientId }: { clientId: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function upload(files: FileList | File[]) {
    const list = Array.from(files);
    if (list.length === 0) return;

    setBusy(true);
    setError(null);
    setResult(null);

    const body = new FormData();
    body.set("clientId", clientId);
    for (const file of list) body.append("files", file);

    try {
      const response = await fetch("/api/documents/upload", { method: "POST", body });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload.error ?? "The upload failed.");
      } else {
        setResult(payload);
        router.refresh();
      }
    } catch {
      setError("The upload failed — check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void upload(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
        }}
        className={clsx(
          "flex cursor-pointer flex-col items-center gap-1.5 rounded-[12px] border border-dashed px-4 py-6 text-center transition-colors",
          dragging ? "border-[var(--color-brand)]" : "hover:border-[var(--ink-muted)]",
        )}
        style={{ background: dragging ? "color-mix(in oklch, var(--color-brand) 8%, var(--surface))" : "transparent" }}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={UPLOAD_ACCEPT}
          className="hidden"
          onChange={(e) => {
            if (e.target.files) void upload(e.target.files);
            e.target.value = "";
          }}
        />

        {busy ? (
          <>
            <Loader2 size={18} className="animate-spin" style={{ color: "var(--color-brand)" }} />
            <p className="text-[13px] font-medium">Reading your files…</p>
            <p className="text-[11.5px] text-muted">Pulling the text out so it becomes searchable.</p>
          </>
        ) : (
          <>
            <FileUp size={18} style={{ color: dragging ? "var(--color-brand)" : "var(--ink-muted)" }} />
            <p className="text-[13px] font-medium">Drop files here, or click to choose</p>
            <p className="text-[11.5px] leading-relaxed text-muted">
              PDF, Word, text, markdown, CSV and images. The text is pulled out and made searchable; the original is kept.
            </p>
          </>
        )}
      </div>

      {error && (
        <p className="mt-2 text-[12.5px]" style={{ color: "var(--color-urgent)" }}>
          {error}
        </p>
      )}

      {result && (
        <div className="mt-2 flex flex-col gap-1">
          {result.created.map((c, i) => (
            <p key={i} className="text-[12px]" style={{ color: "var(--color-good)" }}>
              Added “{c.title}”
              {!c.hasText && " — stored, but no text could be read from it"}
              {c.hasText && !c.stored && " — text stored, original not kept"}
            </p>
          ))}
          {result.failed.map((f, i) => (
            <p key={i} className="text-[12px]" style={{ color: "var(--color-urgent)" }}>
              {f.name}: {f.reason}
            </p>
          ))}
          {result.created.length > 0 && !result.storageConfigured && (
            <p className="text-[11.5px] text-muted">
              Originals aren&apos;t being kept — add a Blob store in Vercel under Storage and they will be from then on.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
