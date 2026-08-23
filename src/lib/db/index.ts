import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { env } from "../env";
import * as schema from "./schema";

/**
 * SQLite everywhere: a local file in dev, Turso (libSQL over HTTP) in prod.
 * Same driver, same SQL, no separate dev/prod dialect to reason about.
 */
const client = createClient(
  env.tursoUrl
    ? { url: env.tursoUrl, authToken: env.tursoToken }
    : { url: env.databaseUrl },
);

export const db = drizzle(client, { schema });
export { schema };
export * from "./schema";
