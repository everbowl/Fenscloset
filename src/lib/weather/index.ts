import { db } from "@/lib/db";
import { clock, dayKey, hourIn } from "@/lib/dates";

/**
 * Weather for the Today screen. Open-Meteo (no key) for the forecast, Zippopotam.us (no key) for zip → lat/lon.
 * Both are cached in WeatherCache: zip lookups forever, forecasts for an hour.
 * MOCK_WEATHER=true returns a fixed clear 68° → 61° day (tests, local dev without network).
 */

export type Coords = { lat: number; lon: number; place?: string };

export type Weather = {
  nowF: number;
  tonightF: number;
  highF: number;
  lowF: number;
  rainChance: number; // 0–100, max over the rest of today
  condition: string; // "Clear", "Rain", …
  timezone: string;
  source: "open-meteo" | "mock";
  /** When the forecast was fetched (ISO), so a screen can say "as of 9 AM" when it is an old one standing in (review D 5.3). */
  fetchedAt?: string;
  /** The service failed and this is the last good forecast, past its hour. */
  stale?: boolean;
};

export class WeatherError extends Error {
  constructor(message: string, public readonly code: "bad_zip" | "unavailable") {
    super(message);
    this.name = "WeatherError";
  }
}

const FORECAST_TTL_MS = 60 * 60 * 1000;

function isMockWeather(): boolean {
  return process.env.MOCK_WEATHER === "true";
}

/** WMO weather code → a plain word (status is words, never color). */
export function conditionWord(code: number): string {
  if (code === 0) return "Clear";
  if (code <= 2) return "Partly cloudy";
  if (code === 3) return "Cloudy";
  if (code <= 48) return "Fog";
  if (code <= 57) return "Drizzle";
  if (code <= 67) return "Rain";
  if (code <= 77) return "Snow";
  if (code <= 82) return "Showers";
  if (code <= 86) return "Snow showers";
  return "Thunderstorm";
}

/** A failed lookup is not tried again for a short while: Today renders several times at once, and each render would hit the service again. */
const RETRY_AFTER_MS = 2 * 60 * 1000;
/**
 * When the service is down, a forecast this old still beats "Weather is unavailable" on Today (Railway sees Open-Meteo time
 * out now and then). Six hours, not a day (review D 5.3): past that the numbers are a different day's and the screen says
 * the weather did not load instead.
 */
const STALE_OK_MS = 6 * 60 * 60 * 1000;
const failures = new Map<string, { at: number; error: Error }>();

type Cached<T> = { payload: T; fetchedAt: Date; stale: boolean };

/**
 * `fetcher` is told whether an older answer is in hand: with one, it must give up fast (Today waits for this before it
 * renders; 20 Nov 2026 a Today load took 17 s on two 8 s timeouts in a row while a 94-minute-old forecast sat in the cache).
 * The answer carries when it was fetched and whether it is an old one standing in for a failed call.
 */
async function cached<T>(key: string, ttlMs: number | null, fetcher: (opts: { haveStale: boolean }) => Promise<T>): Promise<Cached<T>> {
  const hit = await db.weatherCache.findUnique({ where: { key } });
  if (hit && (ttlMs === null || Date.now() - hit.fetchedAt.getTime() < ttlMs)) return { payload: hit.payload as T, fetchedAt: hit.fetchedAt, stale: false };
  // The last good answer, when the service fails: Today keeps showing the weather it had an hour ago, and says so.
  const stale: Cached<T> | null = hit && Date.now() - hit.fetchedAt.getTime() < STALE_OK_MS ? { payload: hit.payload as T, fetchedAt: hit.fetchedAt, stale: true } : null;
  const failed = failures.get(key);
  if (failed && Date.now() - failed.at < RETRY_AFTER_MS) { if (stale) return stale; throw failed.error; }
  let payload: T;
  try { payload = await fetcher({ haveStale: stale !== null }); } catch (e) {
    failures.set(key, { at: Date.now(), error: e as Error });
    if (stale) { console.error(`weather: ${(e as Error).message}; using the forecast from ${Math.round((Date.now() - stale.fetchedAt.getTime()) / 60000)} min ago`); return stale; }
    throw e;
  }
  failures.delete(key);
  const fetchedAt = new Date();
  await db.weatherCache.upsert({ where: { key }, update: { payload: payload as object, fetchedAt }, create: { key, payload: payload as object, fetchedAt } });
  return { payload, fetchedAt, stale: false };
}

