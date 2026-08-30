/**
 * Central place for every environment variable the app reads.
 * Nothing here throws at import time — a missing integration key should
 * degrade that one feature, not take the whole app down.
 */

function opt(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() !== "" ? v.trim() : undefined;
}

export const env = {
  databaseUrl: opt("DATABASE_URL") ?? "file:./data/marketinghq.db",

  /*
   * Hosted-database settings, under any of the names they arrive with. Turso's
   * own docs say TURSO_DATABASE_URL, but a one-click marketplace integration may
   * inject a different name, and a libsql:// address pasted into DATABASE_URL is
   * a reasonable thing to do. Accept all of them rather than failing over a
   * label.
   */
  tursoUrl:
    opt("TURSO_DATABASE_URL") ??
    opt("TURSO_URL") ??
    opt("LIBSQL_URL") ??
    (opt("DATABASE_URL")?.startsWith("libsql://") ? opt("DATABASE_URL") : undefined),
  tursoToken: opt("TURSO_AUTH_TOKEN") ?? opt("TURSO_TOKEN") ?? opt("LIBSQL_AUTH_TOKEN"),

  appUrl: opt("APP_URL") ?? "http://localhost:3000",
  authSecret: opt("AUTH_SECRET"),
  encryptionKey: opt("ENCRYPTION_KEY"),
  ownerEmail: opt("OWNER_EMAIL"),
  cronSecret: opt("CRON_SECRET"),

  anthropicKey: opt("ANTHROPIC_API_KEY"),
  anthropicModel: opt("ANTHROPIC_MODEL") ?? "claude-opus-5",

  google: {
    clientId: opt("GOOGLE_CLIENT_ID"),
    clientSecret: opt("GOOGLE_CLIENT_SECRET"),
    adsDeveloperToken: opt("GOOGLE_ADS_DEVELOPER_TOKEN"),
    adsLoginCustomerId: opt("GOOGLE_ADS_LOGIN_CUSTOMER_ID"),
  },
  microsoft: {
    clientId: opt("MICROSOFT_CLIENT_ID"),
    clientSecret: opt("MICROSOFT_CLIENT_SECRET"),
    tenant: opt("MICROSOFT_TENANT") ?? "common",
  },
  meta: {
    appId: opt("META_APP_ID"),
    appSecret: opt("META_APP_SECRET"),
    apiVersion: opt("META_API_VERSION") ?? "v21.0",
  },
  linkedin: {
    clientId: opt("LINKEDIN_CLIENT_ID"),
    clientSecret: opt("LINKEDIN_CLIENT_SECRET"),
  },
} as const;

export const isConfigured = {
  anthropic: () => Boolean(env.anthropicKey),
  google: () => Boolean(env.google.clientId && env.google.clientSecret),
  googleAds: () => Boolean(env.google.clientId && env.google.adsDeveloperToken),
  microsoft: () => Boolean(env.microsoft.clientId && env.microsoft.clientSecret),
  meta: () => Boolean(env.meta.appId && env.meta.appSecret),
  linkedin: () => Boolean(env.linkedin.clientId && env.linkedin.clientSecret),
};
