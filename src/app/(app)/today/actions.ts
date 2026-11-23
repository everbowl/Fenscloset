"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { requirePerson } from "@/lib/auth/current";
import { db } from "@/lib/db";
import { geocodeZip, WeatherError } from "@/lib/weather";
import { loadPlanAndCheckIn, loadToday, LOCATION_COOKIE, type TodayDay } from "@/lib/today/context";
import { loadWeather } from "@/lib/today/weather";
import { assertCanDress, generateSuggestion, getSuggestion, moreLooks, OutfitError, removePiece, swapPiece, wearBoard, type DayContext } from "@/lib/outfits/engine";
import { AiError } from "@/lib/ai/claude";
import { rateFit, type FitRating } from "@/lib/fits/service";
import { CheckInError, saveSelfie, saveTaps } from "@/lib/checkins/service";
import { PlanError, setPlan } from "@/lib/plans";
import { IMAGE_TYPES } from "@/lib/storage";
import { jobStatus, settled, startJob, type JobStatus, type Step } from "@/lib/jobs";
import { cookieSecure } from "@/lib/app-url";
import type { Viewer } from "@/lib/people/visibility";

export type Result = { ok: true } | { ok: false; error: string };
/** Building looks: done, or a job to poll with looksStatusAction (with where it is, and whether the first board is saved already). */
export type LooksResult = { ok: true; pending?: { jobId: string; step: string; startedAt: number; partial: boolean } } | { ok: false; error: string };

/** How long a looks call waits before handing back a job to poll. */
const QUICK_MS = 1500;

function looksFailed(e: unknown): LooksResult {
  if (e instanceof OutfitError || e instanceof WeatherError) return { ok: false, error: e.message };
  if (e instanceof AiError) {
    console.error(`looks: ai ${e.code}: ${e.message}`);
    // A missing key is a setup problem, not a passing one: say so instead of "Try again" forever (review D 4.5).
    if (e.code === "no_key") return { ok: false, error: "Looks aren’t set up yet (no AI key). A parent admin can add one on the server." };
    return { ok: false, error: "Couldn’t build the looks. Try again." };
  }
  console.error("looks", e);
  return { ok: false, error: "Couldn’t build the looks. Try again." };
}

function looksAnswer(status: JobStatus<void>, jobId: string): LooksResult {
  if (status.state === "done") { revalidatePath("/today"); return { ok: true }; }
  if (status.state === "failed") return looksFailed(status.error);
  return { ok: true, pending: { jobId, step: status.step, startedAt: status.startedAt, partial: Boolean(status.partial) } };
}

async function run(fn: () => Promise<unknown>): Promise<Result> {
  try {
    await fn();
    revalidatePath("/today"); revalidatePath("/fits"); revalidatePath("/closet");
    return { ok: true };
  } catch (e) {
    if (e instanceof OutfitError || e instanceof CheckInError || e instanceof PlanError || e instanceof WeatherError) return { ok: false, error: e.message };
    console.error(e);
    return { ok: false, error: "Something went wrong. Try again." };
  }
}

/** The phone shared its location: remember it for the session (cookie, not the database). */
export async function setLocationAction(lat: number, lon: number): Promise<Result> {
  await requirePerson();
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return { ok: false, error: "No location." };
  (await cookies()).set(LOCATION_COOKIE, `${lat.toFixed(3)},${lon.toFixed(3)}`, { httpOnly: true, sameSite: "lax", secure: cookieSecure(), path: "/", maxAge: 12 * 3600 });
  revalidatePath("/today");
  return { ok: true };
}

/** The zip of the person whose Today this is (a parent on a child's Today saves the child's zip; review D 4.2). */
export async function setZipAction(personId: string, zip: string): Promise<Result> {
  const me = await requirePerson();
  return run(async () => {
    await assertCanDress(me, personId);
    await geocodeZip(zip);
    await db.person.update({ where: { id: personId }, data: { savedZip: zip.trim() } });
    (await cookies()).delete(LOCATION_COOKIE);
  });
}

/** Wear this. Nothing to load first: the look's own plan names the fit, and the engine checks the day (review D 4.3). */
export async function wearAction(personId: string, suggestionId: string, index: number): Promise<Result> {
  const me = await requirePerson();
  return run(async () => { await wearBoard(me, personId, suggestionId, index, null); });
}

export async function swapAction(personId: string, index: number, itemId: string): Promise<Result> {
  const me = await requirePerson();
  return run(async () => { await assertCanDress(me, personId); const day = await loadToday(personId); await swapPiece(personId, day.date, index, itemId, { now: day.now }); });
}

export async function removeAction(personId: string, index: number, itemId: string): Promise<Result> {
  const me = await requirePerson();
  return run(async () => { await assertCanDress(me, personId); const day = await loadToday(personId); await removePiece(personId, day.date, index, itemId, { now: day.now }); });
}