/** Tests: forget the failures that are waiting to be retried. */
export function forgetWeatherFailures(): void { failures.clear(); }

function isValidZip(zip: string): boolean {
  return /^\d{5}$/.test(zip.trim());
}

/** US zip → coordinates (Zippopotam.us). */
export async function geocodeZip(zip: string): Promise<Coords> {
  const z = zip.trim();
  if (!isValidZip(z)) throw new WeatherError("Enter a 5-digit zip code.", "bad_zip");
  if (isMockWeather()) return { lat: 32.7157, lon: -117.1611, place: "San Diego" };
  return (await cached(`zip:${z}`, null, async () => {
    const res = await fetch(`https://api.zippopotam.us/us/${z}`, { signal: AbortSignal.timeout(PATIENT_MS) });
    if (res.status === 404) throw new WeatherError("That zip code wasn't found.", "bad_zip");
    if (!res.ok) { console.error(`weather: Zippopotam answered ${res.status} ${res.statusText}`); throw new WeatherError("Zip lookup is unavailable right now.", "unavailable"); }
    const json = (await res.json()) as { places?: { latitude: string; longitude: string; "place name": string }[] };
    const p = json.places?.[0];
    if (!p) throw new WeatherError("That zip code wasn't found.", "bad_zip");
    return { lat: Number(p.latitude), lon: Number(p.longitude), place: p["place name"] };
  })).payload;
}

type OpenMeteo = {
  timezone: string;
  current: { temperature_2m: number; weather_code: number; time: string };
  hourly: { time: string[]; temperature_2m: number[]; precipitation_probability: number[]; weather_code: number[] };
  daily: { temperature_2m_max: number[]; temperature_2m_min: number[] };
};

/** How long Today waits for Open-Meteo: a short try when an older forecast can stand in, else a longer one with one more try. */
const QUICK_MS = 3000;
const PATIENT_MS = 6000;

/**
 * Open-Meteo answers in well under a second, except when it doesn't. With an older forecast in hand, one short try and
 * the old forecast stands in; with nothing in hand, a longer try and one more before giving up. Today streams the
 * weather in after the page has painted, so this is how long the forecast cell breathes, not how long the page waits.
 */
async function fetchForecastResponse(url: string, haveStale: boolean): Promise<Response> {
  if (haveStale) return fetch(url, { signal: AbortSignal.timeout(QUICK_MS) });
  try { return await fetch(url, { signal: AbortSignal.timeout(PATIENT_MS) }); }
  catch (e) {
    if ((e as Error).name !== "TimeoutError") throw e;
    return fetch(url, { signal: AbortSignal.timeout(PATIENT_MS) });
  }
}

