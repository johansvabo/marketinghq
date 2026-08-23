import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { env } from "./env";

/**
 * AES-256-GCM at rest for OAuth tokens. ENCRYPTION_KEY can be any string —
 * it is hashed to 32 bytes. Without a key we fall back to storing plaintext
 * and mark it so, which is fine for local dev but logged loudly.
 */

const PREFIX = "enc:v1:";

function key(): Buffer | null {
  if (!env.encryptionKey) return null;
  return createHash("sha256").update(env.encryptionKey).digest();
}

export function encrypt(plain: string | null | undefined): string | null {
  if (plain == null) return null;
  const k = key();
  if (!k) return plain;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", k, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + [iv, tag, enc].map((b) => b.toString("base64url")).join(".");
}

export function decrypt(value: string | null | undefined): string | null {
  if (value == null) return null;
  if (!value.startsWith(PREFIX)) return value;
  const k = key();
  if (!k) throw new Error("ENCRYPTION_KEY missing but stored token is encrypted");
  const [ivB, tagB, encB] = value.slice(PREFIX.length).split(".");
  const decipher = createDecipheriv("aes-256-gcm", k, Buffer.from(ivB, "base64url"));
  decipher.setAuthTag(Buffer.from(tagB, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encB, "base64url")), decipher.final()]).toString("utf8");
}
