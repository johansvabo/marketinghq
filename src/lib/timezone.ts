/**
 * Small timezone helpers built on Intl, so a weekly schedule means what the
 * person meant — "Sunday 19:00" in Oslo, not in UTC — without pulling in a
 * timezone database.
 */

export type ZonedParts = { year: number; month: number; day: number; hour: number; weekday: number };

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function zonedParts(date: Date, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    weekday: "short",
  }).formatToParts(date);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";

  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    // "24" appears at midnight in some locales; normalise it.
    hour: Number(get("hour")) % 24,
    weekday: WEEKDAYS.indexOf(get("weekday")),
  };
}

/** A stable identifier for one occurrence of a slot, e.g. "2026-08-30T19". */
export function slotKeyFor(date: Date, timeZone: string, hour: number): string {
  const p = zonedParts(date, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}T${String(hour).padStart(2, "0")}`;
}

/**
 * The most recent moment this slot came round, at or before `now`, or null if
 * it has not happened within the lookback. Scanning backwards day by day keeps
 * it correct across daylight-saving changes without any offset arithmetic.
 */
export function lastOccurrence(
  now: Date,
  timeZone: string,
  weekday: number,
  hour: number,
  lookbackDays = 8,
): { at: Date; slotKey: string } | null {
  for (let back = 0; back <= lookbackDays; back++) {
    const candidate = new Date(now.getTime() - back * 86_400_000);
    const parts = zonedParts(candidate, timeZone);
    if (parts.weekday !== weekday) continue;

    // Today counts only once the hour has actually arrived.
    if (back === 0 && parts.hour < hour) continue;

    // Roughly when the slot itself came round, rather than when we looked.
    // Used to tell whether an occurrence predates the schedule being switched
    // on, so enabling it does not retroactively run last week.
    const at = new Date(candidate.getTime() - (parts.hour - hour) * 3_600_000);

    return { at, slotKey: slotKeyFor(candidate, timeZone, hour) };
  }

  return null;
}
