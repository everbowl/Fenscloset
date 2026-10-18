import { db } from "@/lib/db";
import { hourIn } from "@/lib/dates";

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
};

export class WeatherError extends Error {
  constructor(message: string, public readonly code: "bad_zip" | "unavailable") {
    super(message);
    this.name = "WeatherError";
  }
}

const FORECAST_TTL_MS = 60 * 60 * 1000;

export function isMockWeather(): boolean {
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

async function cached<T>(key: string, ttlMs: number | null, fetcher: () => Promise<T>): Promise<T> {
  const hit = await db.weatherCache.findUnique({ where: { key } });
  if (hit && (ttlMs === null || Date.now() - hit.fetchedAt.getTime() < ttlMs)) return hit.payload as T;
  const payload = await fetcher();
  await db.weatherCache.upsert({ where: { key }, update: { payload: payload as object, fetchedAt: new Date() }, create: { key, payload: payload as object } });
  return payload;
}

export function isValidZip(zip: string): boolean {
  return /^\d{5}$/.test(zip.trim());
}

/** US zip → coordinates (Zippopotam.us). */
export async function geocodeZip(zip: string): Promise<Coords> {
  const z = zip.trim();
  if (!isValidZip(z)) throw new WeatherError("Enter a 5-digit zip code.", "bad_zip");
  if (isMockWeather()) return { lat: 32.7157, lon: -117.1611, place: "San Diego" };
  return cached(`zip:${z}`, null, async () => {
    const res = await fetch(`https://api.zippopotam.us/us/${z}`, { signal: AbortSignal.timeout(8000) });
    if (res.status === 404) throw new WeatherError("That zip code wasn't found.", "bad_zip");
    if (!res.ok) throw new WeatherError("Zip lookup is unavailable right now.", "unavailable");
    const json = (await res.json()) as { places?: { latitude: string; longitude: string; "place name": string }[] };
    const p = json.places?.[0];
    if (!p) throw new WeatherError("That zip code wasn't found.", "bad_zip");
    return { lat: Number(p.latitude), lon: Number(p.longitude), place: p["place name"] };
  });
}

type OpenMeteo = {
  timezone: string;
  current: { temperature_2m: number; weather_code: number; time: string };
  hourly: { time: string[]; temperature_2m: number[]; precipitation_probability: number[]; weather_code: number[] };
  daily: { temperature_2m_max: number[]; temperature_2m_min: number[] };
};

async function fetchForecast(c: Coords): Promise<OpenMeteo> {
  const q = new URLSearchParams({
    latitude: c.lat.toFixed(3), longitude: c.lon.toFixed(3),
    current: "temperature_2m,weather_code",
    hourly: "temperature_2m,precipitation_probability,weather_code",
    daily: "temperature_2m_max,temperature_2m_min",
    temperature_unit: "fahrenheit", timezone: "auto", forecast_days: "2",
  });
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${q}`, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new WeatherError("Weather is unavailable right now.", "unavailable");
  return (await res.json()) as OpenMeteo;
}

/** Today's weather for coordinates. `now` is injectable for tests. */
export async function getWeather(c: Coords, now = new Date()): Promise<Weather> {
  if (isMockWeather()) {
    return { nowF: 68, tonightF: 61, highF: 71, lowF: 58, rainChance: 0, condition: "Clear", timezone: "America/Los_Angeles", source: "mock" };
  }
  const key = `wx:${c.lat.toFixed(2)},${c.lon.toFixed(2)}`;
  const data = await cached(key, FORECAST_TTL_MS, () => fetchForecast(c));
  return summarize(data, now);
}

export function summarize(data: OpenMeteo, now: Date): Weather {
  const tz = data.timezone;
  const hour = hourIn(now, tz);
  // Open-Meteo hourly times are local to `timezone` ("2026-10-18T20:00"). Pick 8 PM tonight (or the current hour if later).
  const today = data.current.time.slice(0, 10);
  const eveningHour = Math.max(20, hour);
  const idx = data.hourly.time.findIndex((t) => t.startsWith(today) && Number(t.slice(11, 13)) === Math.min(eveningHour, 23));
  const tonightF = idx >= 0 ? data.hourly.temperature_2m[idx] : data.daily.temperature_2m_min[0];
  const rest = data.hourly.time.map((t, i) => ({ t, i })).filter(({ t }) => t.startsWith(today) && Number(t.slice(11, 13)) >= hour);
  const rainChance = Math.max(0, ...rest.map(({ i }) => data.hourly.precipitation_probability[i] ?? 0));
  return {
    nowF: Math.round(data.current.temperature_2m),
    tonightF: Math.round(tonightF),
    highF: Math.round(data.daily.temperature_2m_max[0]),
    lowF: Math.round(data.daily.temperature_2m_min[0]),
    rainChance,
    condition: conditionWord(data.current.weather_code),
    timezone: tz,
    source: "open-meteo",
  };
}

/** `68° NOW → 61° TONIGHT` (+ ` · RAIN 60%` when it matters). */
export function weatherLine(w: Weather): string {
  const base = `${w.nowF}° NOW → ${w.tonightF}° TONIGHT`;
  return w.rainChance >= 40 ? `${base} · RAIN ${w.rainChance}%` : base;
}
