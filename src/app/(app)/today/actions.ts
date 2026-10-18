"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { requirePerson } from "@/lib/auth/current";
import { db } from "@/lib/db";
import { geocodeZip, WeatherError } from "@/lib/weather";
import { loadTodayContext, LOCATION_COOKIE } from "@/lib/today/context";
import { assertCanDress, generateSuggestion, moreLooks, OutfitError, swapPiece, wearBoard } from "@/lib/outfits/engine";
import { rateFit, type FitRating } from "@/lib/fits/service";
import { tryOnLook, TryOnError, type TryOnView } from "@/lib/tryon";
import { CheckInError, saveSelfie, saveTaps } from "@/lib/checkins/service";
import { PlanError, setPlan } from "@/lib/plans";
import { IMAGE_TYPES } from "@/lib/storage";

export type Result = { ok: true } | { ok: false; error: string };

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
  return run(async () => { await assertCanDress(me, personId); await swapPiece(personId, (await loadTodayContext(me, personId)).date, index, itemId, await loadTodayContext(me, personId)); });
}

export async function moreAction(personId: string): Promise<Result> {
  const me = await requirePerson();
  return run(async () => { await assertCanDress(me, personId); const ctx = await loadTodayContext(me, personId); await moreLooks(personId, ctx.date, ctx); });
}

/** New inputs (plan, check-in, weather) → fresh looks. */
export async function regenerateAction(personId: string): Promise<Result> {
  const me = await requirePerson();
  return run(async () => { await assertCanDress(me, personId); const ctx = await loadTodayContext(me, personId); await generateSuggestion(personId, ctx.date, ctx); });
}

export async function setPlanAction(personId: string, pick: { occasionId: string } | { text: string } | null): Promise<Result> {
  const me = await requirePerson();
  return run(async () => {
    const ctx = await loadTodayContext(me, personId);
    await setPlan(me, personId, ctx.date, pick);
    const fresh = await loadTodayContext(me, personId);
    await generateSuggestion(personId, fresh.date, fresh);
  });
}

export async function checkInTapsAction(personId: string, answers: { scaleId: string; optionId: string }[]): Promise<Result> {
  const me = await requirePerson();
  return run(async () => {
    const ctx = await loadTodayContext(me, personId);
    await saveTaps(me, personId, ctx.date, answers);
    const fresh = await loadTodayContext(me, personId);
    await generateSuggestion(personId, fresh.date, fresh);
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
    const fresh = await loadTodayContext(me, personId);
    await generateSuggestion(personId, fresh.date, fresh);
  });
}

/** "How did it go?" from the Today strip. */
export async function rateAction(fitId: string, rating: FitRating): Promise<Result> {
  const me = await requirePerson();
  return run(async () => { await rateFit(me, fitId, rating); });
}

/** TRY IT ON: the chosen board on the person's own body photo. */
export async function tryOnAction(personId: string, suggestionId: string, index: number): Promise<Result & { tryOn?: TryOnView }> {
  const me = await requirePerson();
  try {
    const row = await db.outfitSuggestion.findFirst({ where: { id: suggestionId, personId } });
    const board = (row?.outfits as { itemIds: string[] }[] | undefined)?.[index];
    if (!board) return { ok: false, error: "That look isn’t here anymore." };
    const tryOn = await tryOnLook(me, personId, board.itemIds, "today");
    return { ok: true, tryOn };
  } catch (e) {
    if (e instanceof TryOnError || e instanceof OutfitError) return { ok: false, error: e.message };
    console.error(e); return { ok: false, error: "The try-on didn’t come back. Try again." };
  }
}
