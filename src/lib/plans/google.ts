import { db } from "@/lib/db";
import { decrypt, encrypt, sign, verify } from "@/lib/crypto";
import { dayKey } from "@/lib/dates";

/**
 * Google Calendar, read-only: the next event of the local day becomes the plan on Today.
 * Needs GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET in env (Railway). Until they exist, Settings says "Not set up yet".
 * MOCK_GOOGLE=true: a connected person gets a canned "Dinner" at 7:30 PM (tests).
 */

export type CalendarEvent = { summary: string; start: Date; allDay: boolean };

const SCOPES = ["https://www.googleapis.com/auth/calendar.readonly", "https://www.googleapis.com/auth/userinfo.email"];
const EVENT_TTL_MS = 10 * 60 * 1000;

export function isGoogleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) || process.env.MOCK_GOOGLE === "true";
}

export function redirectUri(): string {
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
  if (!res.ok || json.error) throw new Error(`Google: ${json.error_description ?? json.error ?? res.status}`);
  return json;
}

/** Callback step: exchange the code, store the refresh token (encrypted) and the Google account email. */
export async function finishConnect(personId: string, code: string): Promise<void> {
  if (process.env.MOCK_GOOGLE === "true") {
    await db.googleCalendarConnection.upsert({ where: { personId }, update: { refreshToken: encrypt("mock"), email: "mock@example.com" }, create: { personId, refreshToken: encrypt("mock"), email: "mock@example.com" } });
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
}

export async function getConnection(personId: string): Promise<{ email: string | null; connectedAt: Date } | null> {
  const c = await db.googleCalendarConnection.findUnique({ where: { personId } });
  return c ? { email: c.email, connectedAt: c.createdAt } : null;
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
  await db.weatherCache.deleteMany({ where: { key: { startsWith: `gcal:${personId}:` } } });
}

async function accessToken(refreshTokenEnc: string): Promise<string> {
  const tok = await tokenRequest({ refresh_token: decrypt(refreshTokenEnc), grant_type: "refresh_token" });
  return tok.access_token;
}

type GEvent = { summary?: string; status?: string; start?: { dateTime?: string; date?: string }; attendees?: { self?: boolean; responseStatus?: string }[] };

/** The next not-declined event between `now` and the end of the local day. Cached 10 min. */
export async function nextEventToday(personId: string, tz: string, now = new Date()): Promise<CalendarEvent | null> {
  const conn = await db.googleCalendarConnection.findUnique({ where: { personId } });
  if (!conn) return null;
  const day = dayKey(now, tz);
  if (process.env.MOCK_GOOGLE === "true") {
    const start = new Date(`${day}T19:30:00`); // local wall time in the test process
    return start > now ? { summary: "Dinner", start, allDay: false } : null;
  }
  const cacheKey = `gcal:${personId}:${day}`;
  const hit = await db.weatherCache.findUnique({ where: { key: cacheKey } });
  if (hit && Date.now() - hit.fetchedAt.getTime() < EVENT_TTL_MS) {
    const list = hit.payload as { summary: string; start: string; allDay: boolean }[];
    const next = list.map((e) => ({ ...e, start: new Date(e.start) })).find((e) => e.allDay || e.start >= now);
    return next ?? null;
  }
  const token = await accessToken(conn.refreshToken);
  const endOfDay = new Date(now); endOfDay.setHours(23, 59, 59, 999);
  const q = new URLSearchParams({ timeMin: now.toISOString(), timeMax: new Date(now.getTime() + 36 * 3600 * 1000).toISOString(), singleEvents: "true", orderBy: "startTime", maxResults: "10", timeZone: tz });
  const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${q}`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`Google Calendar: ${res.status}`);
  const json = (await res.json()) as { items?: GEvent[] };
  const events = (json.items ?? [])
    .filter((e) => e.status !== "cancelled" && !(e.attendees ?? []).some((a) => a.self && a.responseStatus === "declined"))
    .map((e) => {
      const allDay = Boolean(e.start?.date && !e.start?.dateTime);
      const start = e.start?.dateTime ? new Date(e.start.dateTime) : new Date(`${e.start?.date}T00:00:00`);
      return { summary: e.summary ?? "Busy", start, allDay };
    })
    .filter((e) => dayKey(e.start, tz) === day || (e.allDay && e.start.toISOString().slice(0, 10) === day));
  await db.weatherCache.upsert({ where: { key: cacheKey }, update: { payload: events.map((e) => ({ ...e, start: e.start.toISOString() })), fetchedAt: new Date() }, create: { key: cacheKey, payload: events.map((e) => ({ ...e, start: e.start.toISOString() })) } });
  return events.find((e) => e.allDay || e.start >= now) ?? null;
}
