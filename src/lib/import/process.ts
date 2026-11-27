import { db } from "@/lib/db";
import { isAiCapError, nextHouseholdMidnight } from "@/lib/ai/usage";
import { deleteObject, getObject, newKey, NotFoundError, putObject } from "@/lib/storage";
import { removeBackground, RemoveBgError } from "@/lib/images/remove-bg";
import { fitCutout, makeThumb, normalizeOriginal, toAiImage } from "@/lib/images/thumb";
import { phash } from "@/lib/images/phash";
import { loadTagLists, rotationFor, tagItem, type TagLists, type TagResult } from "@/lib/ai/tag-item";
import { rotateImage } from "@/lib/images/rotate";
import { readLabel } from "@/lib/ai/read-label";
import { AiError } from "@/lib/ai/claude";
import type { ImportEntry } from "@/generated/prisma/client";
import type { StoreMeta } from "@/lib/store/add";
import { confirmedDuplicate, loadDuplicateCandidates } from "@/lib/items/duplicates";
import type { DuplicateHint } from "@/lib/items/duplicates";

/** What lands in ImportEntry.aiResult. */
/** `edited` lists the tag fields the person changed on the card, so a later re-read never undoes them. */
export type EntryAiResult = { tags: TagResult; warnings: string[]; label?: { brand: string | null; size: string | null }; edited?: string[]; /** "Looks like one you own", decided at processing (photo matches confirmed by Claude); undefined on entries processed before this existed. */ duplicate?: DuplicateHint | null };

export type ProcessOutcome = { status: ImportEntry["status"]; error?: string };

/** Entry states a worker may pick up. `processing` is included for a retry after a restart or a watchdog drop. */
const CLAIMABLE: ImportEntry["status"][] = ["queued", "uploaded", "failed", "processing"];

/**
 * Runs one photo through: normalize → remove background and Claude tags (side by side) → thumbnail → hash → duplicate check.
 * A background-removal failure is a warning (the original stays usable); a tagging failure marks the entry `failed`
 * with a retryable error. Re-running on a `failed` entry starts over.
 *
 * The entry is claimed first (one worker at a time, review B B5) and every final write is guarded on it still being
 * ours (status "processing"): a watchdog drop, a split, or a retry from another tab cannot be overwritten by a late answer.
 */
