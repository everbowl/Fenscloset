"use server";

import { revalidatePath } from "next/cache";
import { requirePerson } from "@/lib/auth/current";
import { attachEntryPhoto, createItemFromEntry, ItemError, mergeIntoItem, saveEntryEdits, skipEntry, type ItemEdits } from "@/lib/items/service";
import { readLabelForEntry } from "@/lib/import/process";
import { abandonBatch, ImportError } from "@/lib/import/service";
import { parseKey } from "@/lib/storage";
import type { TagResult } from "@/lib/ai/tag-item";

export type ActionResult<T = undefined> = { ok: true; value: T } | { ok: false; error: string };

function fail(e: unknown): { ok: false; error: string } {
  if (e instanceof ItemError || e instanceof ImportError) return { ok: false, error: e.message };
  console.error(e);
  return { ok: false, error: "Something went wrong. Try again." };
}

export async function confirmEntryAction(batchId: string, entryId: string, edits: ItemEdits): Promise<ActionResult<{ itemId: string }>> {
  const person = await requirePerson();
  try {
    const item = await createItemFromEntry(person.id, entryId, edits);
    revalidatePath(`/add/${batchId}`); revalidatePath("/closet");
    return { ok: true, value: { itemId: item.id } };
  } catch (e) { return fail(e); }
}

export async function skipEntryAction(batchId: string, entryId: string): Promise<ActionResult> {
  const person = await requirePerson();
  try { await skipEntry(person.id, entryId); revalidatePath(`/add/${batchId}`); return { ok: true, value: undefined }; } catch (e) { return fail(e); }
}

export async function mergeEntryAction(batchId: string, entryId: string, itemId: string): Promise<ActionResult> {
  const person = await requirePerson();
  try { await mergeIntoItem(person.id, entryId, itemId); revalidatePath(`/add/${batchId}`); revalidatePath("/closet"); return { ok: true, value: undefined }; } catch (e) { return fail(e); }
}

export async function saveEditsAction(entryId: string, edits: ItemEdits): Promise<ActionResult<TagResult>> {
  const person = await requirePerson();
  try { return { ok: true, value: await saveEntryEdits(person.id, entryId, edits) }; } catch (e) { return fail(e); }
}

/** After the phone uploaded a label or worn photo (key already in the bucket). Labels get read by Claude. */
export async function attachPhotoAction(entryId: string, kind: "label" | "worn", key: string): Promise<ActionResult<TagResult | null>> {
  const person = await requirePerson();
  const parsed = parseKey(key);
  if (!parsed || parsed.ownerId !== person.id || parsed.kind !== (kind === "label" ? "labels" : "worn")) return { ok: false, error: "That photo is not yours." };
  try {
    await attachEntryPhoto(person.id, entryId, kind, key);
    if (kind === "label") {
      const res = await readLabelForEntry(entryId, key);
      return { ok: true, value: res?.tags ?? null };
    }
    return { ok: true, value: null };
  } catch (e) { return fail(e); }
}

export async function abandonBatchAction(batchId: string): Promise<ActionResult> {
  const person = await requirePerson();
  try { await abandonBatch(person.id, batchId); revalidatePath("/add"); return { ok: true, value: undefined }; } catch (e) { return fail(e); }
}
