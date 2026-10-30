"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { requirePerson } from "@/lib/auth/current";
import { db } from "@/lib/db";
import { geocodeZip, WeatherError } from "@/lib/weather";
import { loadTodayContext, LOCATION_COOKIE } from "@/lib/today/context";
import { assertCanDress, generateSuggestion, moreLooks, OutfitError, removePiece, swapPiece, wearBoard } from "@/lib/outfits/engine";
import { rateFit, type FitRating } from "@/lib/fits/service";
import { CheckInError, saveSelfie, saveTaps } from "@/lib/checkins/service";
import { PlanError, setPlan } from "@/lib/plans";
import { IMAGE_TYPES } from "@/lib/storage";
import { jobStatus, settled, startJob, type JobStatus } from "@/lib/jobs";

export type Result = { ok: true } | { ok: false; error: string };
/** Building looks: done, or a job to poll with looksStatusAction. */
export type LooksResult = { ok: true; pending?: { jobId: string } } | { ok: false; error: string };

/** How long a looks call waits before handing back a job to poll. */
const QUICK_MS = 1500;

function looksFailed(e: unknown): LooksResult {
  if (e instanceof OutfitError || e instanceof WeatherError) return { ok: false, error: e.message };
  console.error("looks", e);
  return { ok: false, error: "Couldn’t build the looks. Try again." };
}

function looksAnswer(status: JobStatus<void>, jobId: string): LooksResult {
  if (status.state === "done") { revalidatePath("/today"); return { ok: true }; }
  if (status.state === "failed") return looksFailed(status.error);
  return { ok: true, pending: { jobId } };
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
  (await cookies()).set(LOCATION_COOKIE, `${lat.toFixed(3)},${lon.toFixed(3)}`, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 12 * 3600 });
  revalidatePath("/today");
  return { ok: true };
}

export async function setZipAction(zip: string): Promise<Result> {
  const me = await requirePerson();
  return run(async () => {
    await geocodeZip(zip);
    await db.person.update({ where: { id: me.id }, data: { savedZip: zip.trim() } });
    (await cookies()).delete(LOCATION_COOKIE);
  });
}

export async function wearAction(personId: string, suggestionId: string, index: number): Promise<Result> {
  const me = await requirePerson();
  return run(async () => {
    const ctx = await loadTodayContext(me, personId);
    const title = ctx.plan.label ?? (ctx.hour >= 16 ? "Tonight’s look" : "Today’s look");
    await wearBoard(me, personId, suggestionId, index, title, ctx.now);
  });
}

export async function swapAction(personId: string, index: number, itemId: string): Promise<Result> {
  const me = await requirePerson();
  return run(async () => { await assertCanDress(me, personId); const ctx = await loadTodayContext(me, personId); await swapPiece(personId, ctx.date, index, itemId, ctx); });
}

export async function removeAction(personId: string, index: number, itemId: string): Promise<Result> {
  const me = await requirePerson();
  return run(async () => { await assertCanDress(me, personId); const ctx = await loadTodayContext(me, personId); await removePiece(personId, ctx.date, index, itemId, ctx); });
}

/**
 * Looks are built in the background (src/lib/jobs.ts): Claude takes 20 to 40 seconds, and a page or a request
 * that waits that long is what a phone gives up on (Jeff, 19 Oct 2026, midnight: the first Today of the new
 * day built its looks inside the page load; his phone showed the offline page). The screen polls
 * looksStatusAction and refreshes when the looks are there.
 */
export async function moreAction(personId: string): Promise<LooksResult> {
  const me = await requirePerson();
  try {
    await assertCanDress(me, personId);
    const ctx = await loadTodayContext(me, personId);
    const job = startJob<void>(`more|${personId}|${ctx.date}`, me.id, async () => { await moreLooks(personId, ctx.date, ctx); });
    return looksAnswer(await settled(job, QUICK_MS), job.id);
  } catch (e) { return looksFailed(e); }
}

/** The day's looks (first open of the day), or fresh ones after new inputs (plan, check-in, weather). */
export async function regenerateAction(personId: string): Promise<LooksResult> {
  const me = await requirePerson();
  try {
    await assertCanDress(me, personId);
    const ctx = await loadTodayContext(me, personId);
    const job = startJob<void>(`looks|${personId}|${ctx.date}`, me.id, async () => { await generateSuggestion(personId, ctx.date, ctx); });
    return looksAnswer(await settled(job, QUICK_MS), job.id);
  } catch (e) { return looksFailed(e); }
}

/** Where a looks job stands; done means the page can refresh. */
export async function looksStatusAction(jobId: string): Promise<LooksResult> {
  const me = await requirePerson();
  const status = jobStatus<void>(jobId, me.id);
  if (!status) return { ok: false, error: "Those looks got lost on the way. Try again." };
  return looksAnswer(status, jobId);
}

/** Plan and check-in save at once and return; the screen then asks for fresh looks separately (regenerateAction), so nothing waits on Claude. */
export async function setPlanAction(personId: string, pick: { occasionId: string } | { text: string } | null): Promise<Result> {
  const me = await requirePerson();
  return run(async () => {
    const ctx = await loadTodayContext(me, personId);
    await setPlan(me, personId, ctx.date, pick);
  });
}

export async function checkInTapsAction(personId: string, answers: { scaleId: string; optionId: string }[]): Promise<Result> {
  const me = await requirePerson();
  return run(async () => {
    const ctx = await loadTodayContext(me, personId);
    await saveTaps(me, personId, ctx.date, answers);
  });
}

export async function checkInSelfieAction(personId: string, form: FormData): Promise<Result> {
  const me = await requirePerson();
  return run(async () => {
    const file = form.get("selfie");
    if (!(file instanceof File) || !IMAGE_TYPES[file.type]) throw new CheckInError("Take or choose a JPEG, PNG or WebP photo.");
    if (file.size > 12 * 1024 * 1024) throw new CheckInError("That photo is too large.");
    const ctx = await loadTodayContext(me, personId);
    await saveSelfie(me, personId, ctx.date, { data: Buffer.from(await file.arrayBuffer()), contentType: file.type as "image/jpeg" });
  });
}

/** "How did it go?" from the Today strip. */
export async function rateAction(fitId: string, rating: FitRating): Promise<Result> {
  const me = await requirePerson();
  return run(async () => { await rateFit(me, fitId, rating); });
}

// The mirror (TRY IT ON / SEE IT ON) lives in src/app/(app)/mirror/actions.ts: dressed in the background and polled.
