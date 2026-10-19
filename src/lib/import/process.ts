import { db } from "@/lib/db";
import { deleteObject, getObject, newKey, NotFoundError, putObject } from "@/lib/storage";
import { removeBackground, RemoveBgError } from "@/lib/images/remove-bg";
import { fitCutout, makeThumb, normalizeOriginal, toAiImage } from "@/lib/images/thumb";
import { phash } from "@/lib/images/phash";
import { loadTagLists, rotationFor, tagItem, type TagResult } from "@/lib/ai/tag-item";
import { rotateImage } from "@/lib/images/rotate";
import { isSmoothConfigured, tidyGarment } from "@/lib/images/smooth";
import { readLabel } from "@/lib/ai/read-label";
import { AiError } from "@/lib/ai/claude";
import type { ImportEntry } from "@/generated/prisma/client";
import type { StoreMeta } from "@/lib/store/add";
import { confirmedDuplicate } from "@/lib/items/duplicates";
import type { DuplicateHint } from "@/lib/items/duplicates";

/** What lands in ImportEntry.aiResult. */
/** `edited` lists the tag fields the person changed on the card, so a later re-read never undoes them. */
export type EntryAiResult = { tags: TagResult; warnings: string[]; label?: { brand: string | null; size: string | null }; edited?: string[]; /** "Looks like one you own", decided at processing (photo matches confirmed by Claude); undefined on entries processed before this existed. */ duplicate?: DuplicateHint | null };

export type ProcessOutcome = { status: ImportEntry["status"]; error?: string };

/**
 * Runs one photo through: normalize → remove background → thumbnail → hash → Claude tags.
 * A background-removal failure is a warning (the original stays usable); a tagging failure marks
 * the entry `failed` with a retryable error. Re-running on a `failed` entry starts over.
 */
export async function processEntry(entryId: string): Promise<ProcessOutcome> {
  const entry = await db.importEntry.findUnique({ where: { id: entryId }, include: { batch: true } });
  if (!entry) return { status: "failed", error: "Entry not found" };
  if (!["queued", "uploaded", "failed", "processing"].includes(entry.status)) return { status: entry.status };
  await db.importEntry.update({ where: { id: entryId }, data: { status: "processing", error: null } });
  const ownerId = entry.batch.personId;

  let original: Buffer;
  try {
    original = (await getObject(entry.originalKey)).body;
  } catch (e) {
    const msg = e instanceof NotFoundError ? "The photo never finished uploading." : (e as Error).message;
    await db.importEntry.update({ where: { id: entryId }, data: { status: "failed", error: msg } });
    return { status: "failed", error: msg };
  }

  try {
    const normalized = await normalizeOriginal(original);
    const warnings: string[] = [];

    let cutout: Buffer | null = null;
    let cutoutKey: string | null = entry.cutoutKey;
    try {
      cutout = await fitCutout(await removeBackground(normalized));
      cutoutKey = newKey("cutouts", ownerId, "image/png");
      await putObject(cutoutKey, cutout, "image/png");
    } catch (e) {
      if (e instanceof RemoveBgError) {
        warnings.push(`bg_failed:${e.code}`);
        cutoutKey = null;
      } else throw e;
    }

    let source = cutout ?? normalized;

    const lists = await loadTagLists();
    let tags = await tagItem({ image: await toAiImage(source), lists });
    if (entry.storeMeta) tags = applyStoreMeta(tags, entry.storeMeta as StoreMeta, lists);

    // Auto-upright: a phone held sideways leaves the piece lying on its side; Claude says which turn fixes it.
    const deg = rotationFor(tags.raw.orientation);
    if (deg) {
      const type = cutout ? "image/png" : "image/jpeg";
      source = await rotateImage(source, deg, type);
      const fixedKey = newKey("cutouts", ownerId, type);
      await putObject(fixedKey, source, type);
      if (cutoutKey) await deleteObject(cutoutKey).catch(() => undefined);
      cutoutKey = fixedKey;
      warnings.push(`auto_rotated:${deg}`);
    }

    const thumb = await makeThumb(source);
    const thumbKey = newKey("thumbs", ownerId, "image/jpeg");
    await putObject(thumbKey, thumb, "image/jpeg");
    const hash = await phash(source);
    const duplicate = await confirmedDuplicate(ownerId, { phash: hash, categoryId: tags.categoryId, colorIds: tags.colorIds, brandId: tags.brandId }, source);

    // Auto-tidy (Jeff, 19 Oct 2026): a clean, flat, square-on product picture is parked like SMOOTH; the card
    // shows Before/Undo/Keep and the confirm keeps it unless it was undone. AUTO_TIDY=false turns it off.
    let smoothKey: string | null = entry.smoothKey;
    if (cutout && isSmoothConfigured() && process.env.AUTO_TIDY !== "false") {
      try {
        const out = await tidyGarment(cutout);
        const data = out.contentType === "image/png" ? await fitCutout(out.data) : out.data;
        if (smoothKey) await deleteObject(smoothKey).catch(() => undefined);
        smoothKey = newKey("cutouts", ownerId, out.contentType);
        await putObject(smoothKey, data, out.contentType);
        warnings.push("auto_tidied");
      } catch (e) {
        warnings.push("tidy_failed");
        console.error("auto-tidy failed", e);
      }
    }
    const aiResult: EntryAiResult = { tags, warnings, duplicate };

    await db.importEntry.update({
      where: { id: entryId },
      data: { status: "needs_confirm", cutoutKey, thumbKey, smoothKey, phash: hash, aiResult: JSON.parse(JSON.stringify(aiResult)), error: null },
    });
    return { status: "needs_confirm" };
  } catch (e) {
    const msg = e instanceof AiError
      ? (e.code === "no_key" ? "Tagging is not set up yet (missing ANTHROPIC_API_KEY)." : `Tagging failed: ${e.message}`)
      : `Processing failed: ${(e as Error).message}`;
    await db.importEntry.update({ where: { id: entryId }, data: { status: "failed", error: msg } });
    return { status: "failed", error: msg };
  }
}

/** A piece from a store link or receipt: the store's name, brand, size and color win over the guess. */
export function applyStoreMeta(tags: TagResult, meta: StoreMeta, lists: { brands: { id: string; name: string }[]; colors: { id: string; name: string }[] }): TagResult {
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
    seasonIds: [], formalityId: null, brandText, brandId, sizeText, confidence: 0,
    raw: { name: "", category: "unknown", subcategory: null, colors: [], pattern: "unknown", fabric: "unknown", fabricConfidence: 0, seasons: [], formality: "unknown", brandText, sizeText, confidence: 0 },
  };
}
