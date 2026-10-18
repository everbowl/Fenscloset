import { db } from "@/lib/db";
import { forgetTaste } from "@/lib/outfits/taste";
import { deleteObject, parseKey } from "@/lib/storage";
import { bodyPhotosAllowed, canGrantBodyAccess, canSeeBodyData, type Viewer } from "@/lib/people/visibility";

export class ProfileError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = "ProfileError";
  }
}

export type Named = { id: string; name: string };

export type BodyProfileView = {
  fitNotes: string | null;
  measurements: { kindId: string; name: string; unit: string; value: string | null }[];
  sizes: { id: string; brandId: string; brandName: string; categoryId: string | null; categoryName: string | null; size: string }[];
  photos: { id: string; key: string; takenAt: Date; onlyMe: boolean }[];
  photosAllowed: boolean;
  photosApprovedBy?: string;
};

export type StyleProfileView = { lovedColorIds: string[]; avoidColorIds: string[]; styleWordIds: string[]; neverSuggest: { id: string; name: string | null }[] };
export type FavoritesView = { brandIds: string[]; storeIds: string[] };
export type PrivacyView = {
  savedZip: string | null;
  bodyViewerIds: string[];
  shopperIds: string[];
  /** Fixed viewers (parents of a minor) that cannot be removed. */
  parentIds: string[];
  canGrant: boolean;
};

/** Only the owner (or a parent of a minor owner) edits a profile. */
async function assertCanEdit(viewer: Viewer, ownerId: string) {
  if (viewer.id === ownerId) return;
  const link = await db.guardianLink.findUnique({ where: { minorId_parentId: { minorId: ownerId, parentId: viewer.id } } });
  if (!link) throw new ProfileError("Only the owner or their parent can change this.", 403);
}

export async function getBodyProfile(viewer: Viewer, ownerId: string): Promise<BodyProfileView | null> {
  if (!(await canSeeBodyData(viewer, ownerId))) return null;
  const [profile, kinds, values, sizes, photos, allowed] = await Promise.all([
    db.bodyProfile.findUnique({ where: { personId: ownerId } }),
    db.measurementKind.findMany({ where: { isArchived: false }, orderBy: { sortOrder: "asc" } }),
    db.bodyMeasurement.findMany({ where: { personId: ownerId } }),
    db.bodySizeByBrand.findMany({ where: { personId: ownerId }, include: { brand: true }, orderBy: { updatedAt: "desc" } }),
    db.bodyPhoto.findMany({ where: { personId: ownerId }, orderBy: { takenAt: "desc" } }),
    bodyPhotosAllowed(ownerId),
  ]);
  const categories = await db.category.findMany({ where: { id: { in: sizes.map((s) => s.categoryId).filter((x): x is string => Boolean(x)) } }, select: { id: true, name: true } });
  // A minor's locked photos stay visible to their parents; an adult's locked photos are theirs alone.
  const ownerRole = (await db.person.findUnique({ where: { id: ownerId }, select: { role: true } }))?.role;
  const isParentView = ownerRole === "minor" && viewer.id !== ownerId && Boolean(await db.guardianLink.findUnique({ where: { minorId_parentId: { minorId: ownerId, parentId: viewer.id } } }));
  return {
    fitNotes: profile?.fitNotes ?? null,
    measurements: kinds.map((k) => ({ kindId: k.id, name: k.name, unit: k.unit, value: values.find((v) => v.kindId === k.id)?.value ?? null })),
    sizes: sizes.map((s) => ({ id: s.id, brandId: s.brandId, brandName: s.brand.name, categoryId: s.categoryId, categoryName: categories.find((c) => c.id === s.categoryId)?.name ?? null, size: s.size })),
    photos: allowed.allowed ? photos.filter((p) => !p.onlyMe || viewer.id === ownerId || isParentView).map((p) => ({ id: p.id, key: p.bucketKey, takenAt: p.takenAt, onlyMe: p.onlyMe })) : [],
    photosAllowed: allowed.allowed,
    photosApprovedBy: allowed.approvedBy,
  };
}

export async function setMeasurement(viewer: Viewer, ownerId: string, kindId: string, value: string): Promise<void> {
  await assertCanEdit(viewer, ownerId);
  const v = value.trim().slice(0, 20);
  if (!v) { await db.bodyMeasurement.deleteMany({ where: { personId: ownerId, kindId } }); return; }
  await db.bodyMeasurement.upsert({ where: { personId_kindId: { personId: ownerId, kindId } }, update: { value: v }, create: { personId: ownerId, kindId, value: v } });
}

export async function setFitNotes(viewer: Viewer, ownerId: string, notes: string): Promise<void> {
  await assertCanEdit(viewer, ownerId);
  const fitNotes = notes.trim().slice(0, 1000) || null;
  await db.bodyProfile.upsert({ where: { personId: ownerId }, update: { fitNotes }, create: { personId: ownerId, fitNotes } });
}