async function fetchForecast(c: Coords, haveStale: boolean): Promise<OpenMeteo> {
  const q = new URLSearchParams({
    latitude: c.lat.toFixed(3), longitude: c.lon.toFixed(3),
    current: "temperature_2m,weather_code",
    hourly: "temperature_2m,precipitation_probability,weather_code",
    daily: "temperature_2m_max,temperature_2m_min",
    temperature_unit: "fahrenheit", timezone: "auto", forecast_days: "2",
  });
  const res = await fetchForecastResponse(`https://api.open-meteo.com/v1/forecast?${q}`, haveStale);
  if (!res.ok) {
    console.error(`weather: Open-Meteo answered ${res.status} ${res.statusText}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
    throw new WeatherError("Weather is unavailable right now.", "unavailable");
  }
  return (await res.json()) as OpenMeteo;
}

/** Dev and tests: the mock forecast takes this long to answer, so the screen's wait for the weather can be seen and tested. Unset in production. */
async function mockDelay(): Promise<void> {
  const ms = Number(process.env.MOCK_WEATHER_SLOW_MS ?? 0);
  if (ms > 0) await new Promise((r) => setTimeout(r, ms));
}

/** Today's weather for coordinates. `now` is injectable for tests. */
export async function getWeather(c: Coords, now = new Date()): Promise<Weather> {
  if (isMockWeather()) {
    await mockDelay();
    return { nowF: 68, tonightF: 61, highF: 71, lowF: 58, rainChance: 0, condition: "Clear", timezone: "America/Los_Angeles", source: "mock", fetchedAt: now.toISOString(), stale: false };
  }
  const key = `wx:${c.lat.toFixed(2)},${c.lon.toFixed(2)}`;
  const { payload, fetchedAt, stale } = await cached(key, FORECAST_TTL_MS, ({ haveStale }) => fetchForecast(c, haveStale));
  return summarize(payload, now, { fetchedAt, stale });
}

/**
 * The numbers for `now` out of a forecast. Hours are picked by today's key in the forecast's zone, not by the fetch day, so
 * an old forecast standing in after midnight still reads today's hours (it covers two days); and when it is stale, "now"
 * is the forecast's number for this hour, not the measurement from when it was fetched (review D 5.3).
 */
export function summarize(data: OpenMeteo, now: Date, meta: { fetchedAt?: Date; stale?: boolean } = {}): Weather {
  const tz = data.timezone;
  const hour = hourIn(now, tz);
  const fetchDay = data.current.time.slice(0, 10);
  const todayKey = dayKey(now, tz);
  // Open-Meteo hourly times are local to `timezone` ("2026-10-18T20:00"). Fall back to the fetch day when the forecast does not reach today.
  const today = data.hourly.time.some((t) => t.startsWith(todayKey)) ? todayKey : fetchDay;
  const dayIdx = today === fetchDay ? 0 : Math.min(1, data.daily.temperature_2m_max.length - 1);
  const at = (h: number) => data.hourly.time.findIndex((t) => t.startsWith(today) && Number(t.slice(11, 13)) === h);
  // Pick 8 PM tonight (or the current hour if later).
  const eveningHour = Math.max(20, hour);
  const idx = at(Math.min(eveningHour, 23));
  const tonightF = idx >= 0 ? data.hourly.temperature_2m[idx] : data.daily.temperature_2m_min[dayIdx];
  const rest = data.hourly.time.map((t, i) => ({ t, i })).filter(({ t }) => t.startsWith(today) && Number(t.slice(11, 13)) >= hour);
  const rainChance = Math.max(0, ...rest.map(({ i }) => data.hourly.precipitation_probability[i] ?? 0));
  const nowIdx = meta.stale ? at(hour) : -1;
  return {
    nowF: Math.round(nowIdx >= 0 ? data.hourly.temperature_2m[nowIdx] : data.current.temperature_2m),
    tonightF: Math.round(tonightF),
    highF: Math.round(data.daily.temperature_2m_max[dayIdx]),
    lowF: Math.round(data.daily.temperature_2m_min[dayIdx]),
    rainChance,
    condition: conditionWord(nowIdx >= 0 ? data.hourly.weather_code[nowIdx] ?? data.current.weather_code : data.current.weather_code),
    timezone: tz,
    source: "open-meteo",
    fetchedAt: (meta.fetchedAt ?? now).toISOString(),
    stale: Boolean(meta.stale),
  };
}

/** "as of 9 AM" / "as of 9 AM yesterday": how old a forecast standing in is, for the chip (review D 5.3). */
export function asOfLine(w: Pick<Weather, "fetchedAt" | "timezone">, now = new Date()): string | null {
  if (!w.fetchedAt) return null;
  const at = new Date(w.fetchedAt);
  if (Number.isNaN(at.getTime())) return null;
  const sameDay = dayKey(at, w.timezone) === dayKey(now, w.timezone);
  return `as of ${clock(at, w.timezone)}${sameDay ? "" : " yesterday"}`;
}

/** `68° NOW → 61° TONIGHT` (+ ` · RAIN 60%` when it matters). */
export function weatherLine(w: Weather): string {
  const base = `${w.nowF}° NOW → ${w.tonightF}° TONIGHT`;
  return w.rainChance >= 40 ? `${base} · RAIN ${w.rainChance}%` : base;
}
