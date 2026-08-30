import { del, get, put } from "@vercel/blob";

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

/**
 * Which environment variable the token was found in — the name only, never the
 * value. When storage "isn't working" the first question is always whether the
 * app can see a token at all, and guessing at that from the outside wastes far
 * more time than reporting it does.
 */
export function blobTokenSource(): string | null {
  if (process.env.BLOB_READ_WRITE_TOKEN?.trim()) return "BLOB_READ_WRITE_TOKEN";
  const key = Object.keys(process.env).find((k) => k.endsWith("BLOB_READ_WRITE_TOKEN") && process.env[k]?.trim());
  return key ?? null;
}

export type StoredFile = { url: string; pathname: string };

/**
 * Client documents are private by default: a "public" blob URL is unguessable
 * but permanent and unauthenticated, which is the wrong shape for someone
 * else's brand book. Files are served through an authenticated route instead.
 *
 * Overridable because a store created as public cannot take private blobs.
 */
export const blobAccess = (): "public" | "private" =>
  process.env.BLOB_ACCESS === "public" ? "public" : "private";

/** Reads a stored file back with the token — the only way in for private blobs. */
export async function readFile(pathname: string): Promise<{ stream: ReadableStream<Uint8Array>; contentType: string; size: number } | null> {
  if (!storageConfigured()) return null;

  // get() resolves to null for a missing blob, and to a non-200 shape for
  // not-modified responses — neither carries a stream.
  const result = await get(pathname, { access: blobAccess(), token: blobToken() });
  if (!result || result.statusCode !== 200) return null;

  return { stream: result.stream, contentType: result.blob.contentType, size: result.blob.size };
}

export async function storeFile(file: File, prefix: string): Promise<StoredFile | null> {
  if (!storageConfigured()) return null;

  // addRandomSuffix keeps two files of the same name from overwriting each other.
  const blob = await put(`${prefix}/${file.name}`, file, {
    access: blobAccess(),
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