export async function upsertSize(viewer: Viewer, ownerId: string, input: { id?: string; brandId: string; categoryId: string | null; size: string }): Promise<void> {
  await assertCanEdit(viewer, ownerId);
  const size = input.size.trim().slice(0, 20);
  if (!size) throw new ProfileError("Enter the size.");
  if (input.id) {
    const row = await db.bodySizeByBrand.findUnique({ where: { id: input.id } });
    if (!row || row.personId !== ownerId) throw new ProfileError("Not yours.", 403);
    await db.bodySizeByBrand.update({ where: { id: input.id }, data: { brandId: input.brandId, categoryId: input.categoryId, size } });
    return;
  }
  const existing = await db.bodySizeByBrand.findFirst({ where: { personId: ownerId, brandId: input.brandId, categoryId: input.categoryId } });
  if (existing) await db.bodySizeByBrand.update({ where: { id: existing.id }, data: { size } });
  else await db.bodySizeByBrand.create({ data: { personId: ownerId, brandId: input.brandId, categoryId: input.categoryId, size } });
}

export async function removeSize(viewer: Viewer, ownerId: string, id: string): Promise<void> {
  await assertCanEdit(viewer, ownerId);
  await db.bodySizeByBrand.deleteMany({ where: { id, personId: ownerId } });
}

export async function addBodyPhoto(viewer: Viewer, ownerId: string, key: string, opts: { onlyMe?: boolean } = {}): Promise<void> {
  await assertCanEdit(viewer, ownerId);
  const parsed = parseKey(key);
  if (!parsed || parsed.kind !== "bodies" || parsed.ownerId !== ownerId) throw new ProfileError("That photo is not this person's.", 403);
  const allowed = await bodyPhotosAllowed(ownerId);
  if (!allowed.allowed) throw new ProfileError("Body photos need a parent's approval first.", 403);
  await db.bodyPhoto.create({ data: { personId: ownerId, bucketKey: key, onlyMe: Boolean(opts.onlyMe) } });
}

/** Lock a photo to the owner ("only me") or open it to everyone who can see the body profile. */
export async function setBodyPhotoPrivacy(viewer: Viewer, ownerId: string, photoId: string, onlyMe: boolean): Promise<void> {
  await assertCanEdit(viewer, ownerId);
  const photo = await db.bodyPhoto.findUnique({ where: { id: photoId } });
  if (!photo || photo.personId !== ownerId) throw new ProfileError("Not yours.", 403);
  await db.bodyPhoto.update({ where: { id: photoId }, data: { onlyMe } });
}

export async function removeBodyPhoto(viewer: Viewer, ownerId: string, photoId: string): Promise<void> {
  await assertCanEdit(viewer, ownerId);
  const photo = await db.bodyPhoto.findUnique({ where: { id: photoId } });
  if (!photo || photo.personId !== ownerId) return;
  await db.bodyPhoto.delete({ where: { id: photoId } });
  await deleteObject(photo.bucketKey).catch(() => {});
}

// ---------- Style ----------

export async function getStyleProfile(ownerId: string): Promise<StyleProfileView> {
  const p = await db.person.findUniqueOrThrow({ where: { id: ownerId }, include: { lovedColors: { select: { id: true } }, avoidColors: { select: { id: true } }, styleWords: { select: { id: true } } } });
  const never = await db.item.findMany({ where: { ownerId, neverSuggest: true }, select: { id: true, name: true }, orderBy: { updatedAt: "desc" } });
  return { lovedColorIds: p.lovedColors.map((c) => c.id), avoidColorIds: p.avoidColors.map((c) => c.id), styleWordIds: p.styleWords.map((w) => w.id), neverSuggest: never };
}

export async function updateStyle(viewer: Viewer, ownerId: string, patch: { lovedColorIds?: string[]; avoidColorIds?: string[]; styleWordIds?: string[] }): Promise<void> {
  await assertCanEdit(viewer, ownerId);
  const set = (ids: string[]) => ({ set: [...new Set(ids)].map((id) => ({ id })) });
  await db.person.update({
    where: { id: ownerId },
    data: {
      ...(patch.lovedColorIds ? { lovedColors: set(patch.lovedColorIds) } : {}),
      ...(patch.avoidColorIds ? { avoidColors: set(patch.avoidColorIds) } : {}),
      ...(patch.styleWordIds ? { styleWords: set(patch.styleWordIds) } : {}),
    },
  });
}

export async function setNeverSuggest(viewer: Viewer, ownerId: string, itemId: string, never: boolean): Promise<void> {
  await assertCanEdit(viewer, ownerId);
  await db.item.updateMany({ where: { id: itemId, ownerId }, data: { neverSuggest: never } });
}

