import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { resetDb } from "../helpers";
import { forgetWeatherFailures } from "@/lib/weather";
import { loadWeather, parseLocation } from "@/lib/today/weather";

const sample = {
  timezone: "America/Los_Angeles",
  current: { temperature_2m: 68.2, weather_code: 0, time: "2026-10-18T14:00" },
  hourly: {
    time: Array.from({ length: 48 }, (_, i) => `2026-10-${i < 24 ? "18" : "19"}T${String(i % 24).padStart(2, "0")}:00`),
    temperature_2m: Array.from({ length: 48 }, (_, i) => (i % 24 === 20 ? 61.4 : 65)),
    precipitation_probability: Array.from({ length: 48 }, () => 0),
    weather_code: Array.from({ length: 48 }, () => 0),
  },
  daily: { temperature_2m_max: [71.2], temperature_2m_min: [57.8] },
};
const now = new Date("2026-10-18T21:00:00Z");

/** The slice Today streams in after the page has painted: it answers every time, and says why when there is no forecast. */
describe("today's weather slice", () => {
  beforeEach(async () => { await resetDb(); forgetWeatherFailures(); delete process.env.MOCK_WEATHER; vi.restoreAllMocks(); });

  it("reads the phone's location cookie, and ignores one it cannot use", () => {
    expect(parseLocation("32.716,-117.161")).toEqual({ lat: 32.716, lon: -117.161 });
    expect(parseLocation("north,west")).toBeNull();
    expect(parseLocation("")).toBeNull();
    expect(parseLocation(undefined)).toBeNull();
  });

  it("with nowhere to ask about, no call is made and the note asks for a place", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    expect(await loadWeather({ loc: null, savedZip: null, now })).toEqual({ weather: null, weatherNote: "none" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("the phone's location wins over the saved zip (the zip is never looked up)", async () => {
    await db.weatherCache.create({ data: { key: "wx:32.72,-117.16", payload: sample } });
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const r = await loadWeather({ loc: { lat: 32.7157, lon: -117.1611 }, savedZip: "00000", now });
    expect(r.weather).toMatchObject({ nowF: 68, tonightF: 61, source: "open-meteo" });
    expect(r.weatherNote).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled(); // the forecast came from the cache; the zip was not needed
  });

  it("falls back to the saved zip when the phone shared nothing", async () => {
    process.env.MOCK_WEATHER = "true";
    const r = await loadWeather({ loc: null, savedZip: "92101", now });
    expect(r.weather?.source).toBe("mock");
    expect(r.weatherNote).toBeNull();
  });

  it("never throws: a failed lookup becomes a note, so the rest of the page is unaffected", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("fetch failed"));
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await loadWeather({ loc: { lat: 1, lon: 1 }, savedZip: null, now })).toEqual({ weather: null, weatherNote: "failed" });
    expect(await loadWeather({ loc: null, savedZip: "92101", now })).toEqual({ weather: null, weatherNote: "failed" });
    expect(quiet).toHaveBeenCalled();
  });

  it("the mock forecast can be held back, so a screen's wait for it can be seen (MOCK_WEATHER_SLOW_MS)", async () => {
    process.env.MOCK_WEATHER = "true"; process.env.MOCK_WEATHER_SLOW_MS = "120";
    try {
      const t0 = Date.now();
      expect((await loadWeather({ loc: { lat: 1, lon: 1 }, savedZip: null, now })).weather?.source).toBe("mock");
      expect(Date.now() - t0).toBeGreaterThanOrEqual(100);
    } finally { delete process.env.MOCK_WEATHER_SLOW_MS; }
  });
});
