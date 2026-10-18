import { db } from "@/lib/db";
import { ProfileError } from "@/lib/profiles/service";
import type { Viewer } from "@/lib/people/visibility";

/**
 * My brands & sizes (Jeff, 18 Oct 2026): the brands a person wears, their size in each, and the
 * brand's store link. The confirm card offers them as one-tap picks, so adding fifteen shirts is
 * "which brand?" and the size and link come along. Favorites (Person.favoriteBrands) say which
 * brands; BodySizeByBrand with no category holds the size; Brand.url holds the link, once, for all.
 */

export type MyBrand = { brandId: string; name: string; size: string | null; url: string | null };

async function assertCanEdit(viewer: Viewer, ownerId: string) {
  if (viewer.id === ownerId) return;
  const link = await db.guardianLink.findUnique({ where: { minorId_parentId: { minorId: ownerId, parentId: viewer.id } } });
  if (!link) throw new ProfileError("Only the owner or their parent can change this.", 403);
}

export async function listMyBrands(ownerId: string): Promise<MyBrand[]> {
  const p = await db.person.findUniqueOrThrow({ where: { id: ownerId }, select: { favoriteBrands: { where: { isArchived: false }, orderBy: { name: "asc" }, select: { id: true, name: true, url: true } } } });
  const sizes = await db.bodySizeByBrand.findMany({ where: { personId: ownerId, categoryId: null }, select: { brandId: true, size: true } });
  return p.favoriteBrands.map((b) => ({ brandId: b.id, name: b.name, size: sizes.find((s) => s.brandId === b.id)?.size ?? null, url: b.url }));
}

function cleanUrl(input: string | null | undefined): string | null {
  const raw = (input ?? "").trim();
  if (!raw) return null;
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try { const u = new URL(withScheme); if (!u.hostname.includes(".")) throw new Error(); return u.toString().slice(0, 500); } catch { throw new ProfileError("That link doesn't look right."); }
}

/** Add or update a brand on the person's list: joins favorites, sets the size (empty clears it) and the brand link (empty leaves it). */
export async function setMyBrand(viewer: Viewer, ownerId: string, input: { brandId: string; size?: string | null; url?: string | null }): Promise<void> {
  await assertCanEdit(viewer, ownerId);
  const brand = await db.brand.findUnique({ where: { id: input.brandId } });
  if (!brand || brand.isArchived) throw new ProfileError("That brand is gone from the list.");
  await db.person.update({ where: { id: ownerId }, data: { favoriteBrands: { connect: { id: brand.id } } } });
  if (input.size !== undefined) {
    const size = (input.size ?? "").trim().slice(0, 20);
    const existing = await db.bodySizeByBrand.findFirst({ where: { personId: ownerId, brandId: brand.id, categoryId: null } });
    if (!size) { if (existing) await db.bodySizeByBrand.delete({ where: { id: existing.id } }); }
    else if (existing) await db.bodySizeByBrand.update({ where: { id: existing.id }, data: { size } });
    else await db.bodySizeByBrand.create({ data: { personId: ownerId, brandId: brand.id, categoryId: null, size } });
  }
  if (input.url !== undefined) {
    const url = cleanUrl(input.url);
    if (url || input.url === "") await db.brand.update({ where: { id: brand.id }, data: { url } });
  }
}

export async function removeMyBrand(viewer: Viewer, ownerId: string, brandId: string): Promise<void> {
  await assertCanEdit(viewer, ownerId);
  await db.person.update({ where: { id: ownerId }, data: { favoriteBrands: { disconnect: { id: brandId } } } });
  await db.bodySizeByBrand.deleteMany({ where: { personId: ownerId, brandId, categoryId: null } });
}
