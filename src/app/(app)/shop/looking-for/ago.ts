/** "just now", "12 min ago", "3h ago", "yesterday", "4 days ago": for "last checked" lines. */
export function ago(date: Date | string | null | undefined, now = Date.now()): string {
  if (!date) return "not yet";
  const t = typeof date === "string" ? new Date(date).getTime() : date.getTime();
  const m = Math.max(0, Math.round((now - t) / 60_000));
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}
