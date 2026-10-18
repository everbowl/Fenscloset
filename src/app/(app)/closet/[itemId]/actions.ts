"use server";

import { revalidatePath } from "next/cache";
import { requirePerson } from "@/lib/auth/current";
import { addItemPhoto, cycleLaundry, deleteItem, ItemError, removeItemPhoto, updateItem, type ItemDetailEdits } from "@/lib/items/service";
import type { LaundryStatus } from "@/generated/prisma/client";

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

export async function cycleLaundryAction(itemId: string): Promise<Result<LaundryStatus>> {
  const person = await requirePerson();
  try { const s = await cycleLaundry(person, itemId); bust(itemId); return { ok: true, value: s }; } catch (e) { return fail(e); }
}

export async function addItemPhotoAction(itemId: string, kind: "alone" | "worn" | "label" | "back", key: string): Promise<Result> {
  const person = await requirePerson();
  try { await addItemPhoto(person, itemId, kind, key); bust(itemId); return { ok: true, value: undefined }; } catch (e) { return fail(e); }
}

export async function removeItemPhotoAction(itemId: string, photoId: string): Promise<Result> {
  const person = await requirePerson();
  try { await removeItemPhoto(person, photoId); bust(itemId); return { ok: true, value: undefined }; } catch (e) { return fail(e); }
}

export async function deleteItemAction(itemId: string): Promise<Result> {
  const person = await requirePerson();
  try { await deleteItem(person, itemId); bust(itemId); return { ok: true, value: undefined }; } catch (e) { return fail(e); }
}
