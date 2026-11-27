/**
 * A small brake on sign-in and reset requests (review A S1): five tries in fifteen minutes for one address from one
 * network, then a wait. It lives in the process, so a restart clears it; that is enough for a family site on one server,
 * and it keeps a stranger from guessing the four-digit DEV password.
 */
const WINDOW_MS = 15 * 60 * 1000;
export const MAX_TRIES = 5;

type Entry = { count: number; first: number };
const tries = new Map<string, Entry>();

/** The caller's address as the proxy reports it; "local" when nothing reports one (tests, a direct connection). */
export function clientIp(headers: { get(name: string): string | null }): string {
  const fwd = headers.get("x-forwarded-for");
  return (fwd ? fwd.split(",")[0].trim() : headers.get("x-real-ip")) || "local";
}

export function rateLimitKey(ip: string, email: string): string {
  return `${ip}|${email.trim().toLowerCase()}`;
}

function prune(now: number) {
  for (const [k, e] of tries) if (now - e.first > WINDOW_MS) tries.delete(k);
}

/** May this key try again? When not, how many minutes until the count resets. */
export function checkRateLimit(key: string): { ok: true } | { ok: false; minutesLeft: number } {
  const now = Date.now();
  prune(now);
  const e = tries.get(key);
  if (!e || e.count < MAX_TRIES) return { ok: true };
  return { ok: false, minutesLeft: Math.max(1, Math.ceil((e.first + WINDOW_MS - now) / 60_000)) };
}

/** One more failed try for this key. */
export function noteFailure(key: string): void {
  const now = Date.now();
  const e = tries.get(key);
  if (!e || now - e.first > WINDOW_MS) tries.set(key, { count: 1, first: now });
  else e.count += 1;
}

/** A success clears the count. */
export function clearRateLimit(key: string): void {
  tries.delete(key);
}

/** The words for a refused try. */
export function rateLimitMessage(minutesLeft: number): string {
  return `Too many tries. Wait ${minutesLeft} minute${minutesLeft === 1 ? "" : "s"} and try again; the count resets on its own.`;
}

/** Tests only. */
export function resetRateLimits(): void {
  tries.clear();
}