/** Taste memory lives with the style profile: the person (or a parent, for a minor) can forget lines. */
export async function forgetTasteFor(viewer: Viewer, ownerId: string, itemId?: string): Promise<void> {
  await assertCanEdit(viewer, ownerId);
  await forgetTaste(ownerId, itemId);
}

// ---------- Favorites ----------

export async function getFavorites(ownerId: string): Promise<FavoritesView> {
  const p = await db.person.findUniqueOrThrow({ where: { id: ownerId }, include: { favoriteBrands: { select: { id: true } }, favoriteStores: { select: { id: true } } } });
  return { brandIds: p.favoriteBrands.map((b) => b.id), storeIds: p.favoriteStores.map((s) => s.id) };
}

export async function updateFavorites(viewer: Viewer, ownerId: string, patch: { brandIds?: string[]; storeIds?: string[] }): Promise<void> {
  await assertCanEdit(viewer, ownerId);
  const set = (ids: string[]) => ({ set: [...new Set(ids)].map((id) => ({ id })) });
  await db.person.update({ where: { id: ownerId }, data: { ...(patch.brandIds ? { favoriteBrands: set(patch.brandIds) } : {}), ...(patch.storeIds ? { favoriteStores: set(patch.storeIds) } : {}) } });
}

// ---------- Privacy grants ----------

export async function getPrivacy(ownerId: string): Promise<PrivacyView> {
  const [p, body, shop, parents, canGrant] = await Promise.all([
    db.person.findUniqueOrThrow({ where: { id: ownerId }, select: { savedZip: true } }),
    db.bodyDataGrant.findMany({ where: { ownerId }, select: { viewerId: true } }),
    db.shopForGrant.findMany({ where: { ownerId }, select: { shopperId: true } }),
    db.guardianLink.findMany({ where: { minorId: ownerId }, select: { parentId: true } }),
    canGrantBodyAccess(ownerId),
  ]);
  return { savedZip: p.savedZip, bodyViewerIds: body.map((b) => b.viewerId), shopperIds: shop.map((s) => s.shopperId), parentIds: parents.map((g) => g.parentId), canGrant };
}

/** Only the owner changes grants (a parent does not hand out a minor's data). Minors cannot grant at all. */
export async function setBodyViewers(viewer: Viewer, ownerId: string, viewerIds: string[]): Promise<void> {
  if (viewer.id !== ownerId) throw new ProfileError("Only you can choose who sees your body profile.", 403);
  if (!(await canGrantBodyAccess(ownerId))) throw new ProfileError("A minor's body profile stays with the minor and their parents.", 403);
  const ids = [...new Set(viewerIds)].filter((id) => id !== ownerId);
  await db.$transaction(async (tx) => {
    await tx.bodyDataGrant.deleteMany({ where: { ownerId, viewerId: { notIn: ids } } });
    for (const viewerId of ids) await tx.bodyDataGrant.upsert({ where: { ownerId_viewerId: { ownerId, viewerId } }, update: {}, create: { ownerId, viewerId } });
  });
}

export async function setShoppers(viewer: Viewer, ownerId: string, shopperIds: string[]): Promise<void> {
  if (viewer.id !== ownerId) throw new ProfileError("Only you can choose who shops for you.", 403);
  if (!(await canGrantBodyAccess(ownerId))) throw new ProfileError("A minor's shoppers are their parents.", 403);
  const ids = [...new Set(shopperIds)].filter((id) => id !== ownerId);
  await db.$transaction(async (tx) => {
    await tx.shopForGrant.deleteMany({ where: { ownerId, shopperId: { notIn: ids } } });
    for (const shopperId of ids) await tx.shopForGrant.upsert({ where: { ownerId_shopperId: { ownerId, shopperId } }, update: {}, create: { ownerId, shopperId } });
  });
}

/** Parent admin approves or revokes body photos for a minor. Revoking deletes any body photos. */
export async function setMinorBodyImageApproval(parent: Viewer, minorId: string, approved: boolean): Promise<void> {
  const link = await db.guardianLink.findUnique({ where: { minorId_parentId: { minorId, parentId: parent.id } } });
  if (!link || parent.role !== "admin") throw new ProfileError("Only a parent admin of this minor can approve body photos.", 403);
  if (approved) {
    await db.minorBodyImageApproval.upsert({ where: { minorId }, update: { approvedById: parent.id, approvedAt: new Date() }, create: { minorId, approvedById: parent.id } });
    return;
  }
  const photos = await db.bodyPhoto.findMany({ where: { personId: minorId } });
  await db.$transaction([db.minorBodyImageApproval.deleteMany({ where: { minorId } }), db.bodyPhoto.deleteMany({ where: { personId: minorId } })]);
  await Promise.all(photos.map((p) => deleteObject(p.bucketKey).catch(() => {})));
}
