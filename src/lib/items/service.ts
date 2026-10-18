import { db } from "@/lib/db";
import { finishBatchIfDone } from "@/lib/import/service";
import type { EntryAiResult } from "@/lib/import/process";
import type { TagResult } from "@/lib/ai/tag-item";
import type { Item } from "@/generated/prisma/client";

export class ItemError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = "ItemError";
  }
}

/** What the confirm screen can change before saving. Everything is an id from the editable lists. */
export type ItemEdits = {
  name?: string;
  categoryId?: string | null;
  subcategoryId?: string | null;
  colorIds?: string[];
  patternId?: string | null;
  fabricId?: string | null;
  seasonIds?: string[];
  formalityId?: string | null;
  brandId?: string | null;
  brandText?: string | null;
  sizeText?: string | null;
};

export function applyEdits(tags: TagResult, edits: ItemEdits): TagResult {
  const next = { ...tags };
  if (edits.name !== undefined) next.name = edits.name.trim().slice(0, 80) || tags.name;
  if (edits.categoryId !== undefined) { next.categoryId = edits.categoryId; if (edits.subcategoryId === undefined) next.subcategoryId = null; }
  if (edits.subcategoryId !== undefined) next.subcategoryId = edits.subcategoryId;
  if (edits.colorIds !== undefined) next.colorIds = [...new Set(edits.colorIds)];
  if (edits.patternId !== undefined) next.patternId = edits.patternId;
  if (edits.fabricId !== undefined) { next.fabricId = edits.fabricId; next.fabricConfidence = 1; }
  if (edits.seasonIds !== undefined) next.seasonIds = [...new Set(edits.seasonIds)];
  if (edits.formalityId !== undefined) next.formalityId = edits.formalityId;
  if (edits.brandId !== undefined) next.brandId = edits.brandId;
  if (edits.brandText !== undefined) next.brandText = edits.brandText;
  if (edits.sizeText !== undefined) next.sizeText = edits.sizeText?.trim().slice(0, 20) || null;
  return next;
}

async function ownedEntry(personId: string, entryId: string) {
  const entry = await db.importEntry.findUnique({ where: { id: entryId }, include: { batch: true } });
  if (!entry || entry.batch.personId !== personId) throw new ItemError("Not yours.", 403);
  return entry;
}

/** Saves row edits on the entry so leaving and coming back keeps them. */
export async function saveEntryEdits(personId: string, entryId: string, edits: ItemEdits): Promise<TagResult> {
  const entry = await ownedEntry(personId, entryId);
  const ai = (entry.aiResult as EntryAiResult | null) ?? { tags: emptyTags(), warnings: [] };
  const tags = applyEdits(ai.tags, edits);
  await db.importEntry.update({ where: { id: entryId }, data: { aiResult: JSON.parse(JSON.stringify({ ...ai, tags })) } });
  return tags;
}

export async function personalClosetId(personId: string): Promise<string> {
  const closet = await db.closet.findFirst({ where: { ownerId: personId, kind: "personal" } })
    ?? await db.closet.create({ data: { ownerId: personId, kind: "personal", name: "My closet" } });
  return closet.id;
}

