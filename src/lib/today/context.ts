import "server-only";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { dayKey, hourIn } from "@/lib/dates";
import { getTimezone } from "@/lib/rules";
import { geocodeZip, getWeather, type Weather } from "@/lib/weather";
import { getPlan, type Plan } from "@/lib/plans";
import { getCheckIn, type CheckInView } from "@/lib/checkins/service";
import type { DayContext } from "@/lib/outfits/engine";
import type { Viewer } from "@/lib/people/visibility";

export const LOCATION_COOKIE = "fc_loc";

export type TodayContext = DayContext & {
  tz: string;
  date: string;
  hour: number;
  weather: Weather | null;
  plan: Plan;
  checkIn: CheckInView | null;
  /** Why there is no weather: nothing saved yet, or the lookup failed. */
  weatherNote: "none" | "failed" | null;
  savedZip: string | null;
  now: Date;
};

/** Location order (plan A3): the phone's location cookie → the person's saved zip → nothing (ask on screen). */
export async function loadTodayContext(viewer: Viewer, personId: string, now = new Date()): Promise<TodayContext> {
  const tz = await getTimezone();
  const date = dayKey(now, tz);
  const person = await db.person.findUniqueOrThrow({ where: { id: personId }, select: { savedZip: true } });
  const loc = (await cookies()).get(LOCATION_COOKIE)?.value;
  let weather: Weather | null = null;
  let weatherNote: TodayContext["weatherNote"] = null;
  try {
    if (loc) {
      const [lat, lon] = loc.split(",").map(Number);
      if (Number.isFinite(lat) && Number.isFinite(lon)) weather = await getWeather({ lat, lon }, now);
    }
    if (!weather && person.savedZip) weather = await getWeather(await geocodeZip(person.savedZip), now);
    if (!weather) weatherNote = "none";
  } catch (e) {
    console.error("weather", e);
    weatherNote = "failed";
  }
  const [plan, checkIn] = await Promise.all([getPlan(personId, date, tz, now), getCheckIn(viewer, personId, date)]);
  return { tz, date, hour: hourIn(now, tz), weather, plan, checkIn, weatherNote, savedZip: person.savedZip, now };
}
