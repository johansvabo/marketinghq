import {
  addDays,
  differenceInCalendarDays,
  endOfDay,
  format,
  formatDistanceToNowStrict,
  isAfter,
  isBefore,
  startOfDay,
  subDays,
} from "date-fns";

export const DAY = 86_400_000;

export const iso = (d: Date) => format(d, "yyyy-MM-dd");
export const parseIso = (s: string) => new Date(`${s}T00:00:00`);

export const today = () => startOfDay(new Date());
export const tomorrow = () => addDays(today(), 1);

export function daysUntil(d: Date | null | undefined, from = new Date()): number | null {
  if (!d) return null;
  return differenceInCalendarDays(d, from);
}

export function daysSince(d: Date | null | undefined, from = new Date()): number | null {
  if (!d) return null;
  return differenceInCalendarDays(from, d);
}

/** "in 3 days" / "2 days ago" / "today" */
export function relativeDay(d: Date | null | undefined): string {
  if (!d) return "no date";
  const n = differenceInCalendarDays(d, new Date());
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  if (n === -1) return "yesterday";
  if (n > 0 && n <= 7) return `in ${n} days`;
  if (n < 0 && n >= -7) return `${Math.abs(n)} days ago`;
  return format(d, "d MMM");
}

export function timeRange(start: Date, end: Date): string {
  return `${format(start, "HH:mm")}–${format(end, "HH:mm")}`;
}

/** Inclusive list of YYYY-MM-DD strings. */
export function dateRange(from: Date, to: Date): string[] {
  const out: string[] = [];
  for (let d = startOfDay(from); !isAfter(d, to); d = addDays(d, 1)) out.push(iso(d));
  return out;
}

/** The two windows a WoW / MoM comparison needs. */
export function comparisonWindows(days = 28, ref = new Date()) {
  const end = subDays(startOfDay(ref), 1);
  const start = subDays(end, days - 1);
  const prevEnd = subDays(start, 1);
  const prevStart = subDays(prevEnd, days - 1);
  return {
    current: { start: iso(start), end: iso(end) },
    previous: { start: iso(prevStart), end: iso(prevEnd) },
  };
}

export { addDays, endOfDay, format, formatDistanceToNowStrict, isAfter, isBefore, startOfDay, subDays };
