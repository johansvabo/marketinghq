import { db } from "@/lib/db";
import { metrics, type Connection } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { iso, subDays } from "@/lib/dates";
import { accessTokenFor } from "./oauth";

/* --------------------------------------------------------------- meta ads */

type MetaInsight = {
  date_start: string;
  campaign_id?: string;
  campaign_name?: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
  reach?: string;
  actions?: { action_type: string; value: string }[];
  action_values?: { action_type: string; value: string }[];
};

/** Meta reports conversions as a list of action types; these are the ones that matter. */
const CONVERSION_ACTIONS = new Set([
  "offsite_conversion.fb_pixel_purchase",
  "offsite_conversion.fb_pixel_lead",
  "lead",
  "purchase",
  "onsite_conversion.lead_grouped",
  "omni_purchase",
]);

function sumActions(actions: MetaInsight["actions"]): number {
  return (actions ?? []).filter((a) => CONVERSION_ACTIONS.has(a.action_type)).reduce((sum, a) => sum + Number(a.value ?? 0), 0);
}

export async function syncMetaAds(connection: Connection, opts: { days?: number } = {}): Promise<number> {
  const token = await accessTokenFor(connection);
  const adAccountId = String((connection.config?.adAccountId as string) ?? connection.externalId);
  const account = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;
  const clientId = (connection.config?.clientId as string) ?? null;

  const since = iso(subDays(new Date(), opts.days ?? 30));
  const until = iso(subDays(new Date(), 1));

  const params = new URLSearchParams({
    access_token: token,
    level: "campaign",
    time_increment: "1",
    time_range: JSON.stringify({ since, until }),
    fields: "campaign_id,campaign_name,spend,impressions,clicks,reach,actions,action_values",
    limit: "500",
  });

  let url = `https://graph.facebook.com/${env.meta.apiVersion}/${account}/insights?${params}`;
  let written = 0;

  // Meta paginates; follow next until it stops or we have plenty.
  for (let page = 0; page < 10 && url; page++) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Meta Marketing API ${res.status}: ${(await res.text()).slice(0, 400)}`);
    const body = (await res.json()) as { data: MetaInsight[]; paging?: { next?: string } };

    for (const row of body.data) {
      const values: Record<string, number> = {
        spend: Number(row.spend ?? 0),
        impressions: Number(row.impressions ?? 0),
        clicks: Number(row.clicks ?? 0),
        reach: Number(row.reach ?? 0),
        conversions: sumActions(row.actions),
        revenue: sumActions(row.action_values as MetaInsight["actions"]),
      };

      for (const [metric, value] of Object.entries(values)) {
        if (value === 0 && metric === "revenue") continue;
        await db
          .insert(metrics)
          .values({
            connectionId: connection.id,
            clientId,
            source: "meta",
            date: row.date_start,
            entityType: "campaign",
            entityId: `${account}:${row.campaign_id ?? "account"}`,
            entityName: row.campaign_name ?? "All campaigns",
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

    url = body.paging?.next ?? "";
  }

  return written;
}

/* ----------------------------------------------------------- linkedin ads */

type LinkedInElement = {
  dateRange: { start: { year: number; month: number; day: number } };
  costInLocalCurrency?: string;
  impressions?: number;
  clicks?: number;
  externalWebsiteConversions?: number;
  oneClickLeads?: number;
  pivotValues?: string[];
};

export async function syncLinkedInAds(connection: Connection, opts: { days?: number } = {}): Promise<number> {
  const token = await accessTokenFor(connection);
  const accountId = String((connection.config?.adAccountId as string) ?? connection.externalId).replace(/\D/g, "");
  const clientId = (connection.config?.clientId as string) ?? null;

  const start = subDays(new Date(), opts.days ?? 30);
  const end = subDays(new Date(), 1);

  const params = new URLSearchParams({
    q: "analytics",
    pivot: "CAMPAIGN",
    timeGranularity: "DAILY",
    "dateRange.start.year": String(start.getFullYear()),
    "dateRange.start.month": String(start.getMonth() + 1),
    "dateRange.start.day": String(start.getDate()),
    "dateRange.end.year": String(end.getFullYear()),
    "dateRange.end.month": String(end.getMonth() + 1),
    "dateRange.end.day": String(end.getDate()),
    accounts: `List(urn%3Ali%3AsponsoredAccount%3A${accountId})`,
    fields: "dateRange,costInLocalCurrency,impressions,clicks,externalWebsiteConversions,oneClickLeads,pivotValues",
  });

  const res = await fetch(`https://api.linkedin.com/rest/adAnalytics?${params.toString()}`, {
    headers: {
      authorization: `Bearer ${token}`,
      "LinkedIn-Version": "202409",
      "X-Restli-Protocol-Version": "2.0.0",
    },
  });

  if (!res.ok) throw new Error(`LinkedIn Ads API ${res.status}: ${(await res.text()).slice(0, 400)}`);
  const body = (await res.json()) as { elements: LinkedInElement[] };

  let written = 0;

  for (const row of body.elements) {
    const d = row.dateRange.start;
    const date = `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
    const campaignUrn = row.pivotValues?.[0] ?? "account";

    const values: Record<string, number> = {
      spend: Number(row.costInLocalCurrency ?? 0),
      impressions: Number(row.impressions ?? 0),
      clicks: Number(row.clicks ?? 0),
      conversions: Number(row.externalWebsiteConversions ?? 0) + Number(row.oneClickLeads ?? 0),
    };

    for (const [metric, value] of Object.entries(values)) {
      await db
        .insert(metrics)
        .values({
          connectionId: connection.id,
          clientId,
          source: "linkedin",
          date,
          entityType: "campaign",
          entityId: `${accountId}:${campaignUrn.split(":").pop()}`,
          entityName: campaignUrn.split(":").pop(),
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

  return written;
}
