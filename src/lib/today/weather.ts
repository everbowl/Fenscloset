import { geocodeZip, getWeather, type Coords, type Weather } from "@/lib/weather";

/** The forecast, or why there is none: nowhere to ask about yet ("none"), or the lookup failed. */
export type WeatherSlice = { weather: Weather | null; weatherNote: "none" | "failed" | null };

/** Where to ask for the weather: the phone's location this session, then the person's saved zip. */
export type Located = { loc: Coords | null; savedZip: string | null; now: Date };

/** The location cookie's "lat,lon", or nothing it can use. */
export function parseLocation(cookie: string | undefined): Coords | null {
  if (!cookie) return null;
  const [lat, lon] = cookie.split(",").map(Number);
  return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
}

/**
 * The day's weather. Never throws: Today streams this in after the page has painted and shows the reason when there is
 * none (21 Nov 2026: the page used to wait on Open-Meteo before showing anything, so a slow minute for the service was a
 * slow minute for the whole screen). The phone's location wins over the saved zip (plan A3).
 */
export async function loadWeather(at: Located): Promise<WeatherSlice> {
  try {
    let weather: Weather | null = null;
    if (at.loc) weather = await getWeather(at.loc, at.now);
    if (!weather && at.savedZip) weather = await getWeather(await geocodeZip(at.savedZip), at.now);
    return { weather, weatherNote: weather ? null : "none" };
  } catch (e) {
    console.error(`weather: ${(e as Error).message}`); // one line, not the whole error table
    return { weather: null, weatherNote: "failed" };
  }
}
