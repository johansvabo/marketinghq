import { del, get, list, put } from "@vercel/blob";

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
 * Whether file storage actually works, established by using it.
 *
 * Checking for a BLOB_READ_WRITE_TOKEN variable was a proxy for this, and a
 * wrong one: a store connected in Vercel can authenticate without exposing a
 * static token, so the app reported "no token found" while storage was sitting
 * there working. Probing the real capability removes the guesswork — and when
 * it fails, the reason comes from the service rather than from my assumptions.
 */
type Probe = { ok: boolean; reason: string | null; at: number };
let probeCache: Probe | null = null;
const PROBE_TTL_MS = 5 * 60 * 1000;

export async function storageAvailable(): Promise<Probe> {
  if (probeCache && Date.now() - probeCache.at < PROBE_TTL_MS) return probeCache;

  try {
    // The cheapest call that proves both reachability and authorisation.
    await list({ limit: 1, token: blobToken() });
    probeCache = { ok: true, reason: null, at: Date.now() };
  } catch (error) {
    probeCache = {
      ok: false,
      reason: error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200),
      at: Date.now(),
    };
  }

  return probeCache;
}

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
  // get() resolves to null for a missing blob, and to a non-200 shape for
  // not-modified responses — neither carries a stream.
  const result = await get(pathname, { access: blobAccess(), token: blobToken() });
  if (!result || result.statusCode !== 200) return null;

  return { stream: result.stream, contentType: result.blob.contentType, size: result.blob.size };
}

export async function storeFile(file: File, prefix: string): Promise<StoredFile | null> {
  try {
    // Attempt it rather than pre-judging from whether a token variable exists:
    // credentials can be present without one, and the only reliable test is use.
    // addRandomSuffix keeps two files of the same name from overwriting each other.
    const blob = await put(`${prefix}/${file.name}`, file, {
      access: blobAccess(),
      addRandomSuffix: true,
      contentType: file.type || undefined,
      token: blobToken(),
    });

    return { url: blob.url, pathname: blob.pathname };
  } catch {
    // No storage, or it refused. The caller keeps the extracted text either way.
    return null;
  }
}

export async function removeFile(pathname: string | null | undefined): Promise<void> {
  if (!pathname) return;
  try {
    await del(pathname, { token: blobToken() });
  } catch {
    // A missing blob is not worth failing a delete over — the row is going anyway.
  }
}
