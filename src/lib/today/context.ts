import "server-only";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { dayKey, hourIn } from "@/lib/dates";
import { getTimezone } from "@/lib/rules";
import type { Coords } from "@/lib/weather";
import { getPlan, type Plan } from "@/lib/plans";
import { getCheckIn, type CheckInView } from "@/lib/checkins/service";
import type { DayContext } from "@/lib/outfits/engine";
import type { Viewer } from "@/lib/people/visibility";
import { loadWeather, parseLocation, type WeatherSlice } from "./weather";

export const LOCATION_COOKIE = "fc_loc";

/** Everything Today knows before the weather: the day, the plan, the check-in, and where to ask for the forecast. */
export type TodayBase = {
  tz: string;
  date: string;
  hour: number;
  plan: Plan;
  checkIn: CheckInView | null;
  savedZip: string | null;
  now: Date;
  /** The phone's location, when it shared one this session (the location cookie). */
  loc: Coords | null;
};

export type TodayContext = DayContext & TodayBase & WeatherSlice;

/**
 * Database reads only, no outside call: the page shows this at once and streams the weather in after it.
 * Location order (plan A3): the phone's location cookie → the person's saved zip → nothing (ask on screen).
 */
export async function loadTodayBase(viewer: Viewer, personId: string, now = new Date()): Promise<TodayBase> {
  const tz = await getTimezone();
  const date = dayKey(now, tz);
  const [person, jar, plan, checkIn] = await Promise.all([
    db.person.findUniqueOrThrow({ where: { id: personId }, select: { savedZip: true } }),
    cookies(),
    getPlan(personId, date, tz, now),
    getCheckIn(viewer, personId, date),
  ]);
  return { tz, date, hour: hourIn(now, tz), plan, checkIn, savedZip: person.savedZip, now, loc: parseLocation(jar.get(LOCATION_COOKIE)?.value) };
}

/** The base with the weather in hand, for anything that builds looks (the engine wants the forecast). */
export async function loadTodayContext(viewer: Viewer, personId: string, now = new Date()): Promise<TodayContext> {
  const base = await loadTodayBase(viewer, personId, now);
  return { ...base, ...(await loadWeather(base)) };
}
