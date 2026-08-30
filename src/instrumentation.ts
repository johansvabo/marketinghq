/**
 * Runs once when a server instance starts, before it handles any request.
 * Used to make sure the database schema exists — see lib/db/migrate.ts.
 */
export async function register() {
  // The edge runtime has no filesystem and no database driver; skip it there.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { ensureSchema } = await import("./lib/db/migrate");

  try {
    await ensureSchema();
  } catch (error) {
    // Don't take the whole server down: a readable error page beats a boot
    // loop, and the next cold start will try again.
    console.error(
      "[marketinghq] Could not apply database migrations. The app will not work until this is fixed.\n" +
        "Check TURSO_DATABASE_URL and TURSO_AUTH_TOKEN if you are deployed, or DATABASE_URL locally.\n",
      error,
    );
  }
}
