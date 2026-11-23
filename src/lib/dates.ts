/** Local-day helpers. The household time zone is a rule (`timezone`), default America/Los_Angeles. */

/** YYYY-MM-DD for `date` in `tz`. */
export function dayKey(date: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Hour of day (0–23) in `tz`. */
export function hourIn(date: Date, tz: string): number {
  const h = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hour12: false }).format(date);
  return Number(h) % 24;
}

/** `SAT, OCT 18` (Jeff, 31 Oct 2026, C1: month before day, as Americans read it). */
export function monoDate(key: string): string {
  const d = fromDayKey(key);
  const f = (o: Intl.DateTimeFormatOptions) => d.toLocaleDateString("en-US", { ...o, timeZone: "UTC" }).toUpperCase();
  return `${f({ weekday: "short" })}, ${f({ month: "short" })} ${f({ day: "numeric" })}`;
}

/** `Oct 18, 2026` for sentences and rows. */
export function prettyDate(key: string): string {
  return fromDayKey(key).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/** `OCT 2026` */
export function monoMonth(year: number, month0: number): string {
  return new Date(Date.UTC(year, month0, 1)).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" }).toUpperCase();
}

/** Parse a day key as UTC midnight (for formatting only). */
export function fromDayKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** The wall clock in `tz` at `date`, read as if it were UTC (so two of these can be subtracted for the zone's offset). */
function wallClockMs(date: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
}

/** The instant it is `hour` o'clock on day `key` in `tz` (so `dayKey(localInstant(key, tz, h), tz) === key`). */
export function localInstant(key: string, tz: string, hour = 12): Date {
  const [y, m, d] = key.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, hour);
  return new Date(guess - (wallClockMs(new Date(guess), tz) - guess));
}

/**
 * The instant a wear on day `key` is stored as: local noon in the household zone (review D 2.3/2.4). UTC midnight was the
 * previous evening in Los Angeles, so a fit saved for Saturday rested its pieces from Friday; `now` for a past day rested
 * them from today.
 */
export function wornDateToInstant(key: string, tz: string): Date {
  return localInstant(key, tz, 12);
}

export function addDays(key: string, n: number): string {
  const d = fromDayKey(key); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** A real calendar day: "2026-13-45" rolls over in Date.UTC, so the key has to come back out the same (review D 5.9). */
export function isValidDayKey(key: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
  const d = fromDayKey(key);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === key;
}

/** From this hour the screen says "tonight" and "Good evening" (one threshold for both; review D 5.11). */
export const EVENING_HOUR = 17;
export function isEvening(hour: number): boolean {
  return hour >= EVENING_HOUR;
}

/** `7:30 PM` in `tz`. */
export function clock(date: Date, tz: string): string {
  return date.toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" });
}
