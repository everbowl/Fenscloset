/** Local-day helpers. The household time zone is a rule (`timezone`), default America/Los_Angeles. */

export const DEFAULT_TZ = "America/Los_Angeles";

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

/** `SAT 18 OCT` */
export function monoDate(key: string): string {
  const d = fromDayKey(key);
  const f = (o: Intl.DateTimeFormatOptions) => d.toLocaleDateString("en-US", { ...o, timeZone: "UTC" }).toUpperCase();
  return `${f({ weekday: "short" })} ${f({ day: "2-digit" })} ${f({ month: "short" })}`;
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

export function addDays(key: string, n: number): string {
  const d = fromDayKey(key); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function isValidDayKey(key: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(key) && !Number.isNaN(fromDayKey(key).getTime());
}

/** `7:30 PM` in `tz`. */
export function clock(date: Date, tz: string): string {
  return date.toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" });
}
