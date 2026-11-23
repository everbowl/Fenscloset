import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { resetDb } from "../helpers";
import { asOfLine, conditionWord, forgetWeatherFailures, geocodeZip, getWeather, summarize, weatherLine } from "@/lib/weather";
import { dayKey, hourIn, monoDate, addDays, clock, isEvening, isValidDayKey, localInstant, wornDateToInstant } from "@/lib/dates";

const sample = {
  timezone: "America/Los_Angeles",
  current: { temperature_2m: 68.2, weather_code: 0, time: "2026-10-18T14:00" },
  hourly: {
    time: Array.from({ length: 48 }, (_, i) => `2026-10-${i < 24 ? "18" : "19"}T${String(i % 24).padStart(2, "0")}:00`),
    temperature_2m: Array.from({ length: 48 }, (_, i) => (i % 24 === 20 ? 61.4 : 65)),
    precipitation_probability: Array.from({ length: 48 }, (_, i) => (i === 22 ? 55 : i === 3 ? 90 : 0)),
    weather_code: Array.from({ length: 48 }, () => 0),
  },
  daily: { temperature_2m_max: [71.2], temperature_2m_min: [57.8] },
};

describe("weather", () => {
  beforeEach(async () => { await resetDb(); delete process.env.MOCK_WEATHER; });

  it("summarizes now / tonight / rain for the rest of today", () => {
    const now = new Date("2026-10-18T21:00:00Z"); // 2 PM Los Angeles
    const w = summarize(sample, now);
    expect(w).toMatchObject({ nowF: 68, tonightF: 61, highF: 71, lowF: 58, rainChance: 55, condition: "Clear" });
    expect(weatherLine(w)).toBe("68° NOW → 61° TONIGHT · RAIN 55%");
    expect(weatherLine({ ...w, rainChance: 10 })).toBe("68° NOW → 61° TONIGHT");
    expect(conditionWord(63)).toBe("Rain"); expect(conditionWord(95)).toBe("Thunderstorm");
  });

  it("mock mode needs no network; zip validation; forecast cache is used", async () => {
    process.env.MOCK_WEATHER = "true";
    expect(await geocodeZip("92101")).toMatchObject({ place: "San Diego" });
    expect((await getWeather({ lat: 1, lon: 1 })).source).toBe("mock");
    delete process.env.MOCK_WEATHER;
    await expect(geocodeZip("abc")).rejects.toMatchObject({ code: "bad_zip" });
    await db.weatherCache.create({ data: { key: "wx:32.72,-117.16", payload: sample } });
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const w = await getWeather({ lat: 32.7157, lon: -117.1611 }, new Date("2026-10-18T21:00:00Z"));
    expect(w.nowF).toBe(68);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("a failed forecast is not asked for again for a while: Today renders several times at once", async () => {
    forgetWeatherFailures();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("busy", { status: 429, statusText: "Too Many Requests" }));
    await expect(getWeather({ lat: 40, lon: -74 })).rejects.toMatchObject({ code: "unavailable" });
    await expect(getWeather({ lat: 40, lon: -74 })).rejects.toMatchObject({ code: "unavailable" });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    fetchSpy.mockRestore(); forgetWeatherFailures();
  });

  it("when the service fails, a forecast from the last day is used instead of nothing; a timed-out call is tried once more", async () => {
    forgetWeatherFailures();
    await db.weatherCache.create({ data: { key: "wx:41.00,-73.00", payload: sample, fetchedAt: new Date(Date.now() - 3 * 60 * 60 * 1000) } }); // three hours old: past the hour, inside the day
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("busy", { status: 503, statusText: "Service Unavailable" }));
    const w = await getWeather({ lat: 41, lon: -73 }, new Date("2026-10-18T21:00:00Z"));
    expect(w.nowF).toBe(65); // the stale forecast's number for this hour (not the 68.2 measured when it was fetched), not an error
    expect(w.stale).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const again = await getWeather({ lat: 41, lon: -73 }, new Date("2026-10-18T21:00:00Z"));
    expect(again.nowF).toBe(65); expect(fetchSpy).toHaveBeenCalledTimes(1); // inside the retry-after window: no call, still the stale answer
    fetchSpy.mockRestore(); forgetWeatherFailures();
    const timeout = Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
    const slow = vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(timeout).mockResolvedValueOnce(new Response(JSON.stringify(sample), { status: 200 }));
    expect((await getWeather({ lat: 42, lon: -73 }, new Date("2026-10-18T21:00:00Z"))).nowF).toBe(68);
    expect(slow).toHaveBeenCalledTimes(2);
    slow.mockRestore(); forgetWeatherFailures();
    // with an older forecast in hand a timed-out call is not tried again: the old forecast stands in at once (Today waits for this)
    await db.weatherCache.create({ data: { key: "wx:43.00,-73.00", payload: sample, fetchedAt: new Date(Date.now() - 2 * 60 * 60 * 1000) } });
    const once = vi.spyOn(globalThis, "fetch").mockRejectedValue(timeout);
    expect((await getWeather({ lat: 43, lon: -73 }, new Date("2026-10-18T21:00:00Z"))).nowF).toBe(65); // the old forecast's number for this hour
    expect(once).toHaveBeenCalledTimes(1);
    once.mockRestore(); forgetWeatherFailures();
  });

  it("an older forecast standing in is marked stale, reads today's hour rather than the hour it was fetched, and is dropped past six hours", async () => {
    forgetWeatherFailures();
    const now = new Date("2026-10-18T23:00:00Z"); // 4 PM Los Angeles; the sample was fetched at 2 PM
    await db.weatherCache.create({ data: { key: "wx:44.00,-73.00", payload: sample, fetchedAt: new Date(Date.now() - 2 * 60 * 60 * 1000) } });
    await db.weatherCache.create({ data: { key: "wx:45.00,-73.00", payload: sample, fetchedAt: new Date(Date.now() - 7 * 60 * 60 * 1000) } });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("busy", { status: 503, statusText: "Service Unavailable" }));
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const w = await getWeather({ lat: 44, lon: -73 }, now);
    expect(w.stale).toBe(true);
    expect(w.fetchedAt).toBeTruthy();
    expect(w.nowF).toBe(65); // the forecast's number for 4 PM, not the 68.2 measured at 2 PM
    expect(w.tonightF).toBe(61);
    await expect(getWeather({ lat: 45, lon: -73 }, now)).rejects.toMatchObject({ code: "unavailable" }); // seven hours old: a different day's numbers, so nothing
    fetchSpy.mockRestore(); quiet.mockRestore(); forgetWeatherFailures();
    const fresh = summarize(sample, new Date("2026-10-18T21:00:00Z"));
    expect(fresh.stale).toBe(false);
    expect(fresh.nowF).toBe(68);
    // the chip's words: the hour it was fetched, and "yesterday" when that was another day
    const at = { fetchedAt: "2026-10-18T16:00:00Z", timezone: "America/Los_Angeles" }; // 9 AM Los Angeles
    expect(asOfLine(at, new Date("2026-10-18T23:00:00Z"))).toBe("as of 9:00 AM");
    expect(asOfLine(at, new Date("2026-10-19T15:00:00Z"))).toBe("as of 9:00 AM yesterday");
    expect(asOfLine({ fetchedAt: undefined, timezone: "America/Los_Angeles" })).toBeNull();
  });

  it("date helpers follow the household time zone", () => {
    const d = new Date("2026-10-19T05:30:00Z"); // still Oct 18, 10:30 PM in Los Angeles
    expect(dayKey(d, "America/Los_Angeles")).toBe("2026-10-18");
    expect(hourIn(d, "America/Los_Angeles")).toBe(22);
    expect(monoDate("2026-10-18")).toBe("SUN, OCT 18");
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(clock(new Date("2026-10-19T02:30:00Z"), "America/Los_Angeles")).toBe("7:30 PM");
  });

  it("a wear on a day is stored as local noon in the household zone, so it reads as that day on either side of midnight", () => {
    const tz = "America/Los_Angeles";
    expect(wornDateToInstant("2026-10-18", tz).toISOString()).toBe("2026-10-18T19:00:00.000Z"); // PDT
    expect(wornDateToInstant("2026-12-18", tz).toISOString()).toBe("2026-12-18T20:00:00.000Z"); // PST
    for (const key of ["2026-10-18", "2026-03-08", "2026-11-01", "2026-12-31"]) expect(dayKey(wornDateToInstant(key, tz), tz)).toBe(key); // the clock-change days included
    expect(localInstant("2026-10-18", "Europe/Paris", 0).toISOString()).toBe("2026-10-17T22:00:00.000Z"); // midnight in Paris
    expect(localInstant("2026-10-18", "UTC", 12).toISOString()).toBe("2026-10-18T12:00:00.000Z");
    // a rolled-over day key is not a day (review D 5.9)
    expect(isValidDayKey("2026-13-45")).toBe(false);
    expect(isValidDayKey("2026-02-30")).toBe(false);
    expect(isValidDayKey("2026-02-28")).toBe(true);
    expect(isValidDayKey("2026-2-28")).toBe(false);
    // one threshold for "Good evening" and "tonight's looks" (review D 5.11)
    expect(isEvening(16)).toBe(false);
    expect(isEvening(17)).toBe(true);
  });
});
