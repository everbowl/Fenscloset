import { db } from "@/lib/db";
import { decrypt, encrypt, sign, verify } from "@/lib/crypto";
import { dayKey, localInstant } from "@/lib/dates";

/**
 * Google Calendar, read-only: the next event of the local day becomes the plan on Today.
 * Needs GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET in env (Railway). Until they exist, Settings says "Not set up yet".
 * MOCK_GOOGLE=true: a connected person gets a canned "Dinner" at 7:30 PM (tests).
 */

export type CalendarEvent = { summary: string; start: Date; allDay: boolean };

const SCOPES = ["https://www.googleapis.com/auth/calendar.readonly", "https://www.googleapis.com/auth/userinfo.email"];
const EVENT_TTL_MS = 10 * 60 * 1000;
/** A failed calendar read is not tried again for this long: Today loads several times a morning, and Google on a slow day was 10 to 30 s on every one of them (review D 5.1). */
const FAILURE_MEMO_MS = 10 * 60 * 1000;
/** How long one Google call may take. Short: the plan is one line on the screen, not the screen. */
const GOOGLE_TIMEOUT_MS = 6000;
const failures = new Map<string, { at: number; error: Error }>();

/** Google said the refresh token is gone (the person removed the app, or six months went by unused). */
export class GoogleAuthError extends Error {
  constructor(message: string) { super(message); this.name = "GoogleAuthError"; }
}

/**
 * A connection whose refresh token Google refused (review D 5.2). Kept as a row in WeatherCache (already the calendar's
 * cache) so no table changes: Today and Settings read it and say "Calendar needs reconnecting"; connecting again clears it.
 */
const brokenKey = (personId: string) => `gcal-broken:${personId}`;
export async function markCalendarBroken(personId: string, reason: string): Promise<void> {
  await db.weatherCache.upsert({ where: { key: brokenKey(personId) }, update: { payload: { reason }, fetchedAt: new Date() }, create: { key: brokenKey(personId), payload: { reason } } });
}
export async function calendarNeedsReconnect(personId: string): Promise<boolean> {
  const [conn, broken] = await Promise.all([db.googleCalendarConnection.findUnique({ where: { personId }, select: { personId: true } }), db.weatherCache.findUnique({ where: { key: brokenKey(personId) } })]);
  return Boolean(conn && broken);
}
async function clearCalendarCache(personId: string): Promise<void> {
  failures.delete(personId);
  await db.weatherCache.deleteMany({ where: { OR: [{ key: { startsWith: `gcal:${personId}:` } }, { key: brokenKey(personId) }] } });
}
/** Tests: forget the failures that are waiting to be retried. */
export function forgetCalendarFailures(): void { failures.clear(); }

export function isGoogleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) || process.env.MOCK_GOOGLE === "true";
}

function redirectUri(): string {
  return `${(process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "")}/api/google/callback`;
}

/** Where to send the person to connect. `state` ties the callback to them. */
export function connectUrl(personId: string): string {
  const state = sign(`${personId}:${Date.now()}`);
  const q = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID ?? "", redirect_uri: redirectUri(), response_type: "code",
    scope: SCOPES.join(" "), access_type: "offline", prompt: "consent", include_granted_scopes: "true", state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

/** The personId a callback state belongs to, or null when forged/expired (15 min). */
export function personFromState(state: string): string | null {
  const payload = verify(state);
  if (!payload) return null;
  const [personId, ts] = payload.split(":");
  if (!personId || Date.now() - Number(ts) > 15 * 60 * 1000) return null;
  return personId;
}

type TokenResponse = { access_token: string; refresh_token?: string; expires_in: number; error?: string; error_description?: string };

async function tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID ?? "", client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "", ...params }),
    signal: AbortSignal.timeout(10000),
  });
  const json = (await res.json()) as TokenResponse;
  if (json.error === "invalid_grant") throw new GoogleAuthError(`Google: ${json.error_description ?? json.error}`);
  if (!res.ok || json.error) throw new Error(`Google: ${json.error_description ?? json.error ?? res.status}`);
  return json;
}