/** The one-tap confirm: entry → Item with photos, tags and the owner's personal closet. */
export async function createItemFromEntry(personId: string, entryId: string, edits: ItemEdits = {}): Promise<Item> {
  const entry = await ownedEntry(personId, entryId);
  if (entry.status !== "needs_confirm") throw new ItemError(entry.status === "done" ? "Already added." : "This photo is still being tagged.", 409);
  const ai = (entry.aiResult as EntryAiResult | null) ?? { tags: emptyTags(), warnings: [] };
  const tags = applyEdits(ai.tags, edits);
  if (!tags.categoryId) throw new ItemError("Pick a category first.");
  const closetId = await personalClosetId(personId);
  const connect = (ids: string[]) => ({ connect: ids.map((id) => ({ id })) });
  const item = await db.$transaction(async (tx) => {
    const made = await tx.item.create({
      data: {
        ownerId: personId,
        name: tags.name,
        categoryId: tags.categoryId,
        subcategoryId: tags.subcategoryId,
        brandId: tags.brandId,
        size: tags.sizeText,
        phash: entry.phash,
        aiConfidence: JSON.parse(JSON.stringify({ confidence: tags.confidence, fabricConfidence: tags.fabricConfidence, warnings: ai.warnings })),
        colors: connect(tags.colorIds),
        patterns: connect(tags.patternId ? [tags.patternId] : []),
        fabrics: connect(tags.fabricId ? [tags.fabricId] : []),
        seasons: connect(tags.seasonIds),
        formalities: connect(tags.formalityId ? [tags.formalityId] : []),
        closets: { create: [{ closetId }] },
        photos: {
          create: [
            { kind: "alone", bucketKey: entry.originalKey, isPrimary: !entry.cutoutKey },
            ...(entry.cutoutKey ? [{ kind: "cutout" as const, bucketKey: entry.cutoutKey, isPrimary: true }] : []),
            ...(entry.thumbKey ? [{ kind: "thumb" as const, bucketKey: entry.thumbKey }] : []),
            ...(entry.labelKey ? [{ kind: "label" as const, bucketKey: entry.labelKey }] : []),
            ...(entry.wornKey ? [{ kind: "worn" as const, bucketKey: entry.wornKey }] : []),
          ],
        },
      },
    });
    await tx.importEntry.update({ where: { id: entryId }, data: { status: "done", itemId: made.id, aiResult: JSON.parse(JSON.stringify({ ...ai, tags })) } });
    return made;
  });
  await finishBatchIfDone(entry.batchId);
  return item;
}

/** "SAME?": fold this photo into an item that already exists instead of making a second one. */
export async function mergeIntoItem(personId: string, entryId: string, itemId: string): Promise<void> {
  const entry = await ownedEntry(personId, entryId);
  const item = await db.item.findUnique({ where: { id: itemId }, select: { ownerId: true, photos: { select: { kind: true } } } });
  if (!item || item.ownerId !== personId) throw new ItemError("Not yours.", 403);
  const hasPrimary = item.photos.length > 0;
  await db.$transaction(async (tx) => {
    await tx.itemPhoto.createMany({
      data: [
        { itemId, kind: "alone", bucketKey: entry.originalKey, isPrimary: !hasPrimary && !entry.cutoutKey },
        ...(entry.cutoutKey ? [{ itemId, kind: "cutout" as const, bucketKey: entry.cutoutKey, isPrimary: !hasPrimary }] : []),
        ...(entry.thumbKey ? [{ itemId, kind: "thumb" as const, bucketKey: entry.thumbKey }] : []),
        ...(entry.labelKey ? [{ itemId, kind: "label" as const, bucketKey: entry.labelKey }] : []),
        ...(entry.wornKey ? [{ itemId, kind: "worn" as const, bucketKey: entry.wornKey }] : []),
      ],
      skipDuplicates: true,
    });
    await tx.importEntry.update({ where: { id: entryId }, data: { status: "done", itemId } });
  });
  await finishBatchIfDone(entry.batchId);
}

export async function skipEntry(personId: string, entryId: string): Promise<void> {
  const entry = await ownedEntry(personId, entryId);
  await db.importEntry.update({ where: { id: entryId }, data: { status: "skipped" } });
  await finishBatchIfDone(entry.batchId);
}

export async function attachEntryPhoto(personId: string, entryId: string, kind: "label" | "worn", key: string): Promise<void> {
  await ownedEntry(personId, entryId);
  await db.importEntry.update({ where: { id: entryId }, data: kind === "label" ? { labelKey: key } : { wornKey: key } });
}

export function emptyTags(): TagResult {
  return {
    name: "Untitled piece", categoryId: null, subcategoryId: null, colorIds: [], patternId: null, fabricId: null, fabricConfidence: 0,
    seasonIds: [], formalityId: null, brandText: null, brandId: null, sizeText: null, confidence: 0,
    raw: { name: "", category: "unknown", subcategory: null, colors: [], pattern: "unknown", fabric: "unknown", fabricConfidence: 0, seasons: [], formality: "unknown", brandText: null, sizeText: null, confidence: 0 },
  };
}
