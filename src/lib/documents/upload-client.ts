import { upload } from "@vercel/blob/client";
import {
  formatBytes,
  MAX_DIRECT_POST_BYTES,
  MAX_UPLOAD_BYTES,
  MULTIPART_THRESHOLD_BYTES,
} from "./limits";

export type Uploaded = { id: string; title: string; hasText: boolean; stored: boolean };
export type UploadResult = {
  created: Uploaded[];
  failed: { name: string; reason: string }[];
  storageConfigured: boolean;
};

export type UploadOptions = {
  /** Where it should land. Both null means unfiled — the chat files it after. */
  clientId?: string | null;
  projectId?: string | null;
  storageOn: boolean;
  /** Whether the browser may upload straight to storage — needs a read-write token. */
  canDirect: boolean;
  /** Must match the store's own setting: a private store rejects public blobs. */
  access: "public" | "private";
  onProgress?: (p: { name: string; index: number; total: number }) => void;
};

async function sendThroughServer(list: File[], opts: UploadOptions): Promise<UploadResult> {
  const body = new FormData();
  if (opts.clientId) body.set("clientId", opts.clientId);
  if (opts.projectId) body.set("projectId", opts.projectId);
  for (const file of list) body.append("files", file);

  const response = await fetch("/api/documents/upload", { method: "POST", body });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error ?? "The upload failed.");
  return payload;
}

/**
 * With blob storage on, each file goes straight from the browser to storage, so
 * the serverless request-body cap never applies and large files work. The
 * server then reads it back to pull the text out. Without it, files travel
 * through the server and are limited to what the platform will carry.
 */
async function sendDirect(list: File[], opts: UploadOptions): Promise<UploadResult> {
  const created: Uploaded[] = [];
  const failed: UploadResult["failed"] = [];

  for (const [index, file] of list.entries()) {
    opts.onProgress?.({ name: file.name, index: index + 1, total: list.length });
    try {
      if (file.size > MAX_UPLOAD_BYTES) {
        throw new Error(`is ${formatBytes(file.size)}, over the ${formatBytes(MAX_UPLOAD_BYTES)} limit.`);
      }

      const blob = await upload(file.name, file, {
        access: opts.access,
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
          clientId: opts.clientId ?? null,
          projectId: opts.projectId ?? null,
        }),
      });

      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "could not be recorded.");
      created.push(payload);
    } catch (caught) {
      const raw = caught instanceof Error ? caught.message : "could not be uploaded.";

      /*
       * If the store will not issue an upload token, the direct path is
       * unavailable however healthy storage looks. Anything small enough can
       * still go through the server, so fall back rather than failing — a
       * misconfiguration should cost the size limit, not the feature.
       */
      if (/client token/i.test(raw) && file.size <= MAX_DIRECT_POST_BYTES) {
        try {
          const viaServer = await sendThroughServer([file], opts);
          created.push(...viaServer.created);
          failed.push(...viaServer.failed);
          continue;
        } catch {
          /* fall through to reporting the original failure */
        }
      }

      failed.push({
        name: file.name,
        reason: /client token/i.test(raw)
          ? `is ${formatBytes(file.size)} and the store would not issue an upload token, so it cannot be sent directly. Files up to ${formatBytes(MAX_DIRECT_POST_BYTES)} still work. Settings explains how to lift this.`
          : raw,
      });
    }
  }

  return { created, failed, storageConfigured: true };
}

/** One way in for every uploader, so the fallback logic exists in one place. */
export function uploadFiles(files: File[], opts: UploadOptions): Promise<UploadResult> {
  return opts.storageOn && opts.canDirect ? sendDirect(files, opts) : sendThroughServer(files, opts);
}
