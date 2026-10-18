import { db } from "@/lib/db";
import { priceNumber, storeIdByName, type StoreMeta } from "@/lib/store/add";
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
  const edited = [...new Set([...(ai.edited ?? []), ...Object.keys(edits).filter((k) => edits[k as keyof ItemEdits] !== undefined)])];
  await db.importEntry.update({ where: { id: entryId }, data: { aiResult: JSON.parse(JSON.stringify({ ...ai, tags, edited })) } });
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
  const meta = (entry.storeMeta as StoreMeta | null) ?? null;
  const storeId = meta?.storeName ? await storeIdByName(meta.storeName) : null;
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
        ...(meta ? { storeId, purchaseUrl: meta.url?.slice(0, 500) ?? null, purchasePrice: priceNumber(meta.priceText), purchaseDate: meta.purchaseDate ? new Date(`${meta.purchaseDate}T12:00:00Z`) : null, storePhoto: true } : {}),
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
            ...(entry.backKey ? [{ kind: "back" as const, bucketKey: entry.backKey }] : []),
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
        ...(entry.backKey ? [{ itemId, kind: "back" as const, bucketKey: entry.backKey }] : []),
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

export async function attachEntryPhoto(personId: string, entryId: string, kind: "label" | "worn" | "back", key: string): Promise<void> {
  await ownedEntry(personId, entryId);
  await db.importEntry.update({ where: { id: entryId }, data: kind === "label" ? { labelKey: key } : kind === "worn" ? { wornKey: key } : { backKey: key } });
}

export function emptyTags(): TagResult {
  return {
    name: "Untitled piece", categoryId: null, subcategoryId: null, colorIds: [], patternId: null, fabricId: null, fabricConfidence: 0,
    seasonIds: [], formalityId: null, brandText: null, brandId: null, sizeText: null, confidence: 0,
    raw: { name: "", category: "unknown", subcategory: null, colors: [], pattern: "unknown", fabric: "unknown", fabricConfidence: 0, seasons: [], formality: "unknown", brandText: null, sizeText: null, confidence: 0 },
  };
}

// ---------- Item detail editing ----------

import { deleteObject } from "@/lib/storage";
import type { LaundryStatus } from "@/generated/prisma/client";

export type ItemDetailEdits = ItemEdits & {
  occasionIds?: string[];
  tagIds?: string[];
  storeId?: string | null;
  purchasePrice?: string | null;
  purchaseDate?: string | null;
  purchaseUrl?: string | null;
  fitNotes?: string | null;
  laundryStatus?: LaundryStatus;
  isFavorite?: boolean;
  neverSuggest?: boolean;
  /** Closets besides the owner's personal one (Family, custom). */
  closetIds?: string[];
  sharedWithIds?: string[];
};

async function ownedItem(viewer: { id: string; role: string }, itemId: string) {
  const item = await db.item.findUnique({ where: { id: itemId }, select: { id: true, ownerId: true, storePhoto: true, wearCount: true, photoNudgedAt: true } });
  if (!item) throw new ItemError("That item is gone.", 404);
  if (item.ownerId !== viewer.id && viewer.role !== "admin") throw new ItemError("Only the owner or an admin can change this.", 403);
  return item;
}

const set = (ids: string[]) => ({ set: [...new Set(ids)].map((id) => ({ id })) });

export async function updateItem(viewer: { id: string; role: string }, itemId: string, e: ItemDetailEdits): Promise<void> {
  const item = await ownedItem(viewer, itemId);
  const data: Record<string, unknown> = {};
  if (e.name !== undefined) { const n = e.name.trim().slice(0, 80); if (!n) throw new ItemError("Give it a name."); data.name = n; }
  if (e.categoryId !== undefined) { data.categoryId = e.categoryId; if (e.subcategoryId === undefined) data.subcategoryId = null; }
  if (e.subcategoryId !== undefined) data.subcategoryId = e.subcategoryId;
  if (e.brandId !== undefined) data.brandId = e.brandId;
  if (e.storeId !== undefined) data.storeId = e.storeId;
  if (e.sizeText !== undefined) data.size = e.sizeText?.trim().slice(0, 20) || null;
  if (e.fitNotes !== undefined) data.fitNotes = e.fitNotes?.trim().slice(0, 500) || null;
  if (e.purchaseUrl !== undefined) data.purchaseUrl = e.purchaseUrl?.trim().slice(0, 500) || null;
  if (e.purchasePrice !== undefined) {
    const raw = (e.purchasePrice ?? "").replace(/[$,\s]/g, "");
    if (raw === "") data.purchasePrice = null;
    else { const n = Number(raw); if (!Number.isFinite(n) || n < 0 || n > 1_000_000) throw new ItemError("Enter a price like 48 or 48.50."); data.purchasePrice = n.toFixed(2); }
  }
  if (e.purchaseDate !== undefined) {
    if (!e.purchaseDate) data.purchaseDate = null;
    else { const d = new Date(e.purchaseDate); if (Number.isNaN(d.getTime())) throw new ItemError("That date doesn't look right."); data.purchaseDate = d; }
  }
  if (e.laundryStatus !== undefined) data.laundryStatus = e.laundryStatus;
  if (e.isFavorite !== undefined) data.isFavorite = e.isFavorite;
  if (e.neverSuggest !== undefined) data.neverSuggest = e.neverSuggest;
  if (e.colorIds !== undefined) data.colors = set(e.colorIds);
  if (e.patternId !== undefined) data.patterns = set(e.patternId ? [e.patternId] : []);
  if (e.fabricId !== undefined) data.fabrics = set(e.fabricId ? [e.fabricId] : []);
  if (e.seasonIds !== undefined) data.seasons = set(e.seasonIds);
  if (e.formalityId !== undefined) data.formalities = set(e.formalityId ? [e.formalityId] : []);
  if (e.occasionIds !== undefined) data.occasions = set(e.occasionIds);
  if (e.tagIds !== undefined) data.tags = set(e.tagIds);
  await db.$transaction(async (tx) => {
    if (Object.keys(data).length) await tx.item.update({ where: { id: itemId }, data });
    if (e.closetIds !== undefined) {
      const personal = await personalClosetId(item.ownerId);
      const allowed = await tx.closet.findMany({ where: { id: { in: e.closetIds }, OR: [{ kind: "family" }, { kind: "custom" }, { id: personal }] }, select: { id: true } });
      const keep = new Set([personal, ...allowed.map((c) => c.id)]);
      await tx.itemCloset.deleteMany({ where: { itemId, closetId: { notIn: [...keep] } } });
      for (const closetId of keep) await tx.itemCloset.upsert({ where: { itemId_closetId: { itemId, closetId } }, update: {}, create: { itemId, closetId } });
    }
    if (e.sharedWithIds !== undefined) {
      const ids = [...new Set(e.sharedWithIds)].filter((id) => id !== item.ownerId);
      await tx.itemShare.deleteMany({ where: { itemId, personId: { notIn: ids } } });
      for (const personId of ids) await tx.itemShare.upsert({ where: { itemId_personId: { itemId, personId } }, update: {}, create: { itemId, personId } });
    }
  });
}

