import { join } from "node:path";
import { migrate } from "drizzle-orm/libsql/migrator";
import { db } from "./index";

/**
 * Brings the database up to date with the committed migrations in ./drizzle.
 *
 * This runs automatically at server start (see src/instrumentation.ts) so that
 * deploying is a browser-only job: point the app at an empty database and it
 * builds its own schema on first boot. Without this, every deploy and every
 * schema change would need someone at a terminal running `db:push`.
 *
 * Drizzle records what it has applied in its own table, so this is cheap after
 * the first run and safe to call on every cold start.
 */
let inFlight: Promise<void> | null = null;

export function ensureSchema(): Promise<void> {
  // Single-flight per server instance: concurrent callers await the same run.
  inFlight ??= migrate(db, { migrationsFolder: join(process.cwd(), "drizzle") }).catch((error) => {
    // Clear the latch so the next cold start retries rather than caching a
    // transient database outage for the life of the instance.
    inFlight = null;
    throw error;
  });

  return inFlight;
}
