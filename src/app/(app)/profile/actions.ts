"use server";

import { revalidatePath } from "next/cache";
import { requirePerson } from "@/lib/auth/current";
import { updatePersonDetails } from "@/lib/people/service";
import {
  addBodyPhoto, ProfileError, removeBodyPhoto, removeSize, setBodyPhotoPrivacy, setBodyViewers, setFitNotes, setMeasurement, setMinorBodyImageApproval,
  setNeverSuggest, setShoppers, updateFavorites, updateStyle, upsertSize,
} from "@/lib/profiles/service";

export type Result = { ok: true } | { ok: false; error: string };

async function run(fn: () => Promise<unknown>, paths: string[] = ["/profile", "/profile/body", "/profile/style", "/profile/brands", "/profile/settings"]): Promise<Result> {
  try {
    await fn();
    for (const p of paths) revalidatePath(p);
    return { ok: true };
  } catch (e) {
    if (e instanceof ProfileError) return { ok: false, error: e.message };
    console.error(e);
    return { ok: false, error: "Something went wrong. Try again." };
  }
}

export async function setMeasurementAction(ownerId: string, kindId: string, value: string): Promise<Result> {
  const me = await requirePerson(); return run(() => setMeasurement(me, ownerId, kindId, value));
}
export async function setFitNotesAction(ownerId: string, notes: string): Promise<Result> {
  const me = await requirePerson(); return run(() => setFitNotes(me, ownerId, notes));
}
export async function upsertSizeAction(ownerId: string, input: { id?: string; brandId: string; categoryId: string | null; size: string }): Promise<Result> {
  const me = await requirePerson(); return run(() => upsertSize(me, ownerId, input));
}
export async function removeSizeAction(ownerId: string, id: string): Promise<Result> {
  const me = await requirePerson(); return run(() => removeSize(me, ownerId, id));
}
export async function addBodyPhotoAction(ownerId: string, key: string, onlyMe = false): Promise<Result> {
  const me = await requirePerson(); return run(() => addBodyPhoto(me, ownerId, key, { onlyMe }));
}
export async function setBodyPhotoPrivacyAction(ownerId: string, photoId: string, onlyMe: boolean): Promise<Result> {
  const me = await requirePerson(); return run(() => setBodyPhotoPrivacy(me, ownerId, photoId, onlyMe));
}
export async function removeBodyPhotoAction(ownerId: string, photoId: string): Promise<Result> {
  const me = await requirePerson(); return run(() => removeBodyPhoto(me, ownerId, photoId));
}
export async function updateStyleAction(ownerId: string, patch: { lovedColorIds?: string[]; avoidColorIds?: string[]; styleWordIds?: string[] }): Promise<Result> {
  const me = await requirePerson(); return run(() => updateStyle(me, ownerId, patch));
}
export async function setNeverSuggestAction(ownerId: string, itemId: string, never: boolean): Promise<Result> {
  const me = await requirePerson(); return run(() => setNeverSuggest(me, ownerId, itemId, never), ["/profile/style", `/closet/${itemId}`]);
}
export async function updateFavoritesAction(ownerId: string, patch: { brandIds?: string[]; storeIds?: string[] }): Promise<Result> {
  const me = await requirePerson(); return run(() => updateFavorites(me, ownerId, patch));
}
export async function setBodyViewersAction(viewerIds: string[]): Promise<Result> {
  const me = await requirePerson(); return run(() => setBodyViewers(me, me.id, viewerIds));
}
export async function setShoppersAction(shopperIds: string[]): Promise<Result> {
  const me = await requirePerson(); return run(() => setShoppers(me, me.id, shopperIds));
}
export async function disconnectCalendarAction(): Promise<Result> {
  const me = await requirePerson();
  return run(async () => { const { disconnect } = await import("@/lib/plans/google"); await disconnect(me.id); });
}
export async function setCalendarIdsAction(ids: string[]): Promise<Result> {
  const me = await requirePerson();
  return run(async () => { const { setCalendarIds } = await import("@/lib/plans/google"); await setCalendarIds(me.id, ids); });
}
export async function setSavedZipAction(zip: string): Promise<Result> {
  const me = await requirePerson();
  const z = zip.trim();
  if (z && !/^\d{5}$/.test(z)) return { ok: false, error: "Use a 5-digit zip." };
  return run(() => updatePersonDetails(me.id, { savedZip: z || null }));
}
export async function setMinorBodyImageApprovalAction(minorId: string, approved: boolean): Promise<Result> {
  const me = await requirePerson(); return run(() => setMinorBodyImageApproval(me, minorId, approved), ["/profile/body", `/admin/people/${minorId}`]);
}
