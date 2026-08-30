import { del, put } from "@vercel/blob";

/**
 * Keeping the original file. Optional by design: without a blob store the app
 * still accepts uploads and keeps their extracted text, it just cannot hand the
 * original back. That degrades a feature rather than breaking the upload.
 */
export const storageConfigured = () => Boolean(process.env.BLOB_READ_WRITE_TOKEN);

export type StoredFile = { url: string; pathname: string };

export async function storeFile(file: File, prefix: string): Promise<StoredFile | null> {
  if (!storageConfigured()) return null;

  // addRandomSuffix keeps two files of the same name from overwriting each other.
  const blob = await put(`${prefix}/${file.name}`, file, {
    access: "public",
    addRandomSuffix: true,
    contentType: file.type || undefined,
  });

  return { url: blob.url, pathname: blob.pathname };
}

export async function removeFile(pathname: string | null | undefined): Promise<void> {
  if (!pathname || !storageConfigured()) return;
  try {
    await del(pathname);
  } catch {
    // A missing blob is not worth failing a delete over — the row is going anyway.
  }
}