/**
 * Inside a looks job: the forecast, the plan and the check-in, reported as a step, so the action itself answers in
 * milliseconds (review D 4.4: the weather and the calendar used to be awaited before the job even started).
 */
async function dayContext(viewer: Viewer, personId: string, day: TodayDay, step: Step): Promise<DayContext> {
  step("Checking the weather…");
  const [{ weather }, { plan, checkIn }] = await Promise.all([loadWeather(day), loadPlanAndCheckIn(viewer, personId, day)]);
  return { weather, plan, checkIn, now: day.now };
}

/**
 * Looks are built in the background (src/lib/jobs.ts): Claude takes 10 to 40 seconds, and a page or a request
 * that waits that long is what a phone gives up on (Jeff, 19 Oct 2026, midnight: the first Today of the new
 * day built its looks inside the page load; his phone showed the offline page). The screen polls
 * looksStatusAction and refreshes when the looks are there.
 */
export async function moreAction(personId: string): Promise<LooksResult> {
  const me = await requirePerson();
  try {
    await assertCanDress(me, personId);
    const day = await loadToday(personId);
    const job = startJob<void>(`more|${personId}|${day.date}`, me.id, async (step) => { await moreLooks(personId, day.date, await dayContext(me, personId, day, step), step); });
    return looksAnswer(await settled(job, QUICK_MS), job.id);
  } catch (e) { return looksFailed(e); }
}

/**
 * The day's looks (first open of the day), or fresh ones after new inputs (plan, check-in, weather). `afterInputs`:
 * a build already running started before the new input was saved, so it is followed by a fresh one instead of
 * joined (Jeff, 2 Nov 2026: the Check-in sheet's Save was dead while the first looks of the day were building).
 * The slow wait card's Try again passes it too, so it never re-joins a stuck build (review D 3.4).
 */
export async function regenerateAction(personId: string, afterInputs = false): Promise<LooksResult> {
  const me = await requirePerson();
  try {
    await assertCanDress(me, personId);
    const day = await loadToday(personId);
    const job = startJob<void>(`looks|${personId}|${day.date}`, me.id, async (step) => { await generateSuggestion(personId, day.date, await dayContext(me, personId, day, step), step); }, { after: afterInputs });
    return looksAnswer(await settled(job, QUICK_MS), job.id);
  } catch (e) { return looksFailed(e); }
}

/** Where a looks job stands; done means the page can refresh. A job that is gone (a restart, or more than ten minutes away) still answers "done" when the looks exist (review D 3.5). */
export async function looksStatusAction(jobId: string, personId: string): Promise<LooksResult> {
  const me = await requirePerson();
  const status = jobStatus<void>(jobId, me.id);
  if (status) return looksAnswer(status, jobId);
  try {
    const day = await loadToday(personId);
    if (await getSuggestion(personId, day.date)) { revalidatePath("/today"); return { ok: true }; }
  } catch (e) { console.error("looks", e); }
  return { ok: false, error: "Those looks got lost on the way. Try again." };
}

/** Plan and check-in save at once and return; the screen then asks for fresh looks separately (regenerateAction), so nothing waits on Claude or the weather. */
export async function setPlanAction(personId: string, pick: { occasionId: string } | { text: string } | null): Promise<Result> {
  const me = await requirePerson();
  return run(async () => {
    const day = await loadToday(personId);
    await setPlan(me, personId, day.date, pick);
  });
}

export async function checkInTapsAction(personId: string, answers: { scaleId: string; optionId: string }[]): Promise<Result> {
  const me = await requirePerson();
  return run(async () => {
    const day = await loadToday(personId);
    await saveTaps(me, personId, day.date, answers);
  });
}

/** The selfie arrives already shrunk by the screen (review D 4.1: a raw iPhone photo is over the server action body limit). */
export async function checkInSelfieAction(personId: string, form: FormData): Promise<Result> {
  const me = await requirePerson();
  return run(async () => {
    const file = form.get("selfie");
    if (!(file instanceof File) || !IMAGE_TYPES[file.type]) throw new CheckInError("Take or choose a JPEG, PNG or WebP photo.");
    if (file.size > 12 * 1024 * 1024) throw new CheckInError("That photo is too large.");
    const day = await loadToday(personId);
    await saveSelfie(me, personId, day.date, { data: Buffer.from(await file.arrayBuffer()), contentType: file.type as "image/jpeg" });
  });
}

/** "How did it go?" from the Today strip. */
export async function rateAction(fitId: string, rating: FitRating): Promise<Result> {
  const me = await requirePerson();
  return run(async () => { await rateFit(me, fitId, rating); });
}

// The mirror (TRY IT ON / SEE IT ON) lives in src/app/(app)/mirror/actions.ts: dressed in the background and polled.
