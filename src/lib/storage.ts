import { del, put } from "@vercel/blob";

/**
 * Keeping the original file. Optional by design: without a blob store the app
 * still accepts uploads and keeps their extracted text, it just cannot hand the
 * original back. That degrades a feature rather than breaking the upload.
 */
/**
 * Vercel names this BLOB_READ_WRITE_TOKEN by default, but lets you set a prefix
 * when connecting a store — which would produce something like
 * NATTUGLA_BLOB_READ_WRITE_TOKEN. Matching on the suffix means a connected store
 * works whatever it ended up being called, instead of being silently ignored.
 */
export function blobToken(): string | undefined {
  const direct = process.env.BLOB_READ_WRITE_TOKEN?.trim();
  if (direct) return direct;

  const key = Object.keys(process.env).find((k) => k.endsWith("BLOB_READ_WRITE_TOKEN"));
  const value = key ? process.env[key]?.trim() : undefined;
  return value || undefined;
}

export const storageConfigured = () => Boolean(blobToken());

export type StoredFile = { url: string; pathname: string };

export async function storeFile(file: File, prefix: string): Promise<StoredFile | null> {
  if (!storageConfigured()) return null;

  // addRandomSuffix keeps two files of the same name from overwriting each other.
  const blob = await put(`${prefix}/${file.name}`, file, {
    access: "public",
    addRandomSuffix: true,
    contentType: file.type || undefined,
    token: blobToken(),
  });

  return { url: blob.url, pathname: blob.pathname };
}

export async function removeFile(pathname: string | null | undefined): Promise<void> {
  if (!pathname || !storageConfigured()) return;
  try {
    await del(pathname, { token: blobToken() });
  } catch {
    // A missing blob is not worth failing a delete over — the row is going anyway.
  }
}