export async function processEntry(entryId: string): Promise<ProcessOutcome> {
  const entry = await db.importEntry.findUnique({ where: { id: entryId }, include: { batch: true } });
  if (!entry) return { status: "failed", error: "Entry not found" };
  if (!CLAIMABLE.includes(entry.status)) return { status: entry.status };
  // An entry paused for the day's AI allowance (security item 8) is not claimable until its moment comes.
  const claimed = await db.importEntry.updateMany({ where: { id: entryId, status: { in: CLAIMABLE }, OR: [{ retryAfter: null }, { retryAfter: { lte: new Date() } }] }, data: { status: "processing", error: null, retryAfter: null } });
  if (claimed.count === 0) return { status: entry.status };
  const ownerId = entry.batch.personId;
  const meta = (entry.storeMeta as StoreMeta | null) ?? null;
  /** A late write loses: the row must still be ours, as claimed this very time (a retry's own claim moves updatedAt). */
  const stamp = await db.importEntry.findUnique({ where: { id: entryId }, select: { updatedAt: true } });
  const ours = { id: entryId, status: "processing" as const, updatedAt: stamp?.updatedAt };

  let original: Buffer;
  try {
    original = (await getObject(entry.originalKey)).body;
  } catch (e) {
    const msg = e instanceof NotFoundError ? "The photo never finished uploading." : (e as Error).message;
    console.error(`import: entry ${entryId} failed before processing: ${msg}`);
    await db.importEntry.updateMany({ where: ours, data: { status: "failed", error: msg } });
    return { status: "failed", error: msg };
  }

  const made: string[] = []; // objects written this run, dropped again if the row is no longer ours
  try {
    const normalized = await normalizeOriginal(original);
    const warnings: string[] = [];
    // The owner's pieces for the "one you own" check load while the slow calls run (review B B3).
    const candidates = loadDuplicateCandidates(ownerId).catch(() => []);
    const lists = await loadTagLists();

    let cutout: Buffer | null = null;
    let cutoutKey: string | null = null;
    let tags: TagResult;
    if (meta?.noPhoto) {
      // No picture from the store: nothing for remove.bg or Claude to look at. The store's facts carry the piece.
      warnings.push("no_store_photo");
      tags = applyStoreMeta(emptyTags(null, null, null), meta, lists);
    } else {
      // Tags come from the straightened original, so Claude and remove.bg run at the same time (review B B3).
      const [cut, tagged] = await Promise.all([
        removeBackground(normalized, { personId: ownerId }).then(fitCutout).catch((e: unknown) => { if (e instanceof RemoveBgError) return e; throw e; }),
        toAiImage(normalized).then((image) => tagItem({ image, lists, personId: ownerId })),
      ]);
      if (cut instanceof RemoveBgError) warnings.push(`bg_failed:${cut.code}`);
      else {
        cutout = cut;
        cutoutKey = newKey("cutouts", ownerId, "image/png");
        await putObject(cutoutKey, cutout, "image/png"); made.push(cutoutKey);
      }
      tags = meta ? applyStoreMeta(tagged, meta, lists) : tagged;
    }

    let source = cutout ?? normalized;

    // Auto-upright: a phone held sideways leaves the piece lying on its side; Claude says which turn fixes it.
    const deg = rotationFor(tags.raw.orientation);
    if (deg) {
      const type = cutout ? "image/png" : "image/jpeg";
      source = await rotateImage(source, deg, type);
      const fixedKey = newKey("cutouts", ownerId, type);
      await putObject(fixedKey, source, type); made.push(fixedKey);
      if (cutoutKey) await deleteObject(cutoutKey).catch(() => undefined);
      cutoutKey = fixedKey;
      warnings.push(`auto_rotated:${deg}`);
    }

    const thumbKey = newKey("thumbs", ownerId, "image/jpeg");
    const [, hash] = await Promise.all([makeThumb(source).then((thumb) => putObject(thumbKey, thumb, "image/jpeg")), phash(source)]);
    made.push(thumbKey);
    const duplicate = meta?.noPhoto ? null : await confirmedDuplicate(ownerId, { phash: hash, categoryId: tags.categoryId, colorIds: tags.colorIds, brandId: tags.brandId }, source, await candidates);

    const aiResult: EntryAiResult = { tags, warnings, duplicate };
    const written = await db.importEntry.updateMany({
      where: ours,
      data: { status: "needs_confirm", cutoutKey, thumbKey, phash: hash, aiResult: JSON.parse(JSON.stringify(aiResult)), error: null },
    });
    if (written.count === 0) {
      // Someone else owns the row now (the watchdog failed it, or a retry restarted it): keep their files, drop ours.
      await Promise.all(made.map((k) => deleteObject(k).catch(() => undefined)));
      console.warn(`import: entry ${entryId} finished after it was taken over; result dropped`);
      return { status: (await db.importEntry.findUnique({ where: { id: entryId }, select: { status: true } }))?.status ?? "failed" };
    }
    // A retry leaves the previous run's cutout and thumb behind otherwise (review B B4).
    for (const old of [entry.cutoutKey, entry.thumbKey]) if (old && old !== cutoutKey && old !== thumbKey) await deleteObject(old).catch(() => undefined);

    // C1 (Jeff, 3 Nov 2026): a piece with store facts (a link or a receipt, not a photo the person took) goes straight
    // into the closet, no card; it is fixable on the piece page. A category the AI could not place is no reason to
    // hold it back (review B A2.2): it lands with no category and the closet shows "Needs a category" on it.
    if (meta && !meta.matched) {
      try {
        const { createItemFromEntry } = await import("@/lib/items/service");
        await createItemFromEntry(ownerId, entryId, {}, { allowNoCategory: true });
        console.log(`import: entry ${entryId} landed in the closet (${meta.name}${tags.categoryId ? "" : ", no category yet"})`);
        return { status: "done" };
      } catch (e) {
        // The piece keeps its card; the reason shows on the Tagging card and the confirm card (review B B6).
        const why = `Could not add it on its own: ${(e as Error).message}`;
        console.error(`auto-add from store: entry ${entryId}: ${why}`);
        await db.importEntry.updateMany({ where: { id: entryId, status: "needs_confirm" }, data: { error: why } });
        return { status: "needs_confirm", error: why };
      }
    }
    return { status: "needs_confirm" };
  } catch (e) {
    if (isAiCapError(e)) {
      // The day's AI allowance ran out: the entry waits for tomorrow instead of failing (security item 8).
      const retryAfter = await nextHouseholdMidnight();
      await db.importEntry.updateMany({ where: { id: entryId, status: "processing" }, data: { status: "queued", error: e.message, retryAfter } });
      return { status: "queued", error: e.message };
    }
    const msg = e instanceof AiError
      ? (e.code === "no_key" ? "Tagging is not set up yet (missing ANTHROPIC_API_KEY)." : `Tagging failed: ${e.message}`)
      : `Processing failed: ${(e as Error).message}`;
    console.error(`import: entry ${entryId} failed: ${msg}`);
    const marked = await db.importEntry.updateMany({ where: ours, data: { status: "failed", error: msg } });
    if (marked.count === 0) await Promise.all(made.map((k) => deleteObject(k).catch(() => undefined)));
    return { status: "failed", error: msg };
  }
}

