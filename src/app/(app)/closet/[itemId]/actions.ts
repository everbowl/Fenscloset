"use server";

import { revalidatePath } from "next/cache";
import { requirePerson } from "@/lib/auth/current";
import { addItemPhoto, answerPhotoNudge, cycleLaundry, laundryCopies, setCopies, setLaundry, splitOneOff, deleteItem, ItemError, removeItemPhoto, rotateItemPhoto, setMirrorPhoto, updateItem, type ItemDetailEdits } from "@/lib/items/service";
import type { LaundryStatus } from "@/generated/prisma/client";
import type { CopyAction, CopyCounts } from "@/lib/items/copies";

export type Result<T = undefined> = { ok: true; value: T } | { ok: false; error: string };

function fail(e: unknown): { ok: false; error: string } {
  if (e instanceof ItemError) return { ok: false, error: e.message };
  console.error(e);
  return { ok: false, error: "Something went wrong. Try again." };
}
const bust = (itemId: string) => { revalidatePath(`/closet/${itemId}`); revalidatePath("/closet"); };

export async function updateItemAction(itemId: string, edits: ItemDetailEdits): Promise<Result> {
  const person = await requirePerson();
  try { await updateItem(person, itemId, edits); bust(itemId); return { ok: true, value: undefined }; } catch (e) { return fail(e); }
}

export async function setLaundryAction(itemId: string, status: LaundryStatus): Promise<Result<LaundryStatus>> {
  const person = await requirePerson();
  try { const s = await setLaundry(person, itemId, status); bust(itemId); return { ok: true, value: s }; } catch (e) { return fail(e); }
}

/** A stack's laundry one copy at a time (F1). */
export async function laundryCopiesAction(itemId: string, action: CopyAction): Promise<Result<CopyCounts & { laundryStatus: LaundryStatus }>> {
  const person = await requirePerson();
  try { const v = await laundryCopies(person, itemId, action); bust(itemId); revalidatePath("/today"); return { ok: true, value: v }; } catch (e) { return fail(e); }
}

export async function setCopiesAction(itemId: string, copies: number): Promise<Result<CopyCounts & { laundryStatus: LaundryStatus }>> {
  const person = await requirePerson();
  try { const v = await setCopies(person, itemId, copies); bust(itemId); revalidatePath("/today"); return { ok: true, value: v }; } catch (e) { return fail(e); }
}

/** One copy becomes its own card; answers with the new piece's id. */
export async function splitOneOffAction(itemId: string): Promise<Result<string>> {
  const person = await requirePerson();
  try { const id = await splitOneOff(person, itemId); bust(itemId); return { ok: true, value: id }; } catch (e) { return fail(e); }
}

export async function cycleLaundryAction(itemId: string): Promise<Result<LaundryStatus>> {
  const person = await requirePerson();
  try { const s = await cycleLaundry(person, itemId); bust(itemId); return { ok: true, value: s }; } catch (e) { return fail(e); }
}

export async function addItemPhotoAction(itemId: string, kind: "alone" | "worn" | "label" | "back", key: string): Promise<Result> {
  const person = await requirePerson();
  try { await addItemPhoto(person, itemId, kind, key); bust(itemId); return { ok: true, value: undefined }; } catch (e) { return fail(e); }
}

export async function notNowPhotoAction(itemId: string): Promise<Result> {
  const person = await requirePerson();
  try { await answerPhotoNudge(person, itemId); bust(itemId); return { ok: true, value: undefined }; } catch (e) { return fail(e); }
}

export async function removeItemPhotoAction(itemId: string, photoId: string): Promise<Result> {
  const person = await requirePerson();
  try { await removeItemPhoto(person, photoId); bust(itemId); return { ok: true, value: undefined }; } catch (e) { return fail(e); }
}

/** "Use in the mirror" on a photo (toggle). */
export async function mirrorPhotoAction(itemId: string, photoId: string): Promise<Result<{ photoId: string | null }>> {
  const person = await requirePerson();
  try { const v = await setMirrorPhoto(person, photoId); bust(itemId); return { ok: true, value: v }; } catch (e) { return fail(e); }
}

export async function rotateItemPhotoAction(itemId: string, photoId: string): Promise<Result<{ photoId: string; key: string }>> {
  const person = await requirePerson();
  try { const v = await rotateItemPhoto(person, photoId, "right"); bust(itemId); return { ok: true, value: v }; } catch (e) { return fail(e); }
}

export async function deleteItemAction(itemId: string): Promise<Result> {
  const person = await requirePerson();
  try { await deleteItem(person, itemId); bust(itemId); return { ok: true, value: undefined }; } catch (e) { return fail(e); }
}
