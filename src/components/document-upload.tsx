"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileUp, Loader2 } from "lucide-react";
import { clsx } from "clsx";
import { upload } from "@vercel/blob/client";
import {
  formatBytes,
  MAX_DIRECT_POST_BYTES,
  MAX_UPLOAD_BYTES,
  MULTIPART_THRESHOLD_BYTES,
  UPLOAD_ACCEPT,
} from "@/lib/documents/limits";

type Result = {
  created: { title: string; hasText: boolean; stored: boolean }[];
  failed: { name: string; reason: string }[];
  storageConfigured: boolean;
};

/**
 * Drag a file anywhere on the drop zone, or click to pick. Multiple at once is
 * the normal case — a client handover is rarely one file.
 */
export function DocumentUpload({ clientId, storageOn }: { clientId: string; storageOn: boolean }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ name: string; index: number; total: number } | null>(null);

  /**
   * With blob storage on, each file goes straight from the browser to storage,
   * so the serverless request-body cap never applies and large files work. The
   * server then reads it back to pull the text out.
   *
   * Without it, files travel through the server and are limited to what the
   * platform will carry.
   */
  async function sendDirect(list: File[]): Promise<Result> {
    const created: Result["created"] = [];
    const failed: Result["failed"] = [];

    for (const [index, file] of list.entries()) {
      setProgress({ name: file.name, index: index + 1, total: list.length });
      try {
        if (file.size > MAX_UPLOAD_BYTES) {
          throw new Error(`is ${formatBytes(file.size)}, over the ${formatBytes(MAX_UPLOAD_BYTES)} limit.`);
        }

        const blob = await upload(file.name, file, {
          access: "public",
          handleUploadUrl: "/api/documents/blob-token",
          multipart: file.size > MULTIPART_THRESHOLD_BYTES,
          contentType: file.type || undefined,
        });

        const response = await fetch("/api/documents/from-blob", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            url: blob.url,
            pathname: blob.pathname,
            fileName: file.name,
            fileType: file.type,
            fileSize: file.size,
            clientId,
          }),
        });

        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "could not be recorded.");
        created.push(payload);
      } catch (caught) {
        failed.push({ name: file.name, reason: caught instanceof Error ? caught.message : "could not be uploaded." });
      }
    }

    return { created, failed, storageConfigured: true };
  }

  async function sendThroughServer(list: File[]): Promise<Result> {
    const body = new FormData();
    body.set("clientId", clientId);
    for (const file of list) body.append("files", file);

    const response = await fetch("/api/documents/upload", { method: "POST", body });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? "The upload failed.");
    return payload;
  }

  async function handleFiles(files: FileList | File[]) {
    const list = Array.from(files);
    if (list.length === 0) return;

    setBusy(true);
    setError(null);
    setResult(null);
    setProgress(null);

    try {
      setResult(storageOn ? await sendDirect(list) : await sendThroughServer(list));
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The upload failed — check your connection and try again.");
    } finally {
      setBusy(false);
      setProgress(null);
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
          void handleFiles(e.dataTransfer.files);
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
            if (e.target.files) void handleFiles(e.target.files);
            e.target.value = "";
          }}
        />

        {busy ? (
          <>
            <Loader2 size={18} className="animate-spin" style={{ color: "var(--color-brand)" }} />
            <p className="text-[13px] font-medium">
              {progress ? `Uploading ${progress.name}` : "Reading your files…"}
            </p>
            <p className="text-[11.5px] text-muted">
              {progress && progress.total > 1
                ? `${progress.index} of ${progress.total} · pulling the text out so it becomes searchable`
                : "Pulling the text out so it becomes searchable."}
            </p>
          </>
        ) : (
          <>
            <FileUp size={18} style={{ color: dragging ? "var(--color-brand)" : "var(--ink-muted)" }} />
            <p className="text-[13px] font-medium">Drop files here, or click to choose</p>
            <p className="text-[11.5px] leading-relaxed text-muted">
              PDF, Word, text, markdown, CSV and images. The text is pulled out and made searchable.
            </p>
            <p
              className="text-[11.5px] font-semibold"
              style={{ color: storageOn ? "var(--color-good)" : "var(--color-warn)" }}
            >
              {storageOn
                ? `File storage on · up to ${formatBytes(MAX_UPLOAD_BYTES)} each, originals kept`
                : `File storage off · ${formatBytes(MAX_DIRECT_POST_BYTES)} limit — connect a Blob store in Vercel to lift it`}
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
