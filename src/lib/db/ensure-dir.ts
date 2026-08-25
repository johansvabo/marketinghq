import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

/**
 * SQLite will not create the folder its file lives in, and `data/` is
 * gitignored — so on a fresh clone the very first command would otherwise fail
 * with "unable to open database". Make the folder before anyone asks for it.
 */
export function ensureLocalDbDir(url: string): void {
  if (!url.startsWith("file:")) return;

  const path = url.replace(/^file:/, "");
  try {
    mkdirSync(dirname(path), { recursive: true });
  } catch {
    // A read-only filesystem means a hosted database is in use anyway.
  }
}
