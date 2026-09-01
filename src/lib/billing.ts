import { and, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { clients, timeEntries, type Client } from "@/lib/db/schema";
import { monthBounds, monthKey, type MonthSummary } from "@/lib/billing-format";

/**
 * What a client is worth in a given month.
 *
 * A retainer is a stated number. Hourly work is only worth what was actually
 * logged, so it is computed rather than assumed — a figure that quietly
 * overstates what you earned is worse than no figure at all.
 */
export async function clientMonth(client: Client, month = monthKey(new Date())): Promise<MonthSummary> {
  const { start, end } = monthBounds(month);

  const [row] = await db
    .select({
      hours: sql<number>`coalesce(sum(${timeEntries.hours}), 0)`,
      billable: sql<number>`coalesce(sum(case when ${timeEntries.billable} then ${timeEntries.hours} else 0 end), 0)`,
    })
    .from(timeEntries)
    .where(and(eq(timeEntries.clientId, client.id), gte(timeEntries.date, start), lte(timeEntries.date, end)));

  const hours = Number(row?.hours ?? 0);
  const billableHours = Number(row?.billable ?? 0);

  if (client.billingModel === "hourly") {
    return {
      month,
      hours,
      billableHours,
      value: client.hourlyRate ? billableHours * client.hourlyRate : 0,
      currency: client.currency,
      basis: client.hourlyRate ? "hourly" : "none",
    };
  }

  return {
    month,
    hours,
    billableHours,
    value: client.monthlyValue ?? 0,
    currency: client.currency,
    basis: client.monthlyValue ? "retainer" : "none",
  };
}

/** Every active client's month, for the practice-wide view. */
/** Month summaries for a set of clients, keyed by id. */
export async function monthByClient(rows: Client[], month = monthKey(new Date())) {
  const summaries = await Promise.all(rows.map((client) => clientMonth(client, month)));
  return new Map(rows.map((client, i) => [client.id, summaries[i]]));
}

/** Day-by-day entries for a client in a month, newest first. */
export async function clientEntries(clientId: string, month: string) {
  const { start, end } = monthBounds(month);
  return db
    .select()
    .from(timeEntries)
    .where(and(eq(timeEntries.clientId, clientId), gte(timeEntries.date, start), lte(timeEntries.date, end)))
    .orderBy(sql`${timeEntries.date} desc`);
}

export { formatHours, formatMoney, monthBounds, monthKey, type MonthSummary } from "@/lib/billing-format";
