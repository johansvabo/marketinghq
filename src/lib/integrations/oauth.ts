import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { connections, type Connection } from "@/lib/db/schema";
import { decrypt, encrypt } from "@/lib/crypto";
import { env, isConfigured } from "@/lib/env";

export type ProviderId = "google" | "microsoft" | "meta" | "linkedin";

export type ProviderSpec = {
  id: ProviderId;
  label: string;
  /** What this connection unlocks, in the user's terms. */
  blurb: string;
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string[];
  configured: () => boolean;
  extraAuthParams?: Record<string, string>;
};

export const PROVIDERS: Record<ProviderId, ProviderSpec> = {
  google: {
    id: "google",
    label: "Google",
    blurb: "Gmail, Google Calendar, GA4 and Google Ads — one connection covers all four.",
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: [
      "openid",
      "email",
      "profile",
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/calendar.readonly",
      "https://www.googleapis.com/auth/analytics.readonly",
      "https://www.googleapis.com/auth/adwords",
    ],
    configured: isConfigured.google,
    // offline + consent is what actually gets you a refresh token back.
    extraAuthParams: { access_type: "offline", prompt: "consent", include_granted_scopes: "true" },
  },
  microsoft: {
    id: "microsoft",
    label: "Microsoft",
    blurb: "Outlook mail and calendar via Microsoft Graph.",
    authorizeUrl: `https://login.microsoftonline.com/${env.microsoft.tenant}/oauth2/v2.0/authorize`,
    tokenUrl: `https://login.microsoftonline.com/${env.microsoft.tenant}/oauth2/v2.0/token`,
    scopes: ["offline_access", "openid", "email", "profile", "Mail.Read", "Calendars.Read", "User.Read"],
    configured: isConfigured.microsoft,
  },
  meta: {
    id: "meta",
    label: "Meta",
    blurb: "Meta Ads spend, reach and conversions from the Marketing API.",
    authorizeUrl: `https://www.facebook.com/${env.meta.apiVersion}/dialog/oauth`,
    tokenUrl: `https://graph.facebook.com/${env.meta.apiVersion}/oauth/access_token`,
    scopes: ["ads_read", "business_management"],
    configured: isConfigured.meta,
  },
  linkedin: {
    id: "linkedin",
    label: "LinkedIn",
    blurb: "LinkedIn Ads campaign analytics.",
    authorizeUrl: "https://www.linkedin.com/oauth/v2/authorization",
    tokenUrl: "https://www.linkedin.com/oauth/v2/accessToken",
    scopes: ["r_ads", "r_ads_reporting", "r_basicprofile"],
    configured: isConfigured.linkedin,
  },
};

function credentials(provider: ProviderId): { id: string; secret: string } {
  switch (provider) {
    case "google":
      return { id: env.google.clientId!, secret: env.google.clientSecret! };
    case "microsoft":
      return { id: env.microsoft.clientId!, secret: env.microsoft.clientSecret! };
    case "meta":
      return { id: env.meta.appId!, secret: env.meta.appSecret! };
    case "linkedin":
      return { id: env.linkedin.clientId!, secret: env.linkedin.clientSecret! };
  }
}

export function redirectUri(provider: ProviderId): string {
  return `${env.appUrl}/api/connect/${provider}/callback`;
}

export function authorizeUrl(provider: ProviderId, state: string): string {
  const spec = PROVIDERS[provider];
  if (!spec.configured()) throw new Error(`${spec.label} is not configured — add its client id and secret to your environment first.`);

  const params = new URLSearchParams({
    client_id: credentials(provider).id,
    redirect_uri: redirectUri(provider),
    response_type: "code",
    scope: spec.scopes.join(provider === "linkedin" || provider === "meta" ? "," : " "),
    state,
    ...(spec.extraAuthParams ?? {}),
  });

  return `${spec.authorizeUrl}?${params.toString()}`;
}

export type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  id_token?: string;
};

export async function exchangeCode(provider: ProviderId, code: string): Promise<TokenResponse> {
  const spec = PROVIDERS[provider];
  const creds = credentials(provider);

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(provider),
    client_id: creds.id,
    client_secret: creds.secret,
  });

  const res = await fetch(spec.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body,
  });

  if (!res.ok) throw new Error(`${spec.label} token exchange failed (${res.status}): ${await res.text()}`);
  return (await res.json()) as TokenResponse;
}

async function refresh(connection: Connection): Promise<string> {
  const spec = PROVIDERS[connection.provider as ProviderId];
  const creds = credentials(connection.provider as ProviderId);
  const refreshToken = decrypt(connection.refreshToken);

  if (!refreshToken) {
    await markNeedsReauth(connection.id, "No refresh token stored — reconnect this account.");
    throw new Error(`${spec.label} needs reconnecting.`);
  }

  const res = await fetch(spec.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: creds.id,
      client_secret: creds.secret,
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    await markNeedsReauth(connection.id, `Refresh failed (${res.status}): ${detail.slice(0, 300)}`);
    throw new Error(`${spec.label} refresh failed — reconnect the account.`);
  }

  const token = (await res.json()) as TokenResponse;
  await db
    .update(connections)
    .set({
      accessToken: encrypt(token.access_token),
      // Providers that rotate refresh tokens send a new one; keep the old otherwise.
      refreshToken: token.refresh_token ? encrypt(token.refresh_token) : connection.refreshToken,
      expiresAt: token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : null,
      status: "connected",
      lastError: null,
    })
    .where(eq(connections.id, connection.id));

  return token.access_token;
}

/** A valid access token for this connection, refreshing it if it is about to expire. */
export async function accessTokenFor(connection: Connection): Promise<string> {
  const expiringSoon = connection.expiresAt && connection.expiresAt.getTime() - Date.now() < 120_000;
  if (expiringSoon && connection.refreshToken) return refresh(connection);

  const token = decrypt(connection.accessToken);
  if (!token) throw new Error(`${connection.provider} connection has no access token — reconnect it.`);
  return token;
}

export async function markNeedsReauth(connectionId: string, message: string) {
  await db.update(connections).set({ status: "needs_reauth", lastError: message }).where(eq(connections.id, connectionId));
}

export async function markSynced(connectionId: string, error?: string) {
  await db
    .update(connections)
    .set({ lastSyncedAt: new Date(), lastError: error ?? null, status: error ? "error" : "connected" })
    .where(eq(connections.id, connectionId));
}

export async function saveConnection(opts: {
  userId: string;
  provider: ProviderId;
  externalId: string;
  displayName?: string;
  token: TokenResponse;
  config?: Record<string, unknown>;
}) {
  const values = {
    userId: opts.userId,
    provider: opts.provider,
    externalId: opts.externalId,
    displayName: opts.displayName,
    accessToken: encrypt(opts.token.access_token),
    refreshToken: encrypt(opts.token.refresh_token ?? null),
    expiresAt: opts.token.expires_in ? new Date(Date.now() + opts.token.expires_in * 1000) : null,
    scopes: opts.token.scope,
    config: opts.config,
    status: "connected" as const,
    lastError: null,
  };

  await db
    .insert(connections)
    .values(values)
    .onConflictDoUpdate({
      target: [connections.provider, connections.externalId],
      // A reconnect that comes back without a refresh token must not wipe the one we have.
      set: { ...values, refreshToken: values.refreshToken ?? undefined },
    });
}
