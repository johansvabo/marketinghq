import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { env } from "../env";
import { ensureLocalDbDir } from "./ensure-dir";
import * as schema from "./schema";

/**
 * SQLite everywhere: a local file in dev, Turso (libSQL over HTTP) in prod.
 * Same driver, same SQL, no separate dev/prod dialect to reason about.
 */
if (!env.tursoUrl) ensureLocalDbDir(env.databaseUrl);

/**
 * A malformed URL — a Turso address pasted without its `libsql://` prefix, say —
 * makes the driver throw while this module is still loading, which takes down
 * every page including the Settings screen that would have explained it. So the
 * failure is captured instead, and `db` becomes something that throws a clear
 * message only if a query is actually attempted. Settings checks this first and
 * stays readable, which is the whole point of having a diagnostics page.
 */
let client: ReturnType<typeof createClient> | null = null;
let initError: Error | null = null;

try {
  client = createClient(
    env.tursoUrl ? { url: env.tursoUrl, authToken: env.tursoToken } : { url: env.databaseUrl },
  );
} catch (error) {
  initError = error instanceof Error ? error : new Error(String(error));
}

export const dbInitError = initError;

export const db = client
  ? drizzle(client, { schema })
  : (new Proxy({} as ReturnType<typeof drizzle>, {
      get() {
        throw new Error(
          `The database connection could not be created: ${initError?.message ?? "unknown error"}. ` +
            `Check TURSO_DATABASE_URL — it should start with libsql://`,
        );
      },
    }) as ReturnType<typeof drizzle>);
export { schema };
export * from "./schema";
