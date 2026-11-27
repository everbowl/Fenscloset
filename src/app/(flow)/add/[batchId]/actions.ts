"use server";

import { revalidatePath } from "next/cache";
import { requirePerson } from "@/lib/auth/current";
import { db } from "@/lib/db";
import { attachEntryPhoto, createItemFromEntry, emptyTags, isSure, ItemError, mergeIntoItem, saveEntryEdits, skipEntry, unskipEntry, type ItemEdits, mirrorFromItem } from "@/lib/items/service";
import { readBackForEntry, readLabelForEntry, type EntryAiResult } from "@/lib/import/process";
import { rotateEntry } from "@/lib/import/rotate-entry";
import { splitEntry } from "@/lib/import/split";
import { abandonBatch, ImportError } from "@/lib/import/service";
import { parseKey } from "@/lib/storage";
import type { TagResult } from "@/lib/ai/tag-item";

export type ActionResult<T = undefined> = { ok: true; value: T } | { ok: false; error: string };

function fail(e: unknown): { ok: false; error: string } {
  if (e instanceof ItemError || e instanceof ImportError) return { ok: false, error: e.message };
  console.error(e);
  return { ok: false, error: "Something went wrong. Try again." };
}

/** Where the batch stands after a card: how many pieces it has put in the closet, and whether it is finished (nothing left to review, tag or fix). */
async function batchStanding(batchId: string): Promise<{ added: number; batchDone: boolean }> {
  const [batch, added] = await Promise.all([db.importBatch.findUnique({ where: { id: batchId }, select: { status: true } }), db.importEntry.count({ where: { batchId, status: "done" } })]);
  return { added, batchDone: batch?.status === "done" };
}

export async function confirmEntryAction(batchId: string, entryId: string, edits: ItemEdits): Promise<ActionResult<{ itemId: string; added: number; batchDone: boolean }>> {
  const person = await requirePerson();
  try {
    const item = await createItemFromEntry(person.id, entryId, edits);
    revalidatePath(`/add/${batchId}`); revalidatePath("/closet");
    return { ok: true, value: { itemId: item.id, ...(await batchStanding(batchId)) } };
  } catch (e) { return fail(e); }
}

/**
 * "Add all" (Add flow v2): every card still waiting that is sure goes into the closet as tagged. Cards that are not
 * sure, or that fail, stay for a look one by one; the result says how many went in and how many are left.
 */
export async function confirmAllAction(batchId: string): Promise<ActionResult<{ added: number; left: number; batchDone: boolean }>> {
  const person = await requirePerson();
  try {
    const batch = await db.importBatch.findUnique({ where: { id: batchId }, select: { personId: true } });
    if (!batch || batch.personId !== person.id) throw new ItemError("Not yours.", 403);
    const waiting = await db.importEntry.findMany({ where: { batchId, status: "needs_confirm" }, orderBy: { order: "asc" }, select: { id: true, aiResult: true } });
    let left = 0;
    for (const w of waiting) {
      const tags = (w.aiResult as EntryAiResult | null)?.tags ?? emptyTags();
      if (!isSure(tags)) { left++; continue; }
      try { await createItemFromEntry(person.id, w.id); } catch (e) { left++; console.error(`add all: entry ${w.id}`, e); }
    }
    revalidatePath(`/add/${batchId}`); revalidatePath("/closet");
    return { ok: true, value: { left, ...(await batchStanding(batchId)) } };
  } catch (e) { return fail(e); }
}

export async function skipEntryAction(batchId: string, entryId: string): Promise<ActionResult<{ added: number; batchDone: boolean }>> {
  const person = await requirePerson();
  try { await skipEntry(person.id, entryId); revalidatePath(`/add/${batchId}`); revalidatePath("/closet"); return { ok: true, value: await batchStanding(batchId) }; } catch (e) { return fail(e); }
}

/** Several pieces in one photo (E1): each garment becomes its own entry in the batch; the original steps aside. */
export async function splitEntryAction(batchId: string, entryId: string): Promise<ActionResult<{ count: number; pieces: number }>> {
  const person = await requirePerson();
  try {
    const r = await splitEntry(person.id, entryId);
    revalidatePath(`/add/${batchId}`); revalidatePath("/add");
    return { ok: true, value: { count: r.entryIds.length, pieces: r.pieces } };
  } catch (e) { return fail(e); }
}

export async function unskipEntryAction(batchId: string, entryId: string): Promise<ActionResult> {
  const person = await requirePerson();
  try { await unskipEntry(person.id, entryId); revalidatePath(`/add/${batchId}`); return { ok: true, value: undefined }; } catch (e) { return fail(e); }
}

export async function mirrorEntryAction(entryId: string, itemId: string): Promise<ActionResult<TagResult>> {
  const person = await requirePerson();
  try { return { ok: true, value: await mirrorFromItem(person.id, entryId, itemId) }; } catch (e) { return fail(e); }
}

export async function mergeEntryAction(batchId: string, entryId: string, itemId: string): Promise<ActionResult<{ added: number; batchDone: boolean }>> {
  const person = await requirePerson();
  try { await mergeIntoItem(person.id, entryId, itemId); revalidatePath(`/add/${batchId}`); revalidatePath("/closet"); return { ok: true, value: await batchStanding(batchId) }; } catch (e) { return fail(e); }
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

/** ROTATE: a quarter turn of the photo on the card. */
export async function rotateEntryAction(entryId: string, dir: "right" | "left" = "right"): Promise<ActionResult<{ photoKey: string }>> {
  const person = await requirePerson();
  try { return { ok: true, value: await rotateEntry(person.id, entryId, dir) }; } catch (e) { return fail(e); }
}

export async function abandonBatchAction(batchId: string): Promise<ActionResult> {
  const person = await requirePerson();
  try { await abandonBatch(person.id, batchId); revalidatePath("/add"); revalidatePath("/closet"); return { ok: true, value: undefined }; } catch (e) { return fail(e); }
}
