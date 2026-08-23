import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { calendarEvents, connections, messages, metrics, type Connection } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { addDays, iso, subDays } from "@/lib/dates";
import { accessTokenFor } from "./oauth";
import { ClientMatcher, GENERIC_DOMAINS } from "./attribution";

async function googleFetch(connection: Connection, url: string, init?: RequestInit) {
  const token = await accessTokenFor(connection);
  const res = await fetch(url, {
    ...init,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`Google API ${res.status} on ${new URL(url).pathname}: ${(await res.text()).slice(0, 400)}`);
  return res.json();
}

/* -------------------------------------------------------------------- gmail */

type GmailHeader = { name: string; value: string };

function header(headers: GmailHeader[], name: string): string | undefined {
  return headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value;
}

function parseAddress(raw?: string): { name?: string; email: string } | null {
  if (!raw) return null;
  const match = raw.match(/^\s*"?([^"<]*)"?\s*<([^>]+)>\s*$/);
  if (match) return { name: match[1].trim() || undefined, email: match[2].trim().toLowerCase() };
  const bare = raw.trim().toLowerCase();
  return bare.includes("@") ? { email: bare } : null;
}

/**
 * Pulls recent inbox threads. We only keep headers and the snippet — enough to
 * triage and to spot an unanswered ask, without warehousing the mailbox.
 */
