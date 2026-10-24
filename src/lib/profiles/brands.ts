import { db } from "@/lib/db";
import { ProfileError } from "@/lib/profiles/service";
import type { Viewer } from "@/lib/people/visibility";

/**
 * My brands & sizes (Jeff, 18 Oct 2026): the brands a person wears, their size in each per item
 * type (Tops L, Bottoms 32…), and the brand's store link. The confirm card offers them as one-tap
 * picks, so adding fifteen shirts is "which brand?" and the right size and link come along.
 * Favorites (Person.favoriteBrands) say which brands; BodySizeByBrand holds one size per category
 * (categoryId null = any); Brand.url holds the link, once, for all.
 */

export type MyBrandSize = { categoryId: string | null; categoryName: string | null; size: string };
export type MyBrand = { brandId: string; name: string; url: string | null; sizes: MyBrandSize[] };
export { sizeFor } from "@/lib/profiles/size-options";

async function assertCanEdit(viewer: Viewer, ownerId: string) {
  if (viewer.id === ownerId) return;
  const link = await db.guardianLink.findUnique({ where: { minorId_parentId: { minorId: ownerId, parentId: viewer.id } } });
  if (!link) throw new ProfileError("Only the owner or their parent can change this.", 403);
}

export async function listMyBrands(ownerId: string): Promise<MyBrand[]> {
  const p = await db.person.findUniqueOrThrow({ where: { id: ownerId }, select: { favoriteBrands: { where: { isArchived: false }, orderBy: { name: "asc" }, select: { id: true, name: true, url: true } } } });
  const sizes = await db.bodySizeByBrand.findMany({ where: { personId: ownerId }, select: { brandId: true, categoryId: true, size: true } });
  const cats = await db.category.findMany({ where: { isArchived: false }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } });
  const order = (id: string | null) => (id ? cats.findIndex((c) => c.id === id) : -1);
  return p.favoriteBrands.map((b) => ({
    brandId: b.id, name: b.name, url: b.url,
    sizes: sizes.filter((s) => s.brandId === b.id).map((s) => ({ categoryId: s.categoryId, categoryName: cats.find((c) => c.id === s.categoryId)?.name ?? null, size: s.size })).sort((a, b2) => order(a.categoryId) - order(b2.categoryId)),
  }));
}


function cleanUrl(input: string | null | undefined): string | null {
  const raw = (input ?? "").trim();
  if (!raw) return null;
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try { const u = new URL(withScheme); if (!u.hostname.includes(".")) throw new Error(); return u.toString().slice(0, 500); } catch { throw new ProfileError("That link doesn't look right."); }
}

/**
 * Add or update a brand on the person's list: joins favorites, sets each given category size
 * (empty clears that one) and the brand link (empty string clears it, undefined leaves it).
 */
export async function setMyBrand(viewer: Viewer, ownerId: string, input: { brandId: string; url?: string | null; sizes?: { categoryId: string | null; size: string | null }[] }): Promise<void> {
  await assertCanEdit(viewer, ownerId);
  const brand = await db.brand.findUnique({ where: { id: input.brandId } });
  if (!brand || brand.isArchived) throw new ProfileError("That brand is gone from the list.");
  await db.person.update({ where: { id: ownerId }, data: { favoriteBrands: { connect: { id: brand.id } } } });
  for (const entry of input.sizes ?? []) {
    const size = (entry.size ?? "").trim().slice(0, 20);
    const existing = await db.bodySizeByBrand.findFirst({ where: { personId: ownerId, brandId: brand.id, categoryId: entry.categoryId } });
    if (!size) { if (existing) await db.bodySizeByBrand.delete({ where: { id: existing.id } }); }
    else if (existing) await db.bodySizeByBrand.update({ where: { id: existing.id }, data: { size } });
    else await db.bodySizeByBrand.create({ data: { personId: ownerId, brandId: brand.id, categoryId: entry.categoryId, size } });
  }
  if (input.url !== undefined) {
    const url = cleanUrl(input.url);
    if (url || input.url === "") await db.brand.update({ where: { id: brand.id }, data: { url } });
  }
}

export async function removeMyBrand(viewer: Viewer, ownerId: string, brandId: string): Promise<void> {
  await assertCanEdit(viewer, ownerId);
  await db.person.update({ where: { id: ownerId }, data: { favoriteBrands: { disconnect: { id: brandId } } } });
  await db.bodySizeByBrand.deleteMany({ where: { personId: ownerId, brandId } });
}
