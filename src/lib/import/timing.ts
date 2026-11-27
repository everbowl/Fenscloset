/** How long a piece may say "a few seconds" before the screen admits it is taking long and offers Try again (review B A2.5, F2). */
export const TAKING_LONG_MS = 60_000;

/** True once `since` (an ISO time) is more than TAKING_LONG_MS ago. */
export function isTakingLong(since: string | null | undefined, now = Date.now()): boolean {
  if (!since) return false;
  const t = new Date(since).getTime();
  return Number.isFinite(t) && now - t > TAKING_LONG_MS;
}
