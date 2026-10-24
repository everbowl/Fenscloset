"use server";

import { revalidatePath } from "next/cache";
import { requirePerson } from "@/lib/auth/current";
import { deleteFit, rateFit, saveFit, setFitPhoto, setFitTitle, setFitViewers, type FitRating } from "@/lib/fits/service";
import { OutfitError } from "@/lib/outfits/engine";

export type Result = { ok: true; id?: string } | { ok: false; error: string };

async function run(fn: () => Promise<string | void>): Promise<Result> {
  try { const id = await fn(); revalidatePath("/fits"); revalidatePath("/today"); revalidatePath("/closet"); return { ok: true, id: id ?? undefined }; }
  catch (e) { if (e instanceof OutfitError) return { ok: false, error: e.message }; console.error(e); return { ok: false, error: "Something went wrong. Try again." }; }
}

export async function saveFitAction(personId: string, date: string, itemIds: string[], title: string): Promise<Result> {
  const me = await requirePerson(); return run(() => saveFit(me, personId, date, itemIds, title));
}
export async function setFitTitleAction(fitId: string, title: string): Promise<Result> {
  const me = await requirePerson(); return run(() => setFitTitle(me, fitId, title));
}
export async function setFitPhotoAction(fitId: string, key: string | null): Promise<Result> {
  const me = await requirePerson(); return run(() => setFitPhoto(me, fitId, key));
}
export async function setFitViewersAction(fitId: string, personIds: string[]): Promise<Result> {
  const me = await requirePerson(); return run(() => setFitViewers(me, fitId, personIds));
}
export async function rateFitAction(fitId: string, rating: FitRating | null): Promise<Result> {
  const me = await requirePerson(); return run(() => rateFit(me, fitId, rating));
}
export async function deleteFitAction(fitId: string): Promise<Result> {
  const me = await requirePerson(); return run(() => deleteFit(me, fitId));
}