const LAUNDRY_CYCLE: LaundryStatus[] = ["clean", "dirty", "cleaners"];

/** One tap moves CLEAN → LAUNDRY → AT CLEANERS → CLEAN. Returns the new status. */
export async function cycleLaundry(viewer: { id: string; role: string }, itemId: string): Promise<LaundryStatus> {
  await ownedItem(viewer, itemId);
  const it = await db.item.findUniqueOrThrow({ where: { id: itemId }, select: { laundryStatus: true } });
  const next = LAUNDRY_CYCLE[(LAUNDRY_CYCLE.indexOf(it.laundryStatus) + 1) % LAUNDRY_CYCLE.length];
  await db.item.update({ where: { id: itemId }, data: { laundryStatus: next } });
  return next;
}

export async function addItemPhoto(viewer: { id: string; role: string }, itemId: string, kind: "alone" | "worn" | "label" | "back", key: string): Promise<void> {
  const item = await ownedItem(viewer, itemId);
  const parsed = parseKeyOwner(key);
  if (!parsed || parsed !== item.ownerId) throw new ItemError("That photo is not this item's owner's.", 403);
  const hasPrimary = (await db.itemPhoto.count({ where: { itemId, isPrimary: true } })) > 0;
  const replacesStorePhoto = kind === "alone" && item.storePhoto;
  await db.$transaction(async (tx) => {
    if (replacesStorePhoto) await tx.itemPhoto.updateMany({ where: { itemId }, data: { isPrimary: false } });
    await tx.itemPhoto.create({ data: { itemId, kind, bucketKey: key, isPrimary: replacesStorePhoto || (!hasPrimary && kind === "alone") } });
    if (kind === "alone") await tx.item.update({ where: { id: itemId }, data: { storePhoto: false, photoNudgedAt: item.wearCount } });
  });
}

export type PhotoNudge = "first" | "refresh" | null;
/** Jeff's rule: a store-photo piece asks for your own photo after one wear; every piece asks for a fresh one every 6 wears. Never required. */
export function photoNudge(it: { storePhoto: boolean; wearCount: number; photoNudgedAt: number | null }): PhotoNudge {
  if (it.storePhoto && it.wearCount >= 1 && it.photoNudgedAt === null) return "first";
  if (it.wearCount >= 6 && it.wearCount - (it.photoNudgedAt ?? 0) >= 6) return "refresh";
  return null;
}

/** NOT NOW on a photo nudge: ask again after another six wears. */
export async function answerPhotoNudge(viewer: { id: string; role: string }, itemId: string): Promise<void> {
  const item = await ownedItem(viewer, itemId);
  await db.item.update({ where: { id: itemId }, data: { photoNudgedAt: item.wearCount } });
}

export async function removeItemPhoto(viewer: { id: string; role: string }, photoId: string): Promise<void> {
  const photo = await db.itemPhoto.findUnique({ where: { id: photoId } });
  if (!photo) return;
  await ownedItem(viewer, photo.itemId);
  await db.itemPhoto.delete({ where: { id: photoId } });
  await deleteObject(photo.bucketKey).catch(() => {});
  if (photo.isPrimary) {
    const next = await db.itemPhoto.findFirst({ where: { itemId: photo.itemId, kind: { in: ["cutout", "alone"] } }, orderBy: { createdAt: "asc" } });
    if (next) await db.itemPhoto.update({ where: { id: next.id }, data: { isPrimary: true } });
  }
}

/** Deletes the item and its photos from the bucket. */
export async function deleteItem(viewer: { id: string; role: string }, itemId: string): Promise<void> {
  await ownedItem(viewer, itemId);
  const photos = await db.itemPhoto.findMany({ where: { itemId }, select: { bucketKey: true } });
  await db.item.delete({ where: { id: itemId } });
  await Promise.all(photos.map((p) => deleteObject(p.bucketKey).catch(() => {})));
}

function parseKeyOwner(key: string): string | null {
  const m = /^(?:originals|worn|labels)\/([a-z0-9]{10,40})\//.exec(key);
  return m ? m[1] : null;
}
