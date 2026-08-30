import { sql } from "drizzle-orm";
import { db, dbInitError } from "@/lib/db";
import { env, isConfigured } from "@/lib/env";

export type HealthState = "ok" | "warn" | "error";

export type Check = {
  label: string;
  state: HealthState;
  /** Short status, shown on the right. */
  hint: string;
  /** What to actually do about it, shown only when something is wrong. */
  fix?: string;
};

/**
 * A real check of the things that silently break a deployment, rather than a
 * list of environment variables that happen to be set. The database row in
 * particular used to report healthy unconditionally — which is worse than no
 * check at all, because it answers "is it working?" with a confident lie.
 */
export async function systemHealth(): Promise<Check[]> {
  const checks: Check[] = [];
  const hosted = Boolean(env.tursoUrl);

  // 1. Can we actually reach the database and read from it?
  let reachable = false;
  if (dbInitError) {
    // The connection could not even be constructed — almost always a malformed
    // URL, so say that rather than reporting a connection failure.
    checks.push({
      label: "Database",
      state: "error",
      hint: "address is not valid",
      fix: `${message(dbInitError)} TURSO_DATABASE_URL should start with libsql:// and have no spaces. Fix it and redeploy.`,
    });
    return [...checks, ...configChecks()];
  }

  try {
    await db.get(sql`select 1`);
    reachable = true;
    checks.push({
      label: "Database",
      state: "ok",
      hint: hosted ? "Turso, connected" : "local file, connected",
    });
  } catch (error) {
    checks.push({
      label: "Database",
      state: "error",
      hint: "cannot connect",
      fix: hosted
        ? `Check TURSO_DATABASE_URL and TURSO_AUTH_TOKEN, then redeploy. ${message(error)}`
        : `Check DATABASE_URL. ${message(error)}`,
    });
  }

  // 2. Did the schema actually get built? The app applies migrations on boot,
  //    but that is deliberately non-fatal, so it can fail quietly.
  if (reachable) {
    try {
      const row = await db.get<{ n: number }>(sql`select count(*) as n from __drizzle_migrations`);
      const applied = Number(row?.n ?? 0);
      checks.push(
        applied > 0
          ? { label: "Schema", state: "ok", hint: `${applied} migration${applied === 1 ? "" : "s"} applied` }
          : {
              label: "Schema",
              state: "error",
              hint: "not built",
              fix: "The database is reachable but empty. Redeploy — the schema is built on startup.",
            },
      );
    } catch {
      checks.push({
        label: "Schema",
        state: "error",
        hint: "not built",
        fix: "No migration record found. Redeploy — the schema is built on startup.",
      });
    }
  }

  return [...checks, ...configChecks()];
}

/** The checks that only read configuration, so they work even with no database. */
function configChecks(): Check[] {
  const checks: Check[] = [];

  // Is this deployment actually locked?
  const deployed = env.appUrl.startsWith("https://");
  checks.push(
    env.authSecret
      ? { label: "Passcode lock", state: "ok", hint: "on" }
      : {
          label: "Passcode lock",
          state: deployed ? "error" : "warn",
          hint: "off",
          fix: deployed
            ? "This deployment is open to anyone with the URL. Set AUTH_SECRET and redeploy."
            : "Fine locally. Set AUTH_SECRET before deploying.",
        },
  );

  // 4. Does the app know its own address? OAuth redirects are built from it.
  const trailingSlash = env.appUrl.endsWith("/");
  checks.push(
    deployed && !trailingSlash
      ? { label: "App address", state: "ok", hint: env.appUrl }
      : {
          label: "App address",
          state: deployed ? "warn" : "warn",
          hint: trailingSlash ? "has a trailing slash" : env.appUrl,
          fix: trailingSlash
            ? "Remove the trailing slash from APP_URL and redeploy — OAuth redirects are built from it."
            : "Set APP_URL to this deployment's full https address and redeploy. Connecting Google, Microsoft, Meta or LinkedIn will not work until you do.",
        },
  );

  // 5. Tokens are encrypted at rest with this. It must be set before, not after.
  checks.push(
    env.encryptionKey
      ? { label: "Token encryption", state: "ok", hint: "AES-256-GCM at rest" }
      : {
          label: "Token encryption",
          state: "warn",
          hint: "off",
          fix: "Set ENCRYPTION_KEY before connecting any account — tokens saved without it are stored in plain text.",
        },
  );

  checks.push(
    isConfigured.anthropic()
      ? { label: "Claude", state: "ok", hint: env.anthropicModel }
      : {
          label: "Claude",
          state: "warn",
          hint: "off",
          fix: "Set ANTHROPIC_API_KEY to turn on the brain, report drafting, import and the written brief. Everything else works without it.",
        },
  );

  checks.push(
    env.cronSecret
      ? { label: "Nightly run", state: "ok", hint: "scheduled" }
      : {
          label: "Nightly run",
          state: "warn",
          hint: "unprotected",
          fix: "Set CRON_SECRET so only the scheduler can trigger the nightly sync.",
        },
  );

  return checks;
}

/**
 * Drizzle wraps driver errors, so the top-level message is "Failed query: …"
 * and the reason you actually need — bad token, unknown host — sits in `cause`.
 * Walk the chain and report the innermost thing that says something useful.
 */
function message(error: unknown): string {
  let current: unknown = error;
  let best = "";

  for (let depth = 0; depth < 5 && current instanceof Error; depth++) {
    if (current.message && !current.message.startsWith("Failed query")) best = current.message;
    current = (current as { cause?: unknown }).cause;
  }

  const text = best || (error instanceof Error ? error.message : String(error));
  return text.slice(0, 180);
}