/**
 * A piece from a store link or receipt: the store's name, brand, size, color and (when the page or the receipt knew
 * it) category win over the guess. An unknown category stays null; the piece is added anyway and asks for one later.
 */
export function applyStoreMeta(tags: TagResult, meta: StoreMeta, lists: Pick<TagLists, "brands" | "colors" | "categories">): TagResult {
  const next = { ...tags };
  if (meta.name) next.name = meta.name.slice(0, 80);
  if (meta.brandText) {
    next.brandText = meta.brandText;
    next.brandId = lists.brands.find((b) => b.name.toLowerCase() === meta.brandText!.toLowerCase())?.id ?? tags.brandId;
  }
  if (meta.size) next.sizeText = meta.size;
  if (meta.color) {
    const words = meta.color.toLowerCase();
    const hits = lists.colors.filter((c) => words.includes(c.name.toLowerCase())).map((c) => c.id);
    if (hits.length) next.colorIds = hits;
  }
  if (meta.category) {
    const cat = lists.categories.find((c) => c.name.toLowerCase() === meta.category!.trim().toLowerCase());
    if (cat && cat.id !== tags.categoryId) {
      next.categoryId = cat.id;
      next.subcategoryId = cat.subcategories.some((s) => s.id === tags.subcategoryId) ? tags.subcategoryId : null;
    }
  }
  return next;
}

/** Reads a label photo already uploaded for the entry and merges brand/size into its tags. */
export async function readLabelForEntry(entryId: string, labelKey: string): Promise<EntryAiResult | null> {
  const entry = await db.importEntry.findUnique({ where: { id: entryId } });
  if (!entry) return null;
  const { body } = await getObject(labelKey);
  const label = await readLabel(await toAiImage(body));
  const current = (entry.aiResult as EntryAiResult | null) ?? null;
  const lists = await loadTagLists();
  const brand = label.brand ? lists.brands.find((b) => b.name.toLowerCase() === label.brand!.toLowerCase()) ?? null : null;
  const next: EntryAiResult = current
    ? { ...current, label: { brand: label.brand, size: label.size }, tags: { ...current.tags, brandText: label.brand ?? current.tags.brandText, brandId: brand?.id ?? current.tags.brandId, sizeText: label.size ?? current.tags.sizeText } }
    : { tags: emptyTags(label.brand, brand?.id ?? null, label.size), warnings: [], label: { brand: label.brand, size: label.size } };
  await db.importEntry.update({ where: { id: entryId }, data: { labelKey, aiResult: JSON.parse(JSON.stringify(next)) } });
  return next;
}

/**
 * A back photo was added on the card: Claude reads front and back together. Fields the person already
 * edited, and a brand or size read off the label, stay as they are; the rest take the two-photo read.
 */
export async function readBackForEntry(entryId: string, backKey: string): Promise<EntryAiResult | null> {
  const entry = await db.importEntry.findUnique({ where: { id: entryId } });
  if (!entry) return null;
  const current = (entry.aiResult as EntryAiResult | null) ?? { tags: emptyTags(null, null, null), warnings: [] };
  const front = await toAiImage((await getObject(entry.cutoutKey ?? entry.originalKey)).body);
  const back = await toAiImage((await getObject(backKey)).body);
  const lists = await loadTagLists();
  const fresh = await tagItem({ image: front, back, lists });
  const keep = new Set(current.edited ?? []);
  if (current.label) { keep.add("brandText"); keep.add("brandId"); keep.add("sizeText"); }
  const merged: TagResult = { ...fresh };
  for (const k of keep) (merged as unknown as Record<string, unknown>)[k] = (current.tags as unknown as Record<string, unknown>)[k];
  if (keep.has("categoryId")) merged.subcategoryId = current.tags.subcategoryId;
  const next: EntryAiResult = { ...current, tags: merged };
  await db.importEntry.update({ where: { id: entryId }, data: { backKey, aiResult: JSON.parse(JSON.stringify(next)) } });
  return next;
}

function emptyTags(brandText: string | null, brandId: string | null, sizeText: string | null): TagResult {
  return {
    name: "Untitled piece", categoryId: null, subcategoryId: null, colorIds: [], patternId: null, fabricId: null, fabricConfidence: 0,
    seasonIds: [], formalityId: null, brandText, brandId, sizeText, confidence: 0, features: [],
    raw: { name: "", category: "unknown", subcategory: null, colors: [], pattern: "unknown", fabric: "unknown", fabricConfidence: 0, seasons: [], formality: "unknown", brandText, sizeText, confidence: 0 },
  };
}
