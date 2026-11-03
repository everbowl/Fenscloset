import { db } from "@/lib/db";
import { isFeatureKey } from "@/lib/tryon/features";
import { forgetTryOns } from "@/lib/tryon";
import { priceNumber, storeIdByName, type StoreMeta } from "@/lib/store/add";
import { finishBatchIfDone } from "@/lib/import/service";
import type { EntryAiResult } from "@/lib/import/process";
import type { TagResult } from "@/lib/ai/tag-item";
import type { Item } from "@/generated/prisma/client";
import type { PhotoKind } from "@/generated/prisma/client";

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
  const brandUrl = !meta?.url && tags.brandId ? (await db.brand.findUnique({ where: { id: tags.brandId }, select: { url: true } }))?.url ?? null : null;
  const item = await db.$transaction(async (tx) => {
    const made = await tx.item.create({
      data: {
        ownerId: personId,
        name: tags.name,
        categoryId: tags.categoryId,
        subcategoryId: tags.subcategoryId,
        brandId: tags.brandId,
        size: tags.sizeText,
        copies: Math.min(MAX_COPIES, Math.max(1, entry.quantity)),
        phash: entry.phash,
        ...(meta ? { storeId, purchaseUrl: meta.url?.slice(0, 500) ?? null, purchasePrice: priceNumber(meta.priceText), purchaseDate: meta.purchaseDate ? new Date(`${meta.purchaseDate}T12:00:00Z`) : null, storePhoto: !meta.matched, fitNotes: meta.fitNotes?.slice(0, 500) ?? null } : { purchaseUrl: brandUrl }),
        aiConfidence: JSON.parse(JSON.stringify({ confidence: tags.confidence, fabricConfidence: tags.fabricConfidence, warnings: ai.warnings })),
        features: (tags.features ?? []).filter(isFeatureKey),
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
            ...entry.retailKeys.map((k) => ({ kind: "retail" as const, bucketKey: k })),
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
/**
 * "Another one like my Black crew tee" (Jeff, 18 Oct 2026): copy everything but the color from a
 * piece the person owns onto the entry (name, category, brand, size, fabric, seasons, dress code,
 * pattern), so the new photo only needs its color checked.
 */
export async function mirrorFromItem(personId: string, entryId: string, itemId: string): Promise<TagResult> {
  const item = await db.item.findUnique({ where: { id: itemId }, select: { ownerId: true, name: true, categoryId: true, subcategoryId: true, brandId: true, size: true, brand: { select: { name: true } }, fabrics: { select: { id: true }, take: 1 }, seasons: { select: { id: true } }, formalities: { select: { id: true }, take: 1 }, patterns: { select: { id: true }, take: 1 } } });
  if (!item || item.ownerId !== personId) throw new ItemError("Not yours.", 403);
  return saveEntryEdits(personId, entryId, {
    name: item.name ?? undefined, categoryId: item.categoryId, subcategoryId: item.subcategoryId, brandId: item.brandId, brandText: item.brand?.name ?? null, sizeText: item.size,
    fabricId: item.fabrics[0]?.id ?? null, seasonIds: item.seasons.map((x) => x.id), formalityId: item.formalities[0]?.id ?? null, patternId: item.patterns[0]?.id ?? null,
  });
}

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
        ...entry.retailKeys.map((k) => ({ itemId, kind: "retail" as const, bucketKey: k })),
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

/** "Skipped · Undo" on the next card (Q1): the piece comes back to the pile while its batch is still open. */
export async function unskipEntry(personId: string, entryId: string): Promise<void> {
  const entry = await ownedEntry(personId, entryId);
  if (entry.status !== "skipped") throw new ItemError("That one is already back.");
  await db.importEntry.update({ where: { id: entryId }, data: { status: "needs_confirm" } });
}

export async function attachEntryPhoto(personId: string, entryId: string, kind: "label" | "worn" | "back", key: string): Promise<void> {
  await ownedEntry(personId, entryId);
  await db.importEntry.update({ where: { id: entryId }, data: kind === "label" ? { labelKey: key } : kind === "worn" ? { wornKey: key } : { backKey: key } });
}

export function emptyTags(): TagResult {
  return {
    name: "Untitled piece", categoryId: null, subcategoryId: null, colorIds: [], patternId: null, fabricId: null, fabricConfidence: 0,
    seasonIds: [], formalityId: null, brandText: null, brandId: null, sizeText: null, confidence: 0, features: [],
    raw: { name: "", category: "unknown", subcategory: null, colors: [], pattern: "unknown", fabric: "unknown", fabricConfidence: 0, seasons: [], formality: "unknown", brandText: null, sizeText: null, confidence: 0 },
  };
}

// ---------- Item detail editing ----------

import { deleteObject, getObject, newKey, parseKey, putObject, type PhotoKeyKind } from "@/lib/storage";
import { quarterTurn, rotateImage, type RotateDirection } from "@/lib/images/rotate";
import { makeThumb } from "@/lib/images/thumb";
import { phash } from "@/lib/images/phash";
import { applyCopyAction, countsFor, countsOf, laundrySummary, MAX_COPIES, type CopyAction, type CopyCounts } from "@/lib/items/copies";
import type { LaundryStatus } from "@/generated/prisma/client";

export type ItemDetailEdits = ItemEdits & {
  occasionIds?: string[];
  tagIds?: string[];
  storeId?: string | null;
  purchasePrice?: string | null;
  purchaseDate?: string | null;
  purchaseUrl?: string | null;
  fitNotes?: string | null;
  /** How the piece is made (src/lib/tryon/styling.ts FEATURE_KEYS); drives the mirror's styling chips. */
  features?: string[];
  laundryStatus?: LaundryStatus;
  isFavorite?: boolean;
  neverSuggest?: boolean;
  /** Closets besides the owner's personal one (Family, custom). */
  closetIds?: string[];
  sharedWithIds?: string[];
};

async function ownedItem(viewer: { id: string; role: string }, itemId: string) {
  const item = await db.item.findUnique({ where: { id: itemId }, select: { id: true, ownerId: true, storePhoto: true, wearCount: true, photoNudgedAt: true, copies: true, dirtyCopies: true, cleanersCopies: true, laundryStatus: true } });
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
  if (e.features !== undefined) data.features = [...new Set(e.features.filter(isFeatureKey))];
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
  if (e.laundryStatus !== undefined) Object.assign(data, { laundryStatus: e.laundryStatus, ...countsFor(item.copies, e.laundryStatus) });
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

/** One tap moves CLEAN → LAUNDRY → AT CLEANERS → CLEAN. Returns the new status. The whole stack moves together. */
export async function cycleLaundry(viewer: { id: string; role: string }, itemId: string): Promise<LaundryStatus> {
  const it = await ownedItem(viewer, itemId);
  const next = LAUNDRY_CYCLE[(LAUNDRY_CYCLE.indexOf(it.laundryStatus) + 1) % LAUNDRY_CYCLE.length];
  await db.item.update({ where: { id: itemId }, data: { laundryStatus: next, ...countsFor(it.copies, next) } });
  return next;
}

/** Laundry as three states, one tap each on the piece page. On a stack every copy moves together. */
export async function setLaundry(viewer: { id: string; role: string }, itemId: string, status: LaundryStatus): Promise<LaundryStatus> {
  const it = await ownedItem(viewer, itemId);
  if (!LAUNDRY_CYCLE.includes(status)) throw new ItemError("Pick clean, in the wash, or at the cleaners.");
  await db.item.update({ where: { id: itemId }, data: { laundryStatus: status, ...countsFor(it.copies, status) } });
  return status;
}

/** A stack's laundry one copy at a time (F1, Jeff 3 Nov 2026): one in the wash, one to the cleaners, one back clean, or wash day for all. */
export async function laundryCopies(viewer: { id: string; role: string }, itemId: string, action: CopyAction): Promise<CopyCounts & { laundryStatus: LaundryStatus }> {
  const it = await ownedItem(viewer, itemId);
  const next = applyCopyAction(countsOf(it), action);
  const laundryStatus = laundrySummary(next);
  await db.item.update({ where: { id: itemId }, data: { ...next, laundryStatus } });
  return { ...next, laundryStatus };
}

/** How many identical pieces this card stands for. Copies in the wash or at the cleaners shrink to fit. */
export async function setCopies(viewer: { id: string; role: string }, itemId: string, copies: number): Promise<CopyCounts & { laundryStatus: LaundryStatus }> {
  const it = await ownedItem(viewer, itemId);
  const n = Math.floor(Number(copies));
  if (!Number.isFinite(n) || n < 1 || n > MAX_COPIES) throw new ItemError(`Copies go from 1 to ${MAX_COPIES}.`);
  const next = countsOf({ ...countsOf(it), copies: n, laundryStatus: it.laundryStatus });
  const laundryStatus = laundrySummary(next);
  await db.item.update({ where: { id: itemId }, data: { ...next, laundryStatus } });
  return { ...next, laundryStatus };
}

/** One copy becomes its own card (it got a real photo, a stain, a story): same facts and photos, one piece. Returns the new item's id. */
export async function splitOneOff(viewer: { id: string; role: string }, itemId: string): Promise<string> {
  const it = await ownedItem(viewer, itemId);
  if (it.copies <= 1) throw new ItemError("This is already a single piece.");
  const full = await db.item.findUniqueOrThrow({ where: { id: itemId }, include: { colors: true, patterns: true, fabrics: true, seasons: true, formalities: true, occasions: true, tags: true, photos: true, closets: true } });
  const ids = (xs: { id: string }[]) => ({ connect: xs.map((x) => ({ id: x.id })) });
  // A photo key belongs to one piece: the new card gets its own copies of the pictures.
  const photos: { kind: PhotoKind; bucketKey: string; isPrimary: boolean; forMirror: boolean; wholeGarment: boolean | null }[] = [];
  for (const ph of full.photos) {
    const parsed = parseKey(ph.bucketKey);
    if (!parsed) continue;
    const { body, contentType } = await getObject(ph.bucketKey);
    const key = newKey(parsed.kind, full.ownerId, contentType);
    await putObject(key, body, contentType);
    photos.push({ kind: ph.kind, bucketKey: key, isPrimary: ph.isPrimary, forMirror: ph.forMirror, wholeGarment: ph.wholeGarment });
  }
  return db.$transaction(async (tx) => {
    const made = await tx.item.create({
      data: {
        ownerId: full.ownerId, categoryId: full.categoryId, subcategoryId: full.subcategoryId, brandId: full.brandId, storeId: full.storeId,
        name: full.name, size: full.size, fitNotes: full.fitNotes, purchasePrice: full.purchasePrice, purchaseDate: full.purchaseDate, purchaseUrl: full.purchaseUrl,
        storePhoto: full.storePhoto, features: full.features, phash: full.phash, aiConfidence: full.aiConfidence ?? undefined, copies: 1,
        colors: ids(full.colors), patterns: ids(full.patterns), fabrics: ids(full.fabrics), seasons: ids(full.seasons), formalities: ids(full.formalities), occasions: ids(full.occasions), tags: ids(full.tags),
        closets: { create: full.closets.map((c) => ({ closetId: c.closetId })) },
        photos: { create: photos },
      },
    });
    const rest = countsOf({ ...countsOf(it), copies: it.copies - 1, laundryStatus: it.laundryStatus });
    await tx.item.update({ where: { id: itemId }, data: { ...rest, laundryStatus: laundrySummary(rest) } });
    return made.id;
  });
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
  if (kind !== "worn" && kind !== "label") await forgetTryOns(itemId); // a new picture of the piece: the mirror dresses it afresh
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

/** "Use in the mirror": this photo dresses the person from now on, whatever the app would have picked. Tap again to let the app choose. */
export async function setMirrorPhoto(viewer: { id: string; role: string }, photoId: string): Promise<{ photoId: string | null }> {
  const photo = await db.itemPhoto.findUnique({ where: { id: photoId } });
  if (!photo) throw new ItemError("That photo is gone.", 404);
  await ownedItem(viewer, photo.itemId);
  const on = !photo.forMirror;
  await db.$transaction([
    db.itemPhoto.updateMany({ where: { itemId: photo.itemId }, data: { forMirror: false } }),
    ...(on ? [db.itemPhoto.update({ where: { id: photoId }, data: { forMirror: true } })] : []),
  ]);
  await forgetTryOns(photo.itemId); // the mirror dresses with the new choice from now on
  return { photoId: on ? photoId : null };
}

export async function removeItemPhoto(viewer: { id: string; role: string }, photoId: string): Promise<void> {
  const photo = await db.itemPhoto.findUnique({ where: { id: photoId } });
  if (!photo) return;
  await ownedItem(viewer, photo.itemId);
  await db.itemPhoto.delete({ where: { id: photoId } });
  await deleteObject(photo.bucketKey).catch(() => {});
  if (photo.kind !== "worn" && photo.kind !== "label") await forgetTryOns(photo.itemId);
  if (photo.isPrimary) {
    const next = await db.itemPhoto.findFirst({ where: { itemId: photo.itemId, kind: { in: ["cutout", "alone"] } }, orderBy: { createdAt: "asc" } });
    if (next) await db.itemPhoto.update({ where: { id: next.id }, data: { isPrimary: true } });
  }
}

/**
 * ROTATE on a saved piece: a quarter turn of one photo (new key, old object removed). Turning the
 * main photo also remakes the grid thumbnail and the duplicate hash.
 */
export async function rotateItemPhoto(viewer: { id: string; role: string }, photoId: string, dir: RotateDirection = "right"): Promise<{ photoId: string; key: string }> {
  const photo = await db.itemPhoto.findUnique({ where: { id: photoId } });
  if (!photo) throw new ItemError("That photo is gone.", 404);
  const item = await ownedItem(viewer, photo.itemId);
  if (photo.kind !== "worn" && photo.kind !== "label") await forgetTryOns(item.id); // the piece's picture changes: the mirror dresses it afresh
  const deg = quarterTurn(dir);
  const type = photo.bucketKey.endsWith(".png") ? "image/png" : "image/jpeg";
  const out = await rotateImage((await getObject(photo.bucketKey)).body, deg, type);
  const kindDir = /^(originals|worn|labels|cutouts|thumbs)\//.exec(photo.bucketKey)?.[1] as PhotoKeyKind | undefined;
  const key = newKey(kindDir ?? "cutouts", item.ownerId, type);
  await putObject(key, out, type);
  const main = photo.isPrimary || photo.kind === "cutout" || photo.kind === "alone";
  let thumbKey: string | null = null;
  const oldThumb = main ? await db.itemPhoto.findFirst({ where: { itemId: item.id, kind: "thumb" } }) : null;
  if (main && photo.isPrimary) {
    thumbKey = newKey("thumbs", item.ownerId, "image/jpeg");
    await putObject(thumbKey, await makeThumb(out), "image/jpeg");
  }
  await db.$transaction(async (tx) => {
    await tx.itemPhoto.update({ where: { id: photoId }, data: { bucketKey: key, width: null, height: null } });
    if (thumbKey) {
      if (oldThumb) await tx.itemPhoto.update({ where: { id: oldThumb.id }, data: { bucketKey: thumbKey } });
      else await tx.itemPhoto.create({ data: { itemId: item.id, kind: "thumb", bucketKey: thumbKey } });
      await tx.item.update({ where: { id: item.id }, data: { phash: await phash(out) } });
    }
  });
  await deleteObject(photo.bucketKey).catch(() => {});
  if (thumbKey && oldThumb) await deleteObject(oldThumb.bucketKey).catch(() => {});
  return { photoId, key };
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