export async function syncGmail(connection: Connection, opts: { days?: number } = {}): Promise<number> {
  const days = opts.days ?? 14;
  const matcher = await ClientMatcher.load();
  const ownEmail = connection.externalId.toLowerCase();

  const query = encodeURIComponent(`in:inbox newer_than:${days}d -category:promotions -category:social`);
  const list = (await googleFetch(
    connection,
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=100&q=${query}`,
  )) as { messages?: { id: string; threadId: string }[] };

  if (!list.messages?.length) return 0;

  // Which threads did we already reply to? Those are not awaiting anything.
  const sent = (await googleFetch(
    connection,
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=100&q=${encodeURIComponent(`in:sent newer_than:${days}d`)}`,
  )) as { messages?: { id: string; threadId: string }[] };
  const repliedThreads = new Set((sent.messages ?? []).map((m) => m.threadId));

  let written = 0;

  for (const ref of list.messages.slice(0, 80)) {
    const detail = (await googleFetch(
      connection,
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${ref.id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`,
    )) as {
      id: string;
      threadId: string;
      snippet: string;
      internalDate: string;
      payload: { headers: GmailHeader[] };
    };

    const headers = detail.payload?.headers ?? [];
    const from = parseAddress(header(headers, "From"));
    const to = (header(headers, "To") ?? "")
      .split(",")
      .map((part) => parseAddress(part)?.email)
      .filter((e): e is string => Boolean(e));

    const isFromMe = from?.email === ownEmail;
    const client = matcher.match({
      emails: [from?.email, ...to].filter((e) => e && !GENERIC_DOMAINS.has(e.split("@")[1] ?? "")),
      text: header(headers, "Subject"),
    });

    await db
      .insert(messages)
      .values({
        connectionId: connection.id,
        clientId: client?.id ?? null,
        provider: "gmail",
        externalId: detail.id,
        threadId: detail.threadId,
        subject: header(headers, "Subject") ?? "(no subject)",
        fromName: from?.name,
        fromEmail: from?.email,
        toEmails: to,
        snippet: detail.snippet,
        receivedAt: new Date(Number(detail.internalDate)),
        isFromMe,
        awaitingReply: !isFromMe && !repliedThreads.has(detail.threadId),
      })
      .onConflictDoUpdate({
        target: [messages.provider, messages.externalId],
        set: { awaitingReply: !isFromMe && !repliedThreads.has(detail.threadId), clientId: client?.id ?? null },
      });

    written++;
  }

  return written;
}

/* ----------------------------------------------------------------- calendar */

export async function syncGoogleCalendar(connection: Connection, opts: { past?: number; ahead?: number } = {}): Promise<number> {
  const matcher = await ClientMatcher.load();
  const ownDomain = connection.externalId.split("@")[1]?.toLowerCase() ?? "";
  const timeMin = subDays(new Date(), opts.past ?? 14).toISOString();
  const timeMax = addDays(new Date(), opts.ahead ?? 45).toISOString();

  const data = (await googleFetch(
    connection,
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?singleEvents=true&orderBy=startTime&maxResults=250&timeMin=${encodeURIComponent(
      timeMin,
    )}&timeMax=${encodeURIComponent(timeMax)}`,
  )) as {
    items?: {
      id: string;
      summary?: string;
      description?: string;
      location?: string;
      status?: string;
      start: { dateTime?: string; date?: string };
      end: { dateTime?: string; date?: string };
      organizer?: { email?: string };
      attendees?: { email: string; displayName?: string; responseStatus?: string; self?: boolean }[];
    }[];
  };

  let written = 0;

  for (const item of data.items ?? []) {
    if (item.status === "cancelled") continue;

    const isAllDay = Boolean(item.start.date);
    const startsAt = new Date(item.start.dateTime ?? `${item.start.date}T00:00:00`);
    const endsAt = new Date(item.end.dateTime ?? `${item.end.date}T23:59:59`);

    const attendees = (item.attendees ?? [])
      .filter((a) => !a.self)
      .map((a) => ({ name: a.displayName, email: a.email.toLowerCase() }));

    // "External" is what earns a meeting prep and follow-up treatment.
    const isExternal = attendees.some((a) => {
      const domain = a.email.split("@")[1] ?? "";
      return domain !== ownDomain && !GENERIC_DOMAINS.has(domain);
    });

    const client = matcher.match({ emails: attendees.map((a) => a.email), text: item.summary });

    await db
      .insert(calendarEvents)
      .values({
        connectionId: connection.id,
        clientId: client?.id ?? null,
        provider: "google",
        externalId: item.id,
        title: item.summary ?? "(untitled)",
        description: item.description?.slice(0, 2000),
        location: item.location,
        startsAt,
        endsAt,
        isAllDay,
        attendees,
        organizerEmail: item.organizer?.email?.toLowerCase(),
        isExternal,
      })
      .onConflictDoUpdate({
        target: [calendarEvents.provider, calendarEvents.externalId],
        set: { title: item.summary ?? "(untitled)", startsAt, endsAt, attendees, isExternal, clientId: client?.id ?? null },
      });

    written++;
  }

  return written;
}

/* ---------------------------------------------------------------------- ga4 */

const GA4_METRICS = ["sessions", "activeUsers", "conversions", "totalRevenue", "engagementRate"];

const GA4_METRIC_NAMES: Record<string, string> = {
  sessions: "sessions",
  activeUsers: "users",
  conversions: "conversions",
  totalRevenue: "revenue",
  engagementRate: "engagement_rate",
};

export async function syncGa4(connection: Connection, opts: { days?: number } = {}): Promise<number> {
  const accounts = (connection.config?.accounts ?? []).filter((a) => a.kind === "ga4");
  if (accounts.length === 0) return 0;

  let total = 0;
  for (const account of accounts) total += await syncGa4Property(connection, account.accountId, account.clientId, opts.days ?? 90);
  return total;
}

async function syncGa4Property(connection: Connection, propertyId: string, clientId: string, days: number): Promise<number> {
  const body = {
    dateRanges: [{ startDate: `${days}daysAgo`, endDate: "yesterday" }],
    dimensions: [{ name: "date" }, { name: "sessionDefaultChannelGroup" }],
    metrics: GA4_METRICS.map((name) => ({ name })),
    limit: 10_000,
  };

  const data = (await googleFetch(
    connection,
    `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId.replace(/^properties\//, "")}:runReport`,
    { method: "POST", body: JSON.stringify(body) },
  )) as {
    rows?: { dimensionValues: { value: string }[]; metricValues: { value: string }[] }[];
  };

  let written = 0;

  for (const row of data.rows ?? []) {
    const raw = row.dimensionValues[0].value; // YYYYMMDD
    const date = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
    const channel = row.dimensionValues[1].value;

    for (const [index, metricName] of GA4_METRICS.entries()) {
      const value = Number(row.metricValues[index]?.value ?? 0);
      if (!Number.isFinite(value)) continue;

      await db
        .insert(metrics)
        .values({
          connectionId: connection.id,
          clientId,
          source: "ga4",
          date,
          entityType: "channel",
          entityId: `${propertyId}:${channel}`,
          entityName: channel,
          metric: GA4_METRIC_NAMES[metricName],
          value,
        })
        .onConflictDoUpdate({
          target: [metrics.source, metrics.date, metrics.entityId, metrics.metric],
          set: { value },
        });
      written++;
    }
  }

  return written;
}

/* -------------------------------------------------------------- google ads */

const GAQL = `
  SELECT segments.date, campaign.id, campaign.name,
         metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions,
         metrics.conversions_value
  FROM campaign
  WHERE segments.date DURING LAST_30_DAYS
`;

export async function syncGoogleAds(connection: Connection): Promise<number> {
  const accounts = (connection.config?.accounts ?? []).filter((a) => a.kind === "google_ads");
  if (accounts.length === 0) return 0;
  if (!env.google.adsDeveloperToken) throw new Error("GOOGLE_ADS_DEVELOPER_TOKEN is not set.");

  let total = 0;
  for (const account of accounts) total += await syncAdsCustomer(connection, account.accountId, account.clientId);
  return total;
}

async function syncAdsCustomer(connection: Connection, rawCustomerId: string, clientId: string): Promise<number> {
  const developerToken = env.google.adsDeveloperToken;
  if (!developerToken) throw new Error("GOOGLE_ADS_DEVELOPER_TOKEN is not set.");

  const customerId = rawCustomerId.replace(/-/g, "");
  const token = await accessTokenFor(connection);

  const res = await fetch(`https://googleads.googleapis.com/v18/customers/${customerId}/googleAds:searchStream`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "developer-token": developerToken,
      ...(env.google.adsLoginCustomerId ? { "login-customer-id": env.google.adsLoginCustomerId.replace(/-/g, "") } : {}),
      "content-type": "application/json",
    },
    body: JSON.stringify({ query: GAQL }),
  });

  if (!res.ok) throw new Error(`Google Ads ${res.status}: ${(await res.text()).slice(0, 400)}`);

  const batches = (await res.json()) as {
    results?: {
      segments: { date: string };
      campaign: { id: string; name: string };
      metrics: { costMicros?: string; impressions?: string; clicks?: string; conversions?: number; conversionsValue?: number };
    }[];
  }[];

  let written = 0;

  for (const batch of batches) {
    for (const row of batch.results ?? []) {
      const values: Record<string, number> = {
        spend: Number(row.metrics.costMicros ?? 0) / 1_000_000,
        impressions: Number(row.metrics.impressions ?? 0),
        clicks: Number(row.metrics.clicks ?? 0),
        conversions: Number(row.metrics.conversions ?? 0),
        revenue: Number(row.metrics.conversionsValue ?? 0),
      };

      for (const [metric, value] of Object.entries(values)) {
        await db
          .insert(metrics)
          .values({
            connectionId: connection.id,
            clientId,
            source: "google_ads",
            date: row.segments.date,
            entityType: "campaign",
            entityId: `${customerId}:${row.campaign.id}`,
            entityName: row.campaign.name,
            metric,
            value,
          })
          .onConflictDoUpdate({
            target: [metrics.source, metrics.date, metrics.entityId, metrics.metric],
            set: { value },
          });
        written++;
      }
    }
  }

  return written;
}

/** The email address on the Google account, used as the connection's identity. */
export async function googleIdentity(accessToken: string): Promise<{ email: string; name?: string }> {
  const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Could not read Google profile (${res.status}).`);
  const data = (await res.json()) as { email: string; name?: string };
  return data;
}