/** Callback step: exchange the code, store the refresh token (encrypted) and the Google account email. */
export async function finishConnect(personId: string, code: string): Promise<void> {
  if (process.env.MOCK_GOOGLE === "true") {
    await db.googleCalendarConnection.upsert({ where: { personId }, update: { refreshToken: encrypt("mock"), email: "mock@example.com" }, create: { personId, refreshToken: encrypt("mock"), email: "mock@example.com" } });
    await clearCalendarCache(personId);
    return;
  }
  const tok = await tokenRequest({ code, grant_type: "authorization_code", redirect_uri: redirectUri() });
  if (!tok.refresh_token) throw new Error("Google did not return a refresh token. Remove Fen's Closet at https://myaccount.google.com/permissions and connect again.");
  let email: string | null = null;
  try {
    const me = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", { headers: { authorization: `Bearer ${tok.access_token}` }, signal: AbortSignal.timeout(8000) });
    if (me.ok) email = ((await me.json()) as { email?: string }).email ?? null;
  } catch { /* email is cosmetic */ }
  await db.googleCalendarConnection.upsert({ where: { personId }, update: { refreshToken: encrypt(tok.refresh_token), email }, create: { personId, refreshToken: encrypt(tok.refresh_token), email } });
  await clearCalendarCache(personId); // a fresh token: the "needs reconnecting" mark and the old day's events go
}

export async function getConnection(personId: string): Promise<{ email: string | null; connectedAt: Date; calendarIds: string[] } | null> {
  const c = await db.googleCalendarConnection.findUnique({ where: { personId } });
  return c ? { email: c.email, connectedAt: c.createdAt, calendarIds: c.calendarIds } : null;
}

export type CalendarChoice = { id: string; name: string; primary: boolean };

/** The person's Google calendars (for the Settings picker). Mock: Primary + Family. */
export async function listCalendars(personId: string): Promise<CalendarChoice[]> {
  const conn = await db.googleCalendarConnection.findUnique({ where: { personId } });
  if (!conn) return [];
  if (process.env.MOCK_GOOGLE === "true") return [{ id: "primary", name: "mock@example.com", primary: true }, { id: "family@group.calendar.google.com", name: "Family", primary: false }];
  const token = await accessToken(personId, conn.refreshToken);
  const res = await fetch("https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=reader&showHidden=false", { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Google Calendar: ${res.status}`);
  const json = (await res.json()) as { items?: { id: string; summary?: string; summaryOverride?: string; primary?: boolean }[] };
  return (json.items ?? []).map((c) => ({ id: c.primary ? "primary" : c.id, name: c.summaryOverride ?? c.summary ?? c.id, primary: Boolean(c.primary) }));
}

/** Q18 B: which calendars count. Empty = primary only. */
export async function setCalendarIds(personId: string, calendarIds: string[]): Promise<void> {
  const conn = await db.googleCalendarConnection.findUnique({ where: { personId } });
  if (!conn) throw new Error("Connect Google Calendar first.");
  await db.googleCalendarConnection.update({ where: { personId }, data: { calendarIds: [...new Set(calendarIds)].slice(0, 20) } });
  await db.weatherCache.deleteMany({ where: { key: { startsWith: `gcal:${personId}:` } } });
}

export async function disconnect(personId: string): Promise<void> {
  const c = await db.googleCalendarConnection.findUnique({ where: { personId } });
  if (!c) return;
  if (process.env.MOCK_GOOGLE !== "true") {
    try {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(decrypt(c.refreshToken))}`, { method: "POST", signal: AbortSignal.timeout(8000) });
    } catch { /* revoke is best-effort; the row goes either way */ }
  }
  await db.googleCalendarConnection.delete({ where: { personId } });
  await clearCalendarCache(personId);
}

/** A fresh access token; a refused refresh token marks the connection as needing a reconnect before the error goes up. */
async function accessToken(personId: string, refreshTokenEnc: string): Promise<string> {
  try {
    const tok = await tokenRequest({ refresh_token: decrypt(refreshTokenEnc), grant_type: "refresh_token" });
    return tok.access_token;
  } catch (e) {
    if (e instanceof GoogleAuthError) await markCalendarBroken(personId, e.message).catch(() => {});
    throw e;
  }
}

