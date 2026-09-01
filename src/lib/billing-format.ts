/**
 * Money and hours formatting, plus the shape a month summary takes.
 *
 * In a file with no imports, because the browser needs these too and the
 * calculation module they used to live in reaches the database — which drags
 * node:fs into the client bundle, where it cannot exist.
 */

export type MonthSummary = {
  month: string; // YYYY-MM
  hours: number;
  billableHours: number;
  value: number;
  currency: string;
  basis: "retainer" | "hourly" | "none";
};

export const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

export function monthBounds(month: string): { start: string; end: string } {
  const [year, m] = month.split("-").map(Number);
  const last = new Date(year, m, 0).getDate();
  return { start: `${month}-01`, end: `${month}-${String(last).padStart(2, "0")}` };
}

export function formatMoney(value: number, currency: string): string {
  return `${currency} ${Math.round(value).toLocaleString("nb-NO")}`;
}

export const formatHours = (hours: number) =>
  Number.isInteger(hours) ? `${hours}t` : `${hours.toFixed(1).replace(".", ",")}t`;
