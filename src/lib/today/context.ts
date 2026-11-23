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

/** Just the day: the zone, the key, the hour, and where to ask for the weather. No plan, no check-in, no outside call. */
export type TodayDay = Omit<TodayBase, "plan" | "checkIn">;

/**
 * Two reads (the zone rule, the person's zip) and the cookie jar. For the taps that only need to know what day it is
 * (review D 4.3: Wear this, Swap, Remove, a saved plan or check-in used to wait on the weather and the calendar first).
 */
export async function loadToday(personId: string, now = new Date()): Promise<TodayDay> {
  const [tz, person, jar] = await Promise.all([getTimezone(), db.person.findUniqueOrThrow({ where: { id: personId }, select: { savedZip: true } }), cookies()]);
  return { tz, date: dayKey(now, tz), hour: hourIn(now, tz), savedZip: person.savedZip, now, loc: parseLocation(jar.get(LOCATION_COOKIE)?.value) };
}

/** The plan and the check-in for a day already in hand (the plan may read Google Calendar, cached and bounded in src/lib/plans/google.ts). */
export async function loadPlanAndCheckIn(viewer: Viewer, personId: string, day: Pick<TodayDay, "date" | "tz" | "now">): Promise<Pick<TodayBase, "plan" | "checkIn">> {
  const [plan, checkIn] = await Promise.all([getPlan(personId, day.date, day.tz, day.now), getCheckIn(viewer, personId, day.date)]);
  return { plan, checkIn };
}

/**
 * Database reads only, no outside call: the page shows this at once and streams the weather in after it.
 * Location order (plan A3): the phone's location cookie → the person's saved zip → nothing (ask on screen).
 */
export async function loadTodayBase(viewer: Viewer, personId: string, now = new Date()): Promise<TodayBase> {
  const day = await loadToday(personId, now);
  return { ...day, ...(await loadPlanAndCheckIn(viewer, personId, day)) };
}

/** The base with the weather in hand, for anything that builds looks (the engine wants the forecast). */
export async function loadTodayContext(viewer: Viewer, personId: string, now = new Date()): Promise<TodayContext> {
  const base = await loadTodayBase(viewer, personId, now);
  return { ...base, ...(await loadWeather(base)) };
}