type GEvent = { summary?: string; status?: string; start?: { dateTime?: string; date?: string }; attendees?: { self?: boolean; responseStatus?: string }[] };
type CachedEvent = { summary: string; start: string; allDay: boolean };

/** The next timed event still ahead, else the day's all-day one (review D 5.6: "Thanksgiving" used to beat a 7:30 PM dinner). */
function pickNext(events: CalendarEvent[], now: Date): CalendarEvent | null {
  return events.find((e) => !e.allDay && e.start >= now) ?? events.find((e) => e.allDay) ?? null;
}

/**
 * The next not-declined event between `now` and the end of the local day. Cached 10 min; a failure is remembered for
 * 10 min too, and a connection Google refused answers nothing at once until it is connected again.
 */
export async function nextEventToday(personId: string, tz: string, now = new Date()): Promise<CalendarEvent | null> {
  const conn = await db.googleCalendarConnection.findUnique({ where: { personId } });
  if (!conn) return null;
  const day = dayKey(now, tz);
  if (process.env.MOCK_GOOGLE === "true") {
    const start = new Date(`${day}T19:30:00`); // local wall time in the test process
    return start > now ? { summary: "Dinner", start, allDay: false } : null;
  }
  const cacheKey = `gcal:${personId}:${day}`;
  const [hit, broken] = await Promise.all([db.weatherCache.findUnique({ where: { key: cacheKey } }), db.weatherCache.findUnique({ where: { key: brokenKey(personId) }, select: { key: true } })]);
  if (hit && Date.now() - hit.fetchedAt.getTime() < EVENT_TTL_MS) {
    return pickNext((hit.payload as CachedEvent[]).map((e) => ({ ...e, start: new Date(e.start) })), now);
  }
  if (broken) return null; // Settings and Today say "Calendar needs reconnecting"; no point asking Google again
  const failed = failures.get(personId);
  if (failed && Date.now() - failed.at < FAILURE_MEMO_MS) throw failed.error;
  let events: CalendarEvent[];
  try {
    const token = await accessToken(personId, conn.refreshToken);
    const q = new URLSearchParams({ timeMin: now.toISOString(), timeMax: new Date(now.getTime() + 36 * 3600 * 1000).toISOString(), singleEvents: "true", orderBy: "startTime", maxResults: "10", timeZone: tz });
    const calendarIds = conn.calendarIds.length ? conn.calendarIds : ["primary"];
    // Every calendar at once, not one after another (review D 5.1).
    const pages = await Promise.all(calendarIds.map(async (id) => {
      const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(id)}/events?${q}`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS) });
      if (!res.ok) throw new Error(`Google Calendar: ${res.status}`);
      return ((await res.json()) as { items?: GEvent[] }).items ?? [];
    }));
    events = pages.flat()
      .filter((e) => e.status !== "cancelled" && !(e.attendees ?? []).some((a) => a.self && a.responseStatus === "declined"))
      .flatMap((e): CalendarEvent[] => {
        const allDay = Boolean(e.start?.date && !e.start?.dateTime);
        // An all-day date is a day key, never an instant: it counts when it is today's key, and starts at local midnight (review D 5.5).
        if (allDay) return e.start!.date === day ? [{ summary: e.summary ?? "Busy", start: localInstant(day, tz, 0), allDay }] : [];
        if (!e.start?.dateTime) return [];
        const start = new Date(e.start.dateTime);
        return dayKey(start, tz) === day ? [{ summary: e.summary ?? "Busy", start, allDay }] : [];
      })
      .sort((a, b) => a.start.getTime() - b.start.getTime());
  } catch (e) {
    failures.set(personId, { at: Date.now(), error: e as Error });
    throw e;
  }
  failures.delete(personId);
  const payload: CachedEvent[] = events.map((e) => ({ ...e, start: e.start.toISOString() }));
  await Promise.all([
    db.weatherCache.upsert({ where: { key: cacheKey }, update: { payload, fetchedAt: new Date() }, create: { key: cacheKey, payload } }),
    // Yesterday's events are of no use now (review D 5.7): one row per person stays, not one per day forever.
    db.weatherCache.deleteMany({ where: { key: { startsWith: `gcal:${personId}:` }, NOT: { key: cacheKey } } }),
  ]);
  return pickNext(events, now);
}
