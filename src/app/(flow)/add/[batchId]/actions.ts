"use server";

import { revalidatePath } from "next/cache";
import { requirePerson } from "@/lib/auth/current";
import { attachEntryPhoto, createItemFromEntry, ItemError, mergeIntoItem, saveEntryEdits, skipEntry, type ItemEdits, mirrorFromItem } from "@/lib/items/service";
import { readBackForEntry, readLabelForEntry } from "@/lib/import/process";
import { keepSmooth, smoothEntry } from "@/lib/import/smooth-entry";
import { rotateEntry } from "@/lib/import/rotate-entry";
import { SmoothError } from "@/lib/images/smooth";
import { abandonBatch, ImportError } from "@/lib/import/service";
import { parseKey } from "@/lib/storage";
import type { TagResult } from "@/lib/ai/tag-item";

export type ActionResult<T = undefined> = { ok: true; value: T } | { ok: false; error: string };

function fail(e: unknown): { ok: false; error: string } {
  if (e instanceof ItemError || e instanceof ImportError || e instanceof SmoothError) return { ok: false, error: e.message };
  console.error(e);
  return { ok: false, error: "Something went wrong. Try again." };
}

export async function confirmEntryAction(batchId: string, entryId: string, edits: ItemEdits): Promise<ActionResult<{ itemId: string }>> {
  const person = await requirePerson();
  try {
    await keepSmooth(person.id, entryId, true); // a parked tidy/smooth copy still on the card is kept
    const item = await createItemFromEntry(person.id, entryId, edits);
    revalidatePath(`/add/${batchId}`); revalidatePath("/closet");
    return { ok: true, value: { itemId: item.id } };
  } catch (e) { return fail(e); }
}

export async function skipEntryAction(batchId: string, entryId: string): Promise<ActionResult> {
  const person = await requirePerson();
  try { await skipEntry(person.id, entryId); revalidatePath(`/add/${batchId}`); return { ok: true, value: undefined }; } catch (e) { return fail(e); }
}

export async function mirrorEntryAction(entryId: string, itemId: string): Promise<ActionResult<TagResult>> {
  const person = await requirePerson();
  try { return { ok: true, value: await mirrorFromItem(person.id, entryId, itemId) }; } catch (e) { return fail(e); }
}

export async function mergeEntryAction(batchId: string, entryId: string, itemId: string): Promise<ActionResult> {
  const person = await requirePerson();
  try { await keepSmooth(person.id, entryId, true); await mergeIntoItem(person.id, entryId, itemId); revalidatePath(`/add/${batchId}`); revalidatePath("/closet"); return { ok: true, value: undefined }; } catch (e) { return fail(e); }
}

export async function saveEditsAction(entryId: string, edits: ItemEdits): Promise<ActionResult<TagResult>> {
  const person = await requirePerson();
  try { return { ok: true, value: await saveEntryEdits(person.id, entryId, edits) }; } catch (e) { return fail(e); }
}

/** After the phone uploaded a label, worn or back photo (key already in the bucket). Labels and backs get read by Claude. */
export async function attachPhotoAction(entryId: string, kind: "label" | "worn" | "back", key: string): Promise<ActionResult<TagResult | null>> {
  const person = await requirePerson();
  const parsed = parseKey(key);
  const wantKind = kind === "label" ? "labels" : kind === "worn" ? "worn" : "originals";
  if (!parsed || parsed.ownerId !== person.id || parsed.kind !== wantKind) return { ok: false, error: "That photo is not yours." };
  try {
    await attachEntryPhoto(person.id, entryId, kind, key);
    if (kind === "label") {
      const res = await readLabelForEntry(entryId, key);
      return { ok: true, value: res?.tags ?? null };
    }
    if (kind === "back") {
      const res = await readBackForEntry(entryId, key);
      return { ok: true, value: res?.tags ?? null };
    }
    return { ok: true, value: null };
  } catch (e) { return fail(e); }
}

/** SMOOTH: a wrinkle-free copy, parked until KEEP or UNDO. */
export async function smoothEntryAction(entryId: string, strength: "normal" | "more" | "tidy" = "normal"): Promise<ActionResult<{ smoothKey: string }>> {
  const person = await requirePerson();
  try { return { ok: true, value: await smoothEntry(person.id, entryId, strength) }; } catch (e) { return fail(e); }
}

/** ROTATE: a quarter turn of the photo on the card. */
export async function rotateEntryAction(entryId: string, dir: "right" | "left" = "right"): Promise<ActionResult<{ photoKey: string; smoothKey: string | null }>> {
  const person = await requirePerson();
  try { return { ok: true, value: await rotateEntry(person.id, entryId, dir) }; } catch (e) { return fail(e); }
}

export async function keepSmoothAction(batchId: string, entryId: string, keep: boolean): Promise<ActionResult<{ photoKey: string }>> {
  const person = await requirePerson();
  try { const v = await keepSmooth(person.id, entryId, keep); revalidatePath(`/add/${batchId}`); return { ok: true, value: v }; } catch (e) { return fail(e); }
}

export async function abandonBatchAction(batchId: string): Promise<ActionResult> {
  const person = await requirePerson();
  try { await abandonBatch(person.id, batchId); revalidatePath("/add"); return { ok: true, value: undefined }; } catch (e) { return fail(e); }
}
