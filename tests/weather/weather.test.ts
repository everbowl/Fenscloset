import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { resetDb } from "../helpers";
import { conditionWord, geocodeZip, getWeather, summarize, weatherLine } from "@/lib/weather";
import { dayKey, hourIn, monoDate, addDays, clock } from "@/lib/dates";

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

  it("date helpers follow the household time zone", () => {
    const d = new Date("2026-10-19T05:30:00Z"); // still Oct 18, 10:30 PM in Los Angeles
    expect(dayKey(d, "America/Los_Angeles")).toBe("2026-10-18");
    expect(hourIn(d, "America/Los_Angeles")).toBe(22);
    expect(monoDate("2026-10-18")).toBe("SUN 18 OCT");
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(clock(new Date("2026-10-19T02:30:00Z"), "America/Los_Angeles")).toBe("7:30 PM");
  });
});
